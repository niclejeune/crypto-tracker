import { NextResponse } from "next/server";
import { getAggregatedTickers } from "@/lib/aggregator";

export const revalidate = 15;

export async function GET() {
  try {
    const data = await getAggregatedTickers();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Ticker aggregation failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch tickers" },
      { status: 500 }
    );
  }
}
