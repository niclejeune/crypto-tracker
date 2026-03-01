"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, ReferenceLine, CartesianGrid } from "recharts";
import type { TickerData } from "@/lib/types";

// Distinct colors for up to 10 lines
const LINE_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#6366f1",
];

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
  if (tf === "1d") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function SpaghettiChart({ gainers, losers, timeframe }: SpaghettiChartProps) {
  const topGainers = gainers.slice(0, 5);
  const topLosers = losers.slice(0, 5);
  const topMovers = [...topGainers, ...topLosers];
  const symbols = topMovers.map((t) => t.symbol).join(",");

  const { data, isLoading } = useQuery<ChartResponse>({
    queryKey: ["chart", symbols, timeframe],
    queryFn: () =>
      fetch(`/api/chart?symbols=${symbols}&tf=${timeframe}`).then((r) =>
        r.json()
      ),
    refetchInterval: 60_000,
    enabled: symbols.length > 0,
  });

  if (isLoading || !data || data.series.length === 0) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-400">Top Movers — % Change Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center text-gray-600 text-sm">
          {isLoading ? "Loading chart data..." : "No chart data"}
        </CardContent>
      </Card>
    );
  }

  // Build unified data points: each row = one timestamp with all symbols' pct values
  const allTimes = new Set<number>();
  for (const s of data.series) {
    for (const p of s.points) allTimes.add(p.time);
  }
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const chartData = sortedTimes.map((time) => {
    const row: Record<string, number | string> = { time, label: formatTime(time, timeframe) };
    for (const s of data.series) {
      const point = s.points.find((p) => p.time === time);
      if (point) row[s.symbol] = Math.round(point.pct * 100) / 100;
    }
    return row;
  });

  // Build chart config for shadcn
  const chartConfig: Record<string, { label: string; color: string }> = {};
  data.series.forEach((s, i) => {
    const base = s.symbol.replace("USDT", "");
    chartConfig[s.symbol] = {
      label: base,
      color: LINE_COLORS[i % LINE_COLORS.length]!,
    };
  });

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-gray-400">
          Top Movers — % Change ({timeframe.toUpperCase()})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-72 w-full">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
              width={50}
            />
            <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => `${Number(value) > 0 ? "+" : ""}${value}%`}
                />
              }
            />
            {data.series.map((s, i) => (
              <Line
                key={s.symbol}
                type="monotone"
                dataKey={s.symbol}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartContainer>
        <div className="flex flex-wrap gap-3 mt-3 px-2">
          {data.series.map((s, i) => {
            const ticker = topMovers.find((t) => t.symbol === s.symbol);
            const lastPct = s.points[s.points.length - 1]?.pct ?? 0;
            return (
              <div key={s.symbol} className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }}
                />
                <span className="text-gray-300">{ticker?.base_symbol ?? s.symbol.replace("USDT", "")}</span>
                <span className={lastPct >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {lastPct > 0 ? "+" : ""}{lastPct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
