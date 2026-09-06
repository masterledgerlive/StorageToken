import { describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import BlockchainAdapter, {
} from "../src/chain/adapter.js";
import { assertModeAllowsChain, loadConfig, parseMode } from "../src/config.js";
import { assertNotMockedHash, parseInjectionPayload } from "../src/payload.js";
import { LeftoverRegistry } from "../src/chain/leftovers.js";
import { assertNotVaultKey } from "../src/chain/keys.js";
import { encodeVoiceHex, hasStoreVoice, wrapStoreVoice } from "../src/voice.js";
import { STORE_VOICE } from "../src/types.js";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const RECEIPT_HASH =
  "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
const TX_HASH =
  "0xabcddcbaabcddcbaabcddcbaabcddcbaabcddcbaabcddcbaabcddcbaabcddcba";

describe("mode + chain gates", () => {
  it("defaults MODE to base_sepolia", () => {
    expect(parseMode(undefined)).toBe("base_sepolia");
    expect(loadConfig({}).mode).toBe("base_sepolia");
  });

  it("refuses mainnet in base_sepolia mode", () => {
    expect(() => assertModeAllowsChain("base_sepolia", 8453, false)).toThrow(/8453/);
    expect(() => assertModeAllowsChain("base_sepolia", 1, false)).toThrow(/chainId 1/);
    expect(() => assertModeAllowsChain("base_sepolia", 84532, false)).not.toThrow();
  });

  it("base_mainnet_guarded needs CONFIRM_MAINNET=yes", () => {
    expect(() => assertModeAllowsChain("base_mainnet_guarded", 8453, false)).toThrow(
      /CONFIRM_MAINNET/
    );
    expect(() => assertModeAllowsChain("base_mainnet_guarded", 8453, true)).not.toThrow();
  });

  it("full_live also refuses 8453 without confirm", () => {
    expect(() => assertModeAllowsChain("full_live", 8453, false)).toThrow(/CONFIRM_MAINNET/);
    expect(() => assertModeAllowsChain("full_live", 8453, true)).not.toThrow();
  });
});

describe("adapter sepolia + receipt hashes", () => {
  it("defaults to base-sepolia 84532 public RPC, not mainnet 8453", () => {
    const adapter = new BlockchainAdapter();
    const sepolia = adapter.getChain("base-sepolia");
    expect(sepolia.chainId).toBe(84532);
    expect(sepolia.rpcUrl).toBe("https://sepolia.base.org");
    const base = adapter.getChain("base");
    expect(base.chainId).toBe(8453);
    expect(base.rpcUrl).toBe("");
  });

  it("uses receipt.hash, to=provider, value=0 (credits pay, not wei skim)", async () => {
    const adapter = new BlockchainAdapter();
    const sent: Array<{ to?: string; value?: bigint; data?: string }> = [];
    vi.spyOn(adapter, "getSigner").mockReturnValue({
      estimateGas: async () => 21000n,
      sendTransaction: async (tx: { to?: string; value?: bigint; data?: string }) => {
        sent.push(tx);
        return {
          hash: TX_HASH,
          value: tx.value,
          wait: async () => ({
            hash: RECEIPT_HASH,
            blockNumber: 424242,
            gasUsed: 21000n,
          }),
        };
      },
    } as never);

    const result = await adapter.injectCalldata({
      chainName: "base-sepolia",
      data: "0x68656c6c6f",
      to: PROVIDER,
      mode: "base_sepolia",
      confirmMainnet: false,
      entryPoint: "base_dedicated",
      paidCredits: "1000",
    });

    expect(sent[0].to).toBe(PROVIDER);
    expect(sent[0].value).toBe(0n);
    expect(result.txHash).toBe(RECEIPT_HASH);
    expect(result.txHash).not.toBe(TX_HASH);
    expect(result.blockNumber).toBe(424242);
    expect(result.paidCredits).toBe("1000");
  });

  it("refuses Base mainnet 8453 in base_sepolia mode", async () => {
    const adapter = new BlockchainAdapter();
    await expect(
      adapter.injectCalldata({
        chainName: "base",
        data: "0x00",
        to: PROVIDER,
        mode: "base_sepolia",
        confirmMainnet: false,
        entryPoint: "base_dedicated",
        paidCredits: "0",
      })
    ).rejects.toThrow(/mainnet|8453|base_sepolia/);
  });
});

describe("mocked hashes refused", () => {
  it("rejects empty, zero, and repeated-nibble hashes", () => {
    expect(() => assertNotMockedHash("")).toThrow(/mocked/);
    expect(() => assertNotMockedHash("0xdead")).toThrow(/mocked/);
    expect(() =>
      assertNotMockedHash(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      )
    ).toThrow(/mocked/);
    expect(() =>
      assertNotMockedHash(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      )
    ).toThrow(/mocked/);
    expect(
      assertNotMockedHash(
        "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface"
      )
    ).toBe(
      "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface"
    );
  });
});

describe("leftover registry never invents a swap", () => {
  it("refuses mocked leftover hashes and missing receipts", () => {
    const reg = new LeftoverRegistry();
    expect(() =>
      reg.register({
        swapTx: "0xaaaa",
        leftoverBytes: 64,
        owner: PROVIDER,
        receiptBlock: 1,
      })
    ).toThrow(/mocked/);
    expect(() =>
      reg.register({
        swapTx:
          "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
        leftoverBytes: 64,
        owner: PROVIDER,
        receiptBlock: 0,
      })
    ).toThrow(/receipt block/);
  });
});

describe("vault vs hot key", () => {
  it("refuses when injector is the vault", () => {
    const w = Wallet.createRandom();
    expect(() => assertNotVaultKey(w.privateKey, w.address)).toThrow(/Vault/);
    const other = Wallet.createRandom();
    expect(() => assertNotVaultKey(w.privateKey, other.address)).not.toThrow();
  });
});

describe("voice + payload", () => {
  it("wraps §$STORE§ and parses hex/base64/text", () => {
    const raw = Buffer.from("hello");
    const wrapped = wrapStoreVoice(raw);
    expect(hasStoreVoice(wrapped)).toBe(true);
    expect(wrapped.toString("utf8").startsWith(STORE_VOICE)).toBe(true);
    expect(encodeVoiceHex()).toBe(`0x${Buffer.from(STORE_VOICE).toString("hex")}`);
    expect(parseInjectionPayload({ bytes: "0x68656c6c6f" }).toString()).toBe("hello");
    expect(
      parseInjectionPayload({ base64: Buffer.from("hello").toString("base64") }).toString()
    ).toBe("hello");
    expect(parseInjectionPayload({ text: STORE_VOICE }).toString()).toBe(STORE_VOICE);
  });
});
