import { nanoid } from "nanoid";
import { costForBytes } from "../credits/pricing.js";

export type SlotKind = "gap_fill" | "priority_express";

export const SHARD_CELLS = 64;
export const EXPRESS_MULT = 3n;

export interface PaperSlot {
  slotId: string;
  kind: SlotKind;
  leftoverBytes: number;
  creditsAsk: string;
  shards: number[];
  locked: boolean;
  filled: boolean;
  lockId?: string;
}

export interface PaperLock {
  lockId: string;
  slotId: string;
  lockedAt: string;
}

export interface PaperFill {
  paperId: string;
  lockId: string;
  slotId: string;
  kind: SlotKind;
  creditsAsk: string;
  txHash: null;
  note: string;
}

export function creditsForSlot(kind: SlotKind, leftoverBytes: number): bigint {
  if (kind !== "gap_fill" && kind !== "priority_express") {
    throw new Error("kind must be gap_fill or priority_express");
  }
  const base = costForBytes(Math.max(leftoverBytes, 1));
  return kind === "priority_express" ? base * EXPRESS_MULT : base;
}

export function paperSlotId(): string {
  return `paper_slot_${nanoid()}`;
}

export function paperLockId(): string {
  return `paper_lock_${nanoid()}`;
}

export function assertPaperId(id: string, label: string): string {
  if (id.startsWith("0x") || /^0x[0-9a-fA-F]{64}$/.test(id)) {
    throw new Error(`${label} must never mint a 0x hash`);
  }
  return id;
}

/** Deterministic sparse shard indices from leftover size — no RNG in the service. */
export function sparseShards(leftoverBytes: number): number[] {
  if (!Number.isInteger(leftoverBytes) || leftoverBytes < 0) {
    throw new Error("leftoverBytes must be a non-negative integer");
  }
  const count = Math.min(SHARD_CELLS, Math.max(1, Math.ceil(leftoverBytes / 8)));
  const out: number[] = [];
  let cursor = leftoverBytes % SHARD_CELLS;
  for (let i = 0; i < count; i++) {
    out.push(cursor);
    cursor = (cursor + 7 + (leftoverBytes % 5)) % SHARD_CELLS;
    if (out.includes(cursor)) cursor = (cursor + 1) % SHARD_CELLS;
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export class PaperBroker {
  private slots = new Map<string, PaperSlot>();
  private locks = new Map<string, PaperLock>();

  offer(kind: SlotKind, leftoverBytes: number): PaperSlot {
    if (kind !== "gap_fill" && kind !== "priority_express") {
      throw new Error("kind must be gap_fill or priority_express");
    }
    if (!Number.isInteger(leftoverBytes) || leftoverBytes < 8) {
      throw new Error("leftoverBytes must be an integer >= 8");
    }
    const slotId = assertPaperId(paperSlotId(), "slotId");
    const slot: PaperSlot = {
      slotId,
      kind,
      leftoverBytes,
      creditsAsk: creditsForSlot(kind, leftoverBytes).toString(),
      shards: sparseShards(leftoverBytes),
      locked: false,
      filled: false,
    };
    this.slots.set(slotId, slot);
    return { ...slot, shards: [...slot.shards] };
  }

  lock(slotId: string): PaperLock {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error("Unknown paper slot");
    if (slot.filled) throw new Error("Slot already filled");
    if (slot.locked) throw new Error("Slot already locked — lock-first is exclusive");
    const lockId = assertPaperId(paperLockId(), "lockId");
    slot.locked = true;
    slot.lockId = lockId;
    const lock: PaperLock = {
      lockId,
      slotId,
      lockedAt: new Date().toISOString(),
    };
    this.locks.set(lockId, lock);
    return { ...lock };
  }

  fill(lockId: string): PaperFill {
    const lock = this.locks.get(lockId);
    if (!lock) throw new Error("Unknown lock — lock-first required before fill");
    const slot = this.slots.get(lock.slotId);
    if (!slot) throw new Error("Unknown paper slot");
    if (slot.filled) throw new Error("Slot already filled");
    const paperId = assertPaperId(`paper_${nanoid()}`, "paperId");
    slot.filled = true;
    return {
      paperId,
      lockId,
      slotId: slot.slotId,
      kind: slot.kind,
      creditsAsk: slot.creditsAsk,
      txHash: null,
      note: "paper broker fill — no chain hash",
    };
  }

  get(slotId: string): PaperSlot | undefined {
    const slot = this.slots.get(slotId);
    return slot ? { ...slot, shards: [...slot.shards] } : undefined;
  }

  book(): PaperSlot[] {
    return [...this.slots.values()].map((s) => ({ ...s, shards: [...s.shards] }));
  }

  seedDemoBook(): PaperSlot[] {
    if (this.slots.size > 0) return this.book();
    return [
      this.offer("gap_fill", 32),
      this.offer("gap_fill", 64),
      this.offer("priority_express", 48),
    ];
  }
}
