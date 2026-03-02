import { NextResponse } from "next/server";
import { fetchAllTickers } from "@/lib/aggregator";
import { detectSignals } from "@/lib/signals";
import type { SignalResponse } from "@/lib/types";

export const revalidate = 30;

export async function GET() {
  try {
    const { tickers, marketCaps } = await fetchAllTickers();
    const results = await detectSignals(tickers, marketCaps);

    const response: SignalResponse = {
      updated_at: new Date().toISOString(),
      results,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Signal detection failed:", error);
    return NextResponse.json(
      { error: "Failed to compute signals" },
      { status: 500 }
    );
  }
}
