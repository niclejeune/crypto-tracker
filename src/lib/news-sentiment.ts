import type { NewsSentiment } from "./types";

// =============================================================================
// In-memory cache
// =============================================================================

interface CacheEntry {
  data: NewsSentiment;
  timestamp: number;
}

const sentimentCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

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
  // Prune old entries
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
// CryptoPanic fetcher
// =============================================================================

interface CryptoPanicVotes {
  positive: number;
  negative: number;
  important: number;
  liked: number;
  disliked: number;
}

interface CryptoPanicPost {
  votes: CryptoPanicVotes;
}

interface CryptoPanicResponse {
  results?: CryptoPanicPost[];
}

async function fetchCryptoPanic(
  symbol: string,
  apiKey: string
): Promise<{ score: number; articles: number } | null> {
  try {
    const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&currencies=${symbol}&filter=hot&public=true`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return null;

    const data: CryptoPanicResponse = await res.json();
    const posts = data.results;
    if (!posts || posts.length === 0) return null;

    let totalPositive = 0;
    let totalNegative = 0;

    for (const post of posts) {
      totalPositive += post.votes.positive + post.votes.liked;
      totalNegative += post.votes.negative + post.votes.disliked;
    }

    const total = totalPositive + totalNegative;
    if (total === 0) return { score: 0, articles: posts.length };

    const score = (totalPositive - totalNegative) / total;
    return { score: Math.max(-1, Math.min(1, score)), articles: posts.length };
  } catch {
    return null;
  }
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
    if (!data.feed) return result;

    // Accumulate weighted scores per symbol
    const accum = new Map<
      string,
      { weightedSum: number; totalWeight: number; count: number }
    >();

    for (const item of data.feed) {
      if (!item.ticker_sentiment) continue;
      for (const ts of item.ticker_sentiment) {
        // Match CRYPTO:BTC format
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
    // fail silently — Alpha Vantage is optional
  }

  return result;
}

// =============================================================================
// Main: fetch + merge
// =============================================================================

export async function fetchNewsSentiment(
  symbols: string[]
): Promise<Map<string, NewsSentiment>> {
  const result = new Map<string, NewsSentiment>();
  if (symbols.length === 0) return result;

  // Check cache first, collect uncached symbols
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

  const cpKey = process.env.CRYPTOPANIC_API_KEY;
  const avKey = process.env.ALPHAVANTAGE_API_KEY;

  if (!cpKey && !avKey) return result;

  // Fetch from both APIs in parallel
  const [cpResults, avResults] = await Promise.allSettled([
    // CryptoPanic: one request per symbol
    cpKey
      ? Promise.allSettled(
          uncachedSymbols.map(async (sym) => ({
            symbol: sym,
            data: await fetchCryptoPanic(sym, cpKey),
          }))
        )
      : Promise.resolve([]),

    // Alpha Vantage: single batch request
    avKey
      ? fetchAlphaVantage(uncachedSymbols, avKey)
      : Promise.resolve(new Map<string, { score: number; articles: number }>()),
  ]);

  // Collect CryptoPanic results
  const cpMap = new Map<string, { score: number; articles: number }>();
  if (cpResults.status === "fulfilled" && Array.isArray(cpResults.value)) {
    for (const entry of cpResults.value) {
      if (entry.status === "fulfilled" && entry.value.data) {
        cpMap.set(entry.value.symbol, entry.value.data);
      }
    }
  }

  // Collect Alpha Vantage results
  const avMap =
    avResults.status === "fulfilled" ? avResults.value : new Map();

  // Merge per symbol
  for (const sym of uncachedSymbols) {
    const cp = cpMap.get(sym);
    const av = (avMap as Map<string, { score: number; articles: number }>).get(sym);

    if (!cp && !av) continue;

    let score: number;
    let articles = 0;
    const sources: string[] = [];

    if (cp && av) {
      // Weighted average: 0.4 CryptoPanic + 0.6 Alpha Vantage (NLP is higher quality)
      score = 0.4 * cp.score + 0.6 * av.score;
      articles = cp.articles + av.articles;
      sources.push("cryptopanic", "alphavantage");
    } else if (cp) {
      score = cp.score;
      articles = cp.articles;
      sources.push("cryptopanic");
    } else {
      score = av!.score;
      articles = av!.articles;
      sources.push("alphavantage");
    }

    const sentiment: NewsSentiment = {
      score: Math.round(score * 100) / 100,
      label: scoreToLabel(score),
      articles,
      sources,
    };

    setCache(sym, sentiment);
    result.set(sym, sentiment);
  }

  return result;
}
