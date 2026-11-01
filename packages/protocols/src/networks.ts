// Written with AI help.
// x402 v1 network names -> CAIP-2 (CLAUDE.md §2: explicit, tested table; unknown name -> unreadable).
// Source, x402-foundation/x402 @ e208bd39030be35a0f807eb3bf4f043354273866 (docs/SPEC_SOURCES.md):
//   EVM: typescript/packages/mechanisms/evm/src/constants.ts, EVM_NETWORK_CHAIN_ID_MAP (name -> chain id)
//   SVM: typescript/packages/mechanisms/svm/src/constants.ts, V1_TO_V2_NETWORK_MAP
const EVM_CHAIN_IDS: Readonly<Record<string, number>> = {
  ethereum: 1,
  sepolia: 11155111,
  abstract: 2741,
  "abstract-testnet": 11124,
  "base-sepolia": 84532,
  base: 8453,
  "avalanche-fuji": 43113,
  avalanche: 43114,
  iotex: 4689,
  sei: 1329,
  "sei-testnet": 1328,
  polygon: 137,
  "polygon-amoy": 80002,
  peaq: 3338,
  story: 1514,
  educhain: 41923,
  "skale-base-sepolia": 324705682,
  megaeth: 4326,
  monad: 143,
  "monad-testnet": 10143,
  stable: 988,
  "stable-testnet": 2201,
  celo: 42220,
  flare: 14,
};

const SVM: Readonly<Record<string, string>> = {
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "solana-testnet": "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
};

/** CAIP-2 id for a v1 network name, or undefined (never a guess). */
export function v1NetworkToCaip2(name: string): string | undefined {
  if (Object.hasOwn(EVM_CHAIN_IDS, name)) return `eip155:${String(EVM_CHAIN_IDS[name])}`;
  if (Object.hasOwn(SVM, name)) return SVM[name];
  return undefined;
}

export const V1_NETWORK_NAMES: readonly string[] = [...Object.keys(EVM_CHAIN_IDS), ...Object.keys(SVM)];
