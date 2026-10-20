// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What the fee vault needs from an NFT marketplace.
/// @dev Testnet: MockMarketplace (ignores `data`, buys its own cheapest listing). Mainnet: SeaportAdapter,
/// where `data` carries a signed Seaport order chosen off-chain, because Seaport has no on-chain floor.
interface IMarketplace {
    /// @notice Buy one listing of `collection` for at most `maxPrice` of the native MON sent as msg.value.
    /// The NFT is sent to `to`. Any unspent part of msg.value is refunded to msg.sender.
    /// @param data Marketplace-specific listing data (see the implementation).
    function buyListing(address collection, uint256 maxPrice, address to, bytes calldata data)
        external
        payable
        returns (uint256 tokenId, uint256 price);
}
