import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { LeftoverRegistry } from "../src/chain/leftovers.js";
import { loadConfig } from "../src/config.js";
import { CreditLedger } from "../src/credits/ledger.js";
import {
  appendToCalldata,
  buildLibmHeader,
  CALLDATA_GAS_PER_BYTE,
  hitchCalldataGas,
  LIBM_MAGIC,
} from "../src/hitch/strand.js";
import {
  BASE_WETH,
  createLivePriceClient,
  parseDexScreenerTokenUsd,
  parseGeckoTokenUsd,
  parsePositiveUsd,
  wantsLiveUsd,
  type FetchLike,
} from "../src/prices/live.js";
import * as telegram from "../src/alerts/telegram.js";
import type { BlockchainAdapter } from "../src/chain/adapter.js";
import type { InjectionResult } from "../src/types.js";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const RECEIPT_HASH =
  "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
const LEFTOVER_OK =
  "0xabcddcbaabcddcbaabcddcbaabcddcbaabcddcbaabcddcbaabcddcbaabcddcba";

const RECEIPT: InjectionResult = {
  txHash: RECEIPT_HASH,
  blockNumber: 11,
  gasUsed: "21000",
  chain: "base-sepolia",
  method: "calldata-injection",
  timestamp: 1,
  paidCredits: "1",
  provider: PROVIDER,
  entryPoint: "uniswap_hitch",
};

function mockAdapter(): BlockchainAdapter {
  return {
    getSupportedChains: () => ["base-sepolia"],
    getChain: () => ({
      name: "base-sepolia",
      chainId: 84532,
      rpcUrl: "https://sepolia.base.org",
      explorerUrl: "",
    }),
    injectCalldata: async () => RECEIPT,
    getTransactionDetails: async () => ({
      hash: RECEIPT_HASH,
      blockNumber: 1,
      data: "0x00",
      to: PROVIDER,
      from: PROVIDER,
      status: "success",
    }),
    getProvider: () => {
      throw new Error("no provider in mock");
    },
    setSigner: () => undefined,
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

describe("live USD parsers fail closed", () => {
  it("rejects zero / missing and reads Gecko then DexScreener", async () => {
    expect(parsePositiveUsd(0)).toBeUndefined();
    expect(parsePositiveUsd("0")).toBeUndefined();
    expect(parsePositiveUsd(-1)).toBeUndefined();
    expect(
      parseGeckoTokenUsd(
        { data: { attributes: { token_prices: { [BASE_WETH.toLowerCase()]: "3123.5" } } } },
        BASE_WETH
      )
    ).toBe(3123.5);
    expect(
      parseGeckoTokenUsd({ data: { attributes: { token_prices: { [BASE_WETH]: "0" } } } }, BASE_WETH)
    ).toBeUndefined();
    expect(
      parseDexScreenerTokenUsd({
        pairs: [
          { chainId: "base", priceUsd: "0", liquidity: { usd: 9 } },
          { chainId: "base", priceUsd: "1.25", liquidity: { usd: 100 } },
        ],
      })
    ).toBe(1.25);

    const geckoThenDex: FetchLike = async (url) => {
      if (url.includes("geckoterminal")) {
        return { ok: true, json: async () => ({ data: { attributes: { token_prices: {} } } }) };
      }
      return {
        ok: true,
        json: async () => ({
          pairs: [{ chainId: "base", priceUsd: "4.5", liquidity: { usd: 10 } }],
        }),
      };
    };
    const quote = await createLivePriceClient(geckoThenDex).ethUsd();
    expect(quote.usd).toBe(4.5);
    expect(quote.source).toBe("dexscreener");

    const empty: FetchLike = async () => ({
      ok: true,
      json: async () => ({ data: { attributes: { token_prices: { [BASE_WETH]: "0" } } } }),
    });
    await expect(createLivePriceClient(empty).ethUsd()).rejects.toThrow(/refusing silent \$0/);
    expect(wantsLiveUsd({ needUsd: true })).toBe(true);
    expect(wantsLiveUsd({ text: "§$STORE§" })).toBe(false);
  });
});

describe("LIBM hitch append (guardian bitstorage)", () => {
  it("appends fragment onto leftover swap calldata", () => {
    const header = buildLibmHeader(Buffer.alloc(8, 7), 0);
    expect(header.subarray(0, 4).equals(LIBM_MAGIC)).toBe(true);
    const calldata = appendToCalldata("0x04e45aaf", header);
    expect(calldata.startsWith("0x04e45aaf")).toBe(true);
    expect(calldata.length).toBeGreaterThan("0x04e45aaf".length);
    expect(hitchCalldataGas(10)).toBe(10 * CALLDATA_GAS_PER_BYTE);
    expect(() => appendToCalldata("not-hex", header)).toThrow(/real tx/);
  });
});

describe("quote + inject hitch USD + telegram", () => {
  it("GET /api/price and quote fail closed, inject notifies mined success/fail", async () => {
    const notify = vi.fn<typeof telegram.notifyTelegram>().mockResolvedValue(true);
    const prices = createLivePriceClient(async (url) => {
      if (url.includes("geckoterminal") && url.toLowerCase().includes(BASE_WETH.slice(2).toLowerCase())) {
        return {
          ok: true,
          json: async () => ({
            data: { attributes: { token_prices: { [BASE_WETH.toLowerCase()]: "3000" } } },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ data: { attributes: { token_prices: {} } } }),
      };
    });

    const ledger = new CreditLedger();
    ledger.seed(PROVIDER, 10n ** 18n);
    const leftoverReg = new LeftoverRegistry();
    leftoverReg.register({
      swapTx: LEFTOVER_OK,
      leftoverBytes: 64,
      owner: PROVIDER,
      receiptBlock: 99,
    });

    const { app } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        TELEGRAM_BOT_TOKEN: "tok",
        TELEGRAM_CHAT_ID: "123",
        ENTRY_POINT: "uniswap_hitch",
      }),
      adapter: mockAdapter(),
      ledger,
      leftovers: leftoverReg,
      prices,
      notify,
    });
    const { server, base } = await listen(app);
    servers.push(server);

    const eth = await (await fetch(`${base}/api/price?eth=1`)).json();
    expect(eth.usd).toBe(3000);
    expect(eth.source).toBe("geckoterminal");

    const missing = await fetch(`${base}/api/price?token=${TOKEN}`);
    expect(missing.status).toBe(502);
    expect((await missing.json()).error).toMatch(/refusing silent \$0/);

    const quote = await fetch(`${base}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        leftoverBytes: 64,
        needUsd: true,
        gasPriceGwei: 0.02,
      }),
    });
    expect(quote.status).toBe(200);
    const quoted = await quote.json();
    expect(quoted.hitch.fits).toBe(true);
    expect(quoted.hitch.ethUsd).toBe(3000);
    expect(quoted.hitch.hitchUsd).toBeGreaterThan(0);

    const zeroQuote = await fetch(`${base}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        leftoverBytes: 64,
        needUsd: true,
        gasPriceGwei: 0,
      }),
    });
    expect(zeroQuote.status).toBe(400);
    expect((await zeroQuote.json()).error).toMatch(/refusing silent \$0/);

    const failed = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        provider: PROVIDER,
        leftoverTx: LEFTOVER_OK,
        tokenAddress: TOKEN,
      }),
    });
    expect(failed.status).toBe(400);
    expect((await failed.json()).error).toMatch(/refusing silent \$0/);
    expect(notify.mock.calls.some((c) => String(c[1]).includes("FAIL"))).toBe(true);

    const injected = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        provider: PROVIDER,
        leftoverTx: LEFTOVER_OK,
        needUsd: true,
        gasPriceGwei: 0.02,
        leftoverBytes: 64,
      }),
    });
    expect(injected.status).toBe(200);
    const body = await injected.json();
    expect(body.txHash).toBe(RECEIPT_HASH);
    expect(notify.mock.calls.some((c) => String(c[1]).includes("inject OK"))).toBe(true);
    expect(notify.mock.calls.some((c) => String(c[1]).includes(RECEIPT_HASH))).toBe(true);
  });

  it("telegram stays silent without env", async () => {
    expect(await telegram.notifyTelegram({}, "hi")).toBe(false);
    expect(telegram.formatInjectAlert({ ok: false, error: "nope" })).toMatch(/FAIL/);
  });
});
