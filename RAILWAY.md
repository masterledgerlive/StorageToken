# Railway — fund a real Sepolia `§$STORE§` inject tonight

One page. Default `MODE=base_sepolia` (chainId **84532**). Payment is **$STORE credits**, not ETH value, not Stripe, not CEX.

## 1. Create the project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → `masterledgerlive/StorageToken`.
2. Railway reads `Dockerfile` + `railway.toml` (health check `/health`).
3. Generate a public domain (Settings → Networking → Generate Domain).

## 2. Set variables

Copy from `.env.example`. Minimum for a live Sepolia inject:

| Variable | Value |
| --- | --- |
| `MODE` | `base_sepolia` |
| `ENTRY_POINT` | `base_dedicated` |
| `BASE_SEPOLIA_RPC` | `https://sepolia.base.org` |
| `INJECTOR_PRIVATE_KEY` | Sepolia **hot/risk** key (hex). **Not** the vault. |
| `JWT_SECRET` | long random string |
| `DEFAULT_PROVIDER` | injector address (or router after deploy) |

After `pnpm deploy`:

| Variable | Value |
| --- | --- |
| `STORE_TOKEN_ADDRESS` | from `artifacts/deployed.json` |
| `ROUTER_ADDRESS` | from `artifacts/deployed.json` |

Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Optional on-chain Coinbase: `COINBASE_CDP_*` (never CEX Advanced Trade keys).

Do **not** set `BASE_RPC` / `CONFIRM_MAINNET=yes` tonight. `MODE=base_sepolia` **refuses** mainnet 8453.

## 3. Deploy

Railway builds the Dockerfile (`pnpm install` → `pnpm build` → `node dist/index.js`). Wait until `/health` is 200:

```bash
export URL=https://YOUR-SERVICE.up.railway.app
curl -s "$URL/health"
```

You should see `"mode":"base_sepolia"`, `"chainId":84532`, `"voice":"§$STORE§"`, `"payment":"$STORE credits only"`.

## 4. Fund Sepolia

1. Create/use a dedicated injector wallet. Copy its address (`GET /api/status` → `hotAddress` after the key is set).
2. Get Sepolia ETH for **gas only** (Base Sepolia faucet). ~0.01 ETH is plenty.
3. **Vault stays cold.** If `VAULT_ADDRESS` equals the injector, the service refuses to boot.

## 5. Credits + real inject of `§$STORE§`

Until contracts are deployed, the in-memory ledger is the credit source of truth (same economics as `StoreToken.sol`). Seed the payer, then inject:

```bash
PAYER=0xYourInjectorAddress

curl -s -X POST "$URL/api/credits/seed" \
  -H 'Content-Type: application/json' \
  -d "{\"address\":\"$PAYER\",\"amount\":\"1000000000000000000000\"}"

curl -s "$URL/api/credits/$PAYER"

curl -s -X POST "$URL/api/inject" \
  -H 'Content-Type: application/json' \
  -d "{\"text\":\"§\$STORE§\",\"provider\":\"$PAYER\",\"creditPayer\":\"$PAYER\"}"
```

A live response has a **64-nibble `txHash` from `tx.wait()`**, a `blockNumber`, `paidCredits`, and a JWT (`purpose: strand-read`, `notMoney: true`).

```bash
curl -s "$URL/api/injection/inj_…"     # Map only; unknown id → 404, no hash
```

Look up the hash on [sepolia.basescan.org](https://sepolia.basescan.org). Input data should start with the UTF-8 voice `§$STORE§` (`0xc2a72453544f5245c2a7…`) unless you pointed `to` at the deployed router (then it is `storeDedicated(bytes)` calldata wrapping that voice).

## 6. Deploy contracts (same night, optional but recommended)

From a machine with the hot key (do not paste the key into chat):

```bash
pnpm install
MODE=base_sepolia \
INJECTOR_PRIVATE_KEY=0x… \
BASE_SEPOLIA_RPC=https://sepolia.base.org \
pnpm deploy
```

Set `STORE_TOKEN_ADDRESS` and `ROUTER_ADDRESS` on Railway, redeploy. Further injects call `ShadowWeaveRouter.storeDedicated`. Owner `seedCredits` on-chain replaces `POST /api/credits/seed` for that payer.

## 7. Hitch (only if a real swap exists)

```bash
# leftoverTx MUST be a mined swap we sent — never invented
curl -s -X POST "$URL/api/leftover" \
  -H 'Content-Type: application/json' \
  -d '{"swapTx":"0x…64 hex from receipt…","leftoverBytes":64,"owner":"0xPayer","receiptBlock":123}'

curl -s -X POST "$URL/api/switchboard" \
  -H 'Content-Type: application/json' \
  -d '{"entryPoint":"uniswap_hitch"}'

curl -s -X POST "$URL/api/inject" \
  -H 'Content-Type: application/json' \
  -d '{"text":"§$STORE§","provider":"0xPayer","creditPayer":"0xPayer","leftoverTx":"0x…"}'
```

If there is no leftover, stay on `base_dedicated`. Coinbase CEX cannot register leftovers.

## 8. Graduate modes

1. `paper` — local / CI. No chain hashes.
2. `base_sepolia` — **tonight**.
3. `base_mainnet_guarded` — later, plus `CONFIRM_MAINNET=yes`, disable `seedCredits`, funded hot key, vault still cold.
4. `full_live` — only after guarded is boring.

x402 / Kite remain stub-disabled.
