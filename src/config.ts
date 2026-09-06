import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_DEFAULT,
  DEFAULT_CHAIN,
  ENTRY_POINTS,
  MODES,
  type EntryPoint,
  type Mode,
} from "./types.js";

export function parseMode(raw: string | undefined): Mode {
  const value = (raw || "base_sepolia").trim() as Mode;
  if (!MODES.includes(value)) {
    throw new Error(
      `Invalid MODE=${raw}. Use paper | base_sepolia | base_mainnet_guarded | full_live`
    );
  }
  return value;
}

export function parseEntryPoint(raw: string | undefined): EntryPoint {
  const value = (raw || "base_dedicated").trim() as EntryPoint;
  if (!ENTRY_POINTS.includes(value)) {
    throw new Error(
      `Invalid ENTRY_POINT=${raw}. Use base_dedicated | uniswap_hitch | coinbase_onchain`
    );
  }
  return value;
}

export interface AppConfig {
  mode: Mode;
  entryPoint: EntryPoint;
  port: number;
  host: string;
  jwtSecret: string;
  tokenExpiryHours: number;
  baseSepoliaRpc: string;
  baseMainnetRpc: string;
  injectorPrivateKey?: string;
  vaultAddress?: string;
  storeTokenAddress?: string;
  routerAddress?: string;
  defaultProvider?: string;
  confirmMainnet: boolean;
  coinbaseCdp: {
    apiKey?: string;
    apiSecret?: string;
    walletSecret?: string;
    projectId?: string;
  };
  telegram: {
    botToken?: string;
    chatId?: string;
  };
  x402Enabled: boolean;
  kiteEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = parseMode(env.MODE);
  return {
    mode,
    entryPoint: parseEntryPoint(env.ENTRY_POINT),
    port: Number(env.PORT || 3001),
    host: env.HOST || "0.0.0.0",
    jwtSecret: env.JWT_SECRET || "change-me",
    tokenExpiryHours: Number(env.TOKEN_EXPIRY_HOURS || 24),
    baseSepoliaRpc: env.BASE_SEPOLIA_RPC || BASE_SEPOLIA_RPC_DEFAULT,
    baseMainnetRpc: env.BASE_RPC || "",
    injectorPrivateKey: env.INJECTOR_PRIVATE_KEY || undefined,
    vaultAddress: env.VAULT_ADDRESS || undefined,
    storeTokenAddress: env.STORE_TOKEN_ADDRESS || undefined,
    routerAddress: env.ROUTER_ADDRESS || undefined,
    defaultProvider: env.DEFAULT_PROVIDER || undefined,
    confirmMainnet: env.CONFIRM_MAINNET === "yes",
    coinbaseCdp: {
      apiKey: env.COINBASE_CDP_API_KEY || undefined,
      apiSecret: env.COINBASE_CDP_API_SECRET || undefined,
      walletSecret: env.COINBASE_CDP_WALLET_SECRET || undefined,
      projectId: env.COINBASE_CDP_PROJECT_ID || undefined,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || undefined,
      chatId: env.TELEGRAM_CHAT_ID || undefined,
    },
    x402Enabled: env.X402_ENABLED === "true",
    kiteEnabled: env.KITE_ENABLED === "true",
  };
}

export function assertModeAllowsChain(mode: Mode, chainId: number, confirmMainnet: boolean): void {
  if (mode === "paper") return;
  if (mode === "base_sepolia" && chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `MODE=base_sepolia refuses chainId ${chainId}. Use ${DEFAULT_CHAIN} (${BASE_SEPOLIA_CHAIN_ID}).`
    );
  }
  if (mode === "base_mainnet_guarded" && chainId === 8453 && !confirmMainnet) {
    throw new Error(
      "MODE=base_mainnet_guarded refuses Base mainnet unless CONFIRM_MAINNET=yes"
    );
  }
  if (mode === "base_mainnet_guarded" && chainId !== 8453 && chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`MODE=base_mainnet_guarded refuses chainId ${chainId}`);
  }
}

export function isMainnetRefused(mode: Mode, chainId: number, confirmMainnet: boolean): boolean {
  try {
    assertModeAllowsChain(mode, chainId, confirmMainnet);
    return false;
  } catch {
    return true;
  }
}
