// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMarketplace} from "./IMarketplace.sol";

enum SeaportItemType {
    NATIVE,
    ERC20,
    ERC721,
    ERC1155,
    ERC721_WITH_CRITERIA,
    ERC1155_WITH_CRITERIA
}

struct SeaportOfferItem {
    SeaportItemType itemType;
    address token;
    uint256 identifierOrCriteria;
    uint256 startAmount;
    uint256 endAmount;
}

struct SeaportConsiderationItem {
    SeaportItemType itemType;
    address token;
    uint256 identifierOrCriteria;
    uint256 startAmount;
    uint256 endAmount;
    address payable recipient;
}

struct SeaportOrderParameters {
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
    uint256 totalOriginalConsiderationItems;
}

struct SeaportAdvancedOrder {
    SeaportOrderParameters parameters;
    uint120 numerator;
    uint120 denominator;
    bytes signature;
    bytes extraData;
}

struct SeaportCriteriaResolver {
    uint256 orderIndex;
    uint8 side;
    uint256 index;
    uint256 identifier;
    bytes32[] criteriaProof;
}

interface ISeaport {
    function fulfillAdvancedOrder(
        SeaportAdvancedOrder calldata advancedOrder,
        SeaportCriteriaResolver[] calldata criteriaResolvers,
        bytes32 fulfillerConduitKey,
        address recipient
    ) external payable returns (bool fulfilled);
}

interface IERC721OwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Buys one listing of one NFT collection through Seaport 1.6 (OpenSea).
/// @dev `data` is `abi.encode(SeaportAdvancedOrder)`: the signed order as returned by OpenSea, including
/// the signed-zone `extraData` for restricted orders. That zone signature commits to the fulfiller, so ask
/// OpenSea for fulfillment data with this adapter's address as the fulfiller.
///
/// The adapter checks that the order sells exactly one ERC-721 token of `collection`, lets Seaport pull
/// the price from msg.value, and requires the NFT to have landed at `to`. The price is whatever Seaport
/// kept of msg.value (sale price plus any fee and royalty considerations), refunded remainder excluded.
/// Hackathon code, unaudited. It holds no funds or approvals between calls.
contract SeaportAdapter is IMarketplace {
    ISeaport public immutable seaport;

    constructor(ISeaport seaport_) {
        seaport = seaport_;
    }

    function buyListing(address collection, uint256 maxPrice, address to, bytes calldata data)
        external
        payable
        returns (uint256 tokenId, uint256 price)
    {
        require(msg.value == maxPrice, "send exactly maxPrice");
        SeaportAdvancedOrder memory order = abi.decode(data, (SeaportAdvancedOrder));

        SeaportOrderParameters memory p = order.parameters;
        require(p.offer.length == 1, "order must sell one item");
        require(p.offer[0].itemType == SeaportItemType.ERC721, "not a plain ERC-721 item");
        require(p.offer[0].token == collection, "wrong collection");
        require(order.numerator == order.denominator, "partial fill");
        tokenId = p.offer[0].identifierOrCriteria;

        uint256 balanceBefore = address(this).balance - msg.value;
        bool ok = seaport.fulfillAdvancedOrder{value: msg.value}(order, new SeaportCriteriaResolver[](0), bytes32(0), to);
        require(ok, "seaport did not fulfill");
        require(IERC721OwnerOf(collection).ownerOf(tokenId) == to, "NFT not delivered");

        uint256 refund = address(this).balance - balanceBefore;
        price = msg.value - refund;
        if (refund > 0) {
            (bool sent,) = msg.sender.call{value: refund}("");
            require(sent, "refund failed");
        }
    }

    /// @dev Seaport returns unspent native value to its caller, which is this contract.
    receive() external payable {}
}
