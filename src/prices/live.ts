/**
 * Live USD quotes for hitch sizing.
 * Sources: GeckoTerminal (primary) then DexScreener. No invented prices.
 * Fail closed — never return $0 silently.
 */

export const BASE_WETH = "0x4200000000000000000000000000000000000006";

export const GECKO_SIMPLE_BASE =
  "https://api.geckoterminal.com/api/v2/simple/networks/base/token_price";
export const DEXSCREENER_TOKENS = "https://api.dexscreener.com/latest/dex/tokens";

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export interface LiveUsdQuote {
  usd: number;
  address: string;
  source: "geckoterminal" | "dexscreener";
}

export interface LivePriceClient {
  ethUsd(): Promise<LiveUsdQuote>;
  tokenUsd(address: string): Promise<LiveUsdQuote>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export function geckoUrl(address: string): string {
  return `${GECKO_SIMPLE_BASE}/${address.toLowerCase()}`;
}

export function dexscreenerUrl(address: string): string {
  return `${DEXSCREENER_TOKENS}/${address}`;
}

export function parsePositiveUsd(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function parseGeckoTokenUsd(json: unknown, address: string): number | undefined {
  const key = address.toLowerCase();
  const prices = (json as { data?: { attributes?: { token_prices?: Record<string, unknown> } } })
    ?.data?.attributes?.token_prices;
  if (!prices || typeof prices !== "object") return undefined;
  return (
    parsePositiveUsd(prices[key]) ??
    parsePositiveUsd(prices[address]) ??
    parsePositiveUsd(Object.values(prices)[0])
  );
}

export function parseDexScreenerTokenUsd(json: unknown): number | undefined {
  const pairs = (json as { pairs?: Array<{ chainId?: string; priceUsd?: unknown; liquidity?: { usd?: number } }> })
    ?.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return undefined;
  const base = pairs.filter((p) => (p.chainId || "").toLowerCase() === "base");
  const pool = (base.length ? base : pairs).slice().sort((a, b) => {
    const la = Number(a.liquidity?.usd ?? 0);
    const lb = Number(b.liquidity?.usd ?? 0);
    return lb - la;
  })[0];
  return parsePositiveUsd(pool?.priceUsd);
}

function missingPriceError(label: string): Error {
  return new Error(
    `Missing live ${label} USD price from GeckoTerminal and DexScreener — refusing silent $0`
  );
}

async function readJson(
  fetchImpl: FetchLike,
  url: string
): Promise<unknown | undefined> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function fetchTokenUsd(
  address: string,
  fetchImpl: FetchLike = fetch
): Promise<LiveUsdQuote> {
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error(`Invalid token address for USD quote: ${address}`);
  }

  const gecko = await readJson(fetchImpl, geckoUrl(trimmed));
  const geckoUsd = gecko ? parseGeckoTokenUsd(gecko, trimmed) : undefined;
  if (geckoUsd !== undefined) {
    return { usd: geckoUsd, address: trimmed, source: "geckoterminal" };
  }

  const dex = await readJson(fetchImpl, dexscreenerUrl(trimmed));
  const dexUsd = dex ? parseDexScreenerTokenUsd(dex) : undefined;
  if (dexUsd !== undefined) {
    return { usd: dexUsd, address: trimmed, source: "dexscreener" };
  }

  throw missingPriceError(trimmed === BASE_WETH ? "ETH" : trimmed);
}

export async function fetchEthUsd(fetchImpl: FetchLike = fetch): Promise<LiveUsdQuote> {
  return fetchTokenUsd(BASE_WETH, fetchImpl);
}

export function createLivePriceClient(fetchImpl: FetchLike = fetch): LivePriceClient {
  return {
    ethUsd: () => fetchEthUsd(fetchImpl),
    tokenUsd: (address) => fetchTokenUsd(address, fetchImpl),
  };
}

export function wantsLiveUsd(body: Record<string, unknown> | undefined): boolean {
  if (!body) return false;
  return (
    body.needUsd === true ||
    typeof body.tokenAddress === "string" ||
    body.usdBudget !== undefined ||
    body.leftoverEth !== undefined
  );
}
