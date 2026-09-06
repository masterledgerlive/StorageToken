# STORE FLOOR — Grok Bot seat profiles

Narrow jobs for **$STORE Desk / STORE FLOOR** (storage inject). Not a trading floor.

**INJECT is the sole writer.** Every other seat reads, quotes, locks, or refuses.

Trading seats (execution, research, Hyperliquid, and the rest) live in the optional companion:

**https://github.com/galleonlabs/hypergrok-trading-desk**

Do **not** import those trading seats onto STORE FLOOR. STORE FLOOR seats do **not** trade.

| Seat | Writes? | Job |
| --- | --- | --- |
| [WAVE](./wave.md) | no | Leftover hitch budget |
| [SPARSE](./sparse.md) | no | Shard map / locker density |
| [BROKER](./broker.md) | no | Open-market $STORE slot offers, lock-first |
| [RISK](./risk.md) | no | Kills, vault ≠ hot key |
| [VAULT](./vault.md) | no | Save jar — never spends |
| [INJECT](./inject.md) | **yes** | Sole `POST /api/inject` |
| [RETRIEVE](./retrieve.md) | no | JWT strand READ |
| [PROOF](./proof.md) | no | Receipt honesty + PQ stub |

Proof-market plan: [docs/STORE_PROOF_MARKET.md](../../docs/STORE_PROOF_MARKET.md).
