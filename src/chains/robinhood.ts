import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { type ChainConfig } from "./types";

// Seconds/block; 0.105 over 1,000,000 blocks, 2026-11-13.
// Ponder's finality depth for 4663 is patched to 600 blocks (~60s) in
// patches/ponder@0.17.11.patch. Ponder resolves it (and the multicall3 address)
// from viem/chains, which only knows Robinhood Chain from viem 2.55.0.
const blockTime = 0.1;

export const robinhood: ChainConfig = {
  name: "robinhood",
  chainId: SupportedChainId.ROBINHOOD,
  rpcEnvVar: "ROBINHOOD_RPC_URL",
  wsRpcEnvVar: "ROBINHOOD_WS_RPC_URL",
  blockTime,
  composableCow: {
    address: "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74", // CREATE2 — same across chains
    startBlock: 94383853, // verified: tx 0x5271e5ce4f18f82058b76fac38163fd986ac4d8784752e546098b9063e8f0267 (CREATE2 address recomputed from tx input)
  },
  composableCowLive: {
    address: "0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74",
  },
  // Deployments: cowprotocol/deployments deployments/4663/main/cowShed.*.json.
  // 0x5e28… and 0xc94f… have no code here. The legacy 0x312f… does (one shed,
  // block 47533956, before ComposableCoW existed here) and is left out, as on Ink.
  cowShedFactory: {
    address: [
      "0x221c28ec177cf7da6f837dfd0052ba8f265fb4ca", // COWShedForComposableCoW factory with executeOwnHooks
      "0x0a654985c5856ab562237286f36d55c0ff637213", // factory for COWShed
    ] as const,
    startBlock: 94384309, // verified: tx 0x4d6e6b206b2bce607cd17bd9f974432385115bbc0c4b0f00689f6ccca2ff86d7 (0x0a65…); 0x221c… followed in 94384335
  },
  gpv2Settlement: null,
  flashLoan: null, // no AaveV3AdapterFactory on 4663
  orderbookApiPath: "robinhood",
  orderbookPollInterval: 40, // seconds; = 400 blocks at 100ms/block
  reorgSafetyWindowSeconds: 1200, // 20 min — covers L1-reorg derived resets
};
