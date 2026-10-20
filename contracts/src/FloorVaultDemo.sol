// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FloorVault, INadRouter, INadCreatorFeeVault, IWMON, IRaffle} from "./FloorVault.sol";
import {IMarketplace} from "./IMarketplace.sol";

/// @notice Holds native MON that stands in for nad.fun creator fees on testnet. Only the demo vault can pull it.
/// @dev TESTNET ONLY. nad.fun settles real creator fees after about 100 MON, so a testnet demo cannot reach a harvest.
contract DemoFeePot {
    address public vault;
    mapping(address token => uint256) public pot;

    event Funded(address indexed token, address indexed from, uint256 amount);

    /// @notice One-shot wiring, like `Raffle.init`.
    function init(address vault_) external {
        require(vault == address(0), "already init");
        vault = vault_;
    }

    function fund(address token) external payable {
        pot[token] += msg.value;
        emit Funded(token, msg.sender, msg.value);
    }

    function claim(address token) external returns (uint256 amount) {
        require(msg.sender == vault, "not vault");
        amount = pot[token];
        if (amount == 0) return 0;
        pot[token] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "pot transfer failed");
    }
}

/// @notice FloorVault whose `harvest` also drains a pre-funded `DemoFeePot`, so budgets can be filled on testnet.
/// @dev TESTNET ONLY. Launch still routes the creator fee to nad.fun's real Creator Fee vault, because the
/// router rejects unknown vaults. Never deploy this on mainnet.
contract FloorVaultDemo is FloorVault {
    DemoFeePot public immutable demoPot;

    constructor(
        INadRouter router_,
        INadCreatorFeeVault creatorFeeVault_,
        IWMON wmon_,
        IMarketplace market_,
        IRaffle raffle_,
        address treasury_,
        address keeper_,
        address allowedCollection_,
        DemoFeePot demoPot_
    ) FloorVault(router_, creatorFeeVault_, wmon_, market_, raffle_, treasury_, keeper_, allowedCollection_) {
        demoPot = demoPot_;
    }

    function _claimFees(address token) internal override {
        // Real fees first: this reverts with ZeroBalance until nad.fun settles, which is expected here.
        try creatorFeeVault.claim(token) {} catch {}
        demoPot.claim(token);
    }
}
