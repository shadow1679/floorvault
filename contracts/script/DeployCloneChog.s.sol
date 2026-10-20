// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CloneChog} from "../src/CloneChog.sol";
import {MockMarketplace} from "../src/MockMarketplace.sol";

/// @notice Deploys CloneChog on Monad testnet, mints the mainnet Chog Genesis tokenURIs listed in
/// script/data/chog-uris.json to the deployer and lists every token on an existing MockMarketplace with a low floor:
/// FIRST_PRICE for the first token, then +PRICE_STEP per token (defaults 0.05 MON and 0.01 MON).
///
/// Required env: MARKET (the MockMarketplace the vault under demo uses, `NEXT_PUBLIC_MOCK_MARKETPLACE_ADDRESS`).
///
/// forge script script/DeployCloneChog.s.sol --rpc-url https://testnet-rpc.monad.xyz \
///   --account launcher-deployer --password-file ~/.foundry/keystores/.launcher-deployer.pass --broadcast
contract DeployCloneChog is Script {
    function run() external {
        require(block.chainid == 10143, "Monad testnet (10143) only: CloneChog has an open mint");
        MockMarketplace market = MockMarketplace(vm.envAddress("MARKET"));
        require(address(market).code.length > 0, "MARKET has no code");
        uint256 firstPrice = vm.envOr("FIRST_PRICE", uint256(0.05 ether));
        uint256 priceStep = vm.envOr("PRICE_STEP", uint256(0.01 ether));

        string[] memory uris = vm.parseJsonStringArray(vm.readFile("script/data/chog-uris.json"), "$");
        require(uris.length > 0, "no tokenURIs");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        CloneChog chog = new CloneChog();
        uint256 firstId = chog.mintBatch(deployer, uris);
        chog.setApprovalForAll(address(market), true);
        for (uint256 i = 0; i < uris.length; i++) {
            market.list(address(chog), firstId + i, firstPrice + i * priceStep);
        }
        vm.stopBroadcast();

        console.log("CloneChog:  ", address(chog));
        console.log("Marketplace:", address(market));
        console.log("Listed:     ", uris.length);
        console.log("Floor (wei):", firstPrice);
    }
}
