import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAggregatedTickers, VALID_TIMEFRAMES } from "@/lib/aggregator";
import type { Timeframe } from "@/lib/aggregator";

export const revalidate = 15;

export async function GET(request: NextRequest) {
  const tf = request.nextUrl.searchParams.get("tf") ?? "1d";

  if (!VALID_TIMEFRAMES.includes(tf as Timeframe)) {
    return NextResponse.json(
      { error: `Invalid timeframe. Valid: ${VALID_TIMEFRAMES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const data = await getAggregatedTickers(tf as Timeframe);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Ticker aggregation failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch tickers" },
      { status: 500 }
    );
  }
}
