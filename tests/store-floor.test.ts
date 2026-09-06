import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("STORE FLOOR docs + agent seats", () => {
  it("documents Sparse Proof Market without invented hashes", () => {
    const doc = readFileSync(join(root, "docs/STORE_PROOF_MARKET.md"), "utf8");
    expect(doc).toContain("Sparse Proof Market");
    expect(doc).toContain("Return-Proof Storage");
    expect(doc).toContain("Dilithium");
    expect(doc).toContain("SPHINCS+");
    expect(doc).toContain("pq: \"stub\"");
    expect(doc).toContain("Vault never spends");
    expect(doc).toContain("CEX Advanced Trade cannot carry calldata");
    expect(doc).toContain("No invented hashes");
    expect(doc).toContain("INJECT");
    expect(doc).toContain("hypergrok-trading-desk");
    expect(doc).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(doc).not.toMatch(/\bGROKTOPUS\b/);
    expect(doc).not.toMatch(/\bRidark\b/);
  });

  it("ships eight HyperGrok-style narrow seats; INJECT is sole writer", () => {
    const dir = join(root, "agents/store-floor");
    const files = readdirSync(dir);
    expect(files).toEqual(
      expect.arrayContaining([
        "README.md",
        "wave.md",
        "sparse.md",
        "broker.md",
        "risk.md",
        "vault.md",
        "inject.md",
        "retrieve.md",
        "proof.md",
      ])
    );
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("INJECT is the sole writer");
    expect(readme).toContain("https://github.com/galleonlabs/hypergrok-trading-desk");
    expect(readme).toContain("Do **not** import those trading seats");

    const inject = readFileSync(join(dir, "inject.md"), "utf8");
    expect(inject).toContain("writes_to_chain: true");
    expect(inject).toContain("POST /api/inject");
    expect(inject.toLowerCase()).toContain("sole writer");

    for (const name of ["wave", "sparse", "broker", "risk", "vault", "retrieve", "proof"]) {
      const body = readFileSync(join(dir, `${name}.md`), "utf8");
      expect(body).toContain("writes_to_chain: false");
      expect(body.toLowerCase()).toMatch(/\/api\/inject/);
      expect(body.toLowerCase()).toMatch(/never|do not/);
    }
  });
});
