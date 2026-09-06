import { CALLDATA_GAS_PER_BYTE } from "../hitch/strand.js";

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

export function assertPositiveUsd(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Missing live ${label} USD price — refusing silent $0. Use GeckoTerminal or DexScreener.`
    );
  }
  return n;
}

export function assertPositiveGwei(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("gasPriceGwei required for hitch USD sizing — refusing silent $0");
  }
  return n;
}

/** USD gas-equivalent of hitching leftoverBytes onto a real leftover. */
export function hitchGasUsd(
  leftoverBytes: number,
  ethUsd: number,
  gasPriceGwei: number
): number {
  hitchMax(leftoverBytes);
  const eth = assertPositiveUsd(ethUsd, "ETH");
  const gwei = assertPositiveGwei(gasPriceGwei);
  return (leftoverBytes * CALLDATA_GAS_PER_BYTE * gwei * eth) / 1e9;
}

/** Max hitch bytes a USD gas budget can buy at the live ETH/gwei quote. */
export function hitchBytesFromUsdBudget(
  usdBudget: number,
  ethUsd: number,
  gasPriceGwei: number
): number {
  const budget = assertPositiveUsd(usdBudget, "hitch budget");
  const eth = assertPositiveUsd(ethUsd, "ETH");
  const gwei = assertPositiveGwei(gasPriceGwei);
  const bytes = Math.floor(budget * 1e9 / (CALLDATA_GAS_PER_BYTE * gwei * eth));
  if (bytes <= 0) {
    throw new Error(
      `USD budget ${budget} is too small for one hitch byte at current ETH/gas — refusing silent $0`
    );
  }
  return bytes;
}

export interface HitchWaveQuote {
  leftoverBytes: number;
  payloadBytes: number;
  ethUsd: number;
  tokenUsd?: number;
  hitchUsd: number;
  leftoverUsd?: number;
  maxBytesFromUsd?: number;
  fits: boolean;
}

export function measureHitchWave(input: {
  leftoverBytes: number;
  payloadBytes: number;
  ethUsd: number;
  tokenUsd?: number;
  gasPriceGwei: number;
  leftoverEth?: number;
  usdBudget?: number;
}): HitchWaveQuote {
  if (!Number.isInteger(input.payloadBytes) || input.payloadBytes <= 0) {
    throw new Error("hitch payload must be non-empty");
  }
  const hitchUsd = hitchGasUsd(input.leftoverBytes, input.ethUsd, input.gasPriceGwei);
  const tokenUsd =
    input.tokenUsd === undefined ? undefined : assertPositiveUsd(input.tokenUsd, "token");
  let leftoverUsd: number | undefined;
  if (input.leftoverEth !== undefined) {
    const leftoverEth = assertPositiveUsd(input.leftoverEth, "leftover ETH");
    leftoverUsd = leftoverEth * assertPositiveUsd(input.ethUsd, "ETH");
  }
  const maxBytesFromUsd =
    input.usdBudget === undefined
      ? undefined
      : hitchBytesFromUsdBudget(input.usdBudget, input.ethUsd, input.gasPriceGwei);
  const leftoverOk = input.payloadBytes <= hitchMax(input.leftoverBytes);
  const usdOk = maxBytesFromUsd === undefined || input.payloadBytes <= maxBytesFromUsd;
  return {
    leftoverBytes: input.leftoverBytes,
    payloadBytes: input.payloadBytes,
    ethUsd: assertPositiveUsd(input.ethUsd, "ETH"),
    tokenUsd,
    hitchUsd,
    leftoverUsd,
    maxBytesFromUsd,
    fits: leftoverOk && usdOk,
  };
}

export function quoteHitchWave(
  input: Parameters<typeof measureHitchWave>[0]
): HitchWaveQuote {
  const quote = measureHitchWave(input);
  if (!quote.fits) {
    throw new Error(
      `Hitch payload ${input.payloadBytes}B exceeds leftover ${input.leftoverBytes}B` +
        (quote.maxBytesFromUsd !== undefined
          ? ` or USD budget capacity ${quote.maxBytesFromUsd}B`
          : "")
    );
  }
  return quote;
}
