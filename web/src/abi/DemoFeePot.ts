// Hand-written subset of contracts/src/FloorVaultDemo.sol (testnet demo only). Not generated.
export const demoFeePotAbi = [
  {
    type: "function",
    name: "fund",
    stateMutability: "payable",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pot",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
  },
] as const;

/** Only `FloorVaultDemo` has this; the regular FloorVault reverts, which is how the UI tells them apart. */
export const floorVaultDemoAbi = [
  {
    type: "function",
    name: "demoPot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "contract DemoFeePot" }],
  },
] as const;
