// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {
    SeaportAdvancedOrder,
    SeaportOrderParameters,
    SeaportOfferItem,
    SeaportConsiderationItem,
    SeaportItemType
} from "../../src/SeaportAdapter.sol";

struct SeaportOrderComponents {
    address offerer;
    address zone;
    SeaportOfferItem[] offer;
    SeaportConsiderationItem[] consideration;
    uint8 orderType;
    uint256 startTime;
    uint256 endTime;
    bytes32 zoneHash;
    uint256 salt;
    bytes32 conduitKey;
    uint256 counter;
}

interface ISeaportViews {
    function getOrderHash(SeaportOrderComponents calldata) external view returns (bytes32);
    function getCounter(address offerer) external view returns (uint256);
    function information() external view returns (string memory, bytes32 domainSeparator, address);
}

interface IERC721Test {
    function ownerOf(uint256) external view returns (address);
    function transferFrom(address, address, uint256) external;
    function setApprovalForAll(address, bool) external;
    function royaltyInfo(uint256, uint256) external view returns (address, uint256);
}

struct Listing {
    uint256 sellerPk;
    address collection;
    uint256 tokenId;
    uint256 price;
    address royaltyTo;
    uint256 royaltyBps;
    address feeTo;
    uint256 salt;
}

/// @dev Builds and signs real Seaport 1.6 listings (open orders, no zone) so tests can exercise the live contract.
abstract contract SeaportOrders is Test {
    address internal constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;

    /// @dev Lists the token from the seller (key `l.sellerPk`) at `l.price`: a royalty and a 1% fee go to the
    /// given recipients, the rest to the seller. Approves Seaport for the collection.
    function _signedListing(Listing memory l) internal returns (SeaportAdvancedOrder memory adv) {
        vm.prank(vm.addr(l.sellerPk));
        IERC721Test(l.collection).setApprovalForAll(SEAPORT, true);

        SeaportOrderParameters memory p = _params(l);
        adv = SeaportAdvancedOrder({
            parameters: p,
            numerator: 1,
            denominator: 1,
            signature: _sign(l.sellerPk, p),
            extraData: ""
        });
    }

    function _params(Listing memory l) private view returns (SeaportOrderParameters memory p) {
        address seller = vm.addr(l.sellerPk);
        SeaportOfferItem[] memory offer = new SeaportOfferItem[](1);
        offer[0] = SeaportOfferItem(SeaportItemType.ERC721, l.collection, l.tokenId, 1, 1);

        uint256 royalty = (l.price * l.royaltyBps) / 10_000;
        uint256 fee = l.price / 100;
        uint256 net = l.price - royalty - fee;
        SeaportConsiderationItem[] memory cons = new SeaportConsiderationItem[](3);
        cons[0] = SeaportConsiderationItem(SeaportItemType.NATIVE, address(0), 0, net, net, payable(seller));
        cons[1] = SeaportConsiderationItem(SeaportItemType.NATIVE, address(0), 0, royalty, royalty, payable(l.royaltyTo));
        cons[2] = SeaportConsiderationItem(SeaportItemType.NATIVE, address(0), 0, fee, fee, payable(l.feeTo));

        p = SeaportOrderParameters({
            offerer: seller,
            zone: address(0),
            offer: offer,
            consideration: cons,
            orderType: 0, // FULL_OPEN
            startTime: block.timestamp - 1,
            endTime: block.timestamp + 1 days,
            zoneHash: bytes32(0),
            salt: l.salt,
            conduitKey: bytes32(0),
            totalOriginalConsiderationItems: 3
        });
    }

    function _sign(uint256 sellerPk, SeaportOrderParameters memory p) private view returns (bytes memory) {
        SeaportOrderComponents memory c = SeaportOrderComponents({
            offerer: p.offerer,
            zone: p.zone,
            offer: p.offer,
            consideration: p.consideration,
            orderType: p.orderType,
            startTime: p.startTime,
            endTime: p.endTime,
            zoneHash: p.zoneHash,
            salt: p.salt,
            conduitKey: p.conduitKey,
            counter: ISeaportViews(SEAPORT).getCounter(p.offerer)
        });
        (, bytes32 domainSeparator,) = ISeaportViews(SEAPORT).information();
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, ISeaportViews(SEAPORT).getOrderHash(c)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
