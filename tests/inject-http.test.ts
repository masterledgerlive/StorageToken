import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { BlockchainAdapter } from "../src/chain/adapter.js";
import { CreditLedger } from "../src/credits/ledger.js";
import type { InjectionResult } from "../src/types.js";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const RECEIPT_HASH =
  "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
const RECEIPT_BLOCK = 22223333;

const RECEIPT: InjectionResult = {
  txHash: RECEIPT_HASH,
  blockNumber: RECEIPT_BLOCK,
  gasUsed: "21000",
  chain: "base-sepolia",
  method: "calldata-injection",
  timestamp: 1_700_000_000_000,
  paidCredits: "1000000000000000",
  provider: PROVIDER,
  entryPoint: "base_dedicated",
};

function mockAdapter(receipt: InjectionResult | null = RECEIPT): BlockchainAdapter {
  return {
    getSupportedChains: () => ["base-sepolia"],
    getChain: () => ({
      name: "base-sepolia",
      chainId: 84532,
      rpcUrl: "https://sepolia.base.org",
      explorerUrl: "https://sepolia.basescan.org",
    }),
    injectCalldata: async () => {
      if (!receipt) throw new Error("Injection did not return a receipt hash");
      return receipt;
    },
    getTransactionDetails: async () => ({
      hash: RECEIPT_HASH,
      blockNumber: 88887777,
      data: "0x00",
      to: PROVIDER,
      from: PROVIDER,
      status: "success",
    }),
  } as unknown as BlockchainAdapter;
}

async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        )
    )
  );
});

async function seededApp(mode = "base_sepolia", receipt: InjectionResult | null = RECEIPT) {
  const ledger = new CreditLedger();
  ledger.seed(PROVIDER, 10n ** 18n);
  const { app, injectionStore } = await createApp({
    config: loadConfig({ MODE: mode, JWT_SECRET: "test-secret" }),
    adapter: mockAdapter(receipt),
    ledger,
  });
  const { server, base } = await listen(app);
  servers.push(server);
  return { base, injectionStore };
}

describe("HTTP inject uses receipt hashes only", () => {
  it("POST /api/inject returns the receipt hash and JWT READ metadata", async () => {
    const { base } = await seededApp();
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        provider: PROVIDER,
        creditPayer: PROVIDER,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txHash).toBe(RECEIPT_HASH);
    expect(body.blockNumber).toBe(RECEIPT_BLOCK);
    expect(body.currency).toBe("STORE");
    expect(body.paidCredits).toMatch(/^[0-9]+$/);
    expect(body.claimReceipt.txHash).toBe(RECEIPT_HASH);

    const decoded = jwt.decode(body.accessToken) as {
      purpose: string;
      notMoney: boolean;
      metadata: { txHash: string; paidCredits: string };
    };
    expect(decoded.purpose).toBe("strand-read");
    expect(decoded.notMoney).toBe(true);
    expect(decoded.metadata.txHash).toBe(RECEIPT_HASH);
  });

  it("fails if handler would return a hash that was not from a receipt", async () => {
    const { base } = await seededApp("base_sepolia", {
      ...RECEIPT,
      txHash: "",
    });
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: "0x68656c6c6f", provider: PROVIDER }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.txHash).toBeUndefined();
    expect(body.error).toMatch(/receipt hash|mocked/i);
  });

  it("GET /api/injection/:id reads the Map and 404s unknown ids without inventing a hash", async () => {
    const { base } = await seededApp();
    const created = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: [0x01, 0x02, 0x03], provider: PROVIDER }),
    });
    const injected = await created.json();
    const first = await fetch(`${base}/api/injection/${injected.injectionId}`);
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a.txHash).toBe(RECEIPT_HASH);

    const missing = await fetch(`${base}/api/injection/inj_does_not_exist`);
    expect(missing.status).toBe(404);
    const missingBody = await missing.json();
    expect(missingBody.txHash).toBeUndefined();
    expect(missingBody.error).toBe("Injection not found");
  });

  it("GET /api/retrieve uses chain block number, not 12345678", async () => {
    const { base } = await seededApp();
    const created = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "§$STORE§", provider: PROVIDER }),
    });
    const injected = await created.json();
    const res = await fetch(
      `${base}/api/retrieve/${RECEIPT_HASH}?chain=base-sepolia&accessToken=${injected.accessToken}`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blockNumber).toBe(88887777);
    expect(body.blockNumber).not.toBe(12345678);
  });

  it("rejects inject without payload", async () => {
    const { base } = await seededApp();
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses client-supplied txHash", async () => {
    const { base } = await seededApp();
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "hi",
        provider: PROVIDER,
        txHash: RECEIPT_HASH,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/txHash/);
  });

  it("paper mode does not invent a live 0x hash", async () => {
    const { base } = await seededApp("paper");
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "§$STORE§", provider: PROVIDER }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("paper");
    expect(body.txHash).toBeNull();
    expect(body.paperId).toMatch(/^paper_/);
  });

  it("refuses CEX Advanced Trade", async () => {
    const { base } = await seededApp();
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        provider: PROVIDER,
        cexAdvancedTrade: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/CEX Advanced Trade/);
  });

  it("uniswap_hitch refuses invented leftover", async () => {
    const { base } = await seededApp();
    await fetch(`${base}/api/switchboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPoint: "uniswap_hitch" }),
    });
    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        provider: PROVIDER,
        leftoverTx:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invent|unknown|mocked/i);
  });

  it("switchboard stubs stay disabled", async () => {
    const { base } = await seededApp();
    const get = await fetch(`${base}/api/switchboard`);
    const board = await get.json();
    expect(board.flags.x402.enabled).toBe(false);
    expect(board.flags.kite.enabled).toBe(false);
    expect(board.flags.x402.stub).toBe(true);
    const post = await fetch(`${base}/api/switchboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPoint: "kite" }),
    });
    expect(post.status).toBe(400);

    const wave = await fetch(`${base}/api/switchboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPoint: "wave_first" }),
    });
    expect(wave.status).toBe(400);
    expect(board.flags.wave_first.stub).toBe(true);
    expect(board.flags.gap_fill.enabled).toBe(false);
    expect(board.flags.priority_express.enabled).toBe(false);
    expect(board.flags.multi_chain_cheapest.enabled).toBe(false);
  });

  it("credits balance endpoint", async () => {
    const { base } = await seededApp();
    const res = await fetch(`${base}/api/credits/${PROVIDER}`);
    const body = await res.json();
    expect(body.balance).toBe((10n ** 18n).toString());
    expect(body.currency).toBe("STORE");
  });

  it("CORS allows the public Pages show to health-check a visitor Railway URL", async () => {
    const { base } = await seededApp();
    const preflight = await fetch(`${base}/health`, {
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const health = await fetch(`${base}/health`);
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
    const body = await health.json();
    expect(body.voice).toBe("§$STORE§");
    expect(body.payment).toBe("$STORE credits only");
  });
});

describe("source lock: handlers must not invent hashes", () => {
  it("app.ts does not use Math.random or hardcoded block 12345678", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const appSrc = readFileSync(join(root, "src/app.ts"), "utf8");
    expect(appSrc).not.toMatch(/Math\.random/);
    expect(appSrc).not.toMatch(/12345678/);
    expect(appSrc).not.toMatch(/mockStrand/);
  });
});
