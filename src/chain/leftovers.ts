import { assertNotMockedHash } from "../payload.js";
import type { LeftoverSlot } from "../types.js";

/** Only register leftovers from a REAL mined swap receipt. Never invent a swap. */
export class LeftoverRegistry {
  private slots = new Map<string, LeftoverSlot>();

  register(input: {
    swapTx: string;
    leftoverBytes: number;
    owner: string;
    receiptBlock: number;
  }): LeftoverSlot {
    const swapTx = assertNotMockedHash(input.swapTx);
    if (!Number.isInteger(input.receiptBlock) || input.receiptBlock <= 0) {
      throw new Error("Leftover requires a real receipt blockNumber");
    }
    if (!Number.isInteger(input.leftoverBytes) || input.leftoverBytes <= 0) {
      throw new Error("leftoverBytes must be a positive integer");
    }
    const slot: LeftoverSlot = {
      swapTx,
      leftoverBytes: input.leftoverBytes,
      owner: input.owner,
      used: false,
      registeredAt: new Date(),
      receiptBlock: input.receiptBlock,
    };
    this.slots.set(swapTx.toLowerCase(), slot);
    return slot;
  }

  get(swapTx: string): LeftoverSlot | undefined {
    return this.slots.get(swapTx.toLowerCase());
  }

  consume(swapTx: string, payloadBytes: number): LeftoverSlot {
    const slot = this.get(swapTx);
    if (!slot) throw new Error("Leftover unknown — never invent a swap");
    if (slot.used) throw new Error("Leftover already used");
    if (payloadBytes > slot.leftoverBytes) {
      throw new Error(
        `Hitch payload ${payloadBytes}B exceeds leftover budget ${slot.leftoverBytes}B`
      );
    }
    slot.used = true;
    return slot;
  }

  list(): LeftoverSlot[] {
    return Array.from(this.slots.values());
  }
}
