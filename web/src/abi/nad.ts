// The slice of nad.fun V2 (testnet) that the coin page uses. Copied from the official ABI JSON in
// github.com/Naddotfun/nadfun-v2-intergration (abi/NadFunRouter.json, abi/BondingCurve.json).

const tradeParams = (withAmountIn: boolean) =>
  [
    ...(withAmountIn ? [{ name: "amountIn", type: "uint256" }] : []),
    { name: "amountOutMin", type: "uint256" },
    { name: "token", type: "address" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ] as const;

export const nadRouterAbi = [
  {
    type: "function",
    name: "buyWithNative",
    stateMutability: "payable",
    inputs: [{ name: "params", type: "tuple", components: tradeParams(false) }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellToNative",
    stateMutability: "nonpayable",
    inputs: [{ name: "params", type: "tuple", components: tradeParams(true) }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAmountOut",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "isBuy", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "graduated", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "graduated", type: "bool", indexed: false },
    ],
  },
] as const;

export const bondingCurveAbi = [
  {
    type: "function",
    name: "getCurve",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "creator", type: "address" },
          { name: "quoteToken", type: "address" },
          { name: "virtualQuoteReserve", type: "uint256" },
          { name: "virtualTokenReserve", type: "uint256" },
          { name: "k", type: "uint256" },
          { name: "minTokenReserve", type: "uint256" },
          { name: "initialQuoteReserve", type: "uint256" },
          { name: "initialTokenReserve", type: "uint256" },
          { name: "createdAtBlock", type: "uint64" },
          { name: "graduated", type: "bool" },
          { name: "creatorFeeRate", type: "uint16" },
          { name: "version", type: "uint8" },
          { name: "dexType", type: "uint8" },
          { name: "pair", type: "address" },
          { name: "graduateFee", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "Sync",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "realQuoteReserve", type: "uint256", indexed: false },
      { name: "realTokenReserve", type: "uint256", indexed: false },
      { name: "virtualQuoteReserve", type: "uint256", indexed: false },
      { name: "virtualTokenReserve", type: "uint256", indexed: false },
    ],
  },
] as const;
