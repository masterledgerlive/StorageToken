import {
  DESK_AVENUES,
  LIVE_ENTRY_POINTS,
  STUB_ENTRY_POINTS,
  type EntryPoint,
} from "./types.js";

export interface AvenueCatalogItem {
  id: EntryPoint;
  label: string;
  live: boolean;
  stub: boolean;
  role: "sender" | "policy" | "future";
  reason: string;
}

const AVENUE_COPY: Record<
  EntryPoint,
  { label: string; role: AvenueCatalogItem["role"]; reason: string }
> = {
  base_dedicated: {
    label: "Base dedicated",
    role: "sender",
    reason: "Dedicated Base storage tx (ethers calldata). Live sender.",
  },
  uniswap_hitch: {
    label: "Uniswap hitch",
    role: "sender",
    reason: "Hitch only on OUR real Uniswap/Base leftover — never invent a swap.",
  },
  coinbase_onchain: {
    label: "Coinbase on-chain",
    role: "sender",
    reason:
      "Coinbase CDP / Base wallet on-chain path. CEX Advanced Trade cannot carry calldata.",
  },
  wave_first: {
    label: "Wave first",
    role: "policy",
    reason:
      "Paper policy: prefer leftover hitch, else dedicated. Not a live sender — pick base_dedicated or uniswap_hitch.",
  },
  gap_fill: {
    label: "Gap fill",
    role: "policy",
    reason:
      "Paper broker policy: lock the cheapest sparse slot. Live inject still uses a live sender.",
  },
  priority_express: {
    label: "Priority express",
    role: "policy",
    reason:
      "Paper broker express slot (higher $STORE credits). Not a live chain path.",
  },
  multi_chain_cheapest: {
    label: "Multi-chain cheapest",
    role: "future",
    reason: "Stub — Base only today. No multi-chain quote is computed.",
  },
  x402: {
    label: "x402",
    role: "future",
    reason: "x402 stub — clearly disabled (future).",
  },
  kite: {
    label: "Kite",
    role: "future",
    reason: "kite stub — clearly disabled (future).",
  },
};

export function avenueCatalog(id: EntryPoint): AvenueCatalogItem {
  const copy = AVENUE_COPY[id];
  const stub = STUB_ENTRY_POINTS.includes(id);
  return {
    id,
    label: copy.label,
    live: LIVE_ENTRY_POINTS.includes(id),
    stub,
    role: copy.role,
    reason: copy.reason,
  };
}

export function deskAvenueCatalog(): AvenueCatalogItem[] {
  return DESK_AVENUES.map(avenueCatalog);
}

export function stubReason(name: EntryPoint, envForced?: boolean): string {
  if (envForced) {
    return `${name} is stub-flagged and stays disabled`;
  }
  return avenueCatalog(name).reason;
}
