import type { RawTicker } from "./types";
import type { Candle } from "../types";

const BASE_URL = "https://contract.mexc.com";

interface MexcTickerItem {
  symbol: string;
  lastPrice: number;
  riseFallRate: number;
  amount24: number;
  holdVol: number;
  fundingRate: number;
}

interface MexcTickerResponse {
  success: boolean;
  data: MexcTickerItem[];
}

function toCanonical(mexcSymbol: string): string {
  return mexcSymbol.replace("_", "");
}

function toMexcSymbol(canonical: string): string {
  // BTCUSDT → BTC_USDT
  const base = canonical.replace("USDT", "");
  return `${base}_USDT`;
}

export async function fetchMexcTickers(): Promise<RawTicker[]> {
  const res = await fetch(`${BASE_URL}/api/v1/contract/ticker`, {
    next: { revalidate: 15 },
  });
  if (!res.ok) throw new Error(`MEXC tickers failed: ${res.status}`);

  const data: MexcTickerResponse = await res.json();
  if (!data.success || !data.data) return [];

  return data.data
    .filter((t) => t.symbol.endsWith("_USDT"))
    .map((t) => {
      const symbol = toCanonical(t.symbol);
      return {
        symbol,
        base_symbol: symbol.replace("USDT", ""),
        exchange: "mexc",
        price: t.lastPrice,
        price_change_24h: t.riseFallRate * 100,
        volume_24h_usd: t.amount24,
        funding_rate: t.fundingRate,
      };
    });
}

const INTERVAL_MAP: Record<string, string> = {
  "1m": "Min1",
  "5m": "Min5",
  "15m": "Min15",
  "1h": "Min60",
  "4h": "Hour4",
  "1d": "Day1",
  "1w": "Week1",
};

interface MexcKlineResponse {
  success: boolean;
  data: {
    time: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    vol?: number[];
  };
}

export async function fetchMexcCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Candle[]> {
  const mexcInterval = INTERVAL_MAP[interval];
  if (!mexcInterval) return [];

  const mexcSymbol = toMexcSymbol(symbol);

  const res = await fetch(
    `${BASE_URL}/api/v1/contract/kline/${mexcSymbol}?interval=${mexcInterval}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`MEXC candles failed: ${res.status}`);

  const data: MexcKlineResponse = await res.json();
  if (!data.success || !data.data?.time) return [];

  // MEXC returns up to 2000 candles in ascending order, timestamps in seconds.
  // Take only the last `limit` candles and convert timestamps to milliseconds.
  const total = data.data.time.length;
  const start = Math.max(0, total - limit);
  const candles: Candle[] = [];
  for (let i = start; i < total; i++) {
    candles.push({
      openTime: data.data.time[i]! * 1000,
      open: data.data.open[i]!,
      high: data.data.high[i]!,
      low: data.data.low[i]!,
      close: data.data.close[i]!,
      volume: data.data.vol?.[i],
    });
  }

  return candles;
}
