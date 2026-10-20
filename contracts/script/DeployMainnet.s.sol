// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IMarketplace} from "../src/IMarketplace.sol";
import {FloorVault, INadRouter, INadCreatorFeeVault, IWMON, IRaffle} from "../src/FloorVault.sol";
import {Raffle} from "../src/Raffle.sol";
import {SeaportAdapter, ISeaport} from "../src/SeaportAdapter.sol";

/// @notice Deploys SeaportAdapter, Raffle and FloorVault on Monad MAINNET (143), wired to the live nad.fun V2
/// contracts and Seaport 1.6, and limited to the Chog Genesis collection. Real funds: unaudited contracts.
///
/// Required env: TREASURY (receives 10% of fees; use a multisig or hardware wallet, not the deployer) and
/// KEEPER (the only address allowed to call `buy`). Optional: RAFFLE_DRAW_DELAY / RAFFLE_SETTLE_WINDOW (seconds).
///
/// Dry run first (no --broadcast simulates against the live chain):
///   TREASURY=0x.. KEEPER=0x.. forge script script/DeployMainnet.s.sol --rpc-url https://rpc.monad.xyz --account <keystore>
contract DeployMainnet is Script {
    address constant ROUTER = 0x8986C8fD44eb85294A725a7e61AF35E76bA26F91;
    address constant CREATOR_FEE_VAULT = 0x687f9172D5F4798694811333C5C5696afCF4F6f4;
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    /// nad.fun bonding curve: holds most of a young coin's supply, so it must never win a raffle.
    address constant BONDING_CURVE = 0x9f3832732923252A21044F21eE6bd87F09514ae4;
    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;
    /// Chog Genesis (CHOG), 1,969 NFTs, ERC-721 with ERC-2981 royalties. The only collection FloorVault will pair.
    address constant CHOG = 0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763;

    // Real holders need time to notice and submit themselves; the claim window is fixed at 7 days in the contract.
    uint64 constant DRAW_DELAY = 1 days;
    uint64 constant SETTLE_WINDOW = 6 hours;

    function run() external {
        require(block.chainid == 143, "Monad mainnet (143) only");
        address treasury = vm.envAddress("TREASURY");
        address keeper = vm.envAddress("KEEPER");
        require(treasury != address(0) && keeper != address(0), "TREASURY and KEEPER are required");

        // Fail early if any hardcoded dependency is missing on the chain we are actually talking to.
        address[6] memory deps = [ROUTER, CREATOR_FEE_VAULT, WMON, BONDING_CURVE, SEAPORT, CHOG];
        for (uint256 i = 0; i < deps.length; i++) {
            require(deps[i].code.length > 0, "dependency has no code");
        }

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        SeaportAdapter adapter = new SeaportAdapter(ISeaport(SEAPORT));
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
            IMarketplace(address(adapter)),
            IRaffle(address(raffle)),
            treasury,
            keeper,
            CHOG
        );
        raffle.init(address(vault));
        vm.stopBroadcast();

        console.log("Deployer:        ", deployer);
        console.log("SeaportAdapter:  ", address(adapter));
        console.log("Raffle:          ", address(raffle));
        console.log("FloorVault:      ", address(vault));
        console.log("Treasury:        ", treasury);
        console.log("Keeper:          ", keeper);
        console.log("Collection:      ", CHOG);
    }
}
