import type { RawTicker } from "./types";
import type { Candle } from "../types";

const BASE_URL = "https://fapi.bitunix.com";

interface BitunixTickerItem {
  symbol: string;
  lastPrice: string;
  quoteVol: string;
  open: string;
}

interface BitunixResponse<T> {
  code: number;
  data: T;
}

export async function fetchBitunixTickers(): Promise<RawTicker[]> {
  const res = await fetch(`${BASE_URL}/api/v1/futures/market/tickers`, {
    next: { revalidate: 15 },
  });
  if (!res.ok) throw new Error(`Bitunix tickers failed: ${res.status}`);

  const data: BitunixResponse<BitunixTickerItem[]> = await res.json();
  if (!data.data) return [];

  return data.data
    .filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => {
      const price = parseFloat(t.lastPrice);
      const openPrice = parseFloat(t.open);
      const change24h = openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : 0;

      return {
        symbol: t.symbol,
        base_symbol: t.symbol.replace("USDT", ""),
        exchange: "bitunix",
        price,
        price_change_24h: change24h,
        volume_24h_usd: parseFloat(t.quoteVol),
      };
    });
}

interface BitunixFundingResponse {
  code: number;
  data: { fundingRate: string };
}

export async function fetchBitunixFunding(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/futures/market/funding_rate?symbol=${symbol}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data: BitunixFundingResponse = await res.json();
    if (!data.data?.fundingRate) return null;
    return parseFloat(data.data.fundingRate);
  } catch {
    return null;
  }
}

interface BitunixKlineItem {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  vol?: string;
}

export async function fetchBitunixCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Candle[]> {
  const res = await fetch(
    `${BASE_URL}/api/v1/futures/market/kline?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Bitunix candles failed: ${res.status}`);

  const data: BitunixResponse<BitunixKlineItem[]> = await res.json();
  if (!data.data) return [];

  // Bitunix returns descending order (newest first), reverse to ascending
  return data.data.map((k) => ({
    openTime: parseInt(k.time),
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: k.vol ? parseFloat(k.vol) : undefined,
  })).reverse();
}
