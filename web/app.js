(() => {
  "use strict";

  const STORE_VOICE = "§$STORE§";
  const CREDITS_PER_WORD = 10n ** 15n;
  const PLACEHOLDER_PAYER = "0xYourPayer";
  const PAGES_URL = "https://masterledgerlive.github.io/StorageToken/";
  const REPO = "https://github.com/masterledgerlive/StorageToken";

  const ENV_TEMPLATE = `# StorageToken — placeholders only. Never commit real secrets.
# Paste into Railway Variables. Empty secret fields stay empty here.

# paper | base_sepolia | base_mainnet_guarded | full_live
MODE=base_sepolia

# base_dedicated | uniswap_hitch | coinbase_onchain
# stubs (disabled): x402 | kite
ENTRY_POINT=base_dedicated

PORT=3001
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# Public RPC is fine for Sepolia. Swap if rate-limited.
BASE_SEPOLIA_RPC=https://sepolia.base.org

# Hot / risk key that SIGNS inject txs only. Fund with Sepolia ETH for gas.
# Vault never spends save — do not put the vault key here.
# PASTE IN RAILWAY ONLY. Never commit. Never paste into this website.
INJECTOR_PRIVATE_KEY=

# Optional checksum of the vault (save) address. Must not equal injector.
VAULT_ADDRESS=

# Default calldata \`to\` (router after deploy, or injector address).
DEFAULT_PROVIDER=

# After \`pnpm deploy\`
STORE_TOKEN_ADDRESS=
ROUTER_ADDRESS=

# JWT = strand READ access, NOT money
JWT_SECRET=change-me-to-a-long-random-string
TOKEN_EXPIRY_HOURS=24

# Leave empty unless flipping to live Base. See COINBASE_LIVE_SWITCH.md.
# BASE_RPC=
# CONFIRM_MAINNET=no

# Coinbase CDP / Base wallet (on-chain ONLY).
# CEX Advanced Trade CANNOT carry calldata. Do not set CEX keys here.
COINBASE_CDP_API_KEY=
COINBASE_CDP_API_SECRET=
COINBASE_CDP_WALLET_SECRET=
COINBASE_CDP_PROJECT_ID=
# COINBASE_CDP_ADDRESS=
# Old-guide aliases (used if CDP name unset):
# COINBASE_API_KEY=  → COINBASE_CDP_API_KEY
# COINBASE_API_SECRET= → COINBASE_CDP_API_SECRET
# COINBASE_PRIVATE_KEY= → COINBASE_CDP_WALLET_SECRET

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

X402_ENABLED=false
KITE_ENABLED=false
`;

  const CAPTIONS = [
    "Ride the leftover!",
    "Dedicated store, value=0",
    "Hot key only. Vault cold.",
    STORE_VOICE,
    "credits only — not ETH value",
    "vault never spends",
    "no invented fills",
    "CEX can't carry calldata",
    "paper_* not 0x",
    "JWT is READ, not money",
  ];

  const state = {
    path: "sepolia",
    who: "grok",
    step: 0,
    bits: [],
    filled: 0,
    vaultSave: 0n,
    verifiedHash: null,
    railwayUrl: "",
    healthOk: false,
    autoplay: null,
    surfTimer: null,
    rides: 0,
    wipes: 0,
    risk: freshRisk(1000),
    sampler: { ehlers: { a: 1, b: 1 }, rsi: { a: 1, b: 1 }, macd: { a: 1, b: 1 }, bb: { a: 1, b: 1 } },
    prices: seedPrices(),
  };

  function $(id) {
    return document.getElementById(id);
  }

  function paperId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `paper_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  function isVerifiedTxHash(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
  }

  function voiceBytes() {
    return new TextEncoder().encode(STORE_VOICE).length;
  }

  function costForBytes(byteCount) {
    if (!Number.isInteger(byteCount) || byteCount < 0) {
      throw new Error("byteCount must be a non-negative integer");
    }
    if (byteCount === 0) return 0n;
    const words = BigInt(Math.ceil(byteCount / 32));
    return words * CREDITS_PER_WORD;
  }

  function formatStore(wei) {
    const n = Number(wei) / 1e18;
    return `${n.toFixed(6)} $STORE`;
  }

  function sellTarget(fairExit, injectCost) {
    return fairExit + injectCost;
  }

  function hitchFits(payloadBytes, leftoverBytes) {
    return payloadBytes > 0 && payloadBytes <= leftoverBytes;
  }

  function freshRisk(equity) {
    return { equity, peak: equity, realizedPnl: 0, fees: 0, killed: false, reason: "" };
  }

  function netMargin(pnl, fees) {
    return pnl - fees;
  }

  function drawdownPct(equity, peak) {
    if (peak <= 0) return 0;
    return Math.max(0, (peak - equity) / peak);
  }

  function checkKills(risk) {
    const margin = netMargin(risk.realizedPnl, risk.fees);
    if (margin < 0) {
      return { ...risk, killed: true, reason: `net-margin kill: ${margin} < 0` };
    }
    const dd = drawdownPct(risk.equity, risk.peak);
    if (dd > 0.15) {
      return {
        ...risk,
        killed: true,
        reason: `drawdown kill: ${(dd * 100).toFixed(2)}% > 15%`,
      };
    }
    return { ...risk, killed: false, reason: "" };
  }

  function seedPrices() {
    const out = [100];
    for (let i = 0; i < 30; i++) {
      out.push(out[out.length - 1] + Math.sin(i / 3) * 1.4);
    }
    return out;
  }

  function rsi(values, period = 14) {
    if (values.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      if (delta >= 0) gains += delta;
      else losses -= delta;
    }
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = gains / period / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function ema(values, period) {
    if (!values.length) return 0;
    const k = 2 / (period + 1);
    return values.reduce((prev, v, i) => (i === 0 ? v : v * k + prev * (1 - k)));
  }

  function signalVote(prices) {
    const last = prices[prices.length - 1] ?? 0;
    const r = rsi(prices);
    const fast = ema(prices, 12);
    const slow = ema(prices, 26);
    const hist = fast - slow;
    const window = prices.slice(-20);
    const mid = window.reduce((a, b) => a + b, 0) / (window.length || 1);
    const sd = Math.sqrt(
      window.reduce((a, b) => a + (b - mid) ** 2, 0) / (window.length || 1)
    );
    const eh = ema(prices, 10);
    return {
      rsi: r < 30 ? 1 : r > 70 ? -1 : 0,
      macd: Math.sign(hist),
      bb: last < mid - 2 * sd ? 1 : last > mid + 2 * sd ? -1 : 0,
      ehlers: last > eh ? 1 : last < eh ? -1 : 0,
    };
  }

  function sampleArm() {
    let best = "ehlers";
    let bestDraw = -1;
    for (const name of Object.keys(state.sampler)) {
      const { a, b } = state.sampler[name];
      const draw = a / (a + b) + Math.random() * 0.08;
      if (draw > bestDraw) {
        bestDraw = draw;
        best = name;
      }
    }
    return best;
  }

  function costStamp(verified) {
    return verified
      ? `<span class="stamp mini">LIVE</span>`
      : `<span class="stamp mini">DEMO</span>`;
  }

  function setBanner(verifiedHash) {
    const banner = $("demo-banner");
    const text = $("banner-text");
    if (verifiedHash && isVerifiedTxHash(verifiedHash)) {
      banner.classList.add("is-live");
      text.innerHTML = `One mined receipt verified from <em>your</em> Railway:
        <code>${verifiedHash}</code>. Other costs stay honest. Vault still never spends.`;
      banner.querySelector(".stamp").textContent = "LIVE";
    } else {
      banner.classList.remove("is-live");
      banner.querySelector(".stamp").textContent = "DEMO";
      text.innerHTML = `Paper carnival — no live fills. Costs stay <strong>DEMO</strong> until a
        mined 64-nibble <code>txHash</code> comes back from <em>your</em> Railway.
        Game is not paying Railway tonight.`;
    }
  }

  function buildGrid() {
    const grid = $("bit-grid");
    grid.innerHTML = "";
    state.bits = [];
    for (let i = 0; i < 80; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      grid.appendChild(cell);
      state.bits.push(cell);
    }
    state.filled = 0;
    $("grid-status").textContent = "Empty stage. Paper inject lights a few cells.";
  }

  function fillSparseBits(count = 5) {
    const dark = state.bits.filter((c) => !c.classList.contains("on"));
    for (let i = 0; i < count && dark.length; i++) {
      const idx = Math.floor(Math.random() * dark.length);
      const [cell] = dark.splice(idx, 1);
      cell.classList.add("on");
      state.filled += 1;
    }
    $("grid-status").textContent = `${state.filled} / ${state.bits.length} bits lit · sparse on purpose`;
  }

  function addVaultCoin() {
    const pile = $("vault-coins");
    if (pile.children.length >= 12) return;
    const coin = document.createElement("span");
    coin.className = "coin";
    coin.title = "save";
    pile.appendChild(coin);
  }

  function rotateCaptions() {
    document.querySelectorAll("#show-bots .caption").forEach((el, i) => {
      el.textContent = CAPTIONS[(Date.now() / 1800 + i) % CAPTIONS.length | 0];
    });
  }

  function logReceipt(listId, html) {
    const ol = $(listId);
    const li = document.createElement("li");
    li.innerHTML = html;
    ol.prepend(li);
    while (ol.children.length > 8) ol.removeChild(ol.lastChild);
  }

  function paperInject() {
    const bytes = voiceBytes();
    const cost = costForBytes(bytes);
    const id = paperId();
    if (id.startsWith("0x") || isVerifiedTxHash(id)) {
      throw new Error("paper path must never mint a 0x hash");
    }
    state.vaultSave += cost;
    $("vault-save").textContent = formatStore(state.vaultSave);
    addVaultCoin();
    fillSparseBits(4);
    $("inject-target").classList.add("is-hit");
    setTimeout(() => $("inject-target").classList.remove("is-hit"), 450);
    logReceipt(
      "receipt-log",
      `${costStamp(false)} <strong>${id}</strong><br/>
       voice ${STORE_VOICE} · ${bytes}B · ${formatStore(cost)} · status=paper · txHash=none`
    );
  }

  function paperTick() {
    const last = state.prices[state.prices.length - 1];
    const next = last + (Math.random() - 0.48) * 4;
    state.prices.push(next);
    if (state.prices.length > 40) state.prices.shift();
    const injectCost = Number(costForBytes(voiceBytes())) / 1e18;
    const fair = next + 0.4;
    const target = sellTarget(fair, injectCost);
    const votes = signalVote(state.prices);
    const arm = sampleArm();
    state.risk = {
      ...state.risk,
      equity: next,
      peak: Math.max(state.risk.peak, next),
    };
    state.risk = checkKills(state.risk);
    const dd = drawdownPct(state.risk.equity, state.risk.peak);
    $("risk-mark").textContent = `${state.risk.equity.toFixed(2)} / ${state.risk.peak.toFixed(2)}`;
    $("risk-margin").textContent = String(netMargin(state.risk.realizedPnl, state.risk.fees));
    $("risk-dd").textContent = `${(dd * 100).toFixed(2)}%`;
    $("risk-note").textContent = state.risk.killed
      ? state.risk.reason
      : "No guaranteed PnL. Paper does not invent fills.";
    $("light-margin").className = `lamp ${netMargin(state.risk.realizedPnl, state.risk.fees) < 0 ? "bad" : "ok"}`;
    $("light-dd").className = `lamp ${dd > 0.15 ? "bad" : "ok"}`;
    $("light-kill").className = `lamp ${state.risk.killed ? "bad" : ""}`;
    $("score-target").textContent = target.toFixed(4);
    $("score-arm").textContent = `${arm} vote=${votes[arm]}`;
    return { arm, votes, target, wouldTrade: !state.risk.killed && votes[arm] > 0 };
  }

  function showTab(name) {
    document.querySelectorAll(".panel").forEach((panel) => {
      const on = panel.id === name;
      panel.classList.toggle("is-on", on);
      panel.hidden = !on;
    });
    document.querySelectorAll(".tabs a").forEach((a) => {
      a.classList.toggle("is-on", a.dataset.tab === name);
    });
    if (location.hash.replace("#", "") !== name) {
      history.replaceState(null, "", `#${name}`);
    }
  }

  function setStep(n) {
    state.step = Math.max(0, Math.min(4, n));
    document.querySelectorAll("[data-step]").forEach((btn) => {
      btn.classList.toggle("is-on", Number(btn.dataset.step) === state.step);
    });
    document.querySelectorAll("[data-step-panel]").forEach((panel) => {
      const on = Number(panel.dataset.stepPanel) === state.step;
      panel.hidden = !on;
      panel.classList.toggle("is-on", on);
    });
    $("btn-prev").disabled = state.step === 0;
    $("btn-next").textContent = state.step === 4 ? "Done" : "Next";
  }

  function normalizeRailwayUrl(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("Need a full https URL, like https://YOUR-SERVICE.up.railway.app");
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("Use https (or localhost for local paper).");
    }
    return url.origin;
  }

  async function healthCheck() {
    const out = $("health-out");
    const cors = $("cors-help");
    const tab = $("health-tab");
    const liveBox = $("live-inject-box");
    cors.hidden = true;
    liveBox.hidden = true;
    state.healthOk = false;
    let origin;
    try {
      origin = normalizeRailwayUrl($("railway-url").value);
    } catch (err) {
      out.textContent = err.message;
      return;
    }
    if (!origin) {
      out.textContent = "Paste a Railway URL first — or stay on paper. Game is not hosting one.";
      return;
    }
    state.railwayUrl = origin;
    localStorage.setItem("store_railway_url", origin);
    const healthUrl = `${origin}/health`;
    tab.hidden = false;
    tab.href = healthUrl;
    $("health-curl").textContent = `curl -s "${healthUrl}"`;
    out.textContent = `GET ${healthUrl} …`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(healthUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      const json = await res.json();
      out.textContent = JSON.stringify(json, null, 2);
      if (json.voice && json.voice !== STORE_VOICE) {
        out.textContent += "\n\nNote: unexpected voice. Expected §$STORE§.";
      }
      state.healthOk = res.ok;
      liveBox.hidden = !res.ok;
    } catch (err) {
      cors.hidden = false;
      out.textContent = `Browser fetch failed (${err.name}: ${err.message}). Often CORS. Open the new tab or use curl.`;
    }
  }

  async function liveInject() {
    if (!state.healthOk || !state.railwayUrl) {
      $("health-out").textContent = "Health-check your Railway URL first.";
      return;
    }
    const payer = ($("payer-address").value || "").trim() || PLACEHOLDER_PAYER;
    if (payer === PLACEHOLDER_PAYER) {
      $("health-out").textContent =
        "Replace 0xYourPayer with a real public address you control. This site never asks for a private key.";
      return;
    }
    const url = `${state.railwayUrl}/api/inject`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: STORE_VOICE,
          provider: payer,
          creditPayer: payer,
        }),
      });
      const json = await res.json();
      $("health-out").textContent = JSON.stringify(json, null, 2);
      const hash = json.txHash;
      if (isVerifiedTxHash(hash)) {
        state.verifiedHash = hash;
        setBanner(hash);
        logReceipt(
          "receipt-log",
          `${costStamp(true)} <strong>${hash}</strong><br/>
           from your Railway receipt · ${json.mode || "?"} · ${json.paidCredits || "?"} credits`
        );
      } else if (typeof json.paperId === "string" && json.paperId.startsWith("paper_")) {
        logReceipt(
          "receipt-log",
          `${costStamp(false)} Railway answered paper: <strong>${json.paperId}</strong>`
        );
      } else if (hash) {
        logReceipt(
          "receipt-log",
          `${costStamp(false)} Response hash was not a 64-nibble receipt — left unlabeled.`
        );
      }
    } catch (err) {
      $("cors-help").hidden = false;
      $("health-curl").textContent = `curl -s -X POST "${url}" \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"§$STORE§","provider":"${payer}","creditPayer":"${payer}"}'`;
      $("health-out").textContent = `POST blocked in the browser (${err.message}). Use curl or Grok Bot.`;
    }
  }

  function surfOnce(payload, leftover) {
    const ride = hitchFits(payload, leftover);
    const surfer = $("surfer");
    const callout = $("surf-callout");
    surfer.classList.remove("ride", "wipe");
    void surfer.offsetWidth;
    if (ride) {
      state.rides += 1;
      surfer.classList.add("ride");
      callout.textContent = `RIDE · ${payload}B ≤ ${leftover}B leftover`;
    } else {
      state.wipes += 1;
      surfer.classList.add("wipe");
      callout.textContent = `WIPEOUT · ${payload}B > ${leftover}B leftover`;
    }
    $("score-rides").textContent = String(state.rides);
    $("score-wipes").textContent = String(state.wipes);
    const tick = paperTick();
    logReceipt(
      "surf-log",
      `${costStamp(false)} ${ride ? "ride" : "wipeout"} · payload ${payload}B · leftover ${leftover}B · arm ${tick.arm}`
    );
  }

  function playbackWaves() {
    stopSurf();
    let n = 0;
    state.surfTimer = setInterval(() => {
      const leftover = 16 + ((n * 13) % 96);
      const payload = 8 + ((n * 21) % 140);
      $("leftover-bytes").value = String(Math.min(128, leftover));
      $("payload-bytes").value = String(Math.min(160, payload));
      syncSliders();
      surfOnce(payload, leftover);
      n += 1;
      if (n >= 12) stopSurf();
    }, 900);
  }

  function stopSurf() {
    if (state.surfTimer) {
      clearInterval(state.surfTimer);
      state.surfTimer = null;
    }
  }

  function syncSliders() {
    $("leftover-out").textContent = `${$("leftover-bytes").value} B`;
    $("payload-out").textContent = `${$("payload-bytes").value} B`;
  }

  function copyText(id, btn) {
    const text = $(id).value || $(id).textContent;
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = old;
      }, 1200);
    });
  }

  function bind() {
    $("env-template").value = ENV_TEMPLATE;
    const saved = localStorage.getItem("store_railway_url");
    if (saved) $("railway-url").value = saved;

    document.querySelectorAll(".tabs a").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        showTab(a.dataset.tab);
      });
    });

    $("btn-paper-inject").addEventListener("click", paperInject);
    $("btn-paper-tick").addEventListener("click", paperTick);
    $("btn-autoplay").addEventListener("click", () => {
      if (state.autoplay) {
        clearInterval(state.autoplay);
        state.autoplay = null;
        $("btn-autoplay").textContent = "Play the show";
        return;
      }
      paperInject();
      paperTick();
      state.autoplay = setInterval(() => {
        paperInject();
        paperTick();
        rotateCaptions();
      }, 1600);
      $("btn-autoplay").textContent = "Stop the show";
    });

    $("leftover-bytes").addEventListener("input", syncSliders);
    $("payload-bytes").addEventListener("input", syncSliders);
    $("btn-surf-once").addEventListener("click", () => {
      surfOnce(Number($("payload-bytes").value), Number($("leftover-bytes").value));
    });
    $("btn-surf-play").addEventListener("click", playbackWaves);
    $("btn-surf-stop").addEventListener("click", stopSurf);

    document.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => setStep(Number(btn.dataset.step)));
    });
    $("btn-prev").addEventListener("click", () => setStep(state.step - 1));
    $("btn-next").addEventListener("click", () => {
      if (state.step === 4) {
        showTab("grok");
        return;
      }
      setStep(state.step + 1);
    });

    document.querySelectorAll("[data-path]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.path = btn.dataset.path;
        document.querySelectorAll("[data-path]").forEach((b) => b.classList.toggle("is-on", b === btn));
        $("path-hint").textContent =
          state.path === "live"
            ? "Live Base needs confirmMainnet:yes, BASE_RPC, funded fundAddress, and CDP — not CEX Advanced Trade."
            : "Sepolia first. Mainnet 8453 is refused until you confirm.";
      });
    });
    document.querySelectorAll("[data-who]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.who = btn.dataset.who;
        document.querySelectorAll("[data-who]").forEach((b) => b.classList.toggle("is-on", b === btn));
        $("who-hint").textContent =
          state.who === "diy"
            ? "Deploy from GitHub yourself. Paste placeholders. Generate Domain. Then health-check."
            : "Grok Bot can walk Railway. Never paste a real private key into chat.";
      });
    });

    $("btn-copy-env").addEventListener("click", () => copyText("env-template", $("btn-copy-env")));
    $("btn-copy-grok").addEventListener("click", () => copyText("grok-prompt", $("btn-copy-grok")));
    $("btn-health").addEventListener("click", () => {
      healthCheck();
    });
    $("btn-live-inject").addEventListener("click", liveInject);

    setInterval(rotateCaptions, 2200);
  }

  function boot() {
    buildGrid();
    syncSliders();
    setBanner(null);
    setStep(0);
    bind();
    const hash = location.hash.replace("#", "") || "show";
    showTab(["show", "surf", "onboard", "grok"].includes(hash) ? hash : "show");
  }

  window.StorageTokenShow = {
    paperId,
    isVerifiedTxHash,
    costForBytes,
    hitchFits,
    sellTarget,
    STORE_VOICE,
    PAGES_URL,
    REPO,
  };

  boot();
})();
