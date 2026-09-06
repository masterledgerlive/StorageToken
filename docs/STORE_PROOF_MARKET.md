# Sparse Proof Market / Return-Proof Storage

Product: **$STORE Desk / STORE FLOOR**. Storage inject only. Not a trading desk.
Companion trading seats live in [`galleonlabs/hypergrok-trading-desk`](https://github.com/galleonlabs/hypergrok-trading-desk) — optional, trading only. Do not import those seats here.

This note is a **plan and a paper receipt contract**. It does not claim a live post-quantum signature, a mined hash, or a CEX hitch.

## What is being proved

A **return-proof** is a receipt that a strand was stored and can be read back:

1. **Lock first.** A broker slot (gap-fill or priority express) is locked in `$STORE` credits before anyone writes.
2. **Sparse locker.** Only some shard cells light. The shard map is the locker UI — empty cells are empty, not invented data.
3. **Write once.** Seat **INJECT** is the sole writer (`POST /api/inject`). Other STORE FLOOR seats read, quote, lock, or refuse.
4. **Return.** Seat **RETRIEVE** reads with JWT strand READ access (not money). `GET /api/retrieve/:txHash` and `GET /api/claim/:id` require a matching token.
5. **Proof check.** Seat **PROOF** accepts a receipt only if it is a mined 64-nibble `txHash` from `tx.wait()` **or** a `paper_*` / `paper_slot_*` / `paper_lock_*` id. Unknown ids are 404. No invented hashes.

Payment is **`$STORE` credits only**. Native `value` on the inject tx is `0`. Gas is the hot / risk key.

## Vault never spends

The vault (save jar) is not a signer.

- `VAULT_ADDRESS` must not equal the injector.
- `fundAddress` (hot) is the address to fund for gas.
- Broker paper credits are a **market purse**, not the vault.
- The public desk labels vault spend as **0 — always**.

Save stays save.

## CEX cannot carry calldata

Coinbase **CEX Advanced Trade cannot carry calldata**. This service refuses `cexAdvancedTrade` / `coinbaseAdvancedTrade` on inject, leftover, and broker bodies.

Live Coinbase path is **`coinbase_onchain`** (CDP / Base wallet) only, and only when `COINBASE_CDP_*` (or the documented old-guide aliases) are present. See [COINBASE_LIVE_SWITCH.md](../COINBASE_LIVE_SWITCH.md).

## Avenues (honest)

| Avenue | Live sender? | Notes |
| --- | --- | --- |
| `base_dedicated` | yes | Dedicated Base storage tx. |
| `uniswap_hitch` | yes, gated | Hitch on **OUR** leftover from a **mined** swap receipt. Never invent a swap. |
| `coinbase_onchain` | if CDP ready | On-chain only. Not CEX. |
| `wave_first` | **stub / paper policy** | Prefer leftover hitch, else dedicated. Not a live sender. |
| `gap_fill` | **stub / paper policy** | Lock cheapest sparse slot. |
| `priority_express` | **stub / paper policy** | Express slot, higher `$STORE` credits. |
| `multi_chain_cheapest` | **stub** | Base only today. No multi-chain quote. |
| `x402`, `kite` | **stub** | Stay disabled even if env flags are true. |

`GET /api/avenues` and `GET /api/switchboard` are the source of truth.

## PQ receipt stub (Dilithium / SPHINCS+ hybrid plan)

**Status: stub.** No Dilithium or SPHINCS+ signature is produced today. This site and this service must not print a fake PQ hash or a placeholder `0x` “proof”.

Planned hybrid (not implemented):

1. **Classical now.** Receipt identity is the mined `txHash` (or `paperId` in paper mode) plus JWT metadata `{ purpose: "strand-read", notMoney: true }`.
2. **Dilithium (ML-DSA) later.** Sign the locker transcript: `strandId || payloadHash || credits || avenue || minedTxHash`. Verify off-chain; do not put a PQ blob in CEX order fields (CEX still cannot carry calldata).
3. **SPHINCS+ (SLH-DSA) later.** Hash-based backup for the same transcript if a lattice assumption is retired. Hybrid = accept if **either** classical mined receipt **or** (Dilithium **and** SPHINCS+) verify — never “or invented hex”.
4. **What we will not do.** Invent a hash to look live. Embed a canned 64-nibble proof in Pages. Claim a CEX ticket is a storage receipt.

Until those libraries are wired and tested, **PROOF** reports `pq: "stub"` and only checks the classical / paper rules above.

## Paper broker (lock-first)

`GET /api/broker/book` · `POST /api/broker/offer` · `POST /api/broker/lock` · `POST /api/broker/fill`

- Offers are priced in `$STORE` credit wei. Express is a multiple of gap-fill (`EXPRESS_MULT`).
- Fill without a lock is refused.
- Fill returns `paper_*` and `txHash: null`.
- Client-supplied `txHash` is refused.

The public Pages desk mirrors this in-browser so visitors can play without Railway.

## No invented hashes

- Paper ids: `paper_*`, `paper_slot_*`, `paper_lock_*`.
- Live hashes: only from a mined receipt (`tx.wait()` / CDP wait).
- `GET /api/injection/:id` reads an in-memory `Map`. Unknown → 404, no hash.
- The Pages show labels costs **DEMO** until a visitor’s own Railway returns a verified 64-nibble `txHash`.

## STORE FLOOR seats

WAVE · SPARSE · BROKER · RISK · VAULT · **INJECT** (sole writer) · RETRIEVE · PROOF

Profiles: [`agents/store-floor/`](../agents/store-floor/).
