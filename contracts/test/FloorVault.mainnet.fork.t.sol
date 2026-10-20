// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {SeaportAdapter, ISeaport} from "../src/SeaportAdapter.sol";
import {SeaportOrders, IERC721Test, Listing} from "./utils/SeaportOrders.sol";
import {IMarketplace} from "../src/IMarketplace.sol";
import {FloorVault, INadRouter, INadCreatorFeeVault, IWMON, IRaffle} from "../src/FloorVault.sol";
import {Raffle} from "../src/Raffle.sol";

interface IRouterBuy {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function buyWithNative(BuyParams calldata params) external payable returns (uint256);
}

interface IFeeCollector {
    function accumulatedFee(address pair) external view returns (uint256);
    function settlementThreshold(address pair) external view returns (uint256);
    function isSettleable(address pair) external view returns (bool);
    function settle(address pair, uint256 minAmountOut) external;
}

interface IBondingCurve {
    struct Curve {
        address token;
        address creator;
        address quoteToken;
        uint256 virtualQuoteReserve;
        uint256 virtualTokenReserve;
        uint256 k;
        uint256 minTokenReserve;
        uint256 initialQuoteReserve;
        uint256 initialTokenReserve;
        uint64 createdAtBlock;
        bool graduated;
        uint16 creatorFeeRate;
        uint8 version;
        uint8 dexType;
        address pair;
        uint256 graduateFee;
    }

    function getCurve(address token) external view returns (Curve memory);
}

/// @notice End-to-end test against a fork of Monad MAINNET: the live nad.fun V2 contracts, live Seaport 1.6
/// and the real Chog Genesis collection. Run with: forge test --network monad --match-contract FloorVaultMainnetForkTest -vv
contract FloorVaultMainnetForkTest is SeaportOrders {
    address constant ROUTER = 0x8986C8fD44eb85294A725a7e61AF35E76bA26F91;
    address constant CREATOR_FEE_VAULT = 0x687f9172D5F4798694811333C5C5696afCF4F6f4;
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    address constant FEE_COLLECTOR = 0xE1C8b73343f5A83EBe165BE90470d84B00e33022;
    address constant BONDING_CURVE = 0x9f3832732923252A21044F21eE6bd87F09514ae4;
    address constant FEE_AUTHORITY = 0x71F846A560a4d68F53e5bd34ED084E7992f171C7;
    address constant CHOG = 0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763;

    SeaportAdapter adapter;
    FloorVault vault;
    Raffle raffle;

    uint256 sellerPk = 0xA11CE;
    address creator = makeAddr("creator");
    address nftRecipient = makeAddr("nftRecipient");
    address treasury = makeAddr("treasury");
    address trader = makeAddr("trader");
    address keeper = makeAddr("keeper");
    address feeTo = makeAddr("openseaFee");
    address token;

    function setUp() public {
        vm.createSelectFork("https://rpc.monad.xyz");

        adapter = new SeaportAdapter(ISeaport(SEAPORT));
        address[] memory blocked = new address[](1);
        blocked[0] = BONDING_CURVE;
        raffle = new Raffle(1 hours, 10 minutes, blocked);
        vault = new FloorVault(
            INadRouter(ROUTER),
            INadCreatorFeeVault(CREATOR_FEE_VAULT),
            IWMON(WMON),
            IMarketplace(address(adapter)),
            IRaffle(address(raffle)),
            treasury,
            keeper,
            CHOG
        );
        raffle.init(address(vault));

        vm.deal(creator, 100 ether);
        vm.deal(trader, 1_000_000 ether);

        vm.prank(creator);
        token = vault.launch{value: 20 ether}(_args(CHOG, keccak256("floorvault-mainnet-fork-test")));
    }

    function _args(address collection, bytes32 salt) internal view returns (FloorVault.LaunchArgs memory) {
        return FloorVault.LaunchArgs({
            name: "Mainnet Fork Coin",
            symbol: "MFC",
            tokenURI: "https://example.com/mfc.json",
            creatorFeeRate: 100, // mainnet allows only 100 bps
            salt: salt,
            deadline: block.timestamp + 1 hours,
            collection: collection,
            nftRecipient: nftRecipient,
            devBuy: 0
        });
    }

    /// @dev nad.fun only pays the Creator Fee vault once its own keeper calls `settle` past the pair's threshold.
    function _tradeAndSettle() internal {
        address pair = IBondingCurve(BONDING_CURVE).getCurve(token).pair;
        IFeeCollector fc = IFeeCollector(FEE_COLLECTOR);
        console.log("threshold:", fc.settlementThreshold(pair));

        for (uint256 i = 0; i < 60 && !fc.isSettleable(pair); i++) {
            vm.prank(trader);
            IRouterBuy(ROUTER).buyWithNative{value: 500 ether}(
                IRouterBuy.BuyParams({amountOutMin: 0, token: token, to: trader, deadline: block.timestamp + 1 hours})
            );
        }
        console.log("accumulated:", fc.accumulatedFee(pair));
        require(fc.isSettleable(pair), "never became settleable");

        address nadKeeper = makeAddr("nadfunKeeper");
        vm.mockCall(
            FEE_AUTHORITY,
            abi.encodeWithSignature("canCall(address,address,bytes4)", nadKeeper, FEE_COLLECTOR, IFeeCollector.settle.selector),
            abi.encode(true, uint32(0))
        );
        vm.prank(nadKeeper);
        fc.settle(pair, 0);
    }

    function _chogListing(uint256 tokenId, uint256 price) internal returns (bytes memory) {
        address seller = vm.addr(sellerPk);
        address holder = IERC721Test(CHOG).ownerOf(tokenId);
        vm.prank(holder);
        IERC721Test(CHOG).transferFrom(holder, seller, tokenId);
        (address royaltyTo,) = IERC721Test(CHOG).royaltyInfo(tokenId, 10_000);
        return abi.encode(_signedListing(Listing(sellerPk, CHOG, tokenId, price, royaltyTo, 500, feeTo, 7)));
    }

    function test_launchRecordsChogPairing() public view {
        (address collection, address recipient, uint256 budget) = vault.pairings(token);
        assertEq(collection, CHOG);
        assertEq(recipient, nftRecipient);
        assertEq(budget, 0);
        assertEq(address(vault).balance, 0, "vault must not keep native");
    }

    function test_launchRejectsOtherCollections() public {
        vm.prank(creator);
        vm.expectRevert("collection not supported");
        vault.launch{value: 20 ether}(_args(address(0xBEEF), keccak256("other")));
    }

    function test_harvestSplits80_10_10() public {
        _tradeAndSettle();
        uint256 claimed = vault.harvest(token);
        assertGt(claimed, 0, "no fees claimed");
        (,, uint256 budget) = vault.pairings(token);
        assertEq(IWMON(WMON).balanceOf(treasury), claimed * 1000 / 10_000);
        assertEq(IWMON(WMON).balanceOf(creator), claimed * 1000 / 10_000);
        assertEq(budget, claimed - 2 * (claimed * 1000 / 10_000));
        console.log("claimed (wei):", claimed);
    }

    function test_budgetBuysRealChogListingIntoRaffle() public {
        _tradeAndSettle();
        vault.harvest(token);
        (,, uint256 budgetBefore) = vault.pairings(token);

        uint256 price = budgetBefore / 2;
        bytes memory data = _chogListing(1, price);

        vm.prank(keeper);
        (uint256 id, uint256 paid) = vault.buy(token, price, data);

        assertEq(id, 1);
        assertEq(paid, price, "charged the full listing price incl. royalty and fee");
        assertEq(IERC721Test(CHOG).ownerOf(1), address(raffle), "raffle holds the NFT");
        (,, uint256 budgetAfter) = vault.pairings(token);
        assertEq(budgetAfter, budgetBefore - price);
        assertEq(address(vault).balance, 0);
        assertEq(address(adapter).balance, 0);

        Raffle.RaffleInfo memory r = raffle.getRaffle(1);
        assertEq(r.token, token);
        assertEq(r.collection, CHOG);
        assertEq(r.fallbackTo, nftRecipient);
    }

    function test_buyOnlyByKeeper() public {
        _tradeAndSettle();
        vault.harvest(token);
        (,, uint256 budget) = vault.pairings(token);
        bytes memory data = _chogListing(1, budget / 2);
        vm.expectRevert("not keeper");
        vault.buy(token, budget / 2, data);
    }

    function test_cannotSpendMoreThanBudget() public {
        vm.prank(keeper);
        vm.expectRevert("above budget");
        vault.buy(token, 1 ether, "");
    }

    function test_listingAboveMaxPriceReverts() public {
        _tradeAndSettle();
        vault.harvest(token);
        (,, uint256 budget) = vault.pairings(token);
        bytes memory data = _chogListing(1, budget / 2);
        vm.prank(keeper);
        vm.expectRevert(); // Seaport: not enough native supplied
        vault.buy(token, budget / 2 - 1, data);
    }
}
