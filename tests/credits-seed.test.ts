import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { BlockchainAdapter } from "../src/chain/adapter.js";
import { CreditLedger } from "../src/credits/ledger.js";
import { CREDITS_PER_WORD } from "../src/credits/pricing.js";
import {
  evaluateMainnetCreditSeed,
  MAINNET_BOOTSTRAP_SEED_MAX,
  MAINNET_BOOTSTRAP_SEED_VOICES,
  MAINNET_SEED_DISABLED,
  parseAllowMainnetCreditSeed,
} from "../src/credits/seed-policy.js";
import type { InjectionResult } from "../src/types.js";

const PAYER = "0x1111111111111111111111111111111111111111";
const ONE_VOICE = CREDITS_PER_WORD.toString();
const OVER_MAX = (MAINNET_BOOTSTRAP_SEED_MAX + 1n).toString();

const RECEIPT: InjectionResult = {
  txHash: "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
  blockNumber: 1,
  gasUsed: "21000",
  chain: "base",
  method: "calldata-injection",
  timestamp: 1,
  paidCredits: ONE_VOICE,
  provider: PAYER,
  entryPoint: "coinbase_onchain",
};

function mockAdapter(): BlockchainAdapter {
  return {
    getSupportedChains: () => ["base-sepolia", "base"],
    getChain: (name: string) =>
      name === "base"
        ? {
            name: "base",
            chainId: 8453,
            rpcUrl: "https://mainnet.base.org",
            explorerUrl: "",
          }
        : {
            name: "base-sepolia",
            chainId: 84532,
            rpcUrl: "https://sepolia.base.org",
            explorerUrl: "",
          },
    injectCalldata: async () => RECEIPT,
    getTransactionDetails: async () => ({
      hash: RECEIPT.txHash,
      blockNumber: 1,
      data: "0x00",
      to: PAYER,
      from: PAYER,
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
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        )
    )
  );
});

async function appWithEnv(env: Record<string, string>, ledger = new CreditLedger()) {
  const { app, config } = await createApp({
    config: loadConfig({ JWT_SECRET: "test-secret", ...env }),
    adapter: mockAdapter(),
    ledger,
  });
  const { server, base } = await listen(app);
  servers.push(server);
  return { base, ledger, config };
}

async function seed(
  base: string,
  amount = ONE_VOICE,
  address = PAYER
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/credits/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, amount }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("ALLOW_MAINNET_CREDIT_SEED parse", () => {
  it("unlocks only on the exact string yes", () => {
    expect(parseAllowMainnetCreditSeed(undefined)).toBe(false);
    expect(parseAllowMainnetCreditSeed("")).toBe(false);
    expect(parseAllowMainnetCreditSeed("no")).toBe(false);
    expect(parseAllowMainnetCreditSeed("true")).toBe(false);
    expect(parseAllowMainnetCreditSeed("YES")).toBe(false);
    expect(parseAllowMainnetCreditSeed("yes ")).toBe(false);
    expect(parseAllowMainnetCreditSeed("yes")).toBe(true);
  });

  it("loadConfig stays blocked unless ALLOW_MAINNET_CREDIT_SEED=yes", () => {
    expect(loadConfig({}).allowMainnetCreditSeed).toBe(false);
    expect(
      loadConfig({ ALLOW_MAINNET_CREDIT_SEED: "true" }).allowMainnetCreditSeed
    ).toBe(false);
    expect(
      loadConfig({ ALLOW_MAINNET_CREDIT_SEED: "yes" }).allowMainnetCreditSeed
    ).toBe(true);
  });
});

describe("evaluateMainnetCreditSeed", () => {
  it("blocks confirmed guarded and full_live by default", () => {
    expect(
      evaluateMainnetCreditSeed({
        mode: "base_mainnet_guarded",
        confirmMainnet: true,
        allowMainnetCreditSeed: false,
        amount: CREDITS_PER_WORD,
      })
    ).toEqual({ ok: false, status: 403, error: MAINNET_SEED_DISABLED });
    expect(
      evaluateMainnetCreditSeed({
        mode: "full_live",
        confirmMainnet: true,
        allowMainnetCreditSeed: false,
        amount: CREDITS_PER_WORD,
      })
    ).toEqual({ ok: false, status: 403, error: MAINNET_SEED_DISABLED });
  });

  it("allows a capped bootstrap when the env flag is set", () => {
    expect(
      evaluateMainnetCreditSeed({
        mode: "base_mainnet_guarded",
        confirmMainnet: true,
        allowMainnetCreditSeed: true,
        amount: CREDITS_PER_WORD,
      })
    ).toEqual({ ok: true, bootstrap: true });
    expect(
      evaluateMainnetCreditSeed({
        mode: "base_mainnet_guarded",
        confirmMainnet: true,
        allowMainnetCreditSeed: true,
        amount: MAINNET_BOOTSTRAP_SEED_MAX + 1n,
      }).ok
    ).toBe(false);
    expect(MAINNET_BOOTSTRAP_SEED_MAX).toBe(
      CREDITS_PER_WORD * BigInt(MAINNET_BOOTSTRAP_SEED_VOICES)
    );
  });

  it("does not gate paper or sepolia", () => {
    expect(
      evaluateMainnetCreditSeed({
        mode: "base_sepolia",
        confirmMainnet: false,
        allowMainnetCreditSeed: false,
        amount: 10n ** 21n,
      })
    ).toEqual({ ok: true, bootstrap: false });
  });
});

describe("POST /api/credits/seed mainnet gate", () => {
  const guarded = {
    MODE: "base_mainnet_guarded",
    CONFIRM_MAINNET: "yes",
    BASE_RPC: "https://mainnet.base.org",
  };

  it("is blocked by default on confirmed guarded mainnet", async () => {
    const { base } = await appWithEnv(guarded);
    const { status, body } = await seed(base);
    expect(status).toBe(403);
    expect(body.error).toBe(MAINNET_SEED_DISABLED);
  });

  it("is blocked by default on full_live", async () => {
    const { base } = await appWithEnv({
      MODE: "full_live",
      CONFIRM_MAINNET: "yes",
      BASE_RPC: "https://mainnet.base.org",
    });
    const { status, body } = await seed(base);
    expect(status).toBe(403);
    expect(body.error).toBe(MAINNET_SEED_DISABLED);
  });

  it("still refuses when the env is set to anything other than yes", async () => {
    const { base } = await appWithEnv({
      ...guarded,
      ALLOW_MAINNET_CREDIT_SEED: "true",
    });
    const { status, body } = await seed(base);
    expect(status).toBe(403);
    expect(body.error).toBe(MAINNET_SEED_DISABLED);
  });

  it("unlocks a capped internal-ledger bootstrap when ALLOW_MAINNET_CREDIT_SEED=yes", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { base, ledger } = await appWithEnv({
      ...guarded,
      ALLOW_MAINNET_CREDIT_SEED: "yes",
    });
    const { status, body } = await seed(base, ONE_VOICE);
    expect(status).toBe(200);
    expect(body.balance).toBe(ONE_VOICE);
    expect(body.bootstrap).toBe(true);
    expect(body.max).toBe(MAINNET_BOOTSTRAP_SEED_MAX.toString());
    expect(ledger.balanceOf(PAYER)).toBe(CREDITS_PER_WORD);
    expect(log.mock.calls.some((args) => String(args[0]).includes("guarded bootstrap credit seed"))).toBe(
      true
    );
    expect(log.mock.calls.some((args) => String(args[0]).includes("ALLOW_MAINNET_CREDIT_SEED=yes"))).toBe(
      true
    );
  });

  it("refuses a bootstrap amount above the documented max", async () => {
    const { base, ledger } = await appWithEnv({
      ...guarded,
      ALLOW_MAINNET_CREDIT_SEED: "yes",
    });
    const { status, body } = await seed(base, OVER_MAX);
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/exceeds max/);
    expect(body.max).toBe(MAINNET_BOOTSTRAP_SEED_MAX.toString());
    expect(ledger.balanceOf(PAYER)).toBe(0n);
  });

  it("leaves Sepolia seed uncapped and unlogged as bootstrap", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { base } = await appWithEnv({ MODE: "base_sepolia" });
    const huge = (10n ** 21n).toString();
    const { status, body } = await seed(base, huge);
    expect(status).toBe(200);
    expect(body.balance).toBe(huge);
    expect(body.bootstrap).toBeUndefined();
    expect(
      log.mock.calls.some((args) => String(args[0]).includes("guarded bootstrap credit seed"))
    ).toBe(false);
  });
});
