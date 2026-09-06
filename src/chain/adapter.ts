import { ethers } from "ethers";
import { assertModeAllowsChain } from "../config.js";
import { assertNotMockedHash } from "../payload.js";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_DEFAULT,
  DEFAULT_CHAIN,
  MAINNET_CHAIN_IDS,
  type Chain,
  type InjectionResult,
  type Mode,
  type EntryPoint,
} from "../types.js";

export interface InjectCalldataInput {
  chainName: string;
  data: string;
  to: string;
  mode: Mode;
  confirmMainnet: boolean;
  entryPoint: EntryPoint;
  paidCredits: string;
}

/**
 * Ported from injection-service PR #1 BlockchainAdapter.injectMemoryToCalldata:
 * to = provider, wait() receipt hash only, refuse mainnet in sepolia mode.
 * Native value is NOT storage payment — $STORE credits are.
 */
export class BlockchainAdapter {
  private providers = new Map<string, ethers.Provider>();
  private signers = new Map<string, ethers.Signer>();
  private chains = new Map<string, Chain>();

  constructor(
    private readonly injectorPrivateKey?: string,
    rpcOverrides?: { baseSepolia?: string; base?: string }
  ) {
    const chains: Chain[] = [
      {
        name: DEFAULT_CHAIN,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        rpcUrl: rpcOverrides?.baseSepolia || process.env.BASE_SEPOLIA_RPC || BASE_SEPOLIA_RPC_DEFAULT,
        explorerUrl: "https://sepolia.basescan.org",
      },
      {
        name: "base",
        chainId: 8453,
        rpcUrl: rpcOverrides?.base || process.env.BASE_RPC || "",
        explorerUrl: "https://basescan.org",
      },
    ];

    for (const chain of chains) {
      this.chains.set(chain.name, chain);
      if (!chain.rpcUrl) continue;
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.name, provider);
      if (this.injectorPrivateKey) {
        this.signers.set(
          chain.name,
          new ethers.Wallet(this.injectorPrivateKey, provider)
        );
      }
    }
  }

  getChain(name: string): Chain {
    const chain = this.chains.get(name);
    if (!chain) throw new Error(`Chain not supported: ${name}`);
    return chain;
  }

  getSupportedChains(): string[] {
    return Array.from(this.chains.keys());
  }

  getProvider(chainName: string): ethers.Provider {
    const provider = this.providers.get(chainName);
    if (!provider) throw new Error(`Provider not configured for chain: ${chainName}`);
    return provider;
  }

  getSigner(chainName: string): ethers.Signer {
    const signer = this.signers.get(chainName);
    if (!signer) throw new Error(`Signer not configured for chain: ${chainName}`);
    return signer;
  }

  setSigner(chainName: string, signer: ethers.Signer): void {
    this.signers.set(chainName, signer);
  }

  async injectCalldata(input: InjectCalldataInput): Promise<InjectionResult> {
    const chain = this.getChain(input.chainName);
    assertModeAllowsChain(input.mode, chain.chainId, input.confirmMainnet);
    if (input.mode === "base_sepolia" && MAINNET_CHAIN_IDS.has(chain.chainId)) {
      throw new Error(
        `Refusing to send transactions on mainnet chainId ${chain.chainId}. Use ${DEFAULT_CHAIN} (${BASE_SEPOLIA_CHAIN_ID}).`
      );
    }
    if (MAINNET_CHAIN_IDS.has(chain.chainId) && input.mode === "base_sepolia") {
      throw new Error(`MODE=base_sepolia refuses mainnet chainId ${chain.chainId}`);
    }

    const signer = this.getSigner(input.chainName);
    const request = {
      to: input.to,
      value: 0n,
      data: input.data,
    };

    let gasLimit = 120000n;
    try {
      const estimated = await signer.estimateGas(request);
      gasLimit = estimated + estimated / 5n;
    } catch {
      // fallback for tests / estimate-unavailable
    }

    const tx = await signer.sendTransaction({ ...request, gasLimit });
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction failed to be mined");
    if (!receipt.hash) throw new Error("Receipt missing transaction hash");
    const txHash = assertNotMockedHash(receipt.hash);

    return {
      txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      chain: input.chainName,
      method: "calldata-injection",
      timestamp: Date.now(),
      paidCredits: input.paidCredits,
      provider: input.to,
      entryPoint: input.entryPoint,
    };
  }

  async getTransactionDetails(chainName: string, txHash: string) {
    assertNotMockedHash(txHash);
    const provider = this.getProvider(chainName);
    const tx = await provider.getTransaction(txHash);
    const receipt = await provider.getTransactionReceipt(txHash);
    return {
      hash: tx?.hash || txHash,
      from: tx?.from,
      to: tx?.to,
      data: tx?.data,
      blockNumber: receipt?.blockNumber,
      status: receipt?.status === 1 ? "success" : "failed",
    };
  }
}

export default BlockchainAdapter;
