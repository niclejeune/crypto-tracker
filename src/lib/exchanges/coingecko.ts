const BASE_URL = "https://api.coingecko.com/api/v3";

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  market_cap: number;
}

let cachedMarketCaps: Map<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function fetchMarketCaps(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cachedMarketCaps && now - cacheTimestamp < CACHE_TTL) {
    return cachedMarketCaps;
  }

  const map = new Map<string, number>();

  try {
    // Fetch 4 pages = 1000 coins to cover most perp-listed tokens
    const pages = await Promise.allSettled(
      [1, 2, 3, 4].map((page) =>
        fetch(
          `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`,
          { next: { revalidate: 600 } }
        ).then((r) => (r.ok ? r.json() : []))
      )
    );

    for (const result of pages) {
      if (result.status !== "fulfilled") continue;
      const coins: CoinGeckoMarket[] = result.value;
      for (const coin of coins) {
        if (coin.market_cap > 0) {
          const sym = coin.symbol.toUpperCase();
          // Store by symbol. Some symbols have "1000" prefix on exchanges
          map.set(sym, coin.market_cap);
        }
      }
    }
  } catch {
    // non-critical
  }

  if (map.size > 0) {
    cachedMarketCaps = map;
    cacheTimestamp = now;
  }
  return cachedMarketCaps ?? map;
}

/**
 * Look up market cap for a base symbol, handling common exchange naming
 * quirks like "1000PEPE" -> "PEPE", "1000CHEEMS" -> "CHEEMS"
 */
export function lookupMarketCap(
  baseSymbol: string,
  marketCaps: Map<string, number>
): number | undefined {
  // Direct match
  const direct = marketCaps.get(baseSymbol);
  if (direct) return direct;

  // Handle "1000X" prefix (exchanges list as 1000PEPE, CoinGecko lists as PEPE)
  if (baseSymbol.startsWith("1000")) {
    const stripped = baseSymbol.slice(4);
    const match = marketCaps.get(stripped);
    if (match) return match;
  }

  // Handle "10000X" prefix
  if (baseSymbol.startsWith("10000")) {
    const stripped = baseSymbol.slice(5);
    const match = marketCaps.get(stripped);
    if (match) return match;
  }

  return undefined;
}
