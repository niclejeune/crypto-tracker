import { fetchBinanceTickers, fetchBinanceCandles } from "./exchanges/binance";
import { fetchBybitTickers } from "./exchanges/bybit";
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

function dedupeByBaseSymbol(tickers: RawTicker[]): RawTicker[] {
  const seen = new Map<string, RawTicker>();
  for (const t of tickers) {
    const existing = seen.get(t.base_symbol);
    if (!existing || t.volume_24h_usd > existing.volume_24h_usd) {
      seen.set(t.base_symbol, t);
    }
  }
  return Array.from(seen.values());
}

async function computeSRForTicker(ticker: RawTicker) {
  try {
    const candles = await fetchBinanceCandles(
      ticker.symbol.includes("USDT") ? ticker.symbol : `${ticker.base_symbol}USDT`,
      "1d",
      100
    );
    const levels = computeSRLevels(candles, "1d");
    return findNearbyLevels(ticker.price, levels, SR_THRESHOLD_PCT);
  } catch {
    return [];
  }
}

function toTickerData(raw: RawTicker): TickerData {
  return {
    symbol: raw.symbol,
    base_symbol: raw.base_symbol,
    exchange: raw.exchange,
    price: raw.price,
    price_change_24h: raw.price_change_24h,
    volume_24h_usd: raw.volume_24h_usd,
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

export async function getAggregatedTickers(): Promise<TickerResponse> {
  const results = await Promise.allSettled([
    fetchBinanceTickers(),
    fetchBybitTickers(),
  ]);

  const allTickers: RawTicker[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") allTickers.push(...r.value);
  }

  const deduped = dedupeByBaseSymbol(allTickers);

  const sorted = [...deduped].sort(
    (a, b) => b.price_change_24h - a.price_change_24h
  );

  const gainersRaw = sorted.slice(0, TOP_N);
  const losersRaw = sorted.slice(-TOP_N).reverse();
  const topMovers = [...gainersRaw, ...losersRaw];

  const srResults = await Promise.allSettled(
    topMovers.map((t) => computeSRForTicker(t))
  );

  const srMap = new Map<string, Awaited<ReturnType<typeof computeSRForTicker>>>();
  topMovers.forEach((t, i) => {
    const r = srResults[i]!;
    if (r.status === "fulfilled") srMap.set(t.symbol, r.value);
  });

  const gainers = gainersRaw.map((raw) => {
    const td = toTickerData(raw);
    td.near_sr = srMap.get(raw.symbol) ?? [];
    return td;
  });

  const losers = losersRaw.map((raw) => {
    const td = toTickerData(raw);
    td.near_sr = srMap.get(raw.symbol) ?? [];
    return td;
  });

  return {
    timeframe: "24h",
    updated_at: new Date().toISOString(),
    gainers,
    losers,
  };
}
