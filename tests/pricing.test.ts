import { describe, expect, it } from "vitest";
import {
  assertHitchFits,
  costForBytes,
  emissionForBytes,
  hitchMax,
  sellTarget,
} from "../src/credits/pricing.js";
import { CreditLedger } from "../src/credits/ledger.js";

describe("paper learnings", () => {
  it("sell_target = fair_exit + inject_cost", () => {
    expect(sellTarget(100, 2.5)).toBe(102.5);
    expect(sellTarget(0, 0)).toBe(0);
  });

  it("hitch max clears leftover only", () => {
    expect(hitchMax(64)).toBe(64);
    expect(() => assertHitchFits(65, 64)).toThrow(/exceeds leftover/);
    expect(() => assertHitchFits(64, 64)).not.toThrow();
  });

  it("credits cost matches router words", () => {
    expect(costForBytes(1)).toBe(10n ** 15n);
    expect(costForBytes(32)).toBe(10n ** 15n);
    expect(costForBytes(33)).toBe(2n * 10n ** 15n);
    expect(emissionForBytes(10)).toBe(10n * 10n ** 12n);
  });
});

describe("credit ledger honors balances", () => {
  it("refuses inject when payer lacks $STORE", () => {
    const ledger = new CreditLedger();
    expect(() => ledger.payForStorage("0x1111111111111111111111111111111111111111", 8)).toThrow(
      /Insufficient \$STORE/
    );
  });

  it("debits exactly the word cost — no silent skim", () => {
    const ledger = new CreditLedger();
    const payer = "0x1111111111111111111111111111111111111111";
    ledger.seed(payer, 5n * 10n ** 15n);
    const paid = ledger.payForStorage(payer, 40);
    expect(paid).toBe(2n * 10n ** 15n);
    expect(ledger.balanceOf(payer)).toBe(3n * 10n ** 15n);
  });
});
