import { describe, expect, it } from "vitest";
import { checkKills, freshRisk, netMargin } from "../src/risk/kills.js";
import { PaperLoop } from "../src/loop/paper.js";
import { rsi, macd, bollinger, ehlersSuperSmoother, ThompsonSampler } from "../src/signals/index.js";

describe("signals + Thompson + kills", () => {
  it("computes RSI / MACD / BB / Ehlers on a series", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 4);
    expect(rsi(prices)).toBeGreaterThan(0);
    expect(macd(prices).macd).toBeTypeOf("number");
    expect(bollinger(prices).upper).toBeGreaterThan(bollinger(prices).lower);
    expect(ehlersSuperSmoother(prices)).toBeTypeOf("number");
  });

  it("Thompson sampler updates arms", () => {
    const ts = new ThompsonSampler();
    ts.reward("rsi", true);
    ts.reward("macd", false);
    const snap = ts.snapshot();
    expect(snap.rsi.a).toBe(2);
    expect(snap.macd.b).toBe(2);
    expect(["ehlers", "rsi", "macd", "bb"]).toContain(ts.sample());
  });

  it("drawdown and net-margin kill", () => {
    const dd = checkKills({
      ...freshRisk(100),
      equity: 80,
      peak: 100,
      realizedPnl: 0,
      fees: 0,
    });
    expect(dd.killed).toBe(true);
    expect(dd.reason).toMatch(/drawdown/);

    const nm = checkKills({
      ...freshRisk(100),
      realizedPnl: -1,
      fees: 0,
    });
    expect(nm.killed).toBe(true);
    expect(netMargin(-1, 0)).toBe(-1);
  });

  it("paper loop never claims a fill", () => {
    const loop = new PaperLoop(1000);
    const d = loop.tick({
      prices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      fairExit: 10,
      injectCost: 1,
      mark: 1000,
    });
    expect(d.sellTarget).toBe(11);
    expect(d.risk.killed).toBe(false);
    expect(d.note).toMatch(/does not invent fills/);
  });
});
