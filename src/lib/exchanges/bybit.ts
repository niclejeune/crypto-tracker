import type { RawTicker } from "./types";
import type { Candle } from "../types";

const BASE_URL = "https://api.bybit.com";

interface BybitTickerItem {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string;
  turnover24h: string;
  fundingRate: string;
  openInterest: string;
}

interface BybitResponse<T> {
  retCode: number;
  result: { list: T[] };
}

export async function fetchBybitTickers(): Promise<RawTicker[]> {
  const res = await fetch(
    `${BASE_URL}/v5/market/tickers?category=linear`,
    { next: { revalidate: 15 } }
  );
  if (!res.ok) throw new Error(`Bybit tickers failed: ${res.status}`);

  const data: BybitResponse<BybitTickerItem> = await res.json();

  return data.result.list
    .filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => ({
      symbol: t.symbol,
      base_symbol: t.symbol.replace("USDT", ""),
      exchange: "bybit",
      price: parseFloat(t.lastPrice),
      price_change_24h: parseFloat(t.price24hPcnt) * 100,
      volume_24h_usd: parseFloat(t.turnover24h),
      funding_rate: parseFloat(t.fundingRate),
      open_interest: parseFloat(t.openInterest),
    }));
}

interface BybitKlineItem {
  0: string; // start time
  1: string; // open
  2: string; // high
  3: string; // low
  4: string; // close
  5: string; // turnover (USD volume)
}

export async function fetchBybitCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Candle[]> {
  const res = await fetch(
    `${BASE_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Bybit candles failed: ${res.status}`);

  const data: BybitResponse<BybitKlineItem> = await res.json();

  // Bybit returns descending order, reverse to ascending
  return data.result.list.map((k) => ({
    openTime: parseInt(k[0]),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: k[5] ? parseFloat(k[5]) : undefined,
  })).reverse();
}
