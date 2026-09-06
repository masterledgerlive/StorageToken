/** Paper learning: sell_target = fair_exit + inject_cost */
export function sellTarget(fairExit: number, injectCost: number): number {
  if (!Number.isFinite(fairExit) || !Number.isFinite(injectCost)) {
    throw new Error("sell_target requires finite fair_exit and inject_cost");
  }
  if (injectCost < 0) {
    throw new Error("inject_cost cannot be negative");
  }
  return fairExit + injectCost;
}

/** Hitch payload must clear leftover: payloadBytes <= leftoverBytes */
export function hitchMax(leftoverBytes: number): number {
  if (!Number.isInteger(leftoverBytes) || leftoverBytes < 0) {
    throw new Error("leftoverBytes must be a non-negative integer");
  }
  return leftoverBytes;
}

export function assertHitchFits(payloadBytes: number, leftoverBytes: number): void {
  const max = hitchMax(leftoverBytes);
  if (payloadBytes <= 0) {
    throw new Error("hitch payload must be non-empty");
  }
  if (payloadBytes > max) {
    throw new Error(
      `Hitch payload ${payloadBytes}B exceeds leftover budget ${max}B`
    );
  }
}

/** 0.001 STORE (1e15 wei) per 32-byte word — mirrors ShadowWeaveRouter.sol */
export const CREDITS_PER_WORD = 10n ** 15n;

export function costForBytes(byteCount: number): bigint {
  if (!Number.isInteger(byteCount) || byteCount < 0) {
    throw new Error("byteCount must be a non-negative integer");
  }
  if (byteCount === 0) return 0n;
  const words = BigInt(Math.ceil(byteCount / 32));
  return words * CREDITS_PER_WORD;
}

export const EMISSION_PER_BYTE = 10n ** 12n;

export function emissionForBytes(byteCount: number): bigint {
  return BigInt(byteCount) * EMISSION_PER_BYTE;
}
