const BASE_URL = "https://api.coingecko.com/api/v3";

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  market_cap: number;
}

let cachedMarketCaps: Map<string, number> | null = null;
let cachedSymbolSet: Set<string> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(page: number, retries = 2): Promise<CoinGeckoMarket[]> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(
      `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`,
      { next: { revalidate: 600 } }
    );
    if (res.ok) return res.json();
    if (res.status === 429 && i < retries) {
      await delay(5000);
      continue;
    }
    return [];
  }
  return [];
}

interface MarketCapData {
  caps: Map<string, number>;
  symbols: Set<string>;
}

export async function fetchMarketCaps(): Promise<MarketCapData> {
  const now = Date.now();
  if (cachedMarketCaps && cachedSymbolSet && now - cacheTimestamp < CACHE_TTL) {
    return { caps: cachedMarketCaps, symbols: cachedSymbolSet };
  }

  const caps = new Map<string, number>();
  const symbols = new Set<string>();

  try {
    // Fetch 4 pages = top 1000 coins, sequentially to respect rate limits
    for (const page of [1, 2, 3, 4]) {
      const coins = await fetchPage(page);
      for (const coin of coins) {
        const sym = coin.symbol.toUpperCase();
        symbols.add(sym);
        if (coin.market_cap > 0) {
          caps.set(sym, coin.market_cap);
        }
      }
      if (page < 4) await delay(2500);
    }
  } catch {
    // non-critical
  }

  if (caps.size > 0) {
    cachedMarketCaps = caps;
    cachedSymbolSet = symbols;
    cacheTimestamp = now;
  }

  return {
    caps: cachedMarketCaps ?? caps,
    symbols: cachedSymbolSet ?? symbols,
  };
}

/**
 * Check if a base symbol is in the CoinGecko top 1000.
 * Handles exchange naming quirks like "1000PEPE" -> "PEPE".
 */
export function isInTop1000(baseSymbol: string, symbolSet: Set<string>): boolean {
  if (symbolSet.has(baseSymbol)) return true;
  if (baseSymbol.startsWith("1000") && symbolSet.has(baseSymbol.slice(4))) return true;
  if (baseSymbol.startsWith("10000") && symbolSet.has(baseSymbol.slice(5))) return true;
  return false;
}

/**
 * Look up market cap for a base symbol, handling common exchange naming
 * quirks like "1000PEPE" -> "PEPE", "1000CHEEMS" -> "CHEEMS"
 */
export function lookupMarketCap(
  baseSymbol: string,
  marketCaps: Map<string, number>
): number | undefined {
  const direct = marketCaps.get(baseSymbol);
  if (direct) return direct;

  if (baseSymbol.startsWith("1000")) {
    const match = marketCaps.get(baseSymbol.slice(4));
    if (match) return match;
  }

  if (baseSymbol.startsWith("10000")) {
    const match = marketCaps.get(baseSymbol.slice(5));
    if (match) return match;
  }

  return undefined;
}
