// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {TestChog} from "../src/TestChog.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";
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

/// @notice End-to-end test against a fork of Monad testnet and the live nad.fun V2 contracts.
/// Run with network access: forge test --match-contract FloorVaultForkTest -vv
contract FloorVaultForkTest is Test {
    address constant ROUTER = 0x75588668999cA0557b78046b8a5E86b47b9234ec;
    address constant CREATOR_FEE_VAULT = 0xfEB12B7698e296C57BBF9f0c9b38B3e908285A99;
    address constant WMON = 0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd;
    address constant FEE_COLLECTOR = 0x653cf4297fB3f7804173b8449950E20812DD6dC3;
    address constant BONDING_CURVE = 0x27063a38eC0D3281D354090EB92e669Ed1eB956C;
    address constant FEE_AUTHORITY = 0x2F98030aBD7c59e3E5Dc6b4b66b6008821d0fB41;

    TestChog chog;
    MockMarketplace market;
    FloorVault vault;
    Raffle raffle;

    address creator = makeAddr("creator");
    address nftRecipient = makeAddr("nftRecipient");
    address treasury = makeAddr("treasury");
    address trader = makeAddr("trader");
    address token;

    // The test contract is the NFT seller, so it must be able to receive MON.
    receive() external payable {}

    function setUp() public {
        vm.createSelectFork("https://testnet-rpc.monad.xyz");

        chog = new TestChog();
        market = new MockMarketplace();
        chog.setApprovalForAll(address(market), true);
        market.list(address(chog), chog.mint(address(this)), 0.5 ether);
        market.list(address(chog), chog.mint(address(this)), 0.01 ether);
        market.list(address(chog), chog.mint(address(this)), 0.02 ether);

        address[] memory blocked = new address[](1);
        blocked[0] = BONDING_CURVE;
        raffle = new Raffle(1 hours, 10 minutes, blocked);
        vault = new FloorVault(
            INadRouter(ROUTER),
            INadCreatorFeeVault(CREATOR_FEE_VAULT),
            IWMON(WMON),
            IMarketplace(address(market)),
            IRaffle(address(raffle)),
            treasury,
            address(this), // keeper
            address(0) // any collection
        );
        raffle.init(address(vault));

        vm.deal(creator, 100 ether);
        vm.deal(trader, 100_000 ether);

        vm.prank(creator);
        token = vault.launch{value: 20 ether}(
            FloorVault.LaunchArgs({
                name: "Fork Test Coin",
                symbol: "FTC",
                tokenURI: "https://example.com/ftc.json",
                creatorFeeRate: 500, // testnet allows 100, 300, 500 bps
                salt: keccak256("floorvault-fork-test"),
                deadline: block.timestamp + 1 hours,
                collection: address(chog),
                nftRecipient: nftRecipient,
                devBuy: 0
            })
        );
    }

    /// @dev nad.fun holds creator fees in the FeeCollector and only pays them into the Creator
    /// Fee vault when `settle` is called once accumulated fees pass the pair's threshold.
    /// So: trade until settleable, settle (from an unrelated caller), then the vault can claim.
    function _tradeAndSettle() internal {
        address pair = IBondingCurve(BONDING_CURVE).getCurve(token).pair;
        IFeeCollector fc = IFeeCollector(FEE_COLLECTOR);
        console.log("threshold:", fc.settlementThreshold(pair));

        for (uint256 i = 0; i < 40 && !fc.isSettleable(pair); i++) {
            vm.prank(trader);
            IRouterBuy(ROUTER).buyWithNative{value: 500 ether}(
                IRouterBuy.BuyParams({
                    amountOutMin: 0,
                    token: token,
                    to: trader,
                    deadline: block.timestamp + 1 hours
                })
            );
        }
        console.log("accumulated:", fc.accumulatedFee(pair));
        require(fc.isSettleable(pair), "never became settleable");

        // `settle` is access-managed: on the real testnet only nad.fun's own keeper may call it
        // (a random caller reverts AccessManagedUnauthorized). Stand in for that keeper.
        address keeper = makeAddr("nadfunKeeper");
        vm.mockCall(
            FEE_AUTHORITY,
            abi.encodeWithSignature("canCall(address,address,bytes4)", keeper, FEE_COLLECTOR, IFeeCollector.settle.selector),
            abi.encode(true, uint32(0))
        );
        vm.prank(keeper);
        fc.settle(pair, 0);
        console.log("accumulated after settle:", fc.accumulatedFee(pair));
    }

    function test_launchRecordsPairingAndRefundsExcess() public view {
        (address collection, address recipient, uint256 budget) = vault.pairings(token);
        assertEq(collection, address(chog));
        assertEq(recipient, nftRecipient);
        assertEq(budget, 0);
        assertEq(address(vault).balance, 0, "vault must not keep native");
        console.log("create fee paid (wei):", 100 ether - creator.balance);
    }

    function test_tradesFundVaultAndHarvestSplits80_10_10() public {
        _tradeAndSettle();

        uint256 claimed = vault.harvest(token);
        assertGt(claimed, 0, "no fees claimed");

        uint256 toTreasury = IWMON(WMON).balanceOf(treasury);
        (,, uint256 budget) = vault.pairings(token);
        uint256 toCreator = IWMON(WMON).balanceOf(creator);
        assertEq(toTreasury, claimed * 1000 / 10_000, "treasury gets 10%");
        assertEq(toCreator, claimed * 1000 / 10_000, "creator gets 10%");
        assertEq(budget, claimed - toTreasury - toCreator, "budget gets 80%");
        assertEq(toTreasury + toCreator + budget, claimed);

        console.log("claimed:", claimed);
        console.log("treasury:", toTreasury);
        console.log("budget:", budget);
    }

    function test_budgetBuysFloorNftIntoRaffle() public {
        _tradeAndSettle();
        vault.harvest(token);
        (,, uint256 budgetBefore) = vault.pairings(token);

        (uint256 id, uint256 price) = vault.buy(token, 0.01 ether, "");

        assertEq(price, 0.01 ether, "bought the floor");
        assertEq(chog.ownerOf(id), address(raffle), "NFT is held by the raffle");
        Raffle.RaffleInfo memory r = raffle.getRaffle(1);
        assertEq(r.token, token, "raffle is scoped to the paired coin");
        assertEq(r.tokenId, id);
        assertEq(r.fallbackTo, nftRecipient, "recorded recipient is the fallback");
        (,, uint256 budgetAfter) = vault.pairings(token);
        assertEq(budgetAfter, budgetBefore - price);
        assertEq(address(vault).balance, 0);
    }

    function test_cannotBuyAboveBudget() public {
        vm.expectRevert("above budget");
        vault.buy(token, 1 ether, "");
    }

    function test_cannotRelaunchSameToken() public {
        vm.prank(creator);
        vm.expectRevert();
        vault.launch{value: 20 ether}(
            FloorVault.LaunchArgs({
                name: "Fork Test Coin",
                symbol: "FTC",
                tokenURI: "https://example.com/ftc.json",
                creatorFeeRate: 500,
                salt: keccak256("floorvault-fork-test"),
                deadline: block.timestamp + 1 hours,
                collection: address(chog),
                nftRecipient: nftRecipient,
                devBuy: 0
            })
        );
    }

    /// @dev The dev buy is paid from msg.value on top of the create fee, and the coins reach the creator, not the vault.
    function test_devBuyGoesToCreator() public {
        uint256 before = creator.balance;
        vm.prank(creator);
        address coin = vault.launch{value: 30 ether}(
            FloorVault.LaunchArgs({
                name: "Dev Buy Coin",
                symbol: "DBC",
                tokenURI: "https://example.com/dbc.json",
                creatorFeeRate: 500,
                salt: keccak256("floorvault-fork-test-devbuy"),
                deadline: block.timestamp + 1 hours,
                collection: address(chog),
                nftRecipient: nftRecipient,
                devBuy: 10 ether
            })
        );
        uint256 got = IWMON(coin).balanceOf(creator);
        assertGt(got, 0, "creator holds the dev buy");
        assertEq(IWMON(coin).balanceOf(address(vault)), 0, "vault keeps none");
        console.log("dev buy tokens:", got);
        console.log("MON spent:", before - creator.balance);
        assertLe(before - creator.balance, 20 ether, "create fee + dev buy, excess refunded");
    }

    function test_unknownTokenReverts() public {
        vm.expectRevert("unknown token");
        vault.harvest(makeAddr("notOurs"));
    }
}
