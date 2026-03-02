import type { RawTicker } from "./exchanges/types";
import type { Candle, Signal, SignalResult, SignalDirection, SRLevel } from "./types";
import { fetchCandlesForTicker } from "./aggregator";
import { computeSRLevels } from "./sr-engine";
import {
  getCoinglassHeatmapUrl,
  getCoinglassFundingUrl,
  getCoinglassOIUrl,
  getTradingViewUrl,
} from "./links";
import { fetchNewsSentiment } from "./news-sentiment";

// =============================================================================
// Signal Persistence Cache (Anti-Flicker)
// =============================================================================

interface CachedSignal {
  result: SignalResult;
  firstSeen: number;
  lastConfirmed: number;
  maxExpiry: number; // absolute cap (firstSeen + 8h)
}

const signalCache = new Map<string, CachedSignal>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;       // 4 hours initial
const CACHE_RECONFIRM_MS = 2 * 60 * 60 * 1000;  // +2h on re-confirmation
const CACHE_MAX_TTL_MS = 8 * 60 * 60 * 1000;    // 8h absolute max
const CACHE_MAX_ENTRIES = 200;
const SCORE_DECAY_PER_HOUR = 1;

function getCacheKey(symbol: string, direction: SignalDirection): string {
  return `${symbol}:${direction}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of signalCache) {
    const ttl = Math.min(entry.lastConfirmed + CACHE_TTL_MS, entry.maxExpiry);
    if (now > ttl) signalCache.delete(key);
  }
  // Safety valve
  if (signalCache.size > CACHE_MAX_ENTRIES) {
    const sorted = [...signalCache.entries()].sort(
      (a, b) => a[1].lastConfirmed - b[1].lastConfirmed
    );
    const toRemove = sorted.slice(0, signalCache.size - CACHE_MAX_ENTRIES);
    for (const [key] of toRemove) signalCache.delete(key);
  }
}

function cacheSignal(result: SignalResult): void {
  const key = getCacheKey(result.symbol, result.direction);
  const oppositeKey = getCacheKey(
    result.symbol,
    result.direction === "long" ? "short" : "long"
  );
  // Evict opposite direction
  signalCache.delete(oppositeKey);

  const now = Date.now();
  const existing = signalCache.get(key);
  if (existing) {
    // Re-confirmation: extend TTL, update result
    existing.lastConfirmed = now;
    existing.result = result;
  } else {
    signalCache.set(key, {
      result,
      firstSeen: now,
      lastConfirmed: now,
      maxExpiry: now + CACHE_MAX_TTL_MS,
    });
  }
}

function getCachedSignals(): SignalResult[] {
  pruneCache();
  const now = Date.now();
  const results: SignalResult[] = [];

  for (const entry of signalCache.values()) {
    const hoursSinceConfirmed = (now - entry.lastConfirmed) / (60 * 60 * 1000);
    const decay = Math.floor(hoursSinceConfirmed) * SCORE_DECAY_PER_HOUR;
    const decayedScore = Math.max(0, entry.result.score - decay);
    if (decayedScore < 4) continue;

    const ageMinutes = Math.round((now - entry.firstSeen) / 60000);
    results.push({
      ...entry.result,
      score: decayedScore,
      signal_age_minutes: ageMinutes > 0 ? ageMinutes : undefined,
    });
  }

  return results;
}

// =============================================================================
// Liquidity Gate
// =============================================================================

type LiquidityTier = "skip" | "low" | "normal" | "high";

function getLiquidityTier(volume24h: number): LiquidityTier {
  if (volume24h < 5_000_000) return "skip";
  if (volume24h < 20_000_000) return "low";
  if (volume24h > 200_000_000) return "high";
  return "normal";
}

function applyLiquidityModifier(score: number, tier: LiquidityTier): number {
  if (tier === "low") return Math.min(score, 4);
  if (tier === "high") return Math.round(score * 1.1);
  return score;
}

// =============================================================================
// Ticker-level signals (no candles needed)
// =============================================================================

function detectFundingDivergence(t: RawTicker): Signal | null {
  if (t.funding_rate == null) return null;

  if (t.funding_rate < -0.0001 && t.price_change_24h > 0) {
    return {
      type: "funding_divergence",
      direction: "long",
      weight: 2,
      label: "Negative funding on uptrend",
    };
  }

  if (t.funding_rate > 0.0005 && t.price_change_24h < 0) {
    return {
      type: "funding_divergence",
      direction: "short",
      weight: 2,
      label: "High funding on downtrend",
    };
  }

  return null;
}

function detectOIDivergence(t: RawTicker): Signal | null {
  if (t.open_interest == null || t.volume_24h_usd === 0) return null;

  const oiToVolRatio = t.open_interest / t.volume_24h_usd;

  if (oiToVolRatio > 0.5 && t.price_change_24h < -2) {
    return {
      type: "oi_divergence",
      direction: "long",
      weight: 2,
      label: "High OI on sell-off (squeeze setup)",
    };
  }

  if (oiToVolRatio > 0.5 && t.price_change_24h > 2) {
    return {
      type: "oi_divergence",
      direction: "short",
      weight: 2,
      label: "High OI on rally (squeeze setup)",
    };
  }

  return null;
}

function detectExtremeFunding(t: RawTicker): Signal | null {
  if (t.funding_rate == null) return null;

  // Extremely positive funding = crowded longs, short squeeze incoming
  if (t.funding_rate > 0.01) {
    return {
      type: "extreme_funding",
      direction: "short",
      weight: 3,
      label: `Extreme positive funding (${(t.funding_rate * 100).toFixed(3)}%)`,
    };
  }

  // Extremely negative funding = crowded shorts, long squeeze incoming
  if (t.funding_rate < -0.005) {
    return {
      type: "extreme_funding",
      direction: "long",
      weight: 3,
      label: `Extreme negative funding (${(t.funding_rate * 100).toFixed(3)}%)`,
    };
  }

  return null;
}

// =============================================================================
// Candle-level signals
// =============================================================================

function detectSRRejection(
  candles: Candle[],
  srLevels: { price: number; type: "support" | "resistance" }[]
): Signal | null {
  if (candles.length < 1) return null;
  const curr = candles[candles.length - 1]!;

  for (const level of srLevels) {
    if (level.type === "support") {
      if (curr.low < level.price && curr.close > level.price && curr.open > level.price) {
        return {
          type: "sr_rejection",
          direction: "long",
          weight: 1,
          label: `S/R Hold at support @ ${level.price.toFixed(2)}`,
        };
      }
    }
    if (level.type === "resistance") {
      if (curr.high > level.price && curr.close < level.price && curr.open < level.price) {
        return {
          type: "sr_rejection",
          direction: "short",
          weight: 1,
          label: `S/R Hold at resistance @ ${level.price.toFixed(2)}`,
        };
      }
    }
  }

  return null;
}

function detectVolumeSpike(candles: Candle[]): Signal | null {
  if (candles.length < 21) return null;

  const volumes = candles.slice(-21, -1).map((c) => c.volume).filter((v): v is number => v != null);
  if (volumes.length < 10) return null;

  const curr = candles[candles.length - 1]!;
  if (curr.volume == null) return null;

  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  if (curr.volume < avgVol * 2) return null;

  const isBullish = curr.close > curr.open;
  return {
    type: "volume_spike",
    direction: isBullish ? "long" : "short",
    weight: 1,
    label: `Volume spike (${(curr.volume / avgVol).toFixed(1)}x avg)`,
  };
}

function detectBOS(candles: Candle[]): Signal | null {
  if (candles.length < 10) return null;

  const recent = candles.slice(-20);
  const lastIdx = recent.length - 1;
  const last = recent[lastIdx]!;
  const secondLast = recent[lastIdx - 1]!;

  const swingLows: { price: number; idx: number }[] = [];
  const swingHighs: { price: number; idx: number }[] = [];

  for (let i = 1; i < recent.length - 3; i++) {
    const c = recent[i]!;
    const prev = recent[i - 1]!;
    const next = recent[i + 1]!;

    if (c.low < prev.low && c.low < next.low) {
      swingLows.push({ price: c.low, idx: i });
    }
    if (c.high > prev.high && c.high > next.high) {
      swingHighs.push({ price: c.high, idx: i });
    }
  }

  if (swingLows.length > 0) {
    const sl = swingLows[swingLows.length - 1]!;
    let sweepIdx = -1;
    for (let j = Math.max(sl.idx + 2, lastIdx - 3); j <= lastIdx - 1; j++) {
      if (recent[j]!.low < sl.price) {
        sweepIdx = j;
        break;
      }
    }
    if (sweepIdx >= 0 && last.close > sl.price && secondLast.low < sl.price) {
      return {
        type: "bos",
        direction: "long",
        weight: 3,
        label: "Bullish BOS (liquidity sweep + reclaim)",
      };
    }
  }

  if (swingHighs.length > 0) {
    const sh = swingHighs[swingHighs.length - 1]!;
    let sweepIdx = -1;
    for (let j = Math.max(sh.idx + 2, lastIdx - 3); j <= lastIdx - 1; j++) {
      if (recent[j]!.high > sh.price) {
        sweepIdx = j;
        break;
      }
    }
    if (sweepIdx >= 0 && last.close < sh.price && secondLast.high > sh.price) {
      return {
        type: "bos",
        direction: "short",
        weight: 3,
        label: "Bearish BOS (liquidity sweep + reclaim)",
      };
    }
  }

  return null;
}

function detectFVG(candles: Candle[], currentPrice: number): Signal | null {
  if (candles.length < 5) return null;

  // Tightened: only last 10 candles, and min gap size 0.3% of price
  const recent = candles.slice(-10);
  const minGapSize = currentPrice * 0.003;

  for (let i = recent.length - 2; i >= 1; i--) {
    const before = recent[i - 1]!;
    const after = recent[i + 1]!;

    // Bullish FVG: gap up
    if (before.high < after.low) {
      const gapSize = after.low - before.high;
      if (gapSize < minGapSize) continue;
      const gapTop = after.low;
      const gapBottom = before.high;
      if (currentPrice >= gapBottom && currentPrice <= gapTop * 1.005) {
        return {
          type: "fvg",
          direction: "long",
          weight: 2,
          label: "Bullish FVG (price in gap zone)",
        };
      }
    }

    // Bearish FVG: gap down
    if (before.low > after.high) {
      const gapSize = before.low - after.high;
      if (gapSize < minGapSize) continue;
      const gapTop = before.low;
      const gapBottom = after.high;
      if (currentPrice <= gapTop && currentPrice >= gapBottom * 0.995) {
        return {
          type: "fvg",
          direction: "short",
          weight: 2,
          label: "Bearish FVG (price in gap zone)",
        };
      }
    }
  }

  return null;
}

function detectDisplacement(candles: Candle[]): Signal | null {
  if (candles.length < 16) return null;

  const atrCandles = candles.slice(-15);
  let atrSum = 0;
  for (let i = 1; i < atrCandles.length; i++) {
    const curr = atrCandles[i]!;
    const prev = atrCandles[i - 1]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    atrSum += tr;
  }
  const atr = atrSum / 14;
  if (atr === 0) return null;

  for (let i = candles.length - 4; i >= Math.max(0, candles.length - 10); i--) {
    const c = candles[i]!;
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;

    // Tightened: body must be >70% of total range (wick filter)
    if (range === 0 || body / range < 0.7) continue;

    if (body > 2 * atr) {
      let consolidated = true;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j]!.high - candles[j]!.low > atr * 1.5) {
          consolidated = false;
          break;
        }
      }

      if (consolidated) {
        const isBullish = c.close > c.open;
        return {
          type: "displacement",
          direction: isBullish ? "long" : "short",
          weight: 2,
          label: isBullish
            ? "Bullish displacement + consolidation"
            : "Bearish displacement + consolidation",
        };
      }
    }
  }

  return null;
}

// =============================================================================
// New anticipatory signals
// =============================================================================

function detectPreBreakout(
  candles: Candle[],
  currentPrice: number,
  srLevels: SRLevel[]
): Signal | null {
  if (candles.length < 10 || srLevels.length === 0) return null;

  // Check if price is within 0.3%-2% of a strong S/R level
  for (const level of srLevels) {
    const distPct = Math.abs(currentPrice - level.price) / level.price;
    if (distPct < 0.003 || distPct > 0.02) continue;
    if (level.strength < 2) continue;

    // Check volume building: last 3 candles avg volume > prior 7 candles avg
    const recentCandles = candles.slice(-10);
    const recentVols = recentCandles.slice(-3).map((c) => c.volume ?? 0);
    const priorVols = recentCandles.slice(0, 7).map((c) => c.volume ?? 0);
    const recentAvg = recentVols.reduce((a, b) => a + b, 0) / 3;
    const priorAvg = priorVols.reduce((a, b) => a + b, 0) / 7;
    if (priorAvg === 0 || recentAvg < priorAvg * 1.2) continue;

    // Check compression: candle ranges shrinking (last 3 < prior 7 avg range)
    const recentRanges = recentCandles.slice(-3).map((c) => c.high - c.low);
    const priorRanges = recentCandles.slice(0, 7).map((c) => c.high - c.low);
    const avgRecentRange = recentRanges.reduce((a, b) => a + b, 0) / 3;
    const avgPriorRange = priorRanges.reduce((a, b) => a + b, 0) / 7;
    if (avgPriorRange === 0 || avgRecentRange > avgPriorRange * 0.8) continue;

    const isAbove = currentPrice > level.price;
    return {
      type: "pre_breakout",
      direction: isAbove
        ? (level.type === "resistance" ? "long" : "short")
        : (level.type === "support" ? "short" : "long"),
      weight: 3,
      label: `Pre-breakout near ${level.type} @ ${level.price.toFixed(2)} (${(distPct * 100).toFixed(1)}% away)`,
    };
  }

  return null;
}

function detectRangeCompression(
  candles: Candle[],
  currentPrice: number,
  srLevels: SRLevel[]
): Signal | null {
  if (candles.length < 15) return null;

  // ATR(5) < 0.5x ATR(14) = volatility squeeze
  const atr5 = computeATR(candles, 5);
  const atr14 = computeATR(candles, 14);
  if (atr14 === 0 || atr5 >= atr14 * 0.5) return null;

  // Must be near an S/R level (within 2%)
  const nearbyLevels = srLevels.filter((l) => {
    const dist = Math.abs(currentPrice - l.price) / l.price;
    return dist < 0.02;
  });
  if (nearbyLevels.length === 0) return null;

  const nearest = nearbyLevels.sort(
    (a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price)
  )[0]!;

  // Direction: if near support, expect bounce (long); near resistance, expect rejection (short)
  const direction: SignalDirection =
    nearest.type === "support" ? "long" : "short";

  return {
    type: "range_compression",
    direction,
    weight: 2,
    label: `Range compression near ${nearest.type} @ ${nearest.price.toFixed(2)} (ATR ratio: ${(atr5 / atr14).toFixed(2)})`,
  };
}

function computeSMA(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  return slice.reduce((sum, c) => sum + c.close, 0) / period;
}

function detectMeanReversion(candles: Candle[], currentPrice: number): Signal | null {
  if (candles.length < 20) return null;

  const sma20 = computeSMA(candles, 20);
  if (sma20 === 0) return null;

  const deviation = ((currentPrice - sma20) / sma20) * 100;
  if (Math.abs(deviation) < 8) return null;

  // Momentum decaying: check that last 3 candle bodies are shrinking
  const lastThree = candles.slice(-3);
  const bodies = lastThree.map((c) => Math.abs(c.close - c.open));
  if (bodies.length < 3) return null;
  const bodiesShrinking = bodies[0]! > bodies[1]! && bodies[1]! > bodies[2]!;
  if (!bodiesShrinking) return null;

  if (deviation > 8) {
    return {
      type: "mean_reversion",
      direction: "short",
      weight: 2,
      label: `Extended +${deviation.toFixed(1)}% from SMA20 (momentum fading)`,
    };
  }

  return {
    type: "mean_reversion",
    direction: "long",
    weight: 2,
    label: `Extended ${deviation.toFixed(1)}% from SMA20 (momentum fading)`,
  };
}

function detectVolumeExhaustion(candles: Candle[]): Signal | null {
  if (candles.length < 10) return null;

  const recent = candles.slice(-10);
  const volumes = recent.map((c) => c.volume).filter((v): v is number => v != null);
  if (volumes.length < 8) return null;

  // Split into first half and second half
  const mid = Math.floor(volumes.length / 2);
  const firstHalf = volumes.slice(0, mid);
  const secondHalf = volumes.slice(mid);

  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  if (avgFirst === 0) return null;

  // Volume declining 40%+ while price still trending
  const decline = (avgFirst - avgSecond) / avgFirst;
  if (decline < 0.4) return null;

  // Check if price is still trending (compare first and last candle close)
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const priceChange = ((last.close - first.close) / first.close) * 100;

  if (Math.abs(priceChange) < 2) return null;

  // Counter-trend signal: if price has been going up on declining volume, short setup
  if (priceChange > 2) {
    return {
      type: "volume_exhaustion",
      direction: "short",
      weight: 2,
      label: `Volume declining ${(decline * 100).toFixed(0)}% on +${priceChange.toFixed(1)}% rally`,
    };
  }

  return {
    type: "volume_exhaustion",
    direction: "long",
    weight: 2,
    label: `Volume declining ${(decline * 100).toFixed(0)}% on ${priceChange.toFixed(1)}% sell-off`,
  };
}

// =============================================================================
// TP & SL computation
// =============================================================================

function computeATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const curr = slice[i]!;
    const prev = slice[i - 1]!;
    sum += Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
  }
  return sum / period;
}

function computeTPSL(
  price: number,
  direction: SignalDirection,
  baseSymbol: string,
  srLevels1d: SRLevel[],
  candles4h: Candle[],
  candles1d: Candle[],
  candles15m: Candle[]
): { tp: number; sl: number; invalidation: number; rr_ratio: number } {
  const atr15m = computeATR(candles15m, 14);
  const atr4h = computeATR(candles4h, 14);
  const atrFallback = atr15m > 0 ? atr15m : atr4h;

  const srLevels4h = candles4h.length >= 5 ? computeSRLevels(candles4h, "4h") : [];
  const allLevels = [...srLevels1d, ...srLevels4h];

  const MAX_TP_PCT = 0.08;
  // Tighter SL caps for 15m entries: 2% for BTC/ETH, 1.5% for alts
  const isMajor = baseSymbol === "BTC" || baseSymbol === "ETH";
  const MAX_SL_PCT = isMajor ? 0.02 : 0.015;
  const SL_BUFFER = 0.002;
  const MIN_RR = 1.5; // 1.5:1 RR floor (tighter stops = lower RR needed)

  let structuralTP: number;
  let invalidation: number;

  if (direction === "long") {
    // Structural TP: nearest resistance above (HTF levels)
    const resistancesAbove = allLevels
      .filter((l) => l.price > price * 1.005 && l.price <= price * (1 + MAX_TP_PCT))
      .sort((a, b) => a.price - b.price);
    structuralTP = resistancesAbove.length > 0
      ? resistancesAbove[0]!.price
      : price + (atrFallback > 0 ? Math.min(1.5 * atrFallback, price * MAX_TP_PCT) : price * 0.03);

    // Invalidation: 15m swing low (last 10 candles) as primary, fall back to HTF S/R
    const recentLows15m = candles15m.slice(-10).map((c) => c.low);
    const swingLow15m = recentLows15m.length > 0 ? Math.min(...recentLows15m) : 0;

    if (swingLow15m > 0 && swingLow15m < price * 0.998) {
      invalidation = swingLow15m;
    } else {
      const supportsBelow = allLevels
        .filter((l) => l.price < price * 0.995)
        .sort((a, b) => b.price - a.price);
      if (supportsBelow.length > 0) {
        invalidation = supportsBelow[0]!.price;
      } else {
        const recentLows4h = candles4h.slice(-8).map((c) => c.low);
        const swingLow4h = recentLows4h.length > 0 ? Math.min(...recentLows4h) : 0;
        invalidation = swingLow4h > 0
          ? swingLow4h
          : price - (atrFallback > 0 ? atrFallback : price * 0.015);
      }
    }
  } else {
    // Structural TP: nearest support below (HTF levels)
    const supportsBelow = allLevels
      .filter((l) => l.price < price * 0.995 && l.price >= price * (1 - MAX_TP_PCT))
      .sort((a, b) => b.price - a.price);
    structuralTP = supportsBelow.length > 0
      ? supportsBelow[0]!.price
      : price - (atrFallback > 0 ? Math.min(1.5 * atrFallback, price * MAX_TP_PCT) : price * 0.03);

    // Invalidation: 15m swing high (last 10 candles) as primary, fall back to HTF S/R
    const recentHighs15m = candles15m.slice(-10).map((c) => c.high);
    const swingHigh15m = recentHighs15m.length > 0 ? Math.max(...recentHighs15m) : 0;

    if (swingHigh15m > 0 && swingHigh15m > price * 1.002) {
      invalidation = swingHigh15m;
    } else {
      const resistancesAbove = allLevels
        .filter((l) => l.price > price * 1.005)
        .sort((a, b) => a.price - b.price);
      if (resistancesAbove.length > 0) {
        invalidation = resistancesAbove[0]!.price;
      } else {
        const recentHighs4h = candles4h.slice(-8).map((c) => c.high);
        const swingHigh4h = recentHighs4h.length > 0 ? Math.max(...recentHighs4h) : 0;
        invalidation = swingHigh4h > 0
          ? swingHigh4h
          : price + (atrFallback > 0 ? atrFallback : price * 0.015);
      }
    }
  }

  // SL from invalidation + buffer, capped
  let sl = direction === "long"
    ? invalidation * (1 - SL_BUFFER)
    : invalidation * (1 + SL_BUFFER);

  const slDistPct = Math.abs(sl - price) / price;
  if (slDistPct > MAX_SL_PCT) {
    sl = direction === "long"
      ? price * (1 - MAX_SL_PCT)
      : price * (1 + MAX_SL_PCT);
  }

  // TP: take whichever is further — structural TP or 1.5:1 RR floor
  const risk = Math.abs(price - sl);
  const rrFloorTP = direction === "long"
    ? price + MIN_RR * risk
    : price - MIN_RR * risk;

  const structuralDist = Math.abs(structuralTP - price);
  const rrFloorDist = Math.abs(rrFloorTP - price);
  const tp = structuralDist >= rrFloorDist ? structuralTP : rrFloorTP;

  const rr_ratio = risk > 0 ? Math.round((Math.abs(tp - price) / risk) * 10) / 10 : 0;

  return { tp, sl, invalidation, rr_ratio };
}

// =============================================================================
// Scoring
// =============================================================================

function scoreSignals(signals: Signal[]): { score: number; direction: SignalDirection } | null {
  if (signals.length === 0) return null;

  const rawScore = signals.reduce(
    (sum, s) => sum + s.weight * (s.direction === "long" ? 1 : -1),
    0
  );

  const direction: SignalDirection = rawScore > 0 ? "long" : "short";
  const majoritySignals = signals.filter((s) => s.direction === direction);

  // Confluence requirement: must have 2+ distinct signal types
  const distinctTypes = new Set(majoritySignals.map((s) => s.type));
  if (distinctTypes.size < 2) return null;

  let score = Math.abs(rawScore);

  // Confluence bonus: 3+ distinct types
  if (distinctTypes.size >= 3) score += 1;

  // Minimum score: 4
  if (score < 4) return null;

  return { score, direction };
}

// =============================================================================
// Setup Description Builder
// =============================================================================

const HTF_SIGNAL_TYPES = new Set<string>([
  "extreme_funding", "funding_divergence", "oi_divergence",
  "mean_reversion", "volume_exhaustion", "pre_breakout",
  "range_compression", "sr_rejection",
]);
const LTF_SIGNAL_TYPES = new Set<string>(["bos", "fvg", "displacement", "volume_spike"]);

function buildSetupDescription(
  signals: Signal[],
  direction: SignalDirection,
  candles15m: Candle[]
): string {
  const htfSignals = signals.filter((s) => s.direction === direction && HTF_SIGNAL_TYPES.has(s.type));
  const ltfSignals = signals.filter((s) => s.direction === direction && LTF_SIGNAL_TYPES.has(s.type));

  // HTF context: pick the highest-weight HTF signal
  let htfContext = "";
  if (htfSignals.length > 0) {
    const best = htfSignals.sort((a, b) => b.weight - a.weight)[0]!;
    switch (best.type) {
      case "extreme_funding":
        htfContext = direction === "long"
          ? "Extreme negative funding — squeeze setup"
          : "Extreme positive funding — fade the crowd";
        break;
      case "mean_reversion":
        htfContext = best.label; // Already descriptive: "Extended +X% from SMA20..."
        break;
      case "pre_breakout":
        htfContext = direction === "long"
          ? "Approaching resistance with compression"
          : "Approaching support with compression";
        break;
      case "volume_exhaustion":
        htfContext = direction === "long"
          ? "Volume drying up on sell-off"
          : "Volume drying up on rally";
        break;
      case "funding_divergence":
        htfContext = direction === "long"
          ? "Negative funding on uptrend"
          : "High funding on downtrend";
        break;
      case "oi_divergence":
        htfContext = direction === "long"
          ? "High OI on sell-off — squeeze setup"
          : "High OI on rally — squeeze setup";
        break;
      case "range_compression":
        htfContext = best.label;
        break;
      case "sr_rejection":
        htfContext = best.label;
        break;
      default:
        htfContext = best.label;
    }
  }

  // LTF entry: pick from LTF signals, include 15m price data when available
  let ltfEntry = "";
  if (ltfSignals.length > 0) {
    const best = ltfSignals.sort((a, b) => b.weight - a.weight)[0]!;
    const recent15m = candles15m.slice(-10);

    switch (best.type) {
      case "bos": {
        // Find the swing level that was swept
        const swings = direction === "long"
          ? recent15m.map((c) => c.low).sort((a, b) => a - b)
          : recent15m.map((c) => c.high).sort((a, b) => b - a);
        const swingPrice = swings.length > 0 ? swings[0]! : 0;
        ltfEntry = direction === "long"
          ? `Enter on 15m reclaim above ${swingPrice > 0 ? swingPrice.toPrecision(5) : "swing low"}`
          : `Enter on 15m rejection below ${swingPrice > 0 ? swingPrice.toPrecision(5) : "swing high"}`;
        break;
      }
      case "fvg": {
        // Find the FVG zone from 15m candles
        let gapBottom = 0, gapTop = 0;
        for (let i = recent15m.length - 2; i >= 1; i--) {
          const before = recent15m[i - 1]!;
          const after = recent15m[i + 1]!;
          if (direction === "long" && before.high < after.low) {
            gapBottom = before.high;
            gapTop = after.low;
            break;
          }
          if (direction === "short" && before.low > after.high) {
            gapTop = before.low;
            gapBottom = after.high;
            break;
          }
        }
        ltfEntry = gapBottom > 0
          ? `Enter at 15m FVG fill ${gapBottom.toPrecision(5)}-${gapTop.toPrecision(5)}`
          : "Enter at 15m FVG fill zone";
        break;
      }
      case "displacement":
        ltfEntry = direction === "long"
          ? "Enter on 15m pullback to displacement origin"
          : "Enter on 15m retest of displacement origin";
        break;
      case "volume_spike":
        ltfEntry = "Momentum entry — 15m volume confirmed";
        break;
      default:
        ltfEntry = "Watch 15m for BOS or FVG entry";
    }
  } else {
    ltfEntry = "Watch 15m for BOS or FVG entry";
  }

  if (htfContext && ltfEntry) return `${htfContext}. ${ltfEntry}.`;
  if (htfContext) return `${htfContext}. ${ltfEntry}.`;
  return ltfEntry + ".";
}

// =============================================================================
// Main detection pipeline
// =============================================================================

export async function detectSignals(
  tickers: RawTicker[],
  marketCaps: Map<string, number>
): Promise<SignalResult[]> {
  // Step 1: Liquidity gate — filter out untradeable coins
  const tradeableTickers = tickers.filter((t) => getLiquidityTier(t.volume_24h_usd) !== "skip");

  // Step 2: Ticker-level signals + pre-filter
  const tickerScored: { ticker: RawTicker; signals: Signal[]; score: number }[] = [];

  for (const t of tradeableTickers) {
    const signals: Signal[] = [];

    const funding = detectFundingDivergence(t);
    if (funding) signals.push(funding);

    const oi = detectOIDivergence(t);
    if (oi) signals.push(oi);

    const extremeFunding = detectExtremeFunding(t);
    if (extremeFunding) signals.push(extremeFunding);

    const score = signals.reduce(
      (sum, s) => sum + s.weight * (s.direction === "long" ? 1 : -1),
      0
    );

    tickerScored.push({ ticker: t, signals, score: Math.abs(score) });
  }

  // Pre-filter: top by ticker signals + top movers
  tickerScored.sort((a, b) => b.score - a.score);

  const candidateSet = new Map<string, { ticker: RawTicker; signals: Signal[] }>();

  for (const entry of tickerScored.slice(0, 20)) {
    if (entry.signals.length > 0) {
      candidateSet.set(entry.ticker.symbol, {
        ticker: entry.ticker,
        signals: entry.signals,
      });
    }
  }

  const sorted24h = [...tradeableTickers].sort((a, b) => b.price_change_24h - a.price_change_24h);
  const topGainers = sorted24h.slice(0, 15);
  const topLosers = sorted24h.slice(-15);
  for (const t of [...topGainers, ...topLosers]) {
    if (!candidateSet.has(t.symbol)) {
      candidateSet.set(t.symbol, { ticker: t, signals: [] });
    }
  }

  const candidates = Array.from(candidateSet.values());

  // Step 3: Fetch candles and run all detectors
  const freshKeys = new Set<string>();

  const results = await Promise.allSettled(
    candidates.map(async (entry) => {
      const { ticker, signals } = entry;
      const liqTier = getLiquidityTier(ticker.volume_24h_usd);

      const [candles15m, candles4h, candles1d] = await Promise.all([
        fetchCandlesForTicker(ticker.symbol, "15m", 50, ticker.exchange).catch(() => [] as Candle[]),
        fetchCandlesForTicker(ticker.symbol, "4h", 30, ticker.exchange).catch(() => [] as Candle[]),
        fetchCandlesForTicker(ticker.symbol, "1d", 100, ticker.exchange).catch(() => [] as Candle[]),
      ]);

      const srLevels = candles1d.length >= 5 ? computeSRLevels(candles1d, "1d") : [];

      // --- HTF signals (4H/1D candles) — directional bias ---

      // S/R rejection (1D)
      const rejection = detectSRRejection(candles1d, srLevels);
      if (rejection) signals.push(rejection);

      // Anticipatory HTF signals (4H)
      const preBreakout = detectPreBreakout(candles4h, ticker.price, srLevels);
      if (preBreakout) signals.push(preBreakout);

      const rangeComp = detectRangeCompression(candles4h, ticker.price, srLevels);
      if (rangeComp) signals.push(rangeComp);

      const meanRev = detectMeanReversion(candles4h, ticker.price);
      if (meanRev) signals.push(meanRev);

      const volExhaustion = detectVolumeExhaustion(candles4h);
      if (volExhaustion) signals.push(volExhaustion);

      // --- LTF signals (15m candles) — entry triggers ---

      const volSpike = detectVolumeSpike(candles15m);
      if (volSpike) signals.push(volSpike);

      const bos = detectBOS(candles15m);
      if (bos) signals.push(bos);

      const fvg = detectFVG(candles15m, ticker.price);
      if (fvg) signals.push(fvg);

      const displacement = detectDisplacement(candles15m);
      if (displacement) signals.push(displacement);

      // Score with confluence
      const scored = scoreSignals(signals);
      if (!scored) return null;

      let { score, direction } = scored;

      // Apply liquidity modifier
      score = applyLiquidityModifier(score, liqTier);
      if (score < 4) return null;

      // Build setup description
      const setup = buildSetupDescription(signals, direction, candles15m);

      // Compute TP/SL (using 15m for tight stops, HTF for targets)
      const { tp, sl, invalidation, rr_ratio } = computeTPSL(
        ticker.price, direction, ticker.base_symbol, srLevels, candles4h, candles1d, candles15m
      );

      const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
      const pct = (target: number) =>
        Math.round(((target - ticker.price) / ticker.price) * 10000) / 100;

      const result: SignalResult = {
        symbol: ticker.symbol,
        base_symbol: ticker.base_symbol,
        exchange: ticker.exchange,
        price: ticker.price,
        direction,
        score,
        signals,
        setup,
        tp: round6(tp),
        sl: round6(sl),
        invalidation: round6(invalidation),
        tp_pct: pct(tp),
        sl_pct: pct(sl),
        invalidation_pct: pct(invalidation),
        rr_ratio,
        volume_24h_usd: ticker.volume_24h_usd,
        links: {
          coinglass_heatmap: getCoinglassHeatmapUrl(ticker.base_symbol),
          coinglass_funding: getCoinglassFundingUrl(ticker.base_symbol),
          coinglass_oi: getCoinglassOIUrl(ticker.base_symbol),
          tradingview: getTradingViewUrl(ticker.symbol, ticker.exchange),
        },
      };

      // Cache and track this key
      cacheSignal(result);
      freshKeys.add(getCacheKey(result.symbol, result.direction));

      return result;
    })
  );

  // Collect fresh results
  const freshResults: SignalResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value != null) {
      freshResults.push(r.value);
    }
  }

  // Merge with cached signals (only add cached ones that weren't freshly computed)
  const cachedSignals = getCachedSignals();
  const merged = new Map<string, SignalResult>();

  for (const r of freshResults) {
    merged.set(getCacheKey(r.symbol, r.direction), r);
  }
  for (const r of cachedSignals) {
    const key = getCacheKey(r.symbol, r.direction);
    if (!merged.has(key)) {
      merged.set(key, r);
    }
  }

  const allResults = Array.from(merged.values());
  allResults.sort((a, b) => b.score - a.score);
  const topResults = allResults.slice(0, 12);

  // Attach news sentiment (runs after scoring so it doesn't slow detection)
  const symbols = [...new Set(topResults.map((r) => r.base_symbol))];
  const sentimentMap = await fetchNewsSentiment(symbols);
  for (const result of topResults) {
    const sentiment = sentimentMap.get(result.base_symbol);
    if (sentiment) result.news_sentiment = sentiment;
  }

  return topResults;
}
