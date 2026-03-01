import { fetchBinanceTickers, fetchBinanceCandles, fetchBinanceOI } from "./exchanges/binance";
import { fetchBybitTickers } from "./exchanges/bybit";
import { fetchMarketCaps, lookupMarketCap } from "./exchanges/coingecko";
import { computeSRLevels, findNearbyLevels } from "./sr-engine";
import {
  getCoinglassHeatmapUrl,
  getCoinglassFundingUrl,
  getCoinglassOIUrl,
  getTradingViewUrl,
} from "./links";
import type { RawTicker } from "./exchanges/types";
import type { TickerData, TickerResponse } from "./types";

const TOP_N = 20;
const SR_THRESHOLD_PCT = 1.5;

export const VALID_TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof VALID_TIMEFRAMES)[number];

const TF_TO_BINANCE_INTERVAL: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

function dedupeByBaseSymbol(tickers: RawTicker[]): RawTicker[] {
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

function getBinanceSymbol(ticker: RawTicker): string {
  return ticker.symbol.includes("USDT")
    ? ticker.symbol
    : `${ticker.base_symbol}USDT`;
}

async function computeChangePct(
  symbol: string,
  currentPrice: number,
  tf: Timeframe
): Promise<number | null> {
  try {
    const interval = TF_TO_BINANCE_INTERVAL[tf];
    const candles = await fetchBinanceCandles(symbol, interval, 2);
    if (candles.length === 0) return null;
    const refPrice = candles[candles.length - 1]!.open;
    if (refPrice === 0) return null;
    return ((currentPrice - refPrice) / refPrice) * 100;
  } catch {
    return null;
  }
}

async function computeSRForTicker(ticker: RawTicker) {
  try {
    const candles = await fetchBinanceCandles(getBinanceSymbol(ticker), "1d", 100);
    const levels = computeSRLevels(candles, "1d");
    return findNearbyLevels(ticker.price, levels, SR_THRESHOLD_PCT);
  } catch {
    return [];
  }
}

export async function getAggregatedTickers(
  tf: Timeframe = "1d"
): Promise<TickerResponse> {
  const [tickerResults, marketCaps] = await Promise.all([
    Promise.allSettled([fetchBinanceTickers(), fetchBybitTickers()]),
    fetchMarketCaps(),
  ]);

  const allTickers: RawTicker[] = [];
  for (const r of tickerResults) {
    if (r.status === "fulfilled") allTickers.push(...r.value);
  }

  const deduped = dedupeByBaseSymbol(allTickers);

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

  // Compute TF-specific change from candles for ALL timeframes (including 1d)
  // This ensures 1d matches daily candle open (like TradingView) instead of rolling 24h
  const changeResults = await Promise.allSettled(
    uniqueCandidates.map((t) =>
      computeChangePct(getBinanceSymbol(t), t.price, tf)
    )
  );

  const withChange = uniqueCandidates
    .map((t, i) => {
      const r = changeResults[i]!;
      const pct = r.status === "fulfilled" && r.value !== null ? r.value : t.price_change_24h;
      return { raw: t, change_pct: pct };
    })
    .sort((a, b) => b.change_pct - a.change_pct);

  const gainersRaw = withChange.slice(0, TOP_N);
  const losersRaw = withChange.slice(-TOP_N).reverse();

  const allTopMovers = [...gainersRaw, ...losersRaw];

  // Fetch OI for top movers that don't have it (from Binance, per-symbol)
  const oiResults = await Promise.allSettled(
    allTopMovers.map((entry) => {
      if (entry.raw.open_interest) return Promise.resolve(null);
      return fetchBinanceOI(getBinanceSymbol(entry.raw));
    })
  );

  const oiMap = new Map<string, number>();
  allTopMovers.forEach((entry, i) => {
    const r = oiResults[i]!;
    if (r.status === "fulfilled" && r.value != null) {
      // Convert from coin quantity to USD
      oiMap.set(entry.raw.symbol, r.value * entry.raw.price);
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
    const oi = raw.open_interest ?? oiMap.get(raw.symbol);
    return {
      symbol: raw.symbol,
      base_symbol: raw.base_symbol,
      exchange: raw.exchange,
      price: raw.price,
      change_pct: entry.change_pct,
      volume_24h_usd: raw.volume_24h_usd,
      market_cap: lookupMarketCap(raw.base_symbol, marketCaps),
      open_interest: oi,
      funding_rate: raw.funding_rate,
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
