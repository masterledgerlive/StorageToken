import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { deskAvenueCatalog } from "../src/avenues.js";
import {
  PaperBroker,
  creditsForSlot,
  sparseShards,
} from "../src/broker/paper.js";
import { injectIsSoleWriter, seatCatalog } from "../src/seats.js";

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

describe("STORE FLOOR avenues + seats", () => {
  it("lists seven desk avenues with honest stubs", () => {
    const rows = deskAvenueCatalog();
    expect(rows.map((r) => r.id)).toEqual([
      "base_dedicated",
      "uniswap_hitch",
      "coinbase_onchain",
      "wave_first",
      "gap_fill",
      "priority_express",
      "multi_chain_cheapest",
    ]);
    expect(rows.filter((r) => r.live).map((r) => r.id)).toEqual([
      "base_dedicated",
      "uniswap_hitch",
      "coinbase_onchain",
    ]);
    expect(rows.filter((r) => r.stub).every((r) => r.live === false)).toBe(true);
  });

  it("INJECT is the sole writer", () => {
    expect(injectIsSoleWriter()).toBe(true);
    expect(seatCatalog().filter((s) => s.writes).map((s) => s.id)).toEqual(["INJECT"]);
  });
});

describe("paper broker lock-first", () => {
  it("express costs more than gap-fill and never mints 0x", () => {
    const gap = creditsForSlot("gap_fill", 32);
    const express = creditsForSlot("priority_express", 32);
    expect(express).toBe(gap * 3n);
    const shards = sparseShards(32);
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.length).toBeLessThanOrEqual(64);
    const book = new PaperBroker();
    const slot = book.offer("gap_fill", 32);
    expect(slot.slotId).toMatch(/^paper_slot_/);
    expect(slot.slotId.startsWith("0x")).toBe(false);
    expect(() => book.fill("missing")).toThrow(/lock-first/);
    const lock = book.lock(slot.slotId);
    expect(lock.lockId).toMatch(/^paper_lock_/);
    const fill = book.fill(lock.lockId);
    expect(fill.paperId).toMatch(/^paper_/);
    expect(fill.txHash).toBeNull();
  });
});

describe("HTTP avenues + broker", () => {
  it("refuses stub avenues on the switchboard and serves paper book", async () => {
    const { app } = await createApp({
      config: loadConfig({ MODE: "paper", JWT_SECRET: "test-secret" }),
    });
    const { server, base } = await listen(app);
    servers.push(server);

    const seats = await (await fetch(`${base}/api/seats`)).json();
    expect(seats.injectSoleWriter).toBe(true);
    expect(seats.seats).toHaveLength(8);
    expect(seats.companion).toContain("hypergrok-trading-desk");

    const avenues = await (await fetch(`${base}/api/avenues`)).json();
    expect(avenues.avenues.find((a: { id: string }) => a.id === "wave_first").stub).toBe(true);
    expect(avenues.avenues.find((a: { id: string }) => a.id === "base_dedicated").live).toBe(true);

    const refused = await fetch(`${base}/api/switchboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPoint: "wave_first" }),
    });
    expect(refused.status).toBe(400);
    const refusedBody = await refused.json();
    expect(refusedBody.error).toMatch(/stub-flagged/);
    expect(refusedBody.txHash).toBeUndefined();

    const book = await (await fetch(`${base}/api/broker/book`)).json();
    expect(book.market).toBe("paper");
    expect(book.lockFirst).toBe(true);
    expect(book.vaultSpends).toBe(false);
    expect(book.slots.length).toBeGreaterThan(0);

    const offer = await fetch(`${base}/api/broker/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "gap_fill", leftoverBytes: 40, txHash: "nope" }),
    });
    expect(offer.status).toBe(400);

    const made = await fetch(`${base}/api/broker/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "priority_express", leftoverBytes: 24 }),
    });
    const slot = (await made.json()).slot;
    expect(slot.slotId).toMatch(/^paper_slot_/);

    const unlocked = await fetch(`${base}/api/broker/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockId: "paper_lock_missing" }),
    });
    expect(unlocked.status).toBe(400);

    const locked = await fetch(`${base}/api/broker/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId: slot.slotId }),
    });
    const lock = await locked.json();
    expect(lock.lock.lockId).toMatch(/^paper_lock_/);
    expect(lock.txHash).toBeNull();

    const filled = await fetch(`${base}/api/broker/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockId: lock.lock.lockId }),
    });
    const fill = await filled.json();
    expect(fill.paperId).toMatch(/^paper_/);
    expect(fill.txHash).toBeNull();
  });
});
