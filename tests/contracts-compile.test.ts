import { describe, expect, it } from "vitest";
import { compileContracts } from "../scripts/deploy.js";

describe("Solidity compile", () => {
  it("compiles StoreToken + ShadowWeaveRouter", () => {
    const { store, router } = compileContracts();
    expect(store.bytecode.startsWith("0x")).toBe(true);
    expect(store.bytecode.length).toBeGreaterThan(100);
    expect(router.bytecode.startsWith("0x")).toBe(true);
    expect(Array.isArray(store.abi)).toBe(true);
    const names = (store.abi as { name?: string }[]).map((x) => x.name);
    expect(names).toContain("mintForBytes");
    expect(names).toContain("payForStorage");
    expect(names).toContain("seedCredits");
    const rnames = (router.abi as { name?: string }[]).map((x) => x.name);
    expect(rnames).toContain("storeDedicated");
    expect(rnames).toContain("hitch");
    expect(rnames).toContain("registerLeftover");
  });
});
