"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TickerData } from "@/lib/types";

const GAINER_COLORS = ["#22c55e", "#4ade80", "#86efac", "#a3e635", "#34d399"];
const LOSER_COLORS = ["#ef4444", "#f87171", "#fca5a5", "#fb923c", "#f472b6"];

interface SpaghettiChartProps {
  gainers: TickerData[];
  losers: TickerData[];
  timeframe: string;
}

interface ChartSeries {
  symbol: string;
  points: { time: number; pct: number }[];
}

interface ChartResponse {
  timeframe: string;
  series: ChartSeries[];
}

function formatTime(timestamp: number, tf: string): string {
  const d = new Date(timestamp);
  if (tf === "1w") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

interface SymbolMeta {
  symbol: string;
  base: string;
  color: string;
  side: "gainer" | "loser";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  // Sort by value descending
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...payload].sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div className="bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-gray-400 mb-1.5 font-medium">{label}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {sorted.map((entry: any) => {
        const val = entry.value as number;
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-300">{entry.name}</span>
            </div>
            <span className={val >= 0 ? "text-emerald-400 font-mono" : "text-red-400 font-mono"}>
              {val > 0 ? "+" : ""}{val.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SpaghettiChart({ gainers, losers, timeframe }: SpaghettiChartProps) {
  const topGainers = gainers.slice(0, 5);
  const topLosers = losers.slice(0, 5);

  const symbolMetas: SymbolMeta[] = [
    ...topGainers.map((t, i) => ({
      symbol: t.symbol,
      base: t.base_symbol,
      color: GAINER_COLORS[i]!,
      side: "gainer" as const,
    })),
    ...topLosers.map((t, i) => ({
      symbol: t.symbol,
      base: t.base_symbol,
      color: LOSER_COLORS[i]!,
      side: "loser" as const,
    })),
  ];

  const symbols = symbolMetas.map((m) => m.symbol).join(",");

  const { data, isLoading } = useQuery<ChartResponse>({
    queryKey: ["chart", symbols, timeframe],
    queryFn: () =>
      fetch(`/api/chart?symbols=${symbols}&tf=${timeframe}`).then((r) => r.json()),
    refetchInterval: 60_000,
    enabled: symbols.length > 0,
  });

  // Filter symbolMetas to only those with actual chart data
  const activeSymbols = new Set(data?.series.map((s) => s.symbol) ?? []);
  const activeSymbolMetas = symbolMetas.filter((m) => activeSymbols.has(m.symbol));

  if (isLoading || !data || data.series.length === 0) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-400">Top Movers</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center text-gray-600 text-sm">
          {isLoading ? "Loading chart..." : "No chart data"}
        </CardContent>
      </Card>
    );
  }

  // Build unified data points
  const allTimes = new Set<number>();
  for (const s of data.series) {
    for (const p of s.points) allTimes.add(p.time);
  }
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const chartData = sortedTimes.map((time) => {
    const row: Record<string, number | string> = {
      time,
      label: formatTime(time, timeframe),
    };
    for (const s of data.series) {
      const meta = activeSymbolMetas.find((m) => m.symbol === s.symbol);
      const key = meta?.base ?? s.symbol;
      const point = s.points.find((p) => p.time === time);
      if (point) row[key] = Math.round(point.pct * 100) / 100;
    }
    return row;
  });

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-gray-400">
          Top Movers — % Change ({timeframe.toUpperCase()})
        </CardTitle>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {activeSymbolMetas.map((m) => {
            const series = data.series.find((s) => s.symbol === m.symbol);
            const lastPct = series?.points[series.points.length - 1]?.pct ?? 0;
            return (
              <div key={m.symbol} className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-2.5 h-0.5 rounded-full"
                  style={{ backgroundColor: m.color }}
                />
                <span className="text-gray-400">{m.base}</span>
                <span className={lastPct >= 0 ? "text-emerald-400 font-mono" : "text-red-400 font-mono"}>
                  {lastPct > 0 ? "+" : ""}{lastPct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
              width={48}
            />
            <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1.5} />
            <Tooltip content={<CustomTooltip />} />
            {activeSymbolMetas.map((m) => (
              <Line
                key={m.symbol}
                type="monotone"
                dataKey={m.base}
                name={m.base}
                stroke={m.color}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
