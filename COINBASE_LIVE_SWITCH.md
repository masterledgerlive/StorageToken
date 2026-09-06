# Sepolia → live Base (Coinbase CDP on-chain)

One flip. Game tests on `MODE=base_sepolia`, then switches to real Base with **Coinbase CDP on-chain inject** — not CEX Advanced Trade.

Payment stays **$STORE credits only**. Native `value` on the inject tx is `0`. Hashes come from `tx.wait()` / a mined receipt only. The vault never signs.

In-memory `POST /api/mode` dies on process restart. **Update Railway variables** for a durable flip.

---

## (a) Sepolia test path

1. Railway (or local) with `MODE=base_sepolia`. Default chain is **base-sepolia / 84532**.
2. Set a hot injector key (`INJECTOR_PRIVATE_KEY`) that is **not** the vault. Fund it with Sepolia ETH for gas.
3. `GET /api/status` → `fundAddress` is the hot injector. Fund that address.
4. Seed credits (testnet only) and inject the voice:

```bash
curl -s "$URL/api/status"
# fundAddress, network=base-sepolia, chainId=84532, mode=base_sepolia

curl -s -X POST "$URL/api/credits/seed" \
  -H 'Content-Type: application/json' \
  -d '{"address":"0xPayer","amount":"1000000000000000000000"}'

curl -s -X POST "$URL/api/inject" \
  -H 'Content-Type: application/json' \
  -d '{"text":"§$STORE§","provider":"0xPayer","creditPayer":"0xPayer"}'
```

A live Sepolia response has a **64-nibble `txHash` from the receipt**, a `blockNumber`, and `paidCredits`. Look it up on [sepolia.basescan.org](https://sepolia.basescan.org).

`GET /health` and `GET /api/status` document `POST /api/mode` (`modeApi`) and the Sepolia → live hint (`switchHint`).

---

## (b) Create a CDP account (human KYC)

Bots cannot do this.

1. Open [https://portal.cdp.coinbase.com](https://portal.cdp.coinbase.com).
2. Sign up / log in. Complete Coinbase KYC as a human.
3. Create an API key. Download the JSON and store it offline.
4. From the JSON / portal you need:
   - API key id
   - API secret
   - Wallet secret (or a hex private key if you are driving the same EVM key)

CEX Advanced Trade keys are the wrong product. They **cannot carry calldata**. This service refuses `cexAdvancedTrade` / `coinbaseAdvancedTrade` on inject.

---

## (c) Map keys into Railway

Preferred names (this repo):

| Railway variable | Meaning |
| --- | --- |
| `COINBASE_CDP_API_KEY` | CDP API key id |
| `COINBASE_CDP_API_SECRET` | CDP API secret |
| `COINBASE_CDP_WALLET_SECRET` | CDP wallet secret, **or** a 0x hex private key |
| `COINBASE_CDP_PROJECT_ID` | optional; also satisfies switchboard readiness with the two API keys |
| `COINBASE_CDP_ADDRESS` | optional stable EVM address if the wallet secret is not hex |

Guardian-protocol-agent names (accepted if the `COINBASE_CDP_*` name is unset — same CDP product):

| Guardian env | Maps to |
| --- | --- |
| `CDP_API_KEY_ID` | `COINBASE_CDP_API_KEY` |
| `CDP_API_KEY_SECRET` | `COINBASE_CDP_API_SECRET` |
| `CDP_WALLET_SECRET` | `COINBASE_CDP_WALLET_SECRET` |

Aliases from the old `coinbase-multi-injector` guide (accepted if the `COINBASE_CDP_*` / guardian name is unset):

| Old guide | Maps to |
| --- | --- |
| `COINBASE_API_KEY` | `COINBASE_CDP_API_KEY` |
| `COINBASE_API_SECRET` | `COINBASE_CDP_API_SECRET` |
| `COINBASE_PRIVATE_KEY` | `COINBASE_CDP_WALLET_SECRET` |

`coinbase_onchain` enables only when `apiKey + apiSecret + (walletSecret or projectId)` are set. PEM wallet/API secrets may contain literal `\n` (guardian Railway style) — they are unescaped before the CDP SDK sees them.

Also set, before a live flip:

| Variable | Value |
| --- | --- |
| `BASE_RPC` | a real Base mainnet RPC (required to switch) |
| `INJECTOR_PRIVATE_KEY` | hot/risk hex key if you are not using a CDP-managed wallet |
| `VAULT_ADDRESS` | cold save address — **must not** equal `fundAddress` |
| `CONFIRM_MAINNET` | `yes` for a durable mainnet confirm (or send it once on `POST /api/mode`) |

---

## (d) Fund `fundAddress` on Base

`GET /api/status` → `fundAddress` (= hot injector).

CDP `requestFaucet` is **Sepolia / testnet only**. Mainnet must be funded externally.

1. In the Coinbase retail app, withdraw ETH.
2. Network: **Base** (not Ethereum, not Sepolia).
3. Destination: `fundAddress`.
4. Enough ETH for gas only. Storage payment is still **$STORE credits**.

---

## (e) Flip mode + switchboard

```bash
# In-memory for this process (Railway env still wins after restart)
curl -s -X POST "$URL/api/mode" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"base_mainnet_guarded","confirmMainnet":"yes"}'

curl -s -X POST "$URL/api/switchboard" \
  -H 'Content-Type: application/json' \
  -d '{"entryPoint":"coinbase_onchain"}'
```

Switching **to** `base_mainnet_guarded` or `full_live` requires:

- body `confirmMainnet: "yes"`
- that either matches env `CONFIRM_MAINNET=yes` or sets an in-memory confirm
- `BASE_RPC` already set
- vault ≠ injector / `fundAddress`

Then persist on Railway so the next deploy stays live:

```text
MODE=base_mainnet_guarded
CONFIRM_MAINNET=yes
BASE_RPC=https://…          # your Base RPC
ENTRY_POINT=coinbase_onchain
```

`GET /api/status` should now show `network=base`, `chainId=8453`, `coinbaseOnchainReady=true`, and the same `fundAddress`.

---

## (f) First live `§$STORE§` inject

Credits on mainnet are **not** seeded (`POST /api/credits/seed` is blocked when mainnet is confirmed). The payer must already hold $STORE.

```bash
curl -s -X POST "$URL/api/inject" \
  -H 'Content-Type: application/json' \
  -d '{"text":"§$STORE§","provider":"0xRouterOrProvider","creditPayer":"0xPayer","entryPoint":"coinbase_onchain"}'
```

The `coinbase_onchain` path sends the same calldata (`to` = router or provider, `value` = 0, `data` = payload) on the active chain via:

1. A hex `COINBASE_CDP_WALLET_SECRET` / `CDP_WALLET_SECRET` / `COINBASE_PRIVATE_KEY` (ethers), or
2. `@coinbase/cdp-sdk` for a CDP-managed wallet, or
3. `INJECTOR_PRIVATE_KEY` on Base if that is the hot key

The hash in the response is the **mined receipt**. Do not send `txHash` in the body. CEX Advanced Trade stays refused.

Optional `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` fire on a **mined** inject success and on inject failure. Unset tokens stay silent.

Wave hitch USD (`POST /api/quote` / hitch inject with `needUsd`, `tokenAddress`, `usdBudget`, or `leftoverEth`) uses **GeckoTerminal then DexScreener only**. A missing quote fails closed — never a silent `$0`. Bytes-only leftover hitch (no USD fields) is unchanged.

---

## Modes (recap)

| Mode | Chain | 8453 |
| --- | --- | --- |
| `paper` | n/a | n/a — `paper_*` ids, never a fake `0x` |
| `base_sepolia` | 84532 | **refused** |
| `base_mainnet_guarded` | Base after confirm | needs `confirmMainnet: "yes"` |
| `full_live` | Base after confirm | same confirm gate |

See [RAILWAY.md](./RAILWAY.md) for deploy, [.env.example](./.env.example) for both key names.
