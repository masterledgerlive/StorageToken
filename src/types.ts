export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_RPC_DEFAULT = "https://sepolia.base.org";
export const DEFAULT_CHAIN = "base-sepolia";
export const MAINNET_CHAIN = "base";
export const STORE_VOICE = "§$STORE§";
export type NetworkName = "base-sepolia" | "base";

export const MAINNET_CHAIN_IDS = new Set<number>([1, 137, 42161, 10, 8453]);

export const MODES = [
  "paper",
  "base_sepolia",
  "base_mainnet_guarded",
  "full_live",
] as const;
export type Mode = (typeof MODES)[number];

export const ENTRY_POINTS = [
  "base_dedicated",
  "uniswap_hitch",
  "coinbase_onchain",
  "x402",
  "kite",
] as const;
export type EntryPoint = (typeof ENTRY_POINTS)[number];

export const LIVE_ENTRY_POINTS: readonly EntryPoint[] = [
  "base_dedicated",
  "uniswap_hitch",
  "coinbase_onchain",
];

export const STUB_ENTRY_POINTS: readonly EntryPoint[] = ["x402", "kite"];

export interface Chain {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
}

export interface InjectionResult {
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  chain: string;
  method: string;
  timestamp: number;
  paidCredits: string;
  provider: string;
  entryPoint: EntryPoint;
  leftoverTx?: string;
}

export interface MemoryStrand {
  strandId: string;
  currentHash: string;
  previousHash?: string;
  compressedData: string;
  encryptionKeyHash: string;
  geometricAddress: string;
  resonanceStrength: number;
  voice: typeof STORE_VOICE;
}

export interface InjectionRecord {
  injectionId: string;
  strandId: string;
  chain: string;
  mode: Mode;
  entryPoint: EntryPoint;
  txHash?: string;
  blockNumber?: number;
  status: "pending" | "processing" | "injected" | "failed" | "paper";
  costCredits: string;
  currency: "STORE";
  accessToken?: string;
  createdAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  provider?: string;
  leftoverTx?: string;
  paperId?: string;
  payloadHash: string;
  bytesLen: number;
}

export interface LeftoverSlot {
  swapTx: string;
  leftoverBytes: number;
  owner: string;
  used: boolean;
  registeredAt: Date;
  receiptBlock: number;
}

export interface AccessToken {
  token: string;
  strandId: string;
  expiresAt: Date;
  purpose: "strand-read";
}

export interface SwitchboardState {
  entryPoint: EntryPoint;
  flags: Record<EntryPoint, { enabled: boolean; stub: boolean; reason?: string }>;
}

export interface CreditBalance {
  address: string;
  balance: string;
  source: "onchain" | "ledger";
}
