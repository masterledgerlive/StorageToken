import express from "express";
import { ethers } from "ethers";
import {
  applyModeOverride,
  loadConfig,
  parseMode,
  type AppConfig,
} from "./config.js";
import { TokenManager } from "./access/token-manager.js";
import { BlockchainAdapter } from "./chain/adapter.js";
import { LeftoverRegistry } from "./chain/leftovers.js";
import {
  assertFundAddressNotVault,
  assertNotVaultKey,
  resolveFundAddress,
} from "./chain/keys.js";
import { CreditLedger } from "./credits/ledger.js";
import { costForBytes, measureHitchWave, sellTarget } from "./credits/pricing.js";
import { executeInject, type InjectionStore } from "./inject/engine.js";
import { PaperLoop } from "./loop/paper.js";
import { parseInjectionPayload } from "./payload.js";
import {
  buildSwitchboard,
  refuseCexAdvancedTrade,
} from "./switchboard/index.js";
import { runtimePublicFields } from "./status.js";
import {
  ENTRY_POINTS,
  MODES,
  STORE_VOICE,
  STUB_ENTRY_POINTS,
  type EntryPoint,
  type InjectionRecord,
  type Mode,
} from "./types.js";
import { formatInjectAlert, notifyTelegram } from "./alerts/telegram.js";
import { deskAvenueCatalog } from "./avenues.js";
import { injectIsSoleWriter, seatCatalog } from "./seats.js";
import { PaperBroker, type SlotKind } from "./broker/paper.js";
import { resolveCdpFundAddress } from "./chain/cdp.js";
import {
  BASE_WETH,
  createLivePriceClient,
  wantsLiveUsd,
  type LivePriceClient,
} from "./prices/live.js";

export interface CreateAppOptions {
  config?: AppConfig;
  adapter?: BlockchainAdapter;
  tokenManager?: TokenManager;
  ledger?: CreditLedger;
  leftovers?: LeftoverRegistry;
  injectionStore?: InjectionStore;
  broker?: PaperBroker;
  prices?: LivePriceClient;
  notify?: typeof notifyTelegram;
}

export interface CreatedApp {
  app: express.Express;
  injectionStore: InjectionStore;
  adapter: BlockchainAdapter;
  tokenManager: TokenManager;
  ledger: CreditLedger;
  leftovers: LeftoverRegistry;
  config: AppConfig;
  paper: PaperLoop;
  broker: PaperBroker;
}

function serializeRecord(record: InjectionRecord) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString(),
  };
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const config = options.config ?? loadConfig();
  assertNotVaultKey(config.injectorPrivateKey, config.vaultAddress);
  config.resolvedFundAddress = resolveFundAddress(config);
  if (!config.resolvedFundAddress) {
    try {
      await resolveCdpFundAddress(config);
    } catch {
      // Health still works; fundAddress fills after the first CDP account resolve.
    }
  }
  assertFundAddressNotVault(config.resolvedFundAddress, config.vaultAddress);

  const injectionStore: InjectionStore =
    options.injectionStore ?? new Map<string, InjectionRecord>();
  const adapter =
    options.adapter ??
    new BlockchainAdapter(config.injectorPrivateKey, {
      baseSepolia: config.baseSepoliaRpc,
      base: config.baseMainnetRpc,
    });
  const tokenManager =
    options.tokenManager ?? new TokenManager(config.jwtSecret, config.tokenExpiryHours);
  const ledger = options.ledger ?? new CreditLedger();
  const leftovers = options.leftovers ?? new LeftoverRegistry();
  const paper = new PaperLoop();
  const broker = options.broker ?? new PaperBroker();
  const prices = options.prices ?? createLivePriceClient();
  const notify = options.notify ?? notifyTelegram;
  broker.seedDemoBook();

  let switchboard = buildSwitchboard(config);

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Public Pages show + Grok Bot / agents. No cookies. CORS may still fail
  // on some Railway custom domains — the site then shows curl + open-in-tab.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  app.get("/health", (_req, res) => {
    const runtime = runtimePublicFields(config, switchboard);
    res.json({
      status: "healthy",
      service: "StorageToken",
      ...runtime,
      defaultChain: runtime.network,
      voice: STORE_VOICE,
      payment: "$STORE credits only",
      jwt: "strand READ access — not money",
      origin:
        "gamemasters/agent-genesis unreachable (404 / bc-e37bda11 inaccessible); surfaces reconstructed from spec",
      injectPort: "masterledgerlive/injection-service PR #1",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      ...runtimePublicFields(config, switchboard),
      storeToken: config.storeTokenAddress || null,
      router: config.routerAddress || null,
      vaultAddress: config.vaultAddress || null,
      injections: injectionStore.size,
      leftovers: leftovers.list().filter((l) => !l.used).length,
      noGuaranteedPnl: true,
    });
  });

  app.post("/api/mode", (req, res) => {
    const raw = req.body?.mode;
    if (typeof raw !== "string" || !MODES.includes(raw as Mode)) {
      return res.status(400).json({
        error:
          'Invalid mode. Use paper | base_sepolia | base_mainnet_guarded | full_live',
      });
    }
    try {
      const next = parseMode(raw);
      applyModeOverride(config, next, req.body?.confirmMainnet);
      switchboard = buildSwitchboard(config, switchboard.entryPoint);
      res.json({
        ...runtimePublicFields(config, switchboard),
        persisted: "memory",
        note: "Railway env remains source of truth on restart. Update MODE, CONFIRM_MAINNET, and BASE_RPC for a durable flip.",
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "mode switch refused",
      });
    }
  });

  app.get("/api/switchboard", (_req, res) => {
    res.json(switchboard);
  });

  app.get("/api/avenues", (_req, res) => {
    res.json({
      selected: switchboard.entryPoint,
      avenues: deskAvenueCatalog().map((row) => ({
        ...row,
        enabled: Boolean(switchboard.flags[row.id]?.enabled),
        switchReason: switchboard.flags[row.id]?.reason ?? row.reason,
      })),
      note: "Only base_dedicated, uniswap_hitch, and coinbase_onchain can send. Other avenues are honest stubs or paper policy.",
    });
  });

  app.get("/api/seats", (_req, res) => {
    res.json({
      floor: "STORE FLOOR",
      desk: "$STORE Desk",
      companion:
        "https://github.com/galleonlabs/hypergrok-trading-desk — trading seats only. Do not import those seats onto STORE FLOOR.",
      injectSoleWriter: injectIsSoleWriter(),
      seats: seatCatalog(),
    });
  });

  app.get("/api/broker/book", (_req, res) => {
    res.json({
      market: "paper",
      currency: "STORE",
      lockFirst: true,
      vaultSpends: false,
      slots: broker.book(),
      note: "Paper open-market book. Slot ids are paper_slot_*. No chain hashes.",
    });
  });

  app.post("/api/broker/offer", (req, res) => {
    try {
      if (req.body?.txHash || req.body?.cexAdvancedTrade) {
        return res.status(400).json({
          error: "Broker paper refuses client txHash and CEX Advanced Trade",
        });
      }
      const kind = req.body?.kind as SlotKind;
      const leftoverBytes = Number(req.body?.leftoverBytes);
      const slot = broker.offer(kind, leftoverBytes);
      res.json({ market: "paper", slot, txHash: null });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "offer refused",
      });
    }
  });

  app.post("/api/broker/lock", (req, res) => {
    try {
      if (req.body?.txHash) {
        return res.status(400).json({ error: "Do not supply txHash — paper lock only" });
      }
      const slotId = String(req.body?.slotId ?? "");
      const lock = broker.lock(slotId);
      res.json({ market: "paper", lock, txHash: null, note: "lock-first — fill requires this lockId" });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "lock refused",
      });
    }
  });

  app.post("/api/broker/fill", (req, res) => {
    try {
      if (req.body?.txHash) {
        return res.status(400).json({ error: "Do not supply txHash — paper fill only" });
      }
      const lockId = String(req.body?.lockId ?? "");
      const fill = broker.fill(lockId);
      res.json({ market: "paper", ...fill });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "fill refused",
      });
    }
  });

  app.post("/api/switchboard", (req, res) => {
    const next = req.body?.entryPoint as EntryPoint | undefined;
    if (!next || !ENTRY_POINTS.includes(next)) {
      return res.status(400).json({ error: "Invalid entryPoint" });
    }
    if (STUB_ENTRY_POINTS.includes(next)) {
      return res.status(400).json({
        error: `${next} is stub-flagged and stays disabled`,
        switchboard,
        avenue: deskAvenueCatalog().find((a) => a.id === next) ?? null,
      });
    }
    switchboard = buildSwitchboard(config, next);
    res.json(switchboard);
  });

  /**
   * Ported inject path (injection-service PR #1):
   * plugin.inject → to=provider (or router), receipt hash after wait(),
   * JWT metadata { txHash, blockNumber, chain, ... }, Map store.
   * Payment is $STORE credits, not native wei skim.
   */
  app.post("/api/inject", async (req, res) => {
    try {
      const providerAddress =
        (req.body.provider as string | undefined) ||
        (req.body.recipientAddress as string | undefined) ||
        config.defaultProvider;

      if (!providerAddress || !ethers.isAddress(providerAddress)) {
        return res.status(400).json({ error: "Missing or invalid provider address" });
      }

      const creditPayer =
        (req.body.creditPayer as string | undefined) ||
        (req.body.payer as string | undefined) ||
        providerAddress;

      if (!ethers.isAddress(creditPayer)) {
        return res.status(400).json({ error: "Missing or invalid creditPayer" });
      }

      const entryPoint = (req.body.entryPoint as EntryPoint | undefined) ||
        switchboard.entryPoint;

      const { record, result } = await executeInject(
        {
          body: req.body,
          creditPayer,
          provider: providerAddress,
          entryPoint,
          chain: req.body.chain,
        },
        { config, adapter, ledger, leftovers, switchboard, prices }
      );

      if (config.mode !== "paper" && !record.txHash) {
        return res.status(502).json({ error: "Injection did not return a receipt hash" });
      }

      const accessToken = tokenManager.generateAccessToken(record.strandId, {
        metadata: {
          purpose: "strand-read",
          notMoney: true,
          txHash: record.txHash ?? null,
          paperId: record.paperId ?? null,
          blockNumber: record.blockNumber ?? null,
          chain: record.chain,
          paidCredits: record.costCredits,
          provider: record.provider,
          entryPoint: record.entryPoint,
          mode: record.mode,
        },
      });
      record.accessToken = accessToken.token;
      injectionStore.set(record.injectionId, record);

      if (record.txHash) {
        void notify(
          config.telegram,
          formatInjectAlert({
            ok: true,
            injectionId: record.injectionId,
            txHash: record.txHash,
            paidCredits: record.costCredits,
            entryPoint: record.entryPoint,
          })
        );
      }

      res.json({
        injectionId: record.injectionId,
        strandId: record.strandId,
        chain: record.chain,
        mode: record.mode,
        entryPoint: record.entryPoint,
        status: record.status,
        txHash: record.txHash ?? null,
        paperId: record.paperId ?? null,
        blockNumber: record.blockNumber ?? null,
        paidCredits: record.costCredits,
        currency: "STORE",
        provider: record.provider,
        leftoverTx: record.leftoverTx ?? null,
        bytesLen: record.bytesLen,
        voice: STORE_VOICE,
        accessToken: record.accessToken,
        claimReceipt: {
          txHash: record.txHash ?? null,
          paperId: record.paperId ?? null,
          blockNumber: record.blockNumber ?? null,
          chain: record.chain,
          paidCredits: record.costCredits,
          provider: record.provider,
        },
        note:
          config.mode === "paper"
            ? "paper mode does not invent chain hashes"
            : result
              ? "hash is from mined receipt"
              : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Injection failed";
      void notify(
        config.telegram,
        formatInjectAlert({
          ok: false,
          error: message,
          entryPoint: typeof req.body?.entryPoint === "string" ? req.body.entryPoint : switchboard.entryPoint,
        })
      );
      const status =
        /disabled|Insufficient|Invalid|Missing|Refusing|invent|mocked|CEX|txHash|leftover|credits|USD|price|silent/i.test(
          message
        )
          ? 400
          : 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/injection/:injectionId", (req, res) => {
    const record = injectionStore.get(req.params.injectionId);
    if (!record) {
      return res.status(404).json({ error: "Injection not found" });
    }
    res.json(serializeRecord(record));
  });

  app.get("/api/retrieve/:txHash", async (req, res) => {
    try {
      const { txHash } = req.params;
      const chain =
        (req.query.chain as string | undefined) ||
        runtimePublicFields(config, switchboard).network;
      const token = (req.query.accessToken as string | undefined) ||
        (req.headers.authorization?.replace(/^Bearer\s+/i, "") as string | undefined);

      if (!token) {
        return res.status(401).json({ error: "JWT strand READ access required" });
      }
      const verified = tokenManager.verifyAccessToken(token);
      if (!verified.valid) {
        return res.status(401).json({ error: verified.error || "Invalid access token" });
      }

      if (txHash.startsWith("paper_")) {
        const found = [...injectionStore.values()].find((r) => r.paperId === txHash);
        if (!found) return res.status(404).json({ error: "Paper injection not found" });
        return res.json(serializeRecord(found));
      }

      const details = await adapter.getTransactionDetails(chain, txHash);
      res.json({
        txHash: details.hash,
        blockNumber: details.blockNumber,
        chain,
        data: details.data,
        to: details.to,
        from: details.from,
        status: details.status,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Retrieval failed",
      });
    }
  });

  app.get("/api/claim/:injectionId", (req, res) => {
    const record = injectionStore.get(req.params.injectionId);
    if (!record) {
      return res.status(404).json({ error: "Injection not found" });
    }
    const token =
      (req.query.accessToken as string | undefined) ||
      (req.headers.authorization?.replace(/^Bearer\s+/i, "") as string | undefined);
    if (!token) {
      return res.status(401).json({ error: "JWT strand READ access required" });
    }
    const verified = tokenManager.verifyAccessToken(token);
    if (!verified.valid) {
      return res.status(401).json({ error: verified.error || "Invalid access token" });
    }
    if (verified.payload?.strandId !== record.strandId) {
      return res.status(403).json({ error: "Token does not match strand" });
    }
    res.json({
      claim: serializeRecord(record),
      jwtPurpose: "strand-read",
      notMoney: true,
    });
  });

  app.get("/api/credits/:address", (req, res) => {
    if (!ethers.isAddress(req.params.address)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    res.json({
      address: req.params.address,
      balance: ledger.balanceOf(req.params.address).toString(),
      source: config.storeTokenAddress ? "ledger-cache" : "ledger",
      currency: "STORE",
    });
  });

  app.post("/api/credits/seed", (req, res) => {
    if (config.mode === "full_live" || (config.mode === "base_mainnet_guarded" && config.confirmMainnet)) {
      return res.status(403).json({ error: "Seeding disabled in guarded/live mainnet" });
    }
    const { address, amount } = req.body ?? {};
    if (!ethers.isAddress(address) || typeof amount !== "string" || !/^[0-9]+$/.test(amount)) {
      return res.status(400).json({ error: "address and amount (wei string) required" });
    }
    ledger.seed(address, BigInt(amount));
    res.json({
      address,
      balance: ledger.balanceOf(address).toString(),
      currency: "STORE",
    });
  });

  app.post("/api/leftover", (req, res) => {
    try {
      if (req.body?.cex || req.body?.advancedTrade) {
        refuseCexAdvancedTrade("leftover");
      }
      const slot = leftovers.register({
        swapTx: String(req.body.swapTx),
        leftoverBytes: Number(req.body.leftoverBytes),
        owner: String(req.body.owner),
        receiptBlock: Number(req.body.receiptBlock),
      });
      res.json(slot);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "leftover refused",
      });
    }
  });

  app.get("/api/leftovers", (_req, res) => {
    res.json({ leftovers: leftovers.list() });
  });

  app.get("/api/price", async (req, res) => {
    try {
      const token = String(req.query.token ?? "");
      const wantEth = req.query.eth === "1" || token.toLowerCase() === "eth";
      if (wantEth) {
        const quote = await prices.ethUsd();
        return res.json({
          token: "ETH",
          address: BASE_WETH,
          usd: quote.usd,
          source: quote.source,
        });
      }
      if (!ethers.isAddress(token)) {
        return res.status(400).json({ error: "token address required (or eth=1)" });
      }
      const quote = await prices.tokenUsd(token);
      res.json({
        token,
        address: token,
        usd: quote.usd,
        source: quote.source,
      });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "price unavailable",
      });
    }
  });

  app.post("/api/quote", async (req, res) => {
    try {
      const payload = parseInjectionPayload(req.body);
      const cost = costForBytes(payload.length);
      const fairExit = Number(req.body.fairExit ?? 0);
      const body = (req.body ?? {}) as Record<string, unknown>;
      let hitch:
        | ReturnType<typeof measureHitchWave>
        | { leftoverBytes: number; payloadBytes: number; fits: boolean }
        | undefined;
      if (wantsLiveUsd(body)) {
        const leftoverBytes = Number(body.leftoverBytes);
        const gasPriceGwei = Number(body.gasPriceGwei);
        const eth = await prices.ethUsd();
        let tokenUsd: number | undefined;
        if (typeof body.tokenAddress === "string") {
          tokenUsd = (await prices.tokenUsd(body.tokenAddress)).usd;
        }
        if (
          Number.isInteger(leftoverBytes) &&
          leftoverBytes >= 0 &&
          Number.isFinite(gasPriceGwei) &&
          gasPriceGwei > 0
        ) {
          hitch = measureHitchWave({
            leftoverBytes,
            payloadBytes: payload.length,
            ethUsd: eth.usd,
            tokenUsd,
            gasPriceGwei,
            leftoverEth: body.leftoverEth === undefined ? undefined : Number(body.leftoverEth),
            usdBudget: body.usdBudget === undefined ? undefined : Number(body.usdBudget),
          });
        } else if (body.leftoverBytes !== undefined || body.usdBudget !== undefined) {
          throw new Error(
            "gasPriceGwei and leftoverBytes required for hitch USD sizing — refusing silent $0"
          );
        } else {
          hitch = {
            leftoverBytes: Number.isInteger(leftoverBytes) ? leftoverBytes : payload.length,
            payloadBytes: payload.length,
            ethUsd: eth.usd,
            tokenUsd,
            fits: true,
          };
        }
      } else if (body.leftoverBytes !== undefined) {
        const leftoverBytes = Number(body.leftoverBytes);
        hitch = {
          leftoverBytes,
          payloadBytes: payload.length,
          fits: payload.length > 0 && payload.length <= leftoverBytes,
        };
      }
      res.json({
        bytesLen: payload.length,
        injectCostCredits: cost.toString(),
        sellTarget: sellTarget(fairExit, Number(cost) / 1e18),
        formula: "sell_target = fair_exit + inject_cost",
        hitch,
        voice: STORE_VOICE,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "quote failed",
      });
    }
  });

  app.post("/api/loop/tick", (req, res) => {
    try {
      const decision = paper.tick({
        prices: Array.isArray(req.body.prices) ? req.body.prices.map(Number) : [],
        fairExit: Number(req.body.fairExit ?? 0),
        injectCost: Number(req.body.injectCost ?? 0),
        mark: Number(req.body.mark ?? 0),
        realizedPnl: req.body.realizedPnl !== undefined ? Number(req.body.realizedPnl) : undefined,
        fees: req.body.fees !== undefined ? Number(req.body.fees) : undefined,
      });
      res.json(decision);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "tick failed",
      });
    }
  });

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error("[Error]", err);
      res.status(500).json({ error: "Internal server error", message: err.message });
    }
  );

  return {
    app,
    injectionStore,
    adapter,
    tokenManager,
    ledger,
    leftovers,
    config,
    paper,
    broker,
  };
}

export default createApp;
