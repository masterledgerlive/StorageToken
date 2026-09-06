# StorageToken ($STORE)

Unified live system for Game (masterledgerlive): **Base-first** storage inject, **$STORE credits as the only storage payment**, switchboard of entry points, Railway plug-and-play.

JWT is **strand READ access**, not money. No guaranteed PnL. No invented fills. Vault never spends save.

## Honest sources

These were **merged**, not pretended to already live in one repo:

| Source | What we took | Status |
| --- | --- | --- |
| Origin `gamemasters/agent-genesis` (cloud agent `bc-e37bda11`) | `$STORE` = StoreToken (router-only mint, bytes-based emission) + ShadowWeaveRouter (LIBM hitch on a **REAL** leftover **or** dedicated storage tx — never invent a swap). Modes `paper \| base_sepolia \| base_mainnet_guarded \| full_live`. Signals Ehlers / RSI / MACD / BB, net-margin / drawdown kills, Thompson sampling. JWT = READ. x402 / Kite stub-flagged. | **Unreachable** (GitHub 404; agent not accessible). Surfaces **reconstructed from this spec**. |
| [`masterledgerlive/injection-service` PR #1](https://github.com/masterledgerlive/injection-service/pull/1) (`cursor/base-sepolia-inject-v0-641e`) | Real Base Sepolia calldata inject: `POST /api/inject` → send calldata, `to=provider` (or router), JWT receipt with **mined** `txHash`, `GET /api/injection/:id` from an in-memory `Map` only (no `Math.random`). | **Ported**. |
| Paper learnings | `sell_target = fair_exit + inject_cost`; hitch max that clears leftover; secret voice `§$STORE§`; Coinbase **CEX Advanced Trade cannot carry calldata**. | **Implemented**. |

## Architecture

```
Game / Grok Bot / agents
        │  HTTP
        ▼
 StorageToken service (Railway)
   ├─ switchboard (ENTRY_POINT)
   ├─ $STORE credit ledger (mirrors StoreToken.sol)
   ├─ leftover registry (real swap receipts only)
   ├─ JWT TokenManager (READ, not money)
   └─ ethers injector (hot/risk key only)
        │
        ▼
 Base Sepolia 84532
   StoreToken.sol  ←── router-only mint, bytes emission, burn-to-pay
   ShadowWeaveRouter.sol ← dedicated store OR hitch(leftoverTx)
```

**Payment rule:** only `$STORE` credits (burn / transfer into StoreToken economics). Native `value` on the inject tx is `0`. Gas comes from the **hot/risk** key. The vault address is never the signer.

## Switchboard

| Entry | Live? | Behavior |
| --- | --- | --- |
| `base_dedicated` | yes (default) | Dedicated storage tx — ethers calldata to router (or provider if undeployed). |
| `uniswap_hitch` | yes, gated | Hitch on **OUR** Uniswap/Base leftover. Requires a leftover registered from a **mined** swap receipt. Never invents a swap. Payload ≤ leftover bytes. |
| `coinbase_onchain` | if `COINBASE_CDP_*` present | Coinbase CDP / Base wallet path. **Not** CEX Advanced Trade. |
| `x402`, `kite` | **stub — disabled** | Future. Stay off even if env flags are true. |

`GET /api/switchboard` · `POST /api/switchboard` `{ "entryPoint": "base_dedicated" }`

## Modes

Default **`MODE=base_sepolia`**.

| Mode | Sends txs? | Mainnet 8453 |
| --- | --- | --- |
| `paper` | no — returns `paper_*` ids, **never** a fake `0x` hash | n/a |
| `base_sepolia` | yes, chainId **84532** only | **refused** |
| `base_mainnet_guarded` | only if `CONFIRM_MAINNET=yes` | gated |
| `full_live` | live paths | still no invented fills |

## HTTP API (Grok Bot / agents)

Base URL = Railway domain. JSON in / JSON out.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, mode, voice, payment rule |
| `GET` | `/api/status` | Addresses, leftover count, hot key (no secrets) |
| `GET`/`POST` | `/api/switchboard` | Feature flags |
| `POST` | `/api/inject` | Store `§$STORE§` (or any bytes). Pays **credits**. Returns receipt hash or `paperId`. |
| `GET` | `/api/injection/:id` | Map only. Unknown id → **404**, no invented hash |
| `GET` | `/api/retrieve/:txHash` | Chain read; requires JWT |
| `GET` | `/api/claim/:id` | JWT must match strand |
| `GET` | `/api/credits/:address` | $STORE balance |
| `POST` | `/api/credits/seed` | Testnet/paper faucet (blocked on guarded mainnet) |
| `POST` | `/api/leftover` | Register leftover from a **real** receipt |
| `POST` | `/api/quote` | Bytes → credit cost + `sell_target` |
| `POST` | `/api/loop/tick` | Paper signals / Thompson / risk kills |

### Inject body

```json
{
  "text": "§$STORE§",
  "provider": "0xYourProviderOrRouter",
  "creditPayer": "0xAddressThatHoldsSTORE",
  "entryPoint": "base_dedicated"
}
```

Also accepted: `bytes` (`0x…` hex) or `base64` (ported from injection-service). The service prefixes `§$STORE§` if missing.

Do **not** send `txHash`. Hashes come from `tx.wait()` only.

### Example

```bash
# 1) seed test credits (Sepolia / paper)
curl -s -X POST "$URL/api/credits/seed" \
  -H 'Content-Type: application/json' \
  -d '{"address":"0xYourPayer","amount":"1000000000000000000000"}'

# 2) inject the voice
curl -s -X POST "$URL/api/inject" \
  -H 'Content-Type: application/json' \
  -d '{"text":"§$STORE§","provider":"0xYourPayer","creditPayer":"0xYourPayer"}'
```

## Contracts

`contracts/StoreToken.sol` — ERC-20 credits. `mintForBytes` is **router-only**. `payForStorage` burns credits. `seedCredits` is owner-only and must be disabled before mainnet.

`contracts/ShadowWeaveRouter.sol` — `storeDedicated(bytes)` or `hitch(bytes, leftoverTx)` after `registerLeftover` from a real swap.

```bash
pnpm compile
MODE=base_sepolia INJECTOR_PRIVATE_KEY=0x... pnpm deploy
# then set STORE_TOKEN_ADDRESS + ROUTER_ADDRESS
```

## Local

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm build
pnpm dev
```

## Railway

See **[RAILWAY.md](./RAILWAY.md)** — create project → set vars → deploy → curl inject → fund Sepolia → graduate modes.

## Out of scope

AES-GCM (later). Stripe. Guaranteed dividends. CEX hitch. Cloning Origin (unavailable — reconstructed; cite this README).
