import { Wallet } from "ethers";
import { assertModeAllowsChain, type AppConfig } from "../config.js";
import { assertNotMockedHash } from "../payload.js";
import {
  asHexPrivateKey,
  configuredCdpAddress,
  resolveFundAddress,
} from "./keys.js";
import type { BlockchainAdapter } from "./adapter.js";
import type { EntryPoint, InjectionResult, NetworkName } from "../types.js";

const HOT_ACCOUNT_NAME = "StorageTokenHot";

export const CDP_FAUCET_NETWORKS = new Set<NetworkName>(["base-sepolia"]);

export function cdpFaucetAllowed(network: NetworkName): boolean {
  return CDP_FAUCET_NETWORKS.has(network);
}

export interface CdpSendClient {
  evm: {
    /** Official CDP SDK: get existing EOA by address or name. */
    getAccount?(opts: { address?: string; name?: string }): Promise<{ address: string }>;
    getOrCreateAccount(opts: { name: string }): Promise<{ address: string }>;
    sendTransaction(opts: {
      address: string;
      network: NetworkName;
      transaction: { to: string; value: bigint; data: string };
    }): Promise<{ transactionHash: string }>;
  };
}

export type CdpClientFactory = (config: AppConfig) => Promise<CdpSendClient>;

let injectedFactory: CdpClientFactory | undefined;

/** Test hook — production uses @coinbase/cdp-sdk via loadCdpClient. */
export function setCdpClientFactory(factory?: CdpClientFactory): void {
  injectedFactory = factory;
}

export async function loadCdpClient(config: AppConfig): Promise<CdpSendClient | undefined> {
  if (injectedFactory) return injectedFactory(config);
  if (!config.coinbaseCdp.apiKey || !config.coinbaseCdp.apiSecret) return undefined;
  // Vitest must not open the CDP network. Hex-key path covers unit tests.
  if (process.env.VITEST) return undefined;
  if (!config.coinbaseCdp.walletSecret) return undefined;
  if (asHexPrivateKey(config.coinbaseCdp.walletSecret)) return undefined;

  try {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    return new CdpClient({
      apiKeyId: config.coinbaseCdp.apiKey,
      apiKeySecret: config.coinbaseCdp.apiSecret,
      walletSecret: config.coinbaseCdp.walletSecret,
    }) as unknown as CdpSendClient;
  } catch {
    return undefined;
  }
}

/**
 * CDP sender: configured COINBASE_CDP_ADDRESS / CDP_ADDRESS via getAccount({ address }),
 * else named StorageTokenHot. Never create StorageTokenHot when an address is set.
 */
export async function resolveCdpSenderAddress(
  config: AppConfig,
  cdp: CdpSendClient
): Promise<string> {
  const configured = configuredCdpAddress(config);
  if (configured) {
    if (typeof cdp.evm.getAccount === "function") {
      try {
        const account = await cdp.evm.getAccount({ address: configured });
        if (account?.address) {
          config.resolvedFundAddress = account.address;
          return account.address;
        }
      } catch {
        // Lookup failed — still send from the configured EOA (do not create StorageTokenHot).
      }
    }
    config.resolvedFundAddress = configured;
    return configured;
  }

  const account = await cdp.evm.getOrCreateAccount({ name: HOT_ACCOUNT_NAME });
  if (!account?.address) {
    throw new Error("CDP getOrCreateAccount(StorageTokenHot) returned no address");
  }
  config.resolvedFundAddress = account.address;
  return account.address;
}

export async function resolveCdpFundAddress(
  config: AppConfig,
  client?: CdpSendClient
): Promise<string | undefined> {
  const existing = resolveFundAddress({
    ...config,
    entryPoint: "coinbase_onchain",
  });
  if (existing) {
    config.resolvedFundAddress = existing;
    return existing;
  }
  const cdp = client ?? (await loadCdpClient(config));
  if (!cdp) return undefined;
  const address = await resolveCdpSenderAddress(config, cdp);
  config.resolvedFundAddress = address;
  return address;
}

export interface CoinbaseOnchainInput {
  config: AppConfig;
  adapter: BlockchainAdapter;
  chain: string;
  to: string;
  data: string;
  entryPoint: EntryPoint;
  paidCredits: string;
  cdpClient?: CdpSendClient;
}

/**
 * coinbase_onchain sender: same calldata (to=provider/router, value=0, data=payload)
 * on the active chain. Receipt-only — never invent a hash.
 *
 * Prefer a hex CDP wallet secret (ethers). Else @coinbase/cdp-sdk.
 * Last resort: INJECTOR_PRIVATE_KEY on the active chain.
 */
export async function sendCoinbaseOnchain(
  input: CoinbaseOnchainInput
): Promise<InjectionResult> {
  const chain = input.adapter.getChain(input.chain);
  assertModeAllowsChain(input.config.mode, chain.chainId, input.config.confirmMainnet);

  const hexSecret = asHexPrivateKey(input.config.coinbaseCdp.walletSecret);
  const injectorHex = asHexPrivateKey(input.config.injectorPrivateKey);
  const configured = configuredCdpAddress(input.config);

  // Configured portal API-key wallet: send from that address via CDP, not INJECTOR.
  if (configured) {
    const cdp = input.cdpClient ?? (await loadCdpClient(input.config));
    if (cdp) {
      return sendWithCdpSdk(input, cdp, chain.name as NetworkName);
    }
  }

  if (hexSecret) {
    return sendWithHexKey(input, hexSecret);
  }

  const cdp = input.cdpClient ?? (await loadCdpClient(input.config));
  if (cdp) {
    return sendWithCdpSdk(input, cdp, chain.name as NetworkName);
  }

  if (injectorHex) {
    return sendWithHexKey(input, injectorHex);
  }

  throw new Error(
    "coinbase_onchain has no signer — set CDP_WALLET_SECRET / COINBASE_CDP_WALLET_SECRET / COINBASE_PRIVATE_KEY or INJECTOR_PRIVATE_KEY, or a CDP wallet secret @coinbase/cdp-sdk can use"
  );
}

async function sendWithHexKey(
  input: CoinbaseOnchainInput,
  hexKey: string
): Promise<InjectionResult> {
  try {
    const provider = input.adapter.getProvider(input.chain);
    input.adapter.setSigner(input.chain, new Wallet(hexKey, provider));
  } catch {
    // Tests may mock injectCalldata without a real provider.
  }
  return input.adapter.injectCalldata({
    chainName: input.chain,
    data: input.data,
    to: input.to,
    mode: input.config.mode,
    confirmMainnet: input.config.confirmMainnet,
    entryPoint: input.entryPoint,
    paidCredits: input.paidCredits,
  });
}

async function sendWithCdpSdk(
  input: CoinbaseOnchainInput,
  cdp: CdpSendClient,
  network: NetworkName
): Promise<InjectionResult> {
  const address = await resolveCdpSenderAddress(input.config, cdp);

  const submitted = await cdp.evm.sendTransaction({
    address,
    network,
    transaction: {
      to: input.to,
      value: 0n,
      data: input.data,
    },
  });

  if (!submitted?.transactionHash) {
    throw new Error("CDP send did not return a transaction hash");
  }

  const provider = input.adapter.getProvider(input.chain);
  const receipt = await provider.waitForTransaction(submitted.transactionHash);
  if (!receipt) throw new Error("Transaction failed to be mined");
  if (!receipt.hash) throw new Error("Receipt missing transaction hash");
  const txHash = assertNotMockedHash(receipt.hash);

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    chain: input.chain,
    method: "calldata-injection",
    timestamp: Date.now(),
    paidCredits: input.paidCredits,
    provider: input.to,
    entryPoint: input.entryPoint,
  };
}
