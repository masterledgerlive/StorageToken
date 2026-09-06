import { ethers } from "ethers";
import { nanoid } from "nanoid";
import { networkForMode, type AppConfig } from "../config.js";
import { BlockchainAdapter } from "../chain/adapter.js";
import { LeftoverRegistry } from "../chain/leftovers.js";
import { CreditLedger } from "../credits/ledger.js";
import { costForBytes } from "../credits/pricing.js";
import { assertNotMockedHash, parseInjectionPayload } from "../payload.js";
import { wrapStoreVoice } from "../voice.js";
import { sendCoinbaseOnchain, type CdpSendClient } from "../chain/cdp.js";
import { assertEntryEnabled, refuseCexAdvancedTrade } from "../switchboard/index.js";
import type { SwitchboardState } from "../types.js";
import {
  STORE_VOICE,
  type EntryPoint,
  type InjectionRecord,
  type InjectionResult,
  type MemoryStrand,
} from "../types.js";

export type InjectionStore = Map<string, InjectionRecord>;

export interface InjectRequest {
  body: Record<string, unknown>;
  creditPayer: string;
  provider: string;
  entryPoint: EntryPoint;
  chain?: string;
}

export interface InjectDeps {
  config: AppConfig;
  adapter: BlockchainAdapter;
  ledger: CreditLedger;
  leftovers: LeftoverRegistry;
  switchboard: SwitchboardState;
  cdpClient?: CdpSendClient;
  sendTx?: (input: {
    chain: string;
    to: string;
    data: string;
    entryPoint: EntryPoint;
    paidCredits: string;
  }) => Promise<InjectionResult>;
}

function buildStrand(payload: Buffer, strandId: string): MemoryStrand {
  return {
    strandId,
    currentHash: ethers.keccak256(payload),
    compressedData: payload.toString("base64"),
    encryptionKeyHash: ethers.keccak256(ethers.toUtf8Bytes(strandId)),
    geometricAddress: "",
    resonanceStrength: 0,
    voice: STORE_VOICE,
  };
}

export function encodeDedicatedCalldata(
  payload: Buffer,
  routerAddress?: string
): string {
  if (routerAddress && ethers.isAddress(routerAddress)) {
    const iface = new ethers.Interface([
      "function storeDedicated(bytes payload) returns (bytes32)",
    ]);
    return iface.encodeFunctionData("storeDedicated", [payload]);
  }
  return ethers.hexlify(payload);
}

export function encodeHitchCalldata(payload: Buffer, leftoverTx: string): string {
  const iface = new ethers.Interface([
    "function hitch(bytes payload, bytes32 leftoverTx) returns (bytes32)",
  ]);
  return iface.encodeFunctionData("hitch", [payload, leftoverTx]);
}

export async function executeInject(
  req: InjectRequest,
  deps: InjectDeps
): Promise<{ record: InjectionRecord; strand: MemoryStrand; result?: InjectionResult }> {
  if (req.body.cexAdvancedTrade || req.body.coinbaseAdvancedTrade) {
    refuseCexAdvancedTrade("inject body");
  }
  if (typeof req.body.txHash === "string") {
    throw new Error("Do not supply txHash — hashes come from a mined receipt only");
  }

  assertEntryEnabled(deps.switchboard, req.entryPoint);

  const raw = parseInjectionPayload(req.body);
  const payload = wrapStoreVoice(raw);
  const chain = (req.chain as string | undefined) || networkForMode(deps.config.mode);
  const strandId =
    (typeof req.body.strandId === "string" && req.body.strandId) ||
    `strand_${nanoid()}`;
  const strand = buildStrand(payload, strandId);
  const cost = costForBytes(payload.length);
  const paid = deps.ledger.payForStorage(req.creditPayer, payload.length);

  const injectionId = `inj_${nanoid()}`;
  const baseRecord: InjectionRecord = {
    injectionId,
    strandId,
    chain,
    mode: deps.config.mode,
    entryPoint: req.entryPoint,
    status: "processing",
    costCredits: paid.toString(),
    currency: "STORE",
    createdAt: new Date(),
    provider: req.provider,
    payloadHash: strand.currentHash,
    bytesLen: payload.length,
  };

  if (deps.config.mode === "paper") {
    const paperId = `paper_${nanoid()}`;
    const record: InjectionRecord = {
      ...baseRecord,
      status: "paper",
      paperId,
      completedAt: new Date(),
    };
    return { record, strand };
  }

  let data: string;
  let leftoverTx: string | undefined;

  if (req.entryPoint === "uniswap_hitch") {
    const rawLeftover = req.body.leftoverTx ?? req.body.leftoverSwapTx;
    if (typeof rawLeftover !== "string") {
      throw new Error("uniswap_hitch requires leftoverTx from a REAL registered swap");
    }
    leftoverTx = assertNotMockedHash(rawLeftover);
    deps.leftovers.consume(leftoverTx, payload.length);
    data = encodeHitchCalldata(payload, leftoverTx);
  } else if (req.entryPoint === "coinbase_onchain") {
    if (!deps.switchboard.flags.coinbase_onchain.enabled) {
      throw new Error("coinbase_onchain disabled — CDP keys missing or stub");
    }
    data = encodeDedicatedCalldata(payload, deps.config.routerAddress);
  } else {
    data = encodeDedicatedCalldata(payload, deps.config.routerAddress);
  }

  const to =
    deps.config.routerAddress && ethers.isAddress(deps.config.routerAddress)
      ? deps.config.routerAddress
      : req.provider;

  const send =
    deps.sendTx ??
    (async (input) => {
      if (input.entryPoint === "coinbase_onchain") {
        return sendCoinbaseOnchain({
          config: deps.config,
          adapter: deps.adapter,
          chain: input.chain,
          to: input.to,
          data: input.data,
          entryPoint: input.entryPoint,
          paidCredits: input.paidCredits,
          cdpClient: deps.cdpClient,
        });
      }
      return deps.adapter.injectCalldata({
        chainName: input.chain,
        data: input.data,
        to: input.to,
        mode: deps.config.mode,
        confirmMainnet: deps.config.confirmMainnet,
        entryPoint: input.entryPoint,
        paidCredits: input.paidCredits,
      });
    });

  const result = await send({
    chain,
    to,
    data,
    entryPoint: req.entryPoint,
    paidCredits: cost.toString(),
  });

  if (!result?.txHash) {
    throw new Error("Injection did not return a receipt hash");
  }
  const txHash = assertNotMockedHash(result.txHash);

  const record: InjectionRecord = {
    ...baseRecord,
    status: "injected",
    txHash,
    blockNumber: result.blockNumber,
    completedAt: new Date(),
    leftoverTx,
  };

  return { record, strand, result: { ...result, txHash, leftoverTx } };
}
