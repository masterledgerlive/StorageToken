import type { AppConfig } from "../config.js";
import {
  ENTRY_POINTS,
  LIVE_ENTRY_POINTS,
  STUB_ENTRY_POINTS,
  type EntryPoint,
  type SwitchboardState,
} from "../types.js";

export function coinbaseCdpReady(config: AppConfig): boolean {
  const c = config.coinbaseCdp;
  return Boolean(c.apiKey && c.apiSecret && (c.walletSecret || c.projectId));
}

export function buildSwitchboard(
  config: AppConfig,
  override?: EntryPoint
): SwitchboardState {
  const entryPoint = override ?? config.entryPoint;
  const flags = {} as SwitchboardState["flags"];

  for (const name of ENTRY_POINTS) {
    if (STUB_ENTRY_POINTS.includes(name)) {
      const forced =
        name === "x402" ? config.x402Enabled : config.kiteEnabled;
      flags[name] = {
        enabled: false,
        stub: true,
        reason: forced
          ? `${name} is stub-flagged and stays disabled`
          : `${name} stub — clearly disabled (future)`,
      };
      continue;
    }

    if (name === "coinbase_onchain") {
      const ready = coinbaseCdpReady(config);
      flags[name] = {
        enabled: ready && LIVE_ENTRY_POINTS.includes(name),
        stub: false,
        reason: ready
          ? "Coinbase CDP / Base wallet on-chain path"
          : "COINBASE_CDP_* (or COINBASE_API_KEY / COINBASE_API_SECRET / COINBASE_PRIVATE_KEY) missing — on-chain path disabled. CEX Advanced Trade cannot carry calldata.",
      };
      continue;
    }

    flags[name] = {
      enabled: true,
      stub: false,
      reason:
        name === "uniswap_hitch"
          ? "Hitch only on OUR real Uniswap/Base leftover — never invent a swap"
          : "Dedicated Base storage tx (ethers calldata)",
    };
  }

  if (STUB_ENTRY_POINTS.includes(entryPoint)) {
    flags[entryPoint].enabled = false;
  }

  return { entryPoint, flags };
}

export function assertEntryEnabled(state: SwitchboardState, name: EntryPoint): void {
  const flag = state.flags[name];
  if (!flag?.enabled) {
    throw new Error(
      `Entry point ${name} is disabled${flag?.reason ? `: ${flag.reason}` : ""}`
    );
  }
}

export function refuseCexAdvancedTrade(label?: string): never {
  throw new Error(
    `Coinbase CEX Advanced Trade CANNOT carry calldata${label ? ` (${label})` : ""}. Use coinbase_onchain (CDP / Base wallet) or base_dedicated.`
  );
}
