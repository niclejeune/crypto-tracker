import type { RawTicker } from "./types";
import type { Candle } from "../types";

const BASE_URL = "https://fapi.binance.com";

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

export async function fetchBinanceTickers(): Promise<RawTicker[]> {
  const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr`, {
    next: { revalidate: 15 },
  });
  if (!res.ok) throw new Error(`Binance tickers failed: ${res.status}`);

  const data: BinanceTicker[] = await res.json();

  return data
    .filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => ({
      symbol: t.symbol,
      base_symbol: t.symbol.replace("USDT", ""),
      exchange: "binance",
      price: parseFloat(t.lastPrice),
      price_change_24h: parseFloat(t.priceChangePercent),
      volume_24h_usd: parseFloat(t.quoteVolume),
    }));
}

interface BinanceKline {
  0: number; // open time
  1: string; // open
  2: string; // high
  3: string; // low
  4: string; // close
}

export async function fetchBinanceCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Candle[]> {
  const res = await fetch(
    `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Binance candles failed: ${res.status}`);

  const data: BinanceKline[] = await res.json();

  return data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}
