import type { Candle, SRLevel, ProximityResult } from "./types";

function detectSwingLevels(candles: Candle[], timeframe: string): SRLevel[] {
  const levels: SRLevel[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const curr = candles[i]!;
    const prevHighs = [candles[i - 1]!.high, candles[i - 2]!.high];
    const nextHighs = [candles[i + 1]!.high, candles[i + 2]!.high];
    const prevLows = [candles[i - 1]!.low, candles[i - 2]!.low];
    const nextLows = [candles[i + 1]!.low, candles[i + 2]!.low];

    if (
      curr.high > Math.max(...prevHighs) &&
      curr.high > Math.max(...nextHighs)
    ) {
      levels.push({ price: curr.high, type: "resistance", strength: 1, timeframe });
    }

    if (
      curr.low < Math.min(...prevLows) &&
      curr.low < Math.min(...nextLows)
    ) {
      levels.push({ price: curr.low, type: "support", strength: 1, timeframe });
    }
  }

  return levels;
}

function clusterLevels(levels: SRLevel[], clusterPct: number = 0.5): SRLevel[] {
  if (levels.length === 0) return [];

  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clustered: SRLevel[] = [];
  let cluster: SRLevel[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = cluster[cluster.length - 1]!;
    const pctDiff = (Math.abs(sorted[i]!.price - prev.price) / prev.price) * 100;

    if (pctDiff <= clusterPct && sorted[i]!.type === prev.type) {
      cluster.push(sorted[i]!);
    } else {
      const avgPrice = cluster.reduce((sum, l) => sum + l.price, 0) / cluster.length;
      clustered.push({
        price: Math.round(avgPrice * 100) / 100,
        type: cluster[0]!.type,
        strength: cluster.length,
        timeframe: cluster[0]!.timeframe,
      });
      cluster = [sorted[i]!];
    }
  }

  const avgPrice = cluster.reduce((sum, l) => sum + l.price, 0) / cluster.length;
  clustered.push({
    price: Math.round(avgPrice * 100) / 100,
    type: cluster[0]!.type,
    strength: cluster.length,
    timeframe: cluster[0]!.timeframe,
  });

  return clustered;
}

export function findNearbyLevels(
  currentPrice: number,
  levels: SRLevel[],
  thresholdPct: number = 1.5
): ProximityResult[] {
  return levels
    .map((level) => {
      // Polarity flip: if price is below the level, it acts as resistance
      // regardless of how it was originally detected. If price is above, it's support.
      const effectiveType: "support" | "resistance" =
        currentPrice < level.price ? "resistance" : "support";

      return {
        timeframe: level.timeframe,
        type: effectiveType,
        level: level.price,
        distance_pct:
          Math.round(
            (Math.abs(currentPrice - level.price) / level.price) * 10000
          ) / 100,
        strength: level.strength,
      };
    })
    .filter((r) => r.distance_pct <= thresholdPct)
    .sort((a, b) => a.distance_pct - b.distance_pct);
}

export function computeSRLevels(
  candles: Candle[],
  timeframe: string,
  clusterPct: number = 0.5
): SRLevel[] {
  const raw = detectSwingLevels(candles, timeframe);
  return clusterLevels(raw, clusterPct);
}
