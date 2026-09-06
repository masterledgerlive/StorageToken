import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { Wallet } from "ethers";
import { createApp } from "../src/app.js";
import {
  applyModeOverride,
  assertLiveSwitchAllowed,
  coinbaseEnvReady,
  firstEnv,
  loadConfig,
  networkForMode,
} from "../src/config.js";
import { BlockchainAdapter } from "../src/chain/adapter.js";
import {
  cdpFaucetAllowed,
  resolveCdpSenderAddress,
  sendCoinbaseOnchain,
  type CdpSendClient,
} from "../src/chain/cdp.js";
import { resolveFundAddress } from "../src/chain/keys.js";
import { CreditLedger } from "../src/credits/ledger.js";
import { buildSwitchboard, coinbaseCdpReady } from "../src/switchboard/index.js";
import type { InjectionResult } from "../src/types.js";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const RECEIPT_HASH =
  "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
const CDP_SUBMITTED =
  "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000";

const RECEIPT: InjectionResult = {
  txHash: RECEIPT_HASH,
  blockNumber: 99,
  gasUsed: "21000",
  chain: "base-sepolia",
  method: "calldata-injection",
  timestamp: 1,
  paidCredits: "1",
  provider: PROVIDER,
  entryPoint: "coinbase_onchain",
};

function mockAdapter(receipt: InjectionResult | null = RECEIPT): BlockchainAdapter {
  return {
    getSupportedChains: () => ["base-sepolia", "base"],
    getChain: (name: string) =>
      name === "base"
        ? { name: "base", chainId: 8453, rpcUrl: "https://mainnet.base.org", explorerUrl: "" }
        : { name: "base-sepolia", chainId: 84532, rpcUrl: "https://sepolia.base.org", explorerUrl: "" },
    injectCalldata: async () => {
      if (!receipt) throw new Error("Injection did not return a receipt hash");
      return receipt;
    },
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
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        )
    )
  );
});

describe("alias env parsing", () => {
  it("maps guardian CDP_* names into coinbaseCdp and health", async () => {
    const hot = Wallet.createRandom();
    const cfg = loadConfig({
      CDP_API_KEY_ID: "guardian-key",
      CDP_API_KEY_SECRET: "-----BEGIN\\nKEY\\n-----",
      CDP_WALLET_SECRET: hot.privateKey,
    });
    expect(cfg.coinbaseCdp.apiKey).toBe("guardian-key");
    expect(cfg.coinbaseCdp.apiSecret).toBe("-----BEGIN\nKEY\n-----");
    expect(cfg.coinbaseCdp.walletSecret).toBe(hot.privateKey);
    expect(coinbaseCdpReady(cfg)).toBe(true);
    expect(resolveFundAddress(cfg)).toBe(hot.address);

    const { app } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        CDP_API_KEY_ID: "guardian-key",
        CDP_API_KEY_SECRET: "guardian-secret",
        CDP_WALLET_SECRET: hot.privateKey,
      }),
      adapter: mockAdapter(),
    });
    const { server, base } = await listen(app);
    servers.push(server);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.coinbaseOnchainReady).toBe(true);
    expect(health.fundAddress).toBe(hot.address);
  });

  it("maps old-guide names into coinbaseCdp", () => {
    const hot = Wallet.createRandom();
    const cfg = loadConfig({
      COINBASE_API_KEY: "legacy-key",
      COINBASE_API_SECRET: "legacy-secret",
      COINBASE_PRIVATE_KEY: hot.privateKey,
    });
    expect(cfg.coinbaseCdp.apiKey).toBe("legacy-key");
    expect(cfg.coinbaseCdp.apiSecret).toBe("legacy-secret");
    expect(cfg.coinbaseCdp.walletSecret).toBe(hot.privateKey);
    expect(coinbaseCdpReady(cfg)).toBe(true);
    expect(resolveFundAddress(cfg)).toBe(hot.address);
  });

  it("shared Railway guardian-only env is ready without remapping", () => {
    const env = {
      CDP_API_KEY_ID: "guardian-id",
      CDP_API_KEY_SECRET: "guardian-secret",
      CDP_WALLET_SECRET: "guardian-wallet",
      COINBASE_CDP_API_KEY: "",
      COINBASE_CDP_API_SECRET: "",
      COINBASE_CDP_WALLET_SECRET: "",
    };
    expect(coinbaseEnvReady(env)).toBe(true);
    expect(coinbaseEnvReady({})).toBe(false);
    const board = buildSwitchboard(loadConfig(env));
    expect(board.flags.coinbase_onchain.enabled).toBe(true);
    expect(loadConfig(env).coinbaseCdp.apiKey).toBe("guardian-id");
  });

  it("maps CDP_ADDRESS as an alias of COINBASE_CDP_ADDRESS", () => {
    const cfg = loadConfig({
      CDP_ADDRESS: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
    });
    expect(cfg.coinbaseCdp.address).toBe(
      "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915"
    );
  });

  it("prefers COINBASE_CDP_* over aliases", () => {
    const cfg = loadConfig({
      COINBASE_CDP_API_KEY: "cdp-key",
      CDP_API_KEY_ID: "guardian-id",
      COINBASE_API_KEY: "old-key",
      COINBASE_CDP_API_SECRET: "cdp-secret",
      CDP_API_KEY_SECRET: "guardian-secret",
      COINBASE_API_SECRET: "old-secret",
      COINBASE_CDP_WALLET_SECRET: "cdp-wallet",
      CDP_WALLET_SECRET: "guardian-wallet",
      COINBASE_PRIVATE_KEY: "old-private",
      COINBASE_CDP_PROJECT_ID: "proj",
      COINBASE_CDP_ADDRESS: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      CDP_ADDRESS: "0x0000000000000000000000000000000000000001",
    });
    expect(cfg.coinbaseCdp.apiKey).toBe("cdp-key");
    expect(cfg.coinbaseCdp.apiSecret).toBe("cdp-secret");
    expect(cfg.coinbaseCdp.walletSecret).toBe("cdp-wallet");
    expect(cfg.coinbaseCdp.projectId).toBe("proj");
    expect(cfg.coinbaseCdp.address).toBe(
      "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915"
    );
    expect(firstEnv({ A: "", B: "x" }, "A", "B")).toBe("x");
  });
});

const PEM_WALLET_SECRET =
  "-----BEGIN EC PRIVATE KEY-----\nnot-a-hex-key\n-----END EC PRIVATE KEY-----";
const CDP_PORTAL_WALLET = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";

describe("fundAddress prefers configured CDP wallet", () => {
  it("prefers COINBASE_CDP_ADDRESS over INJECTOR when wallet secret is PEM", () => {
    const injector = Wallet.createRandom();
    const cfg = loadConfig({
      ENTRY_POINT: "coinbase_onchain",
      INJECTOR_PRIVATE_KEY: injector.privateKey,
      COINBASE_CDP_API_KEY: "k",
      COINBASE_CDP_API_SECRET: "s",
      COINBASE_CDP_WALLET_SECRET: PEM_WALLET_SECRET,
      COINBASE_CDP_ADDRESS: CDP_PORTAL_WALLET,
    });
    expect(cfg.coinbaseCdp.address).toBe(CDP_PORTAL_WALLET);
    expect(resolveFundAddress(cfg)).toBe(CDP_PORTAL_WALLET);
    expect(resolveFundAddress(cfg)).not.toBe(injector.address);
  });

  it("shared guardian CDP_* + COINBASE_CDP_ADDRESS still funds the portal wallet", () => {
    const injector = Wallet.createRandom();
    const cfg = loadConfig({
      ENTRY_POINT: "coinbase_onchain",
      INJECTOR_PRIVATE_KEY: injector.privateKey,
      CDP_API_KEY_ID: "guardian-id",
      CDP_API_KEY_SECRET: "guardian-secret",
      CDP_WALLET_SECRET: PEM_WALLET_SECRET,
      COINBASE_CDP_ADDRESS: CDP_PORTAL_WALLET,
    });
    expect(cfg.coinbaseCdp.apiKey).toBe("guardian-id");
    expect(resolveFundAddress(cfg)).toBe(CDP_PORTAL_WALLET);
  });

  it("prefers CDP_ADDRESS over INJECTOR on coinbase_onchain", () => {
    const injector = Wallet.createRandom();
    const cfg = loadConfig({
      ENTRY_POINT: "coinbase_onchain",
      INJECTOR_PRIVATE_KEY: injector.privateKey,
      COINBASE_CDP_WALLET_SECRET: PEM_WALLET_SECRET,
      CDP_ADDRESS: CDP_PORTAL_WALLET,
    });
    expect(resolveFundAddress(cfg)).toBe(CDP_PORTAL_WALLET);
  });

  it("falls back to INJECTOR when no CDP address is configured", () => {
    const injector = Wallet.createRandom();
    const cfg = loadConfig({
      ENTRY_POINT: "coinbase_onchain",
      INJECTOR_PRIVATE_KEY: injector.privateKey,
      COINBASE_CDP_WALLET_SECRET: PEM_WALLET_SECRET,
    });
    expect(resolveFundAddress(cfg)).toBe(injector.address);
  });

  it("GET /api/status and /health report the configured CDP address", async () => {
    const injector = Wallet.createRandom();
    const vault = Wallet.createRandom();
    const { app } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        ENTRY_POINT: "coinbase_onchain",
        INJECTOR_PRIVATE_KEY: injector.privateKey,
        VAULT_ADDRESS: vault.address,
        COINBASE_CDP_API_KEY: "k",
        COINBASE_CDP_API_SECRET: "s",
        COINBASE_CDP_WALLET_SECRET: PEM_WALLET_SECRET,
        COINBASE_CDP_ADDRESS: CDP_PORTAL_WALLET,
      }),
      adapter: mockAdapter(),
    });
    const { server, base } = await listen(app);
    servers.push(server);

    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.fundAddress).toBe(CDP_PORTAL_WALLET);
    expect(status.hotAddress).toBe(CDP_PORTAL_WALLET);
    expect(status.entryPoint).toBe("coinbase_onchain");

    const health = await (await fetch(`${base}/health`)).json();
    expect(health.fundAddress).toBe(CDP_PORTAL_WALLET);
  });
});

describe("switchboard coinbase readiness", () => {
  it("stays disabled without keys and enables with aliases", () => {
    const off = buildSwitchboard(loadConfig({}));
    expect(off.flags.coinbase_onchain.enabled).toBe(false);
    expect(off.flags.coinbase_onchain.reason).toMatch(/COINBASE_API_KEY/);

    const on = buildSwitchboard(
      loadConfig({
        COINBASE_API_KEY: "k",
        COINBASE_API_SECRET: "s",
        COINBASE_CDP_PROJECT_ID: "p",
      })
    );
    expect(on.flags.coinbase_onchain.enabled).toBe(true);
    expect(
      coinbaseCdpReady(
        loadConfig({
          COINBASE_CDP_API_KEY: "k",
          COINBASE_CDP_API_SECRET: "s",
          COINBASE_CDP_WALLET_SECRET: "w",
        })
      )
    ).toBe(true);
  });
});

describe("status fundAddress shape", () => {
  it("GET /api/status and /health expose fundAddress, network, chainId, switchHint", async () => {
    const hot = Wallet.createRandom();
    const vault = Wallet.createRandom();
    const { app } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        INJECTOR_PRIVATE_KEY: hot.privateKey,
        VAULT_ADDRESS: vault.address,
        COINBASE_CDP_API_KEY: "k",
        COINBASE_CDP_API_SECRET: "s",
        COINBASE_CDP_WALLET_SECRET: hot.privateKey,
      }),
      adapter: mockAdapter(),
    });
    const { server, base } = await listen(app);
    servers.push(server);

    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.fundAddress).toBe(hot.address);
    expect(status.hotAddress).toBe(hot.address);
    expect(status.network).toBe("base-sepolia");
    expect(status.chainId).toBe(84532);
    expect(status.mode).toBe("base_sepolia");
    expect(status.entryPoint).toBe("base_dedicated");
    expect(status.coinbaseOnchainReady).toBe(true);
    expect(status.switchHint).toMatch(/POST \/api\/mode/);
    expect(status.modeApi).toMatch(/confirmMainnet/);
    expect(status.vaultAddress).toBe(vault.address);

    const health = await (await fetch(`${base}/health`)).json();
    expect(health.fundAddress).toBe(hot.address);
    expect(health.chainId).toBe(84532);
    expect(health.network).toBe("base-sepolia");
    expect(health.modeApi).toMatch(/POST \/api\/mode/);
  });
});

describe("POST /api/mode gate", () => {
  it("refuses mainnet without confirm, without BASE_RPC, and when vault equals injector", async () => {
    const hot = Wallet.createRandom();
    const vault = Wallet.createRandom();
    const cfg = loadConfig({
      MODE: "base_sepolia",
      JWT_SECRET: "test-secret",
      INJECTOR_PRIVATE_KEY: hot.privateKey,
      VAULT_ADDRESS: vault.address,
    });
    expect(() =>
      assertLiveSwitchAllowed(cfg, "base_mainnet_guarded", "no")
    ).toThrow(/confirmMainnet/);
    expect(() =>
      assertLiveSwitchAllowed(cfg, "full_live", "yes")
    ).toThrow(/BASE_RPC/);

    const same = loadConfig({
      MODE: "base_sepolia",
      BASE_RPC: "https://mainnet.base.org",
      INJECTOR_PRIVATE_KEY: hot.privateKey,
      VAULT_ADDRESS: hot.address,
    });
    expect(() =>
      assertLiveSwitchAllowed(same, "base_mainnet_guarded", "yes")
    ).toThrow(/Vault/);

    const { app, config } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        INJECTOR_PRIVATE_KEY: hot.privateKey,
        VAULT_ADDRESS: vault.address,
        BASE_RPC: "https://mainnet.base.org",
      }),
      adapter: mockAdapter(),
    });
    const { server, base } = await listen(app);
    servers.push(server);

    const refused = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "base_mainnet_guarded" }),
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/confirmMainnet/);

    const { app: noRpcApp } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        INJECTOR_PRIVATE_KEY: hot.privateKey,
        VAULT_ADDRESS: vault.address,
      }),
      adapter: mockAdapter(),
    });
    const noRpc = await listen(noRpcApp);
    servers.push(noRpc.server);
    const missingRpc = await fetch(`${noRpc.base}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "full_live",
        confirmMainnet: "yes",
      }),
    });
    expect(missingRpc.status).toBe(400);
    expect((await missingRpc.json()).error).toMatch(/BASE_RPC/);

    const ok = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "base_mainnet_guarded",
        confirmMainnet: "yes",
      }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.mode).toBe("base_mainnet_guarded");
    expect(body.network).toBe("base");
    expect(body.chainId).toBe(8453);
    expect(body.confirmMainnet).toBe(true);
    expect(body.persisted).toBe("memory");
    expect(config.mode).toBe("base_mainnet_guarded");
    expect(config.confirmMainnet).toBe(true);
    expect(networkForMode(config.mode)).toBe("base");
  });

  it("applyModeOverride is in-memory only", () => {
    const cfg = loadConfig({
      MODE: "base_sepolia",
      BASE_RPC: "https://mainnet.base.org",
    });
    applyModeOverride(cfg, "full_live", "yes");
    expect(cfg.mode).toBe("full_live");
    expect(cfg.confirmMainnet).toBe(true);
    expect(loadConfig({ MODE: "base_sepolia" }).mode).toBe("base_sepolia");
  });
});

describe("coinbase_onchain inject path", () => {
  it("uses the hex CDP key through the adapter and returns the receipt hash", async () => {
    const hot = Wallet.createRandom();
    const ledger = new CreditLedger();
    ledger.seed(PROVIDER, 10n ** 18n);
    const { app } = await createApp({
      config: loadConfig({
        MODE: "base_sepolia",
        JWT_SECRET: "test-secret",
        INJECTOR_PRIVATE_KEY: hot.privateKey,
        COINBASE_API_KEY: "k",
        COINBASE_API_SECRET: "s",
        COINBASE_PRIVATE_KEY: hot.privateKey,
        ENTRY_POINT: "coinbase_onchain",
      }),
      adapter: mockAdapter(),
      ledger,
    });
    const { server, base } = await listen(app);
    servers.push(server);

    const board = await (await fetch(`${base}/api/switchboard`)).json();
    expect(board.flags.coinbase_onchain.enabled).toBe(true);

    const res = await fetch(`${base}/api/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "§$STORE§",
        provider: PROVIDER,
        creditPayer: PROVIDER,
        entryPoint: "coinbase_onchain",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txHash).toBe(RECEIPT_HASH);
    expect(body.entryPoint).toBe("coinbase_onchain");
    expect(body.chain).toBe("base-sepolia");
  });

  it("sends from COINBASE_CDP_ADDRESS via getAccount, not StorageTokenHot", async () => {
    const injector = Wallet.createRandom();
    const adapter = new BlockchainAdapter();
    vi.spyOn(adapter, "getProvider").mockReturnValue({
      waitForTransaction: async () => ({
        hash: RECEIPT_HASH,
        blockNumber: 777,
        gasUsed: 21000n,
      }),
    } as never);

    const getAccount = vi.fn(async (opts: { address?: string; name?: string }) => {
      expect(opts.address).toBe(CDP_PORTAL_WALLET);
      expect(opts.name).toBeUndefined();
      return { address: CDP_PORTAL_WALLET };
    });
    const getOrCreateAccount = vi.fn(async () => ({
      address: "0x2222222222222222222222222222222222222222",
    }));

    const cdp: CdpSendClient = {
      evm: {
        getAccount,
        getOrCreateAccount,
        sendTransaction: async (opts) => {
          expect(opts.address).toBe(CDP_PORTAL_WALLET);
          expect(opts.network).toBe("base-sepolia");
          expect(opts.transaction.value).toBe(0n);
          return { transactionHash: CDP_SUBMITTED };
        },
      },
    };

    const config = loadConfig({
      MODE: "base_sepolia",
      ENTRY_POINT: "coinbase_onchain",
      INJECTOR_PRIVATE_KEY: injector.privateKey,
      COINBASE_CDP_API_KEY: "k",
      COINBASE_CDP_API_SECRET: "s",
      COINBASE_CDP_WALLET_SECRET: PEM_WALLET_SECRET,
      COINBASE_CDP_ADDRESS: CDP_PORTAL_WALLET,
    });

    const sender = await resolveCdpSenderAddress(config, cdp);
    expect(sender).toBe(CDP_PORTAL_WALLET);
    expect(getAccount).toHaveBeenCalledWith({ address: CDP_PORTAL_WALLET });
    expect(getOrCreateAccount).not.toHaveBeenCalled();

    const result = await sendCoinbaseOnchain({
      config,
      adapter,
      chain: "base-sepolia",
      to: PROVIDER,
      data: "0x68656c6c6f",
      entryPoint: "coinbase_onchain",
      paidCredits: "1",
      cdpClient: cdp,
    });

    expect(result.txHash).toBe(RECEIPT_HASH);
    expect(config.resolvedFundAddress).toBe(CDP_PORTAL_WALLET);
    expect(getOrCreateAccount).not.toHaveBeenCalled();
  });

  it("CDP SDK path waits for the receipt, not the submitted hash", async () => {
    const adapter = new BlockchainAdapter();
    vi.spyOn(adapter, "getProvider").mockReturnValue({
      waitForTransaction: async () => ({
        hash: RECEIPT_HASH,
        blockNumber: 777,
        gasUsed: 21000n,
      }),
    } as never);

    const cdp: CdpSendClient = {
      evm: {
        getOrCreateAccount: async (opts) => {
          expect(opts.name).toBe("StorageTokenHot");
          return { address: "0x2222222222222222222222222222222222222222" };
        },
        sendTransaction: async (opts) => {
          expect(opts.network).toBe("base-sepolia");
          expect(opts.transaction.value).toBe(0n);
          expect(opts.transaction.to).toBe(PROVIDER);
          expect(opts.transaction.data).toMatch(/^0x/);
          return { transactionHash: CDP_SUBMITTED };
        },
      },
    };

    const result = await sendCoinbaseOnchain({
      config: loadConfig({
        MODE: "base_sepolia",
        COINBASE_CDP_API_KEY: "k",
        COINBASE_CDP_API_SECRET: "s",
        COINBASE_CDP_WALLET_SECRET: "not-a-hex-key",
      }),
      adapter,
      chain: "base-sepolia",
      to: PROVIDER,
      data: "0x68656c6c6f",
      entryPoint: "coinbase_onchain",
      paidCredits: "1",
      cdpClient: cdp,
    });

    expect(result.txHash).toBe(RECEIPT_HASH);
    expect(result.txHash).not.toBe(CDP_SUBMITTED);
    expect(result.blockNumber).toBe(777);
  });

  it("requestFaucet is Sepolia-only", () => {
    expect(cdpFaucetAllowed("base-sepolia")).toBe(true);
    expect(cdpFaucetAllowed("base")).toBe(false);
  });
});
