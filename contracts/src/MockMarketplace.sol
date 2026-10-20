// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMarketplace} from "./IMarketplace.sol";

interface IERC721Like {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @notice Minimal escrow marketplace for Monad testnet, where Seaport is not deployed.
/// @dev TESTNET ONLY. Anyone can list; NFTs are held in escrow until bought or cancelled.
/// Floor lookup loops over a collection's listings, so keep listing counts small.
contract MockMarketplace is IMarketplace {
    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    mapping(address => mapping(uint256 => Listing)) public listings;
    mapping(address => uint256[]) private _listedIds;

    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(address indexed collection, uint256 indexed tokenId);
    event Bought(address indexed collection, uint256 indexed tokenId, address indexed to, uint256 price);

    function list(address collection, uint256 tokenId, uint256 price) external {
        require(price > 0, "price is zero");
        require(!listings[collection][tokenId].active, "already listed");
        listings[collection][tokenId] = Listing(msg.sender, price, true);
        _listedIds[collection].push(tokenId);
        IERC721Like(collection).transferFrom(msg.sender, address(this), tokenId);
        emit Listed(collection, tokenId, msg.sender, price);
    }

    function cancel(address collection, uint256 tokenId) external {
        Listing memory l = listings[collection][tokenId];
        require(l.active, "not listed");
        require(l.seller == msg.sender, "not seller");
        listings[collection][tokenId].active = false;
        IERC721Like(collection).transferFrom(address(this), msg.sender, tokenId);
        emit Cancelled(collection, tokenId);
    }

    function floor(address collection) public view returns (uint256 tokenId, uint256 price) {
        uint256[] storage ids = _listedIds[collection];
        bool found;
        for (uint256 i = 0; i < ids.length; i++) {
            Listing storage l = listings[collection][ids[i]];
            if (l.active && (!found || l.price < price)) {
                tokenId = ids[i];
                price = l.price;
                found = true;
            }
        }
        require(found, "no listings");
    }

    function buyFloor(address collection, uint256 maxPrice, address to)
        external
        payable
        returns (uint256 tokenId, uint256 price)
    {
        return _buyFloor(collection, maxPrice, to);
    }

    /// @dev `data` is ignored: the mock always sells its own cheapest listing.
    function buyListing(address collection, uint256 maxPrice, address to, bytes calldata)
        external
        payable
        returns (uint256 tokenId, uint256 price)
    {
        return _buyFloor(collection, maxPrice, to);
    }

    function _buyFloor(address collection, uint256 maxPrice, address to) internal returns (uint256 tokenId, uint256 price) {
        (tokenId, price) = floor(collection);
        require(price <= maxPrice, "floor above max price");
        require(msg.value >= price, "insufficient payment");

        address seller = listings[collection][tokenId].seller;
        listings[collection][tokenId].active = false;

        IERC721Like(collection).transferFrom(address(this), to, tokenId);

        (bool paid,) = seller.call{value: price}("");
        require(paid, "seller payment failed");

        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            require(refunded, "refund failed");
        }
        emit Bought(collection, tokenId, to, price);
    }
}
