import type { RawTicker } from "./types";
import type { Candle } from "../types";

const BASE_URL = "https://api.hyperliquid.xyz";

interface HyperMeta {
  universe: { name: string }[];
}

interface HyperAssetCtx {
  markPx: string;
  funding: string;
  dayNtlVlm: string;
  openInterest: string;
  prevDayPx: string;
}

function toCanonical(coin: string): string {
  return `${coin}USDT`;
}

function toCoin(canonical: string): string {
  return canonical.replace("USDT", "");
}

export async function fetchHyperliquidTickers(): Promise<RawTicker[]> {
  const res = await fetch(BASE_URL + "/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    next: { revalidate: 15 },
  });
  if (!res.ok) throw new Error(`HyperLiquid tickers failed: ${res.status}`);

  const data: [HyperMeta, HyperAssetCtx[]] = await res.json();
  const [meta, contexts] = data;

  return meta.universe.map((asset, i) => {
    const ctx = contexts[i]!;
    const price = parseFloat(ctx.markPx);
    const prevPrice = parseFloat(ctx.prevDayPx);
    const change24h = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
    const oi = parseFloat(ctx.openInterest) * price;

    return {
      symbol: toCanonical(asset.name),
      base_symbol: asset.name,
      exchange: "hyperliquid",
      price,
      price_change_24h: change24h,
      volume_24h_usd: parseFloat(ctx.dayNtlVlm),
      funding_rate: parseFloat(ctx.funding),
      open_interest: oi,
    };
  });
}

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

interface HyperCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v?: string;
}

export async function fetchHyperliquidCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Candle[]> {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) return [];

  const coin = toCoin(symbol);
  const endTime = Date.now();
  const startTime = endTime - intervalMs * limit;

  const res = await fetch(BASE_URL + "/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime, endTime },
    }),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`HyperLiquid candles failed: ${res.status}`);

  const data: HyperCandle[] = await res.json();

  return data.map((c) => ({
    openTime: c.t,
    open: parseFloat(c.o),
    high: parseFloat(c.h),
    low: parseFloat(c.l),
    close: parseFloat(c.c),
    volume: c.v ? parseFloat(c.v) : undefined,
  }));
}
