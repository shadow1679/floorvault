// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SeaportOrders, IERC721Test, Listing} from "./utils/SeaportOrders.sol";
import {SeaportAdapter, ISeaport, SeaportAdvancedOrder} from "../src/SeaportAdapter.sol";

/// @notice SeaportAdapter against live Seaport 1.6 and the real Chog Genesis collection on a Monad mainnet fork.
/// Run with network access: forge test --match-contract SeaportAdapterForkTest -vv
contract SeaportAdapterForkTest is SeaportOrders {
    address constant CHOG = 0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763;

    SeaportAdapter adapter;
    uint256 sellerPk = 0xA11CE;
    address seller;
    address royaltyTo;
    address feeTo = makeAddr("openseaFee");
    address recipient = makeAddr("recipient"); // stands in for the Raffle: a plain address
    uint256 tokenId = 1;
    uint256 royaltyBps;

    // This contract plays the vault: it sends value and receives refunds.
    receive() external payable {}

    function setUp() public {
        vm.createSelectFork("https://rpc.monad.xyz");
        adapter = new SeaportAdapter(ISeaport(SEAPORT));
        seller = vm.addr(sellerPk);

        (royaltyTo, ) = IERC721Test(CHOG).royaltyInfo(tokenId, 10_000);
        royaltyBps = 500;
        // Give the seller a real Chog Genesis token.
        address holder = IERC721Test(CHOG).ownerOf(tokenId);
        vm.prank(holder);
        IERC721Test(CHOG).transferFrom(holder, seller, tokenId);
    }

    function _list(uint256 price) internal returns (bytes memory) {
        return abi.encode(
            _signedListing(Listing(sellerPk, CHOG, tokenId, price, royaltyTo, royaltyBps, feeTo, 1))
        );
    }

    function test_buysListingAndPaysEveryRecipient() public {
        uint256 price = 100 ether;
        bytes memory data = _list(price);
        uint256 sellerBefore = seller.balance;
        uint256 royaltyBefore = royaltyTo.balance;

        (uint256 id, uint256 paid) = adapter.buyListing{value: price}(CHOG, price, recipient, data);

        assertEq(id, tokenId);
        assertEq(paid, price, "price covers sale, royalty and fee");
        assertEq(IERC721Test(CHOG).ownerOf(tokenId), recipient, "NFT delivered");
        assertEq(seller.balance - sellerBefore, price - price * 500 / 10_000 - price / 100);
        assertEq(royaltyTo.balance - royaltyBefore, price * 500 / 10_000);
        assertEq(feeTo.balance, price / 100);
        assertEq(address(adapter).balance, 0, "adapter keeps nothing");
    }

    function test_refundsWhenMaxPriceExceedsRealPrice() public {
        uint256 price = 100 ether;
        bytes memory data = _list(price);
        uint256 before = address(this).balance;

        (, uint256 paid) = adapter.buyListing{value: 150 ether}(CHOG, 150 ether, recipient, data);

        assertEq(paid, price, "reports what Seaport kept");
        assertEq(before - address(this).balance, price, "excess came back");
        assertEq(address(adapter).balance, 0);
    }

    function test_revertsWhenMaxPriceBelowPrice() public {
        bytes memory data = _list(100 ether);
        vm.expectRevert(); // Seaport: InsufficientNativeTokensSupplied
        adapter.buyListing{value: 99 ether}(CHOG, 99 ether, recipient, data);
    }

    function test_revertsForWrongCollection() public {
        bytes memory data = _list(100 ether);
        vm.expectRevert("wrong collection");
        adapter.buyListing{value: 100 ether}(address(0xBEEF), 100 ether, recipient, data);
    }

    function test_revertsWhenValueDiffersFromMaxPrice() public {
        bytes memory data = _list(100 ether);
        vm.expectRevert("send exactly maxPrice");
        adapter.buyListing{value: 100 ether}(CHOG, 101 ether, recipient, data);
    }

    function test_revertsWhenListingExpired() public {
        bytes memory data = _list(100 ether);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(); // Seaport: OrderIsCancelled / expired
        adapter.buyListing{value: 100 ether}(CHOG, 100 ether, recipient, data);
    }

    function test_cannotBuyTheSameListingTwice() public {
        bytes memory data = _list(100 ether);
        adapter.buyListing{value: 100 ether}(CHOG, 100 ether, recipient, data);
        vm.expectRevert(); // Seaport: OrderAlreadyFilled
        adapter.buyListing{value: 100 ether}(CHOG, 100 ether, recipient, data);
    }

    function test_revertsOnTamperedSignature() public {
        SeaportAdvancedOrder memory adv = abi.decode(_list(100 ether), (SeaportAdvancedOrder));
        adv.parameters.consideration[0].startAmount -= 1 ether; // seller "gets" less than they signed for
        adv.parameters.consideration[0].endAmount -= 1 ether;
        vm.expectRevert(); // Seaport: InvalidSigner
        adapter.buyListing{value: 100 ether}(CHOG, 100 ether, recipient, abi.encode(adv));
    }
}
