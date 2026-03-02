import type { NewsSentiment } from "./types";

// =============================================================================
// In-memory cache
// =============================================================================

interface CacheEntry {
  data: NewsSentiment;
  timestamp: number;
}

const sentimentCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min (conservative for 25 req/day limit)

function getCached(symbol: string): NewsSentiment | null {
  const entry = sentimentCache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    sentimentCache.delete(symbol);
    return null;
  }
  return entry.data;
}

function setCache(symbol: string, data: NewsSentiment): void {
  sentimentCache.set(symbol, { data, timestamp: Date.now() });
  if (sentimentCache.size > 200) {
    const now = Date.now();
    for (const [key, entry] of sentimentCache) {
      if (now - entry.timestamp > CACHE_TTL_MS) sentimentCache.delete(key);
    }
  }
}

// =============================================================================
// Score → Label
// =============================================================================

function scoreToLabel(score: number): NewsSentiment["label"] {
  if (score <= -0.35) return "Bearish";
  if (score <= -0.15) return "Somewhat Bearish";
  if (score < 0.15) return "Neutral";
  if (score < 0.35) return "Somewhat Bullish";
  return "Bullish";
}

// =============================================================================
// Alpha Vantage fetcher
// =============================================================================

interface AVTickerSentiment {
  ticker: string;
  ticker_sentiment_score: string;
  relevance_score: string;
}

interface AVFeedItem {
  ticker_sentiment?: AVTickerSentiment[];
}

interface AVResponse {
  feed?: AVFeedItem[];
  Information?: string;
}

async function fetchAlphaVantage(
  symbols: string[],
  apiKey: string
): Promise<Map<string, { score: number; articles: number }>> {
  const result = new Map<string, { score: number; articles: number }>();
  if (symbols.length === 0) return result;

  try {
    const tickers = symbols.map((s) => `CRYPTO:${s}`).join(",");
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${tickers}&limit=50&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return result;

    const data: AVResponse = await res.json();

    // Rate limit check — AV returns 200 with an Information field when quota exceeded
    if (data.Information || !data.feed) return result;

    const accum = new Map<
      string,
      { weightedSum: number; totalWeight: number; count: number }
    >();

    for (const item of data.feed) {
      if (!item.ticker_sentiment) continue;
      for (const ts of item.ticker_sentiment) {
        const match = ts.ticker.match(/^CRYPTO:(\w+)$/);
        if (!match) continue;
        const sym = match[1]!;
        if (!symbols.includes(sym)) continue;

        const sentScore = parseFloat(ts.ticker_sentiment_score);
        const relevance = parseFloat(ts.relevance_score);
        if (isNaN(sentScore) || isNaN(relevance)) continue;

        const existing = accum.get(sym) ?? {
          weightedSum: 0,
          totalWeight: 0,
          count: 0,
        };
        existing.weightedSum += sentScore * relevance;
        existing.totalWeight += relevance;
        existing.count++;
        accum.set(sym, existing);
      }
    }

    for (const [sym, acc] of accum) {
      if (acc.totalWeight === 0) continue;
      const score = acc.weightedSum / acc.totalWeight;
      result.set(sym, {
        score: Math.max(-1, Math.min(1, score)),
        articles: acc.count,
      });
    }
  } catch {
    // fail silently
  }

  return result;
}

// =============================================================================
// Main entry point
// =============================================================================

export async function fetchNewsSentiment(
  symbols: string[]
): Promise<Map<string, NewsSentiment>> {
  const result = new Map<string, NewsSentiment>();
  if (symbols.length === 0) return result;

  const uncachedSymbols: string[] = [];
  for (const sym of symbols) {
    const cached = getCached(sym);
    if (cached) {
      result.set(sym, cached);
    } else {
      uncachedSymbols.push(sym);
    }
  }

  if (uncachedSymbols.length === 0) return result;

  const avKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!avKey) return result;

  const avMap = await fetchAlphaVantage(uncachedSymbols, avKey);

  for (const sym of uncachedSymbols) {
    const av = avMap.get(sym);
    if (!av) continue;

    const sentiment: NewsSentiment = {
      score: Math.round(av.score * 100) / 100,
      label: scoreToLabel(av.score),
      articles: av.articles,
      sources: ["alphavantage"],
    };

    setCache(sym, sentiment);
    result.set(sym, sentiment);
  }

  return result;
}
