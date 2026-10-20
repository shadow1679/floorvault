// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CloneChog} from "../src/CloneChog.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";

contract CloneChogTest is Test {
    CloneChog chog;
    MockMarketplace market;
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");

    string constant URI_A = "ipfs://bafy/1462.json";
    string constant URI_B = "ipfs://bafy/1463.json";

    function setUp() public {
        chog = new CloneChog();
        market = new MockMarketplace();
        vm.deal(buyer, 10 ether);
    }

    function _two() internal pure returns (string[] memory uris) {
        uris = new string[](2);
        uris[0] = URI_A;
        uris[1] = URI_B;
    }

    function test_mintBatchKeepsEachUri() public {
        uint256 first = chog.mintBatch(seller, _two());
        assertEq(first, 1);
        assertEq(chog.totalSupply(), 2);
        assertEq(chog.balanceOf(seller), 2);
        assertEq(chog.tokenURI(1), URI_A);
        assertEq(chog.tokenURI(2), URI_B);
    }

    function test_mintBatchContinuesAfterEarlierMints() public {
        chog.mint(seller, URI_A);
        assertEq(chog.mintBatch(seller, _two()), 2);
        assertEq(chog.tokenURI(3), URI_B);
    }

    function test_tokenURIRevertsForUnmintedToken() public {
        vm.expectRevert("nonexistent token");
        chog.tokenURI(1);
    }

    function test_royaltyIsFivePercent() public view {
        (address receiver, uint256 amount) = chog.royaltyInfo(1, 2 ether);
        assertEq(receiver, chog.ROYALTY_RECEIVER());
        assertEq(amount, 0.1 ether);
    }

    function test_supportsMetadataAndRoyaltyInterfaces() public view {
        assertTrue(chog.supportsInterface(0x80ac58cd));
        assertTrue(chog.supportsInterface(0x5b5e139f));
        assertTrue(chog.supportsInterface(0x2a55205a));
        assertFalse(chog.supportsInterface(0xffffffff));
    }

    function test_worksWithMockMarketplaceAndKeepsUriAfterSale() public {
        chog.mintBatch(seller, _two());
        vm.startPrank(seller);
        chog.setApprovalForAll(address(market), true);
        market.list(address(chog), 1, 0.2 ether);
        market.list(address(chog), 2, 0.05 ether);
        vm.stopPrank();

        (uint256 id, uint256 price) = market.floor(address(chog));
        assertEq(id, 2);
        assertEq(price, 0.05 ether);

        vm.prank(buyer);
        market.buyFloor{value: 0.05 ether}(address(chog), 0.05 ether, buyer);
        assertEq(chog.ownerOf(2), buyer);
        assertEq(chog.tokenURI(2), URI_B);
    }
}
