const BASE_URL = "https://api.coingecko.com/api/v3";

interface CoinGeckoMarket {
  symbol: string;
  market_cap: number;
}

let cachedMarketCaps: Map<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchMarketCaps(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cachedMarketCaps && now - cacheTimestamp < CACHE_TTL) {
    return cachedMarketCaps;
  }

  const map = new Map<string, number>();

  try {
    // Fetch top 250 coins by market cap (max per page)
    const [page1, page2] = await Promise.all([
      fetch(
        `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`,
        { next: { revalidate: 300 } }
      ),
      fetch(
        `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2&sparkline=false`,
        { next: { revalidate: 300 } }
      ),
    ]);

    const results: CoinGeckoMarket[][] = [];
    if (page1.ok) results.push(await page1.json());
    if (page2.ok) results.push(await page2.json());

    for (const page of results) {
      for (const coin of page) {
        if (coin.market_cap > 0) {
          // CoinGecko uses lowercase symbols
          map.set(coin.symbol.toUpperCase(), coin.market_cap);
        }
      }
    }
  } catch {
    // Return empty map on failure — market cap is optional
  }

  cachedMarketCaps = map;
  cacheTimestamp = now;
  return map;
}
