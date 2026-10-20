// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestChog} from "../src/TestChog.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";

contract MockMarketplaceTest is Test {
    TestChog chog;
    MockMarketplace market;

    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address recipient = makeAddr("recipient");

    function setUp() public {
        chog = new TestChog();
        market = new MockMarketplace();
        vm.deal(buyer, 100 ether);

        vm.startPrank(seller);
        chog.setApprovalForAll(address(market), true);
        market.list(address(chog), chog.mint(seller), 3 ether); // id 1
        market.list(address(chog), chog.mint(seller), 1 ether); // id 2, the floor
        market.list(address(chog), chog.mint(seller), 2 ether); // id 3
        vm.stopPrank();
    }

    function test_floorIsCheapestListing() public view {
        (uint256 id, uint256 price) = market.floor(address(chog));
        assertEq(id, 2);
        assertEq(price, 1 ether);
    }

    function test_buyFloorSendsNftPaysSellerRefundsExcess() public {
        uint256 sellerBefore = seller.balance;
        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        (uint256 id, uint256 price) = market.buyFloor{value: 5 ether}(address(chog), 1 ether, recipient);

        assertEq(id, 2);
        assertEq(price, 1 ether);
        assertEq(chog.ownerOf(2), recipient);
        assertEq(seller.balance, sellerBefore + 1 ether);
        assertEq(buyer.balance, buyerBefore - 1 ether);
        assertEq(address(market).balance, 0);
    }

    function test_nextBuyTakesNextCheapest() public {
        vm.startPrank(buyer);
        market.buyFloor{value: 1 ether}(address(chog), 1 ether, recipient);
        (uint256 id, uint256 price) = market.buyFloor{value: 2 ether}(address(chog), 2 ether, recipient);
        vm.stopPrank();
        assertEq(id, 3);
        assertEq(price, 2 ether);
    }

    function test_revertsWhenFloorAboveMaxPrice() public {
        vm.prank(buyer);
        vm.expectRevert("floor above max price");
        market.buyFloor{value: 5 ether}(address(chog), 0.5 ether, recipient);
    }

    function test_revertsWhenUnderpaid() public {
        vm.prank(buyer);
        vm.expectRevert("insufficient payment");
        market.buyFloor{value: 0.5 ether}(address(chog), 1 ether, recipient);
    }

    function test_revertsWhenNoListings() public {
        vm.expectRevert("no listings");
        market.floor(makeAddr("otherCollection"));
    }

    function test_cancelReturnsNftAndRemovesFromFloor() public {
        vm.prank(seller);
        market.cancel(address(chog), 2);
        assertEq(chog.ownerOf(2), seller);
        (uint256 id,) = market.floor(address(chog));
        assertEq(id, 3);
    }

    function test_onlySellerCanCancel() public {
        vm.prank(buyer);
        vm.expectRevert("not seller");
        market.cancel(address(chog), 2);
    }

    function test_cannotBuySameListingTwice() public {
        vm.startPrank(buyer);
        market.buyFloor{value: 1 ether}(address(chog), 1 ether, recipient);
        (uint256 id,) = market.buyFloor{value: 2 ether}(address(chog), 2 ether, recipient);
        vm.stopPrank();
        assertTrue(id != 2);
    }
}
