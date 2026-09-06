import { STORE_FLOOR_SEATS, type StoreFloorSeat } from "./types.js";

export interface SeatProfile {
  id: StoreFloorSeat;
  role: string;
  writes: boolean;
  job: string;
}

export const SEAT_PROFILES: readonly SeatProfile[] = [
  {
    id: "WAVE",
    role: "scanner",
    writes: false,
    job: "leftover hitch budget — payload ≤ leftover, never invent a swap",
  },
  {
    id: "SPARSE",
    role: "locker",
    writes: false,
    job: "shard map / sparse locker density — receipt cells only",
  },
  {
    id: "BROKER",
    role: "market",
    writes: false,
    job: "open-market slot offers in $STORE credits — lock-first",
  },
  {
    id: "RISK",
    role: "guard",
    writes: false,
    job: "net-margin / drawdown kills — vault ≠ hot key",
  },
  {
    id: "VAULT",
    role: "save",
    writes: false,
    job: "save jar — never spends, never signs",
  },
  {
    id: "INJECT",
    role: "writer",
    writes: true,
    job: "sole POST /api/inject writer — hashes from mined receipt or paper_*",
  },
  {
    id: "RETRIEVE",
    role: "reader",
    writes: false,
    job: "JWT strand READ — GET retrieve / claim, not money",
  },
  {
    id: "PROOF",
    role: "checker",
    writes: false,
    job: "receipt honesty + PQ stub — refuse invented hashes",
  },
] as const;

export function seatCatalog(): SeatProfile[] {
  return STORE_FLOOR_SEATS.map((id) => {
    const row = SEAT_PROFILES.find((s) => s.id === id);
    if (!row) throw new Error(`missing seat profile ${id}`);
    return row;
  });
}

export function injectIsSoleWriter(): boolean {
  return SEAT_PROFILES.filter((s) => s.writes).every((s) => s.id === "INJECT");
}
