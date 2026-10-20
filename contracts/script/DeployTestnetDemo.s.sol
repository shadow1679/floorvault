// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IMarketplace} from "../src/IMarketplace.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";
import {TestChog} from "../src/TestChog.sol";
import {INadRouter, INadCreatorFeeVault, IWMON, IRaffle} from "../src/FloorVault.sol";
import {FloorVaultDemo, DemoFeePot} from "../src/FloorVaultDemo.sol";
import {Raffle} from "../src/Raffle.sol";

/// @notice Deploys a second, demo-only vault (plus its Raffle, fee pot and a fresh mock marketplace) on Monad
/// testnet next to the existing deployment, reusing its Test CHOG. The original marketplace predates
/// `buyListing`, so the demo vault needs its own. The demo vault's `harvest` also drains the pot, so a coin's
/// budget can be filled without waiting for nad.fun to settle ~100 MON of real fees.
///
/// forge script script/DeployTestnetDemo.s.sol --rpc-url https://testnet-rpc.monad.xyz \
///   --account launcher-deployer --password-file ~/.foundry/keystores/.launcher-deployer.pass --broadcast
contract DeployTestnetDemo is Script {
    address constant ROUTER = 0x75588668999cA0557b78046b8a5E86b47b9234ec;
    address constant CREATOR_FEE_VAULT = 0xfEB12B7698e296C57BBF9f0c9b38B3e908285A99;
    address constant WMON = 0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd;
    address constant BONDING_CURVE = 0x27063a38eC0D3281D354090EB92e669Ed1eB956C;
    /// Existing testnet Test CHOG (see web/.env.local); `mint` is open to anyone.
    address constant TEST_CHOG = 0xC9213E85a516657F383002C25064CD9d84e4e347;
    uint64 constant DRAW_DELAY = 5 minutes;
    uint64 constant SETTLE_WINDOW = 2 minutes;

    function run() external {
        require(block.chainid == 10143, "Monad testnet (10143) only: demo vault must never reach mainnet");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        MockMarketplace market = new MockMarketplace();
        address[] memory blocked = new address[](1);
        blocked[0] = BONDING_CURVE;
        Raffle raffle = new Raffle(
            uint64(vm.envOr("RAFFLE_DRAW_DELAY", uint256(DRAW_DELAY))),
            uint64(vm.envOr("RAFFLE_SETTLE_WINDOW", uint256(SETTLE_WINDOW))),
            blocked
        );
        DemoFeePot pot = new DemoFeePot();
        FloorVaultDemo vault = new FloorVaultDemo(
            INadRouter(ROUTER),
            INadCreatorFeeVault(CREATOR_FEE_VAULT),
            IWMON(WMON),
            IMarketplace(address(market)),
            IRaffle(address(raffle)),
            deployer, // treasury
            deployer, // keeper: only this address may call buy
            address(0), // testnet pairs any collection
            pot
        );
        raffle.init(address(vault));
        pot.init(address(vault));

        TestChog chog = TestChog(TEST_CHOG);
        chog.setApprovalForAll(address(market), true);
        for (uint256 i = 1; i <= 6; i++) {
            market.list(TEST_CHOG, chog.mint(deployer), i * 0.05 ether);
        }
        vm.stopBroadcast();

        console.log("Marketplace:  ", address(market));
        console.log("Raffle:       ", address(raffle));
        console.log("DemoFeePot:   ", address(pot));
        console.log("FloorVaultDemo:", address(vault));
    }
}
