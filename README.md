# StorageToken ($STORE)

Unified live system for Game (masterledgerlive): **Base-first** storage inject, **$STORE credits as the only storage payment**, switchboard of entry points, Railway plug-and-play.

JWT is **strand READ access**, not money. No guaranteed PnL. No invented fills. Vault never spends save.

## Public desk (free, no API keys)

Open **$STORE Desk / STORE FLOOR** in a browser — paper / DEMO works fully client-side:

**[https://masterledgerlive.github.io/StorageToken/](https://masterledgerlive.github.io/StorageToken/)**

Neon storage-inject floor: header, metric cards, locker-core swarm with eight seats (**WAVE, SPARSE, BROKER, RISK, VAULT, INJECT, RETRIEVE, PROOF**), activity log, avenue picker, and a paper broker (lock-first, sparse shard map, gap-fill vs express). Costs stay labeled **DEMO** until a mined 64-nibble `txHash` comes back from **your** Railway. This site never invents live hashes and never asks for injector keys or JWTs. Not branded GROKTOPUS or Ridark. Not a trading desk.

Sepolia ↔ live Coinbase CDP onboard is still in the wizard. Game’s Railway trial is **expired**. Visitors with a fresh Railway trial can deploy this repo for free. Real inject only if you paste your own `RAILWAY_URL`.

Static files live in [`web/`](./web/). Seat profiles: [`agents/store-floor/`](./agents/store-floor/) (**INJECT** is the sole writer). Proof-market plan: [`docs/STORE_PROOF_MARKET.md`](./docs/STORE_PROOF_MARKET.md). Optional trading seats only: [`galleonlabs/hypergrok-trading-desk`](https://github.com/galleonlabs/hypergrok-trading-desk) — do not import those seats here.

GitHub Pages deploys from `web/` via [`.github/workflows/pages.yml`](./.github/workflows/pages.yml). After merge, enable **Settings → Pages → Source: GitHub Actions** if the first deploy has not created the environment yet.

## Honest sources

These were **merged**, not pretended to already live in one repo:

| Source | What we took | Status |
| --- | --- | --- |
| Origin `gamemasters/agent-genesis` (cloud agent `bc-e37bda11`) | `$STORE` = StoreToken (router-only mint, bytes-based emission) + ShadowWeaveRouter (LIBM hitch on a **REAL** leftover **or** dedicated storage tx — never invent a swap). Modes `paper \| base_sepolia \| base_mainnet_guarded \| full_live`. Signals Ehlers / RSI / MACD / BB, net-margin / drawdown kills, Thompson sampling. JWT = READ. x402 / Kite stub-flagged. | **Unreachable** (GitHub 404; agent not accessible). Surfaces **reconstructed from this spec**. |
| [`masterledgerlive/injection-service` PR #1](https://github.com/masterledgerlive/injection-service/pull/1) (`cursor/base-sepolia-inject-v0-641e`) | Real Base Sepolia calldata inject: `POST /api/inject` → send calldata, `to=provider` (or router), JWT receipt with **mined** `txHash`, `GET /api/injection/:id` from an in-memory `Map` only (no `Math.random`). | **Ported**. |
| Paper learnings | `sell_target = fair_exit + inject_cost`; hitch max that clears leftover; secret voice `§$STORE§`; Coinbase **CEX Advanced Trade cannot carry calldata**. | **Implemented**. |
| [`masterledgerlive/guardian-protocol-agent`](https://github.com/masterledgerlive/guardian-protocol-agent) | Coinbase CDP SDK (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` / `CDP_WALLET_SECRET`), bitstorage hitch-on-real-tx / LIBM append, env-gated Telegram inject alerts, GeckoTerminal + DexScreener USD for wave hitch sizing (fail closed, never silent `$0`). **Not** the buy/sell wave trading loop. | **Ported** (storage / CDP only). |

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
   └─ ethers injector / Coinbase CDP (hot/risk key only)
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
| `coinbase_onchain` | if `CDP_*` **or** `COINBASE_CDP_*` **or** old-guide `COINBASE_API_KEY` + `COINBASE_API_SECRET` + (`COINBASE_PRIVATE_KEY` or `COINBASE_CDP_PROJECT_ID`) | Coinbase CDP / Base wallet on-chain calldata. **Not** CEX Advanced Trade. |
| `wave_first`, `gap_fill`, `priority_express` | **stub / paper policy** | Desk can simulate. Switchboard will not enable them as senders. |
| `multi_chain_cheapest` | **stub — disabled** | Base only today. No multi-chain quote. |
| `x402`, `kite` | **stub — disabled** | Future. Stay off even if env flags are true. |

`GET /api/switchboard` · `POST /api/switchboard` `{ "entryPoint": "coinbase_onchain" }`

Sepolia → live Base: **[COINBASE_LIVE_SWITCH.md](./COINBASE_LIVE_SWITCH.md)**. Set `COINBASE_CDP_ADDRESS=0x50e1…` to use the CDP portal API key wallet. `GET /api/status` shows `fundAddress` (that wallet on `coinbase_onchain`, else the hot injector), `network`, `chainId`, `coinbaseOnchainReady`, and `switchHint`.

## Modes

Default **`MODE=base_sepolia`**.

| Mode | Sends txs? | Mainnet 8453 |
| --- | --- | --- |
| `paper` | no — returns `paper_*` ids, **never** a fake `0x` hash | n/a |
| `base_sepolia` | yes, chainId **84532** only | **refused** |
| `base_mainnet_guarded` | only if `CONFIRM_MAINNET=yes` (env or `POST /api/mode`) | gated |
| `full_live` | live paths | same 8453 confirm gate; still no invented fills |

`POST /api/mode` `{ "mode": "base_mainnet_guarded", "confirmMainnet": "yes" }` flips this process in memory. Railway `MODE` / `CONFIRM_MAINNET` / `BASE_RPC` remain the source of truth on restart.

## HTTP API (Grok Bot / agents)

Base URL = Railway domain. JSON in / JSON out.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, mode, network, `fundAddress`, `modeApi`, voice, payment rule |
| `GET` | `/api/status` | `fundAddress`, `network`, `chainId`, `mode`, `entryPoint`, `coinbaseOnchainReady`, `switchHint` |
| `POST` | `/api/mode` | In-memory mode flip. Mainnet requires `confirmMainnet:"yes"` + `BASE_RPC`. |
| `GET`/`POST` | `/api/switchboard` | Feature flags. POST refuses stub avenues. |
| `GET` | `/api/avenues` | Desk avenue catalog (live vs honest stub) |
| `GET` | `/api/seats` | STORE FLOOR seats; INJECT sole writer |
| `GET`/`POST` | `/api/broker/book` `offer` `lock` `fill` | Paper open-market slots in `$STORE` credits. Lock-first. `txHash` always null. |
| `POST` | `/api/inject` | Store `§$STORE§` (or any bytes). Pays **credits**. Returns receipt hash or `paperId`. |
| `GET` | `/api/injection/:id` | Map only. Unknown id → **404**, no invented hash |
| `GET` | `/api/retrieve/:txHash` | Chain read; requires JWT |
| `GET` | `/api/claim/:id` | JWT must match strand |
| `GET` | `/api/credits/:address` | $STORE balance |
| `POST` | `/api/credits/seed` | Testnet/paper faucet (blocked on guarded mainnet) |
| `POST` | `/api/leftover` | Register leftover from a **real** receipt |
| `GET` | `/api/price` | Live ETH/token USD (GeckoTerminal → DexScreener). Missing quote → 502, never `$0`. |
| `POST` | `/api/quote` | Bytes → credit cost + `sell_target`. With `needUsd` / `tokenAddress` / `usdBudget`, hitch USD fails closed. |
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

Live Base + CDP: **[COINBASE_LIVE_SWITCH.md](./COINBASE_LIVE_SWITCH.md)**.

## Out of scope

AES-GCM (later). Stripe. Guaranteed dividends. CEX hitch. Cloning Origin (unavailable — reconstructed; cite this README).
