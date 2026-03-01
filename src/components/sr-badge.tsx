"use client";

import type { ProximityResult } from "@/lib/types";

const TF_PRIORITY: Record<string, number> = { "1w": 3, "1d": 2, "4h": 1 };

interface SRBadgeProps {
  nearSR: ProximityResult[];
}

export function SRBadge({ nearSR }: SRBadgeProps) {
  if (nearSR.length === 0) {
    return <span className="text-gray-600 text-xs">—</span>;
  }

  const hasSupport = nearSR.some((s) => s.type === "support");
  const hasResistance = nearSR.some((s) => s.type === "resistance");
  const isCompression = hasSupport && hasResistance;

  if (isCompression) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300" title="Compression zone">
        Squeeze
      </span>
    );
  }

  const sorted = [...nearSR].sort(
    (a, b) => (TF_PRIORITY[b.timeframe] ?? 0) - (TF_PRIORITY[a.timeframe] ?? 0)
  );
  const top = sorted[0]!;

  const colorClass =
    top.type === "resistance"
      ? "bg-red-900/50 text-red-300"
      : "bg-emerald-900/50 text-emerald-300";

  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${colorClass}`}
      title={`${top.timeframe.toUpperCase()} ${top.type} @ $${top.level.toLocaleString()} (${top.distance_pct.toFixed(1)}%)`}
    >
      {top.timeframe.toUpperCase()} {top.type === "resistance" ? "Res" : "Sup"}
    </span>
  );
}
