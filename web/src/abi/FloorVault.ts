// Generated from contracts/out/FloorVault.sol/FloorVault.json. Do not edit by hand.
export const floorVaultAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "router_",
        "type": "address",
        "internalType": "contract INadRouter"
      },
      {
        "name": "creatorFeeVault_",
        "type": "address",
        "internalType": "contract INadCreatorFeeVault"
      },
      {
        "name": "wmon_",
        "type": "address",
        "internalType": "contract IWMON"
      },
      {
        "name": "market_",
        "type": "address",
        "internalType": "contract IMarketplace"
      },
      {
        "name": "raffle_",
        "type": "address",
        "internalType": "contract IRaffle"
      },
      {
        "name": "treasury_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "keeper_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowedCollection_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CREATOR_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "TREASURY_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allowedCollection",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "buy",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "maxPrice",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "price",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "creatorFeeVault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract INadCreatorFeeVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "creators",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "harvest",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "claimed",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "keeper",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launch",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct FloorVault.LaunchArgs",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "symbol",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "tokenURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "creatorFeeRate",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "collection",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "nftRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "devBuy",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "market",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IMarketplace"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pairings",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "collection",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nftRecipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "budget",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "raffle",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IRaffle"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "router",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract INadRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setKeeper",
    "inputs": [
      {
        "name": "keeper_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "wmon",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWMON"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Bought",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collection",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "price",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Harvested",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "claimed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "toTreasury",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "toCreator",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "toBudget",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeeperChanged",
    "inputs": [
      {
        "name": "keeper",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Launched",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "collection",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nftRecipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  }
] as const;
