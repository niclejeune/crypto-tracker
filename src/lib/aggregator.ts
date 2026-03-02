import { fetchBybitTickers, fetchBybitCandles } from "./exchanges/bybit";
import { fetchMexcTickers, fetchMexcCandles } from "./exchanges/mexc";
import { fetchHyperliquidTickers, fetchHyperliquidCandles } from "./exchanges/hyperliquid";
import { fetchBitunixTickers, fetchBitunixCandles, fetchBitunixFunding } from "./exchanges/bitunix";
import { fetchMarketCaps, lookupMarketCap, isInTop1000 } from "./exchanges/coingecko";
import { computeSRLevels, findNearbyLevels } from "./sr-engine";
import {
  getCoinglassHeatmapUrl,
  getCoinglassFundingUrl,
  getCoinglassOIUrl,
  getTradingViewUrl,
} from "./links";
import type { RawTicker } from "./exchanges/types";
import type { TickerData, TickerResponse, Candle } from "./types";

const TOP_N = 20;
const SR_THRESHOLD_PCT = 1.5;

export const VALID_TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof VALID_TIMEFRAMES)[number];

// Bybit uses numeric intervals
const BYBIT_INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};

// Sub-candle config: for each user-facing timeframe, which candle interval
// and how many candles to fetch to cover the full period.
// This is shared with chart/route.ts to keep change% and chart in sync.
export const TF_CANDLE_CONFIG: Record<Timeframe, { interval: string; limit: number }> = {
  "5m": { interval: "1m", limit: 5 },
  "15m": { interval: "1m", limit: 15 },
  "1h": { interval: "5m", limit: 12 },
  "4h": { interval: "15m", limit: 16 },
  "1d": { interval: "1h", limit: 24 },
  "1w": { interval: "4h", limit: 42 },
};

export function dedupeByBaseSymbol(tickers: RawTicker[]): RawTicker[] {
  const seen = new Map<string, RawTicker>();
  for (const t of tickers) {
    const existing = seen.get(t.base_symbol);
    if (!existing) {
      seen.set(t.base_symbol, t);
    } else {
      if (t.volume_24h_usd > existing.volume_24h_usd) {
        seen.set(t.base_symbol, {
          ...t,
          funding_rate: t.funding_rate ?? existing.funding_rate,
          open_interest: t.open_interest ?? existing.open_interest,
        });
      } else {
        seen.set(t.base_symbol, {
          ...existing,
          funding_rate: existing.funding_rate ?? t.funding_rate,
          open_interest: existing.open_interest ?? t.open_interest,
        });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Fetch all tickers from all exchanges, filter to CoinGecko top 1000, dedupe.
 * Shared between /api/tickers and /api/signals.
 */
export async function fetchAllTickers(): Promise<{
  tickers: RawTicker[];
  marketCaps: Map<string, number>;
}> {
  const [tickerResults, marketCapData] = await Promise.all([
    Promise.allSettled([
      fetchBybitTickers(),
      fetchMexcTickers(),
      fetchHyperliquidTickers(),
      fetchBitunixTickers(),
    ]),
    fetchMarketCaps(),
  ]);

  const { caps: marketCaps, symbols: top1000Symbols } = marketCapData;

  const allTickers: RawTicker[] = [];
  for (const r of tickerResults) {
    if (r.status === "fulfilled") allTickers.push(...r.value);
  }

  const filtered = allTickers.filter((t) => isInTop1000(t.base_symbol, top1000Symbols));
  const deduped = dedupeByBaseSymbol(filtered);

  return { tickers: deduped, marketCaps };
}

/**
 * Multi-exchange candle resolver.
 * Tries the ticker's own exchange first, then falls back through the chain.
 */
export async function fetchCandlesForTicker(
  symbol: string,
  interval: string,
  limit: number = 100,
  preferredExchange?: string
): Promise<Candle[]> {
  type Fetcher = () => Promise<Candle[]>;

  const bybitInterval = BYBIT_INTERVAL_MAP[interval] ?? interval;

  const fetchers: Record<string, Fetcher> = {
    bybit: () => fetchBybitCandles(symbol, bybitInterval, limit),
    mexc: () => fetchMexcCandles(symbol, interval, limit),
    bitunix: () => fetchBitunixCandles(symbol, interval, limit),
    hyperliquid: () => fetchHyperliquidCandles(symbol, interval, limit),
  };

  // Build order: preferred exchange first, then the rest
  const order = ["bybit", "mexc", "bitunix", "hyperliquid"];
  if (preferredExchange && fetchers[preferredExchange]) {
    const idx = order.indexOf(preferredExchange);
    if (idx > 0) {
      order.splice(idx, 1);
      order.unshift(preferredExchange);
    }
  }

  for (const exchange of order) {
    try {
      const candles = await fetchers[exchange]!();
      if (candles.length >= 2) return candles;
    } catch {
      // try next exchange
    }
  }

  return [];
}

/**
 * Compute % change exactly like TradingView: from the current candle's open
 * at the selected timeframe interval. For 1D → fetch 1D candle, use its open.
 * For 4H → fetch 4H candle, use its open. Etc.
 * Uses Bybit as primary source (matches TV), falls back to other exchanges.
 */
async function computeChangePct(
  symbol: string,
  currentPrice: number,
  tf: Timeframe,
  exchange?: string
): Promise<number | null> {
  try {
    const candles = await fetchCandlesForTicker(symbol, tf, 2, exchange);
    if (candles.length === 0) return null;
    // Most recent candle's open = current period open (matches TradingView)
    const refPrice = candles[candles.length - 1]!.open;
    if (refPrice === 0) return null;
    return ((currentPrice - refPrice) / refPrice) * 100;
  } catch {
    return null;
  }
}

async function computeSRForTicker(ticker: RawTicker) {
  try {
    const candles = await fetchCandlesForTicker(ticker.symbol, "1d", 100, ticker.exchange);
    const levels = computeSRLevels(candles, "1d");
    return findNearbyLevels(ticker.price, levels, SR_THRESHOLD_PCT);
  } catch {
    return [];
  }
}

export async function getAggregatedTickers(
  tf: Timeframe = "1d"
): Promise<TickerResponse> {
  const { tickers: deduped, marketCaps } = await fetchAllTickers();

  // Pre-sort by 24h to pick candidates for candle-based re-ranking
  const sortedBy24h = [...deduped].sort(
    (a, b) => b.price_change_24h - a.price_change_24h
  );

  const candidateCount = Math.min(50, Math.floor(sortedBy24h.length / 2));
  const candidates = [
    ...sortedBy24h.slice(0, candidateCount),
    ...sortedBy24h.slice(-candidateCount),
  ];
  const candidateMap = new Map<string, RawTicker>();
  for (const c of candidates) candidateMap.set(c.symbol, c);
  const uniqueCandidates = Array.from(candidateMap.values());

  // Compute TF-specific change from candles
  const changeResults = await Promise.allSettled(
    uniqueCandidates.map((t) =>
      computeChangePct(t.symbol, t.price, tf, t.exchange)
    )
  );

  const withChange = uniqueCandidates
    .map((t, i) => {
      const r = changeResults[i]!;
      const pct = r.status === "fulfilled" && r.value !== null ? r.value : null;
      return { raw: t, change_pct: pct };
    })
    .filter((entry): entry is { raw: RawTicker; change_pct: number } => entry.change_pct !== null)
    .sort((a, b) => b.change_pct - a.change_pct);

  const gainersRaw = withChange.slice(0, TOP_N);
  const losersRaw = withChange.slice(-TOP_N).reverse();

  const allTopMovers = [...gainersRaw, ...losersRaw];

  // Fetch funding for Bitunix top movers that are missing it
  const fundingResults = await Promise.allSettled(
    allTopMovers.map((entry) => {
      if (entry.raw.funding_rate != null) return Promise.resolve(null);
      if (entry.raw.exchange !== "bitunix") return Promise.resolve(null);
      return fetchBitunixFunding(entry.raw.symbol);
    })
  );

  const fundingMap = new Map<string, number>();
  allTopMovers.forEach((entry, i) => {
    const r = fundingResults[i]!;
    if (r.status === "fulfilled" && r.value != null) {
      fundingMap.set(entry.raw.symbol, r.value);
    }
  });

  // Compute S/R levels
  const srResults = await Promise.allSettled(
    allTopMovers.map((entry) => computeSRForTicker(entry.raw))
  );
  const srMap = new Map<string, Awaited<ReturnType<typeof computeSRForTicker>>>();
  allTopMovers.forEach((entry, i) => {
    const r = srResults[i]!;
    if (r.status === "fulfilled") srMap.set(entry.raw.symbol, r.value);
  });

  function convert(entry: { raw: RawTicker; change_pct: number }): TickerData {
    const raw = entry.raw;
    const funding = raw.funding_rate ?? fundingMap.get(raw.symbol);
    return {
      symbol: raw.symbol,
      base_symbol: raw.base_symbol,
      exchange: raw.exchange,
      price: raw.price,
      change_pct: entry.change_pct,
      volume_24h_usd: raw.volume_24h_usd,
      market_cap: lookupMarketCap(raw.base_symbol, marketCaps),
      open_interest: raw.open_interest,
      funding_rate: funding,
      near_sr: srMap.get(raw.symbol) ?? [],
      links: {
        coinglass_heatmap: getCoinglassHeatmapUrl(raw.base_symbol),
        coinglass_funding: getCoinglassFundingUrl(raw.base_symbol),
        coinglass_oi: getCoinglassOIUrl(raw.base_symbol),
        tradingview: getTradingViewUrl(raw.symbol, raw.exchange),
      },
    };
  }

  return {
    timeframe: tf,
    updated_at: new Date().toISOString(),
    gainers: gainersRaw.map(convert),
    losers: losersRaw.map(convert),
  };
}
