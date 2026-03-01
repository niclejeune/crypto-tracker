import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchBinanceCandles } from "@/lib/exchanges/binance";

export const revalidate = 60;

// Number of candles per timeframe to show a meaningful spaghetti chart
const TF_CANDLE_COUNT: Record<string, { interval: string; limit: number }> = {
  "5m": { interval: "1m", limit: 5 },
  "15m": { interval: "1m", limit: 15 },
  "1h": { interval: "5m", limit: 12 },
  "4h": { interval: "15m", limit: 16 },
  "1d": { interval: "1h", limit: 24 },
  "1w": { interval: "4h", limit: 42 },
};

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
      const candles = await fetchBinanceCandles(
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
    .map((r) => (r as PromiseFulfilledResult<{ symbol: string; points: { time: number; pct: number }[] }>).value);

  return NextResponse.json({ timeframe: tf, series });
}
