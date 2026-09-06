import type { AppConfig } from "./config.js";
import { chainIdForMode, networkForMode, switchHint } from "./config.js";
import { resolveFundAddress } from "./chain/keys.js";
import { coinbaseCdpReady } from "./switchboard/index.js";
import type { SwitchboardState } from "./types.js";

export const MODE_API =
  'POST /api/mode { "mode": "base_mainnet_guarded" | "full_live" | "base_sepolia" | "paper", "confirmMainnet": "yes" }';

export const DURABLE_FLIP =
  "In-memory MODE override dies on restart. Set Railway MODE, CONFIRM_MAINNET=yes, and BASE_RPC for a durable flip.";

export function runtimePublicFields(
  config: AppConfig,
  switchboard: SwitchboardState
) {
  const network = networkForMode(config.mode);
  const fundAddress =
    resolveFundAddress({
      ...config,
      entryPoint: switchboard.entryPoint,
    }) ?? null;
  const ready = coinbaseCdpReady(config);
  return {
    mode: config.mode,
    entryPoint: switchboard.entryPoint,
    network,
    chain: network,
    chainId: chainIdForMode(config.mode),
    fundAddress,
    hotAddress: fundAddress,
    coinbaseOnchainReady: ready,
    confirmMainnet: config.confirmMainnet,
    switchHint: switchHint(config.mode, ready, config.confirmMainnet),
    modeApi: MODE_API,
    durableFlip: DURABLE_FLIP,
  };
}
