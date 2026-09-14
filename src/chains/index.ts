import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { type ChainConfig } from "./types";
import { mainnet } from "./mainnet";
import { gnosis } from "./gnosis";
import { arbitrum } from "./arbitrum";
import { base } from "./base";
import { bnb } from "./bnb";
import { polygon } from "./polygon";
import { plasma } from "./plasma";
import { avalanche } from "./avalanche";
import { linea } from "./linea";
import { ink } from "./ink";
import { sepolia } from "./sepolia";

/**
 * CHAIN_CONFIGS — the chain registry, keyed by SupportedChainId.
 *
 * `satisfies Record<SupportedChainId, ChainConfig | null>` makes coverage
 * exhaustive: when cow-sdk adds a member to SupportedChainId, `pnpm typecheck`
 * fails until an entry is added here — a full ChainConfig, or `null` to skip.
 */
export const CHAIN_CONFIGS = {
  [SupportedChainId.MAINNET]: mainnet,
  [SupportedChainId.BNB]: bnb,
  [SupportedChainId.GNOSIS_CHAIN]: gnosis,
  [SupportedChainId.POLYGON]: polygon,
  [SupportedChainId.BASE]: base,
  [SupportedChainId.PLASMA]: plasma,
  [SupportedChainId.ARBITRUM_ONE]: arbitrum,
  [SupportedChainId.AVALANCHE]: avalanche,
  [SupportedChainId.INK]: ink,
  [SupportedChainId.LINEA]: linea,
  [SupportedChainId.SEPOLIA]: sepolia,
  [SupportedChainId.SOLANA]: null,
} satisfies Record<SupportedChainId, ChainConfig | null>;

/**
 * ALL_DEFINED_CHAINS — every chain configured with a full ChainConfig.
 * Derived from CHAIN_CONFIGS (drops the `null` / skipped entries). Used for
 * API-only lookups (e.g. orderbook URLs) across all configured chains, not just
 * the actively indexed ones.
 */
export const ALL_DEFINED_CHAINS: ChainConfig[] = Object.values(
  CHAIN_CONFIGS
).filter((c): c is ChainConfig => c !== null);

/**
 * ACTIVE_CHAINS — the chains this indexer instance actually processes.
 *
 * All defined chains are enabled. Supply each chain's RPC URL through the
 * infrastructure deployment. ponder.config.ts derives its config from this array.
 */
export const ACTIVE_CHAINS: ChainConfig[] = ALL_DEFINED_CHAINS;
