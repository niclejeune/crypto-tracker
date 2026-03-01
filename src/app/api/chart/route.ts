import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchBinanceCandles } from "@/lib/exchanges/binance";
import { fetchBybitCandles } from "@/lib/exchanges/bybit";
import type { Candle } from "@/lib/types";

export const revalidate = 60;

// Binance interval → Bybit interval mapping
const BYBIT_INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
};

// Number of candles per timeframe to show a meaningful spaghetti chart
const TF_CANDLE_COUNT: Record<string, { interval: string; limit: number }> = {
  "5m": { interval: "1m", limit: 5 },
  "15m": { interval: "1m", limit: 15 },
  "1h": { interval: "5m", limit: 12 },
  "4h": { interval: "15m", limit: 16 },
  "1d": { interval: "1h", limit: 24 },
  "1w": { interval: "4h", limit: 42 },
};

async function fetchCandlesWithFallback(
  symbol: string,
  binanceInterval: string,
  limit: number
): Promise<Candle[]> {
  // Try Binance first
  try {
    const candles = await fetchBinanceCandles(symbol, binanceInterval, limit);
    // Check candles have actual price movement (Binance returns stale zero-volume candles for suspended symbols)
    const hasVolume = candles.some((c) => c.open !== c.close || c.high !== c.low);
    if (candles.length >= 2 && hasVolume) return candles;
  } catch {
    // Binance failed, try Bybit
  }

  // Fallback to Bybit
  const bybitInterval = BYBIT_INTERVAL_MAP[binanceInterval];
  if (!bybitInterval) return [];

  try {
    const candles = await fetchBybitCandles(symbol, bybitInterval, limit);
    // Bybit returns descending order, reverse to ascending
    return candles.reverse();
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols");
  const tf = request.nextUrl.searchParams.get("tf") ?? "1d";

  if (!symbols) {
    return NextResponse.json({ error: "symbols param required" }, { status: 400 });
  }

  const config = TF_CANDLE_COUNT[tf];
  if (!config) {
    return NextResponse.json({ error: "Invalid timeframe" }, { status: 400 });
  }

  const symbolList = symbols.split(",").slice(0, 10); // Max 10 lines

  const results = await Promise.allSettled(
    symbolList.map(async (symbol) => {
      const candles = await fetchCandlesWithFallback(
        symbol,
        config.interval,
        config.limit + 1 // +1 to get the reference candle
      );

      if (candles.length < 2) return { symbol, points: [] };

      const refPrice = candles[0]!.open;
      const points = candles.map((c) => ({
        time: c.openTime,
        pct: ((c.close - refPrice) / refPrice) * 100,
      }));

      return { symbol, points };
    })
  );

  const series = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => (r as PromiseFulfilledResult<{ symbol: string; points: { time: number; pct: number }[] }>).value)
    .filter((s) => s.points.length > 0); // Exclude symbols with no data

  return NextResponse.json({ timeframe: tf, series });
}
