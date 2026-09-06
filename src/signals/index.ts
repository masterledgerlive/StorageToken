/**
 * Trading signals + Thompson sampling.
 * Reconstructed Origin loop surface. No guaranteed PnL. No invented fills.
 */

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

export function macd(values: number[]): { macd: number; signal: number; hist: number } {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = fast - slow;
  const signal = ema([...values.slice(-9), line], 9);
  return { macd: line, signal, hist: line - signal };
}

export function bollinger(values: number[], period = 20): {
  mid: number;
  upper: number;
  lower: number;
} {
  const window = values.slice(-period);
  if (window.length === 0) return { mid: 0, upper: 0, lower: 0 };
  const mid = window.reduce((a, b) => a + b, 0) / window.length;
  const variance =
    window.reduce((a, b) => a + (b - mid) ** 2, 0) / window.length;
  const sd = Math.sqrt(variance);
  return { mid, upper: mid + 2 * sd, lower: mid - 2 * sd };
}

/** Ehlers SuperSmoother (2-pole) — last value. */
export function ehlersSuperSmoother(values: number[], period = 10): number {
  if (values.length === 0) return 0;
  const a = Math.exp(-Math.SQRT2 * Math.PI / period);
  const c2 = 2 * a * Math.cos((Math.SQRT2 * Math.PI) / period);
  const c3 = -(a * a);
  const c1 = 1 - c2 - c3;
  let f1 = values[0];
  let f2 = values[0];
  let out = values[0];
  for (let i = 1; i < values.length; i++) {
    const next = c1 * (values[i] + values[i - 1]) / 2 + c2 * f1 + c3 * f2;
    f2 = f1;
    f1 = next;
    out = next;
  }
  return out;
}

export type ArmName = "ehlers" | "rsi" | "macd" | "bb";

export class ThompsonSampler {
  private arms: Record<ArmName, { a: number; b: number }> = {
    ehlers: { a: 1, b: 1 },
    rsi: { a: 1, b: 1 },
    macd: { a: 1, b: 1 },
    bb: { a: 1, b: 1 },
  };

  sample(): ArmName {
    let best: ArmName = "ehlers";
    let bestDraw = -1;
    for (const name of Object.keys(this.arms) as ArmName[]) {
      const draw = sampleBeta(this.arms[name].a, this.arms[name].b);
      if (draw > bestDraw) {
        bestDraw = draw;
        best = name;
      }
    }
    return best;
  }

  reward(arm: ArmName, success: boolean): void {
    if (success) this.arms[arm].a += 1;
    else this.arms[arm].b += 1;
  }

  snapshot(): Record<ArmName, { a: number; b: number }> {
    return structuredClone(this.arms);
  }
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(a: number, b: number): number {
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  return x / (x + y);
}

function randn(): number {
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function signalVote(prices: number[]): Record<ArmName, number> {
  const last = prices[prices.length - 1] ?? 0;
  const r = rsi(prices);
  const m = macd(prices);
  const bb = bollinger(prices);
  const eh = ehlersSuperSmoother(prices);
  return {
    rsi: r < 30 ? 1 : r > 70 ? -1 : 0,
    macd: Math.sign(m.hist),
    bb: last < bb.lower ? 1 : last > bb.upper ? -1 : 0,
    ehlers: last > eh ? 1 : last < eh ? -1 : 0,
  };
}
