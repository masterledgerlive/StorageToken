import { CREDITS_PER_WORD } from "./pricing.js";
import type { Mode } from "../types.js";

/**
 * §$STORE§ is 8 UTF-8 bytes → 1 word → CREDITS_PER_WORD (1e15).
 * Guarded mainnet bootstrap is capped at a few voices.
 */
export const MAINNET_BOOTSTRAP_SEED_VOICES = 8;

/** Hard max for ALLOW_MAINNET_CREDIT_SEED=yes: 8 typical §$STORE§ voices (8e15 wei). */
export const MAINNET_BOOTSTRAP_SEED_MAX =
  CREDITS_PER_WORD * BigInt(MAINNET_BOOTSTRAP_SEED_VOICES);

export const MAINNET_SEED_DISABLED =
  "Seeding disabled in guarded/live mainnet";

export function parseAllowMainnetCreditSeed(raw: string | undefined): boolean {
  return raw === "yes";
}

/** Same gate as today's POST /api/credits/seed hard-block. */
export function isMainnetCreditSeedBlocked(
  mode: Mode,
  confirmMainnet: boolean
): boolean {
  return mode === "full_live" || (mode === "base_mainnet_guarded" && confirmMainnet);
}

export type SeedGate =
  | { ok: true; bootstrap: boolean }
  | { ok: false; status: 403 | 400; error: string };

/**
 * Default: blocked on confirmed guarded / full_live.
 * ALLOW_MAINNET_CREDIT_SEED=yes (exact) unlocks a capped internal-ledger bootstrap.
 */
export function evaluateMainnetCreditSeed(input: {
  mode: Mode;
  confirmMainnet: boolean;
  allowMainnetCreditSeed: boolean;
  amount: bigint;
  currentBalance?: bigint;
}): SeedGate {
  if (!isMainnetCreditSeedBlocked(input.mode, input.confirmMainnet)) {
    return { ok: true, bootstrap: false };
  }
  if (!input.allowMainnetCreditSeed) {
    return { ok: false, status: 403, error: MAINNET_SEED_DISABLED };
  }
  if (input.amount > MAINNET_BOOTSTRAP_SEED_MAX) {
    return {
      ok: false,
      status: 400,
      error: bootstrapSeedMaxError(),
    };
  }
  const current = input.currentBalance ?? 0n;
  if (current + input.amount > MAINNET_BOOTSTRAP_SEED_MAX) {
    return {
      ok: false,
      status: 400,
      error: bootstrapSeedMaxError(),
    };
  }
  return { ok: true, bootstrap: true };
}

export function bootstrapSeedMaxError(): string {
  return (
    `Bootstrap seed exceeds max ${MAINNET_BOOTSTRAP_SEED_MAX.toString()}` +
    ` (${MAINNET_BOOTSTRAP_SEED_VOICES} typical §$STORE§ voices)`
  );
}
