import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = (name: string) => readFileSync(join(root, "web", name), "utf8");

const LIVE_HASH = /0x[0-9a-fA-F]{64}/;

describe("public Pages desk stays paper-honest", () => {
  it("ships the neon $STORE Desk / STORE FLOOR", () => {
    const html = web("index.html");
    expect(html).toContain("$STORE Desk");
    expect(html).toContain("STORE FLOOR");
    expect(html).toContain("§$STORE§");
    expect(html).toContain("DEMO");
    expect(html).toContain("Vault · save jar");
    expect(html).toContain("never spends");
    expect(html).toContain("Sepolia test");
    expect(html).toContain("Live Base + Coinbase CDP");
    expect(html).toContain("Use Grok Bot");
    expect(html).toContain("Do it myself on Railway");
    expect(html).toContain("masterledgerlive/StorageToken");
    expect(html).toContain("portal.cdp.coinbase.com");
    expect(html).toContain("cannot carry calldata");
    expect(html).toContain("Railway trial");
    expect(html).toContain("https://masterledgerlive.github.io/StorageToken/");
    expect(html).toContain("./app.js");
    expect(html).toContain("./styles.css");
    expect(html).toContain("WAVE");
    expect(html).toContain("SPARSE");
    expect(html).toContain("BROKER");
    expect(html).toContain("RISK");
    expect(html).toContain("VAULT");
    expect(html).toContain("INJECT");
    expect(html).toContain("RETRIEVE");
    expect(html).toContain("PROOF");
    expect(html).toContain("base_dedicated");
    expect(html).toContain("uniswap_hitch");
    expect(html).toContain("coinbase_onchain");
    expect(html).toContain("wave_first");
    expect(html).toContain("gap_fill");
    expect(html).toContain("priority_express");
    expect(html).toContain("multi_chain_cheapest");
    expect(html).toContain("galleonlabs/hypergrok-trading-desk");
    expect(html).toContain("lock-first");
    expect(html).toMatch(/<title>\$STORE Desk/);
    expect(html).not.toMatch(/<title>[^<]*(GROKTOPUS|Ridark)/i);
    expect(html).toMatch(/<h1>STORE <span class="voice">FLOOR<\/span><\/h1>/);
  });

  it("does not brand the product as GROKTOPUS or Ridark", () => {
    const html = web("index.html");
    const js = web("app.js");
    const css = web("styles.css");
    for (const text of [html, js, css]) {
      expect(text).not.toMatch(/id=["']groktopus/i);
      expect(text).not.toMatch(/brand=["']ridark/i);
    }
    expect(html).not.toMatch(/<title>[^<]*GROKTOPUS/i);
    expect(html).not.toMatch(/<title>[^<]*Ridark/i);
    expect(html).toContain("no GROKTOPUS");
    expect(html).toContain("no Ridark");
  });

  it("does not embed an invented live tx hash", () => {
    const html = web("index.html");
    const js = web("app.js");
    const css = web("styles.css");
    expect(html).not.toMatch(LIVE_HASH);
    expect(css).not.toMatch(LIVE_HASH);
    const literals = js.match(LIVE_HASH) || [];
    expect(literals).toEqual([]);
    expect(js).toContain("paper_");
    expect(js).toContain("isVerifiedTxHash");
    expect(js).toContain("paper path must never mint a 0x hash");
    expect(js).toContain("CEX Advanced Trade CANNOT carry calldata");
    expect(js).not.toContain("INJECTOR_PRIVATE_KEY=0x");
  });

  it("paper helpers never mint a 0x receipt", async () => {
    const { pathToFileURL } = await import("node:url");
    const js = web("app.js");
    const fake = makeDom();
    const run = new Function("document", "window", "localStorage", "crypto", "history", "location", js);
    const win: Record<string, unknown> = { StorageTokenShow: undefined };
    run(fake.document, win, fake.localStorage, fake.crypto, fake.history, fake.location);
    const api = win.StorageTokenShow as {
      paperId: () => string;
      isVerifiedTxHash: (v: unknown) => boolean;
      costForBytes: (n: number) => bigint;
      hitchFits: (a: number, b: number) => boolean;
      sellTarget: (a: number, b: number) => number;
      creditsForSlot: (kind: string, n: number) => bigint;
      lockFirstFill: (slot: Record<string, unknown>) => { paperId: string; txHash: null };
      AVENUES: { id: string; stub: boolean }[];
      SEATS: string[];
      STORE_VOICE: string;
    };
    expect(api.STORE_VOICE).toBe("§$STORE§");
    expect(api.SEATS).toEqual([
      "WAVE",
      "SPARSE",
      "BROKER",
      "RISK",
      "VAULT",
      "INJECT",
      "RETRIEVE",
      "PROOF",
    ]);
    expect(api.AVENUES.map((a) => a.id)).toEqual([
      "base_dedicated",
      "uniswap_hitch",
      "coinbase_onchain",
      "wave_first",
      "gap_fill",
      "priority_express",
      "multi_chain_cheapest",
    ]);
    expect(api.AVENUES.filter((a) => a.stub).map((a) => a.id)).toEqual([
      "wave_first",
      "gap_fill",
      "priority_express",
      "multi_chain_cheapest",
    ]);
    for (let i = 0; i < 20; i++) {
      const id = api.paperId();
      expect(id).toMatch(/^paper_[0-9a-f]{16}$/);
      expect(api.isVerifiedTxHash(id)).toBe(false);
    }
    expect(api.isVerifiedTxHash("paper_ab")).toBe(false);
    expect(api.isVerifiedTxHash("0xfeed")).toBe(false);
    expect(api.costForBytes(10)).toBe(10n ** 15n);
    expect(api.hitchFits(32, 64)).toBe(true);
    expect(api.hitchFits(80, 64)).toBe(false);
    expect(api.sellTarget(1, 0.001)).toBeCloseTo(1.001);
    expect(api.creditsForSlot("priority_express", 32)).toBe(api.creditsForSlot("gap_fill", 32) * 3n);
    expect(() => api.lockFirstFill({ locked: false })).toThrow(/lock-first/);
    void pathToFileURL;
  });
});

function makeDom() {
  const nodes = new Map<string, FakeEl>();
  const byId = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new FakeEl(id));
    return nodes.get(id)!;
  };
  const document = {
    getElementById: (id: string) => byId(id),
    querySelectorAll: () => [],
    createElement: (tag: string) => new FakeEl(tag),
  };
  const store: Record<string, string> = {};
  const localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
  const crypto = {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 17 + 3) % 256;
      return arr;
    },
  };
  const history = { replaceState: () => undefined };
  const location = { hash: "#show" };
  return { document, localStorage, crypto, history, location };
}

class FakeEl {
  id: string;
  innerHTML = "";
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  href = "";
  className = "";
  children: FakeEl[] = [];
  classList = {
    add: () => undefined,
    remove: () => undefined,
    toggle: () => undefined,
    contains: () => false,
  };
  style: Record<string, string> = {};
  constructor(id: string) {
    this.id = id;
  }
  prepend(child: FakeEl) {
    this.children.unshift(child);
  }
  removeChild() {
    this.children.pop();
  }
  appendChild(child: FakeEl) {
    this.children.push(child);
    return child;
  }
  addEventListener() {
    return undefined;
  }
  querySelector() {
    return this;
  }
}
