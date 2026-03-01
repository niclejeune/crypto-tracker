import type { RawTicker } from "./types";
import type { Candle } from "../types";

const BASE_URL = "https://fapi.binance.com";

interface BinanceSymbolInfo {
  symbol: string;
  contractType: string;
  status: string;
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbolInfo[];
}

let activeSymbols: Set<string> | null = null;
let activeSymbolsTimestamp = 0;
const SYMBOLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getActivePerpetualsSet(): Promise<Set<string>> {
  const now = Date.now();
  if (activeSymbols && now - activeSymbolsTimestamp < SYMBOLS_CACHE_TTL) {
    return activeSymbols;
  }

  const res = await fetch(`${BASE_URL}/fapi/v1/exchangeInfo`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Binance exchangeInfo failed: ${res.status}`);

  const data: BinanceExchangeInfo = await res.json();

  activeSymbols = new Set(
    data.symbols
      .filter(
        (s) =>
          s.contractType === "PERPETUAL" &&
          s.status === "TRADING" &&
          s.symbol.endsWith("USDT")
      )
      .map((s) => s.symbol)
  );
  activeSymbolsTimestamp = now;
  return activeSymbols;
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

export async function fetchBinanceTickers(): Promise<RawTicker[]> {
  const [tickerRes, activePerpetuals] = await Promise.all([
    fetch(`${BASE_URL}/fapi/v1/ticker/24hr`, { next: { revalidate: 15 } }),
    getActivePerpetualsSet(),
  ]);

  if (!tickerRes.ok) throw new Error(`Binance tickers failed: ${tickerRes.status}`);

  const data: BinanceTicker[] = await tickerRes.json();

  return data
    .filter((t) => activePerpetuals.has(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      base_symbol: t.symbol.replace("USDT", ""),
      exchange: "binance",
      price: parseFloat(t.lastPrice),
      price_change_24h: parseFloat(t.priceChangePercent),
      volume_24h_usd: parseFloat(t.quoteVolume),
    }));
}

interface BinanceKline {
  0: number; // open time
  1: string; // open
  2: string; // high
  3: string; // low
  4: string; // close
}

export async function fetchBinanceCandles(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Candle[]> {
  const res = await fetch(
    `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    { next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Binance candles failed: ${res.status}`);

  const data: BinanceKline[] = await res.json();

  return data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}
