// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TestChog} from "../src/TestChog.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";
import {IMarketplace} from "../src/IMarketplace.sol";
import {FloorVault, INadRouter, INadCreatorFeeVault, IWMON, IRaffle} from "../src/FloorVault.sol";
import {Raffle} from "../src/Raffle.sol";

/// @notice Deploys the Test CHOG collection, a mock marketplace, the Raffle and the FloorVault on
/// Monad testnet (Raffle first, then FloorVault, then Raffle.init), then mints 5 NFTs and lists them at 0.1 to 0.5 MON. FloorVault is wired to the
/// live nad.fun V2 testnet contracts. Treasury is $TREASURY if set, otherwise the deployer.
///
/// forge script script/DeployTestnet.s.sol --rpc-url https://testnet-rpc.monad.xyz \
///   --private-key $PRIVATE_KEY --broadcast
contract DeployTestnet is Script {
    address constant ROUTER = 0x75588668999cA0557b78046b8a5E86b47b9234ec;
    address constant CREATOR_FEE_VAULT = 0xfEB12B7698e296C57BBF9f0c9b38B3e908285A99;
    address constant WMON = 0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd;
    /// nad.fun bonding curve: holds most of a young coin's supply, so it must never win a raffle.
    address constant BONDING_CURVE = 0x27063a38eC0D3281D354090EB92e669Ed1eB956C;
    // Short enough for a live demo. The claim window is fixed at 7 days in the contract.
    uint64 constant DRAW_DELAY = 5 minutes;
    uint64 constant SETTLE_WINDOW = 2 minutes;

    function run() external {
        require(block.chainid == 10143, "Monad testnet (10143) only: nad.fun addresses are hardcoded");
        vm.startBroadcast();
        // Inside run(), msg.sender is Foundry's default sender, not the --private-key wallet.
        (, address deployer,) = vm.readCallers();
        address treasury = vm.envOr("TREASURY", deployer);

        TestChog chog = new TestChog();
        MockMarketplace market = new MockMarketplace();
        address[] memory blocked = new address[](1);
        blocked[0] = BONDING_CURVE;
        Raffle raffle = new Raffle(
            uint64(vm.envOr("RAFFLE_DRAW_DELAY", uint256(DRAW_DELAY))),
            uint64(vm.envOr("RAFFLE_SETTLE_WINDOW", uint256(SETTLE_WINDOW))),
            blocked
        );
        FloorVault vault = new FloorVault(
            INadRouter(ROUTER),
            INadCreatorFeeVault(CREATOR_FEE_VAULT),
            IWMON(WMON),
            IMarketplace(address(market)),
            IRaffle(address(raffle)),
            treasury,
            vm.envOr("KEEPER", deployer), // only this address may call buy
            address(0) // testnet pairs any collection
        );
        raffle.init(address(vault));

        chog.setApprovalForAll(address(market), true);
        for (uint256 i = 1; i <= 5; i++) {
            uint256 tokenId = chog.mint(deployer);
            market.list(address(chog), tokenId, i * 0.1 ether);
        }

        vm.stopBroadcast();

        console.log("TestChog:        ", address(chog));
        console.log("MockMarketplace: ", address(market));
        console.log("Raffle:          ", address(raffle));
        console.log("FloorVault:      ", address(vault));
        console.log("Treasury:        ", treasury);
    }
}
