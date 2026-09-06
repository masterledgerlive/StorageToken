import {
  assertFundAddressNotVault,
  assertNotVaultKey,
  resolveFundAddress,
} from "./chain/keys.js";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_DEFAULT,
  DEFAULT_CHAIN,
  ENTRY_POINTS,
  MODES,
  type EntryPoint,
  type Mode,
  type NetworkName,
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

export function firstEnv(
  env: NodeJS.ProcessEnv,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function isMainnetMode(mode: Mode): boolean {
  return mode === "base_mainnet_guarded" || mode === "full_live";
}

export function networkForMode(mode: Mode): NetworkName {
  return isMainnetMode(mode) ? "base" : DEFAULT_CHAIN;
}

export function chainIdForMode(mode: Mode): number {
  return isMainnetMode(mode) ? BASE_MAINNET_CHAIN_ID : BASE_SEPOLIA_CHAIN_ID;
}

export function switchHint(
  mode: Mode,
  coinbaseOnchainReady: boolean,
  confirmMainnet: boolean
): string {
  const flip =
    'POST /api/mode {"mode":"base_mainnet_guarded","confirmMainnet":"yes"} then POST /api/switchboard {"entryPoint":"coinbase_onchain"}. In-memory mode dies on restart — set Railway MODE, CONFIRM_MAINNET=yes, and BASE_RPC for a durable flip. CEX Advanced Trade cannot carry calldata.';
  if (mode === "paper") {
    return `Paper mode — no chain hashes. Flip to base_sepolia for a real Sepolia inject, then ${flip}`;
  }
  if (mode === "base_sepolia") {
    return `Sepolia test path is active (84532). When Game is ready: fund fundAddress with Base ETH (Coinbase withdraw, network Base), then ${flip}`;
  }
  if (!confirmMainnet) {
    return `MODE=${mode} is set but CONFIRM_MAINNET is not yes — 8453 injects are refused. ${flip}`;
  }
  return `Live Base (8453) ${mode} with confirm. ${
    coinbaseOnchainReady
      ? "coinbase_onchain is ready — fund fundAddress and inject §$STORE§."
      : "Set COINBASE_CDP_* (or COINBASE_API_KEY / COINBASE_API_SECRET / COINBASE_PRIVATE_KEY) for coinbase_onchain."
  } Persist Railway MODE + CONFIRM_MAINNET=yes + BASE_RPC before restart.`;
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
    address?: string;
  };
  /** Cached CDP / hot injector address after resolve. Not a secret. */
  resolvedFundAddress?: string;
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
      // Preferred names first; old coinbase-multi-injector guide aliases second.
      apiKey: firstEnv(env, "COINBASE_CDP_API_KEY", "COINBASE_API_KEY"),
      apiSecret: firstEnv(env, "COINBASE_CDP_API_SECRET", "COINBASE_API_SECRET"),
      walletSecret: firstEnv(
        env,
        "COINBASE_CDP_WALLET_SECRET",
        "COINBASE_PRIVATE_KEY"
      ),
      projectId: firstEnv(env, "COINBASE_CDP_PROJECT_ID"),
      address: firstEnv(env, "COINBASE_CDP_ADDRESS"),
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
  if (isMainnetMode(mode) && chainId === BASE_MAINNET_CHAIN_ID && !confirmMainnet) {
    throw new Error(
      `MODE=${mode} refuses Base mainnet unless CONFIRM_MAINNET=yes`
    );
  }
  if (
    isMainnetMode(mode) &&
    chainId !== BASE_MAINNET_CHAIN_ID &&
    chainId !== BASE_SEPOLIA_CHAIN_ID
  ) {
    throw new Error(`MODE=${mode} refuses chainId ${chainId}`);
  }
}

export function assertLiveSwitchAllowed(
  config: AppConfig,
  next: Mode,
  confirmMainnet: unknown
): void {
  if (!MODES.includes(next)) {
    throw new Error(
      `Invalid mode ${String(next)}. Use paper | base_sepolia | base_mainnet_guarded | full_live`
    );
  }
  if (!isMainnetMode(next)) return;
  if (confirmMainnet !== "yes") {
    throw new Error(
      'Switching to mainnet requires confirmMainnet: "yes" (and CONFIRM_MAINNET=yes in env or this in-memory confirm)'
    );
  }
  if (!config.baseMainnetRpc) {
    throw new Error("BASE_RPC must be set before flipping to mainnet");
  }
  assertNotVaultKey(config.injectorPrivateKey, config.vaultAddress);
  assertFundAddressNotVault(resolveFundAddress(config), config.vaultAddress);
}

export function applyModeOverride(
  config: AppConfig,
  next: Mode,
  confirmMainnet: unknown
): AppConfig {
  assertLiveSwitchAllowed(config, next, confirmMainnet);
  config.mode = next;
  if (isMainnetMode(next)) {
    // Request confirmMainnet:"yes" either matches env CONFIRM_MAINNET=yes
    // or sets an in-memory confirm for this process only.
    config.confirmMainnet = true;
  }
  return config;
}

export function isMainnetRefused(mode: Mode, chainId: number, confirmMainnet: boolean): boolean {
  try {
    assertModeAllowsChain(mode, chainId, confirmMainnet);
    return false;
  } catch {
    return true;
  }
}
