import { fetchBinanceTickers, fetchBinanceCandles } from "./exchanges/binance";
import { fetchBybitTickers } from "./exchanges/bybit";
import { fetchMarketCaps } from "./exchanges/coingecko";
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
      // Keep highest volume ticker but merge in funding/OI from other sources
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
    const binanceSymbol = ticker.symbol.includes("USDT")
      ? ticker.symbol
      : `${ticker.base_symbol}USDT`;
    const candles = await fetchBinanceCandles(binanceSymbol, "1d", 100);
    const levels = computeSRLevels(candles, "1d");
    return findNearbyLevels(ticker.price, levels, SR_THRESHOLD_PCT);
  } catch {
    return [];
  }
}

function toTickerData(
  raw: RawTicker,
  changePct: number,
  marketCaps: Map<string, number>
): TickerData {
  return {
    symbol: raw.symbol,
    base_symbol: raw.base_symbol,
    exchange: raw.exchange,
    price: raw.price,
    change_pct: changePct,
    volume_24h_usd: raw.volume_24h_usd,
    market_cap: marketCaps.get(raw.base_symbol),
    open_interest: raw.open_interest,
    funding_rate: raw.funding_rate,
    near_sr: [],
    links: {
      coinglass_heatmap: getCoinglassHeatmapUrl(raw.base_symbol),
      coinglass_funding: getCoinglassFundingUrl(raw.base_symbol),
      coinglass_oi: getCoinglassOIUrl(raw.base_symbol),
      tradingview: getTradingViewUrl(raw.symbol, raw.exchange),
    },
  };
}

export async function getAggregatedTickers(
  tf: Timeframe = "1d"
): Promise<TickerResponse> {
  // Fetch tickers + market caps in parallel
  const [tickerResults, marketCaps] = await Promise.all([
    Promise.allSettled([fetchBinanceTickers(), fetchBybitTickers()]),
    fetchMarketCaps(),
  ]);

  const allTickers: RawTicker[] = [];
  for (const r of tickerResults) {
    if (r.status === "fulfilled") allTickers.push(...r.value);
  }

  const deduped = dedupeByBaseSymbol(allTickers);

  if (tf === "1d") {
    const sorted = [...deduped].sort(
      (a, b) => b.price_change_24h - a.price_change_24h
    );

    const gainersRaw = sorted.slice(0, TOP_N);
    const losersRaw = sorted.slice(-TOP_N).reverse();

    return await enrichWithSR(gainersRaw, losersRaw, tf, (raw) =>
      toTickerData(raw, raw.price_change_24h, marketCaps)
    );
  }

  // For other timeframes: compute change % from candles
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

  const changeResults = await Promise.allSettled(
    uniqueCandidates.map((t) => {
      const binanceSymbol = t.symbol.includes("USDT")
        ? t.symbol
        : `${t.base_symbol}USDT`;
      return computeChangePct(binanceSymbol, t.price, tf);
    })
  );

  const withChange = uniqueCandidates
    .map((t, i) => {
      const r = changeResults[i]!;
      const pct = r.status === "fulfilled" ? r.value : null;
      return { raw: t, change_pct: pct ?? t.price_change_24h };
    })
    .sort((a, b) => b.change_pct - a.change_pct);

  const gainersRaw = withChange.slice(0, TOP_N);
  const losersRaw = withChange.slice(-TOP_N).reverse();

  return await enrichWithSR(
    gainersRaw.map((g) => g.raw),
    losersRaw.map((l) => l.raw),
    tf,
    (raw) => {
      const entry = withChange.find((w) => w.raw.symbol === raw.symbol);
      return toTickerData(
        raw,
        entry?.change_pct ?? raw.price_change_24h,
        marketCaps
      );
    }
  );
}

async function enrichWithSR(
  gainersRaw: RawTicker[],
  losersRaw: RawTicker[],
  tf: Timeframe,
  convert: (raw: RawTicker) => TickerData
): Promise<TickerResponse> {
  const topMovers = [...gainersRaw, ...losersRaw];

  const srResults = await Promise.allSettled(
    topMovers.map((t) => computeSRForTicker(t))
  );

  const srMap = new Map<
    string,
    Awaited<ReturnType<typeof computeSRForTicker>>
  >();
  topMovers.forEach((t, i) => {
    const r = srResults[i]!;
    if (r.status === "fulfilled") srMap.set(t.symbol, r.value);
  });

  const gainers = gainersRaw.map((raw) => {
    const td = convert(raw);
    td.near_sr = srMap.get(raw.symbol) ?? [];
    return td;
  });

  const losers = losersRaw.map((raw) => {
    const td = convert(raw);
    td.near_sr = srMap.get(raw.symbol) ?? [];
    return td;
  });

  return {
    timeframe: tf,
    updated_at: new Date().toISOString(),
    gainers,
    losers,
  };
}
