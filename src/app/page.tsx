"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TickerResponse } from "@/lib/types";
import { TickerTable } from "@/components/ticker-table";
import { TimeframeTabs } from "@/components/timeframe-tabs";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d", "1w"] as const;

export default function Home() {
  const [tf, setTf] = useState<string>("1d");

  const { data, isLoading, error, dataUpdatedAt } = useQuery<TickerResponse>({
    queryKey: ["tickers", tf],
    queryFn: () => fetch(`/api/tickers?tf=${tf}`).then((r) => r.json()),
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Crypto Perp Scanner</h1>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          {dataUpdatedAt > 0 && (
            <span>
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </header>

      <TimeframeTabs
        timeframes={TIMEFRAMES as unknown as string[]}
        active={tf}
        onChange={setTf}
      />

      {isLoading && (
        <div className="text-center py-20 text-gray-500">
          Loading exchange data...
        </div>
      )}

      {error && (
        <div className="text-center py-20 text-red-400">
          Failed to load data. Retrying...
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold text-emerald-400 mb-3">
              Top Gainers ({tf.toUpperCase()})
            </h2>
            <TickerTable tickers={data.gainers} side="gainers" />
          </section>

          <section>
            <h2 className="text-lg font-semibold text-red-400 mb-3">
              Top Losers ({tf.toUpperCase()})
            </h2>
            <TickerTable tickers={data.losers} side="losers" />
          </section>
        </div>
      )}
    </div>
  );
}
