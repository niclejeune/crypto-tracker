import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchCandlesForTicker, TF_CANDLE_CONFIG, VALID_TIMEFRAMES } from "@/lib/aggregator";
import type { Timeframe } from "@/lib/aggregator";

export const revalidate = 60;

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols");
  const tf = request.nextUrl.searchParams.get("tf") ?? "1d";

  if (!symbols) {
    return NextResponse.json({ error: "symbols param required" }, { status: 400 });
  }

  if (!VALID_TIMEFRAMES.includes(tf as Timeframe)) {
    return NextResponse.json({ error: "Invalid timeframe" }, { status: 400 });
  }

  const config = TF_CANDLE_CONFIG[tf as Timeframe];

  const symbolList = symbols.split(",").slice(0, 10); // Max 10 lines

  const results = await Promise.allSettled(
    symbolList.map(async (symbol) => {
      const candles = await fetchCandlesForTicker(
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
    .filter((s) => s.points.length > 0);

  return NextResponse.json({ timeframe: tf, series });
}
