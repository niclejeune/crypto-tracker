# System Architecture — Crypto Perpetual Futures Scanner

> **Version:** 1.0  
> **Author:** Nic / Cimalys  
> **Last Updated:** March 2026  
> **Status:** Planning / Pre-MVP

---

## 1. Overview

A real-time dashboard that aggregates **top gainers and losers** across perpetual futures markets on multiple centralized exchanges, enriched with:

- Higher-timeframe **support/resistance detection** with visual highlighting
- Direct links to **Coinglass liquidation heatmaps** and **TradingView charts**
- Multi-timeframe views (5m, 15m, 1H, 4H, 1D, 1W)
- Funding rate, open interest, and volume context

The tool is designed for active futures traders who want a single view of what's moving, where liquidity sits, and whether price is near a technically significant level — without flipping between 5 tabs.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                          │
│                                                                  │
│   Next.js App (React + TailwindCSS)                              │
│   ┌────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│   │ Timeframe  │  │ Gainers /    │  │ S/R Highlight Engine    │  │
│   │ Selector   │  │ Losers Table │  │ (client-side rendering) │  │
│   └────────────┘  └──────────────┘  └─────────────────────────┘  │
│                          │                                       │
│              Polls every 15-60s via SWR/React Query              │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS (JSON)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     API LAYER (Next.js API Routes)               │
│                                                                  │
│   /api/tickers?tf=1h          → Aggregated gainers/losers        │
│   /api/sr-levels?symbol=BTC   → Support/resistance levels        │
│   /api/metadata               → Exchange status, symbols list    │
│                                                                  │
│   Reads from cache (Supabase/Redis), never hits exchanges live   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     CACHE / DATABASE LAYER                       │
│                                                                  │
│   Supabase (PostgreSQL)                                          │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│   │ ticker_snapshots │  │ sr_levels        │  │ candles_cache │  │
│   │ (per TF, per     │  │ (per symbol,     │  │ (raw klines   │  │
│   │  exchange)       │  │  per HTF)        │  │  for S/R calc)│  │
│   └──────────────────┘  └──────────────────┘  └──────────────┘  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   BACKGROUND WORKERS (Cron Jobs)                 │
│                                                                  │
│   ┌─────────────────────────┐  ┌──────────────────────────────┐  │
│   │ Ticker Aggregator       │  │ S/R Calculator               │  │
│   │ (runs every 15-30s)     │  │ (runs every 5-15 min)        │  │
│   │                         │  │                              │  │
│   │ • Fetches 24hr tickers  │  │ • Fetches 4H/1D/1W klines   │  │
│   │   from all exchanges    │  │ • Detects swing highs/lows   │  │
│   │ • Computes % change per │  │ • Clusters nearby levels     │  │
│   │   timeframe             │  │ • Writes to sr_levels table  │  │
│   │ • Ranks top N gainers / │  │                              │  │
│   │   losers                │  │                              │  │
│   │ • Writes to cache       │  │                              │  │
│   └────────┬────────────────┘  └─────────┬────────────────────┘  │
│            │                             │                       │
│            ▼                             ▼                       │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │              Exchange APIs (Public, No Auth)             │    │
│   │   Binance Futures  │  Bybit  │  OKX  │  Bitget          │    │
│   └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Sources

### 3.1 Exchange APIs

All endpoints are **public** (no API key required for market data).

#### Binance Futures
- **Base URL:** `https://fapi.binance.com`
- **Docs:** https://binance-docs.github.io/apidocs/futures/en/
- **Rate Limit:** 2,400 request weight / minute

| Endpoint | Purpose | Weight |
|---|---|---|
| `GET /fapi/v1/ticker/24hr` | All symbols: price, volume, change % | 40 |
| `GET /fapi/v1/klines?symbol={}&interval={}` | Candlestick data (for S/R) | 5 |
| `GET /fapi/v1/fundingRate?symbol={}` | Current funding rate | 1 |
| `GET /fapi/v1/openInterest?symbol={}` | Open interest | 1 |
| `GET /fapi/v1/ticker/price` | Current prices (lightweight) | 2 |

#### Bybit
- **Base URL:** `https://api.bybit.com`
- **Docs:** https://bybit-exchange.github.io/docs/v5/intro
- **Rate Limit:** 120 requests / 5 seconds

| Endpoint | Purpose |
|---|---|
| `GET /v5/market/tickers?category=linear` | All USDT perp tickers |
| `GET /v5/market/kline?category=linear&symbol={}&interval={}` | Candles |
| `GET /v5/market/funding/history?category=linear&symbol={}` | Funding rate |
| `GET /v5/market/open-interest?category=linear&symbol={}` | Open interest |

#### OKX (V2)
- **Base URL:** `https://www.okx.com`
- **Docs:** https://www.okx.com/docs-v5/en/

| Endpoint | Purpose |
|---|---|
| `GET /api/v5/market/tickers?instType=SWAP` | All swap tickers |
| `GET /api/v5/market/candles?instId={}-USDT-SWAP` | Candles |

#### Bitget (V2)
- **Base URL:** `https://api.bitget.com`
- **Docs:** https://www.bitget.com/api-doc/common/intro

| Endpoint | Purpose |
|---|---|
| `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` | Tickers |
| `GET /api/v2/mix/market/candles?productType=USDT-FUTURES` | Candles |

### 3.2 External Link Templates

```
Coinglass Liquidation Heatmap:
  https://www.coinglass.com/liquidation-heatmap/{BASE_SYMBOL}
  Example: https://www.coinglass.com/liquidation-heatmap/BTC

TradingView Perpetual Chart:
  https://www.tradingview.com/chart/?symbol={EXCHANGE}:{SYMBOL}USDT.P
  Example: https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT.P

Coinglass Funding Rate:
  https://www.coinglass.com/funding/{BASE_SYMBOL}
  Example: https://www.coinglass.com/funding/BTC

Coinglass Open Interest:
  https://www.coinglass.com/open-interest/{BASE_SYMBOL}
  Example: https://www.coinglass.com/open-interest/BTC
```

---

## 4. Database Schema (Supabase / PostgreSQL)

### 4.1 `symbols`
Master list of tracked perpetual contracts.

```sql
CREATE TABLE symbols (
  id            SERIAL PRIMARY KEY,
  base_symbol   TEXT NOT NULL,            -- 'BTC', 'ETH', 'SOL'
  symbol        TEXT NOT NULL,            -- 'BTCUSDT'
  exchange      TEXT NOT NULL,            -- 'binance', 'bybit', 'okx', 'bitget'
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, exchange)
);
```

### 4.2 `ticker_snapshots`
Latest ticker data per symbol per exchange, overwritten on each poll.

```sql
CREATE TABLE ticker_snapshots (
  id              SERIAL PRIMARY KEY,
  symbol          TEXT NOT NULL,
  exchange        TEXT NOT NULL,
  price           NUMERIC NOT NULL,
  price_change_5m   NUMERIC,
  price_change_15m  NUMERIC,
  price_change_1h   NUMERIC,
  price_change_4h   NUMERIC,
  price_change_24h  NUMERIC,
  price_change_7d   NUMERIC,
  volume_24h_usd  NUMERIC,
  open_interest   NUMERIC,
  funding_rate    NUMERIC,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, exchange)
);

-- Index for fast sorting by change %
CREATE INDEX idx_ticker_change_1h ON ticker_snapshots (price_change_1h DESC);
CREATE INDEX idx_ticker_change_24h ON ticker_snapshots (price_change_24h DESC);
```

### 4.3 `sr_levels`
Computed support and resistance levels per symbol per higher timeframe.

```sql
CREATE TABLE sr_levels (
  id            SERIAL PRIMARY KEY,
  base_symbol   TEXT NOT NULL,            -- 'BTC'
  timeframe     TEXT NOT NULL,            -- '4h', '1d', '1w'
  level_type    TEXT NOT NULL,            -- 'support' or 'resistance'
  price         NUMERIC NOT NULL,
  strength      INTEGER DEFAULT 1,       -- # of touches / confluences
  computed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(base_symbol, timeframe, price)
);

CREATE INDEX idx_sr_symbol ON sr_levels (base_symbol, timeframe);
```

### 4.4 `candles_cache`
Raw candlestick data for S/R calculation (avoids re-fetching).

```sql
CREATE TABLE candles_cache (
  id            SERIAL PRIMARY KEY,
  symbol        TEXT NOT NULL,
  exchange      TEXT NOT NULL,
  timeframe     TEXT NOT NULL,           -- '4h', '1d', '1w'
  open_time     BIGINT NOT NULL,
  open          NUMERIC NOT NULL,
  high          NUMERIC NOT NULL,
  low           NUMERIC NOT NULL,
  close         NUMERIC NOT NULL,
  volume        NUMERIC,
  UNIQUE(symbol, exchange, timeframe, open_time)
);
```

---

## 5. Core Algorithms

### 5.1 Ticker Aggregation

```
EVERY 15-30 SECONDS:

1. Fetch /ticker/24hr from each exchange in parallel
2. For each symbol:
   a. Normalize to common format { symbol, price, change_pct, volume, oi, funding }
   b. Compute short-term change % using cached candle close prices:
      - 5m change  = (current - close_5m_ago) / close_5m_ago * 100
      - 15m change = (current - close_15m_ago) / close_15m_ago * 100
      - 1h change  = from ticker or computed
      - 4h change  = computed from candles
      - 24h change = from ticker (native)
      - 7d change  = computed from candles
3. Cross-reference with sr_levels:
   - For each symbol, check if current price is within THRESHOLD% of any S/R level
   - Attach nearest S/R data: { level_price, level_type, timeframe, distance_pct }
4. Rank: top N gainers + top N losers per timeframe
5. UPSERT into ticker_snapshots
```

### 5.2 Support/Resistance Detection

```
EVERY 5-15 MINUTES (per symbol, per higher timeframe):

Input:  Array of candles (OHLCV) for timeframe [4H, 1D, 1W]
Output: Array of { price, type: 'support'|'resistance', strength }

Algorithm — Swing High/Low Detection:
─────────────────────────────────────

For i = 2 to len(candles) - 2:
  
  # Swing High → Resistance
  IF candle[i].high > MAX(candle[i-1].high, candle[i-2].high)
     AND candle[i].high > MAX(candle[i+1].high, candle[i+2].high):
    → Add resistance at candle[i].high
  
  # Swing Low → Support  
  IF candle[i].low < MIN(candle[i-1].low, candle[i-2].low)
     AND candle[i].low < MIN(candle[i+1].low, candle[i+2].low):
    → Add support at candle[i].low

Level Clustering:
─────────────────
Group levels within CLUSTER_PCT (default: 0.5%) of each other.
Use the average price of the cluster as the final level.
Strength = number of touches in the cluster.

Proximity Detection:
────────────────────
THRESHOLD_PCT = 1.5% (configurable)

For each symbol:
  distance = |current_price - sr_level| / sr_level * 100
  IF distance <= THRESHOLD_PCT:
    → Flag as "Near {timeframe} {support|resistance}"
    → Include in highlighted output
```

### 5.3 Proximity Flagging Logic

```
Priority order for display (highest timeframe wins):

1. Near 1W Support/Resistance  → 🔴🟢 STRONG highlight (red/green glow)
2. Near 1D Support/Resistance  → 🟠🟡 Medium highlight
3. Near 4H Support/Resistance  → Subtle badge/tag

If price is near BOTH support and resistance (squeeze zone):
  → Special "Compression Zone" flag ⚡

Output format per row:
{
  symbol: "BTCUSDT",
  near_sr: [
    { timeframe: "1w", type: "resistance", level: 72450, distance_pct: 0.8 },
    { timeframe: "1d", type: "resistance", level: 72100, distance_pct: 0.3 }
  ]
}
```

---

## 6. API Routes

### `GET /api/tickers`

Returns ranked gainers/losers for a given timeframe.

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `tf` | string | `1h` | Timeframe: `5m`, `15m`, `1h`, `4h`, `1d`, `1w` |
| `side` | string | `both` | `gainers`, `losers`, or `both` |
| `limit` | number | `20` | Max results per side |
| `exchange` | string | `all` | Filter by exchange |
| `sr_only` | boolean | `false` | Only show symbols near S/R |

**Response:**
```json
{
  "timeframe": "1h",
  "updated_at": "2026-03-01T14:30:00Z",
  "gainers": [
    {
      "symbol": "SOLUSDT",
      "base_symbol": "SOL",
      "exchange": "binance",
      "price": 148.52,
      "change_pct": 8.42,
      "volume_24h_usd": 1240000000,
      "open_interest": 580000000,
      "funding_rate": 0.0012,
      "near_sr": [
        {
          "timeframe": "1d",
          "type": "resistance",
          "level": 150.00,
          "distance_pct": 0.99,
          "strength": 3
        }
      ],
      "links": {
        "coinglass_heatmap": "https://www.coinglass.com/liquidation-heatmap/SOL",
        "coinglass_funding": "https://www.coinglass.com/funding/SOL",
        "coinglass_oi": "https://www.coinglass.com/open-interest/SOL",
        "tradingview": "https://www.tradingview.com/chart/?symbol=BINANCE:SOLUSDT.P"
      }
    }
  ],
  "losers": [...]
}
```

### `GET /api/sr-levels`

Returns computed S/R levels for a symbol.

**Query params:** `symbol` (required), `timeframe` (optional)

**Response:**
```json
{
  "symbol": "BTC",
  "levels": [
    { "timeframe": "1w", "type": "resistance", "price": 74200, "strength": 4 },
    { "timeframe": "1d", "type": "support", "price": 68500, "strength": 2 },
    { "timeframe": "4h", "type": "support", "price": 69800, "strength": 1 }
  ]
}
```

### `GET /api/metadata`

Returns list of tracked symbols, exchange status, last update times.

---

## 7. Frontend Components

### 7.1 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER: Crypto Perp Scanner          [Exchange Filter ▾]   │
├─────────────────────────────────────────────────────────────┤
│  TIMEFRAME TABS:  [5m] [15m] [1H] [4H] [1D] [1W]          │
├─────────────────────────────────────────────────────────────┤
│  TOGGLE: [Show All] [Near S/R Only]   [Refresh: 15s ●]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ▲ TOP GAINERS                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ #  Symbol  Exchange  Price   Chg%   Vol   OI  Fund  │    │
│  │    S/R Status              [Heatmap] [Chart]        │    │
│  │─────────────────────────────────────────────────────│    │
│  │ 1  SOLUSDT  BIN   $148.52  +8.4%  1.2B  580M 0.12% │    │
│  │    🔴 Near 1D Resistance @ $150.00 (0.99%)          │    │
│  │    [🔗 Heatmap] [📈 TradingView]                    │    │
│  │─────────────────────────────────────────────────────│    │
│  │ 2  WIFUSDT  BYB   $2.34    +7.1%  340M  89M  0.03% │    │
│  │    — No nearby S/R                                  │    │
│  │    [🔗 Heatmap] [📈 TradingView]                    │    │
│  │─────────────────────────────────────────────────────│    │
│  │ 3  ETHUSDT  BIN   $3,812   +5.2%  8.1B  4.2B 0.01% │    │
│  │    🟢 Near 1W Support @ $3,750 (1.6%)               │    │
│  │    ⚡ Compression: also near 1D Res @ $3,850        │    │
│  │    [🔗 Heatmap] [📈 TradingView]                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ▼ TOP LOSERS                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ (same format, sorted by largest negative change)    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Component Tree

```
<App>
  <Header />
  <TimeframeTabs activeTab={tf} onChange={setTf} />
  <FilterBar>
    <ExchangeFilter />
    <SROnlyToggle />
    <RefreshIndicator />
  </FilterBar>
  <Section title="Top Gainers">
    <TickerTable data={gainers}>
      <TickerRow>
        <SymbolCell />
        <PriceCell />
        <ChangeCell />          ← Color-coded green/red
        <VolumeCell />
        <OICell />
        <FundingCell />
        <SRBadge />             ← Highlighted if near S/R
        <LinkButtons />         ← Coinglass + TradingView
      </TickerRow>
    </TickerTable>
  </Section>
  <Section title="Top Losers">
    <TickerTable data={losers} />
  </Section>
</App>
```

### 7.3 S/R Highlighting Rules (CSS)

```
Near 1W S/R  →  Row border-left: 4px solid; background: rgba with glow
               Resistance = red (#ef4444), Support = green (#22c55e)

Near 1D S/R  →  Row border-left: 3px solid; subtle background tint
               Resistance = orange (#f97316), Support = yellow (#eab308)

Near 4H S/R  →  Small badge/pill only, no row highlight

Compression  →  Purple border (#a855f7), ⚡ icon, tooltip with details
```

---

## 8. Background Worker Architecture

### 8.1 Ticker Aggregator Worker

```
Schedule: Every 15-30 seconds (via setInterval in a long-running process, 
          or Vercel Cron + edge function for serverless)

Flow:
1. Promise.allSettled([
     fetchBinanceTickers(),
     fetchBybitTickers(),
     // fetchOKXTickers(),   // V2
     // fetchBitgetTickers(), // V2
   ])
2. Normalize all responses to common TickerData shape
3. Merge by base_symbol (aggregate volume, pick best price, etc.)
4. Compute short-term change % from candles_cache
5. Cross-reference with sr_levels table
6. Batch UPSERT into ticker_snapshots
7. Log latency + any exchange failures
```

### 8.2 S/R Calculator Worker

```
Schedule: Every 5 minutes for 4H, every 15 minutes for 1D/1W

Flow:
1. Get list of active symbols from symbols table
2. For each symbol (batched, respecting rate limits):
   a. Fetch last 100 candles per timeframe from exchange
   b. Cache in candles_cache table
   c. Run swing high/low detection
   d. Cluster nearby levels
   e. UPSERT into sr_levels
3. Prune stale levels (older than 30 days for 4H, 90 days for 1D/1W)
```

### 8.3 Rate Limit Management

```
Exchange       Limit                  Strategy
─────────────────────────────────────────────────────────
Binance        2400 weight/min        Batch ticker call = 40 weight
                                      ~60 calls/min budget remaining
Bybit          120 req/5s             Stagger requests, 100ms delay
OKX            20 req/2s              Sequential with backoff
Bitget         20 req/1s              Sequential with backoff

Implementation:
- Use a token bucket or sliding window per exchange
- Retry with exponential backoff on 429 responses
- Circuit breaker: if an exchange fails 3x consecutively, 
  skip for 60s and serve stale data with a "delayed" badge
```

---

## 9. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 14+ (App Router) | SSR, API routes, your existing stack |
| Styling | TailwindCSS | Rapid UI, easy highlight classes |
| State/Fetching | TanStack Query (React Query) | Auto-refetch, stale-while-revalidate |
| Database | Supabase (PostgreSQL) | Managed, real-time subscriptions, your existing stack |
| Cache (optional) | Upstash Redis | Sub-ms reads for ticker data if needed |
| Background Jobs | Vercel Cron + Edge Functions | Serverless, or a standalone Node process |
| S/R Engine | Python (or TypeScript) | Swing detection + clustering logic |
| Monitoring | Vercel Analytics + Sentry | Error tracking, latency monitoring |
| Deployment | Vercel | Zero-config Next.js deploy |
| Alerts (V2) | n8n / Make → Telegram | Webhook-based notifications |

---

## 10. Configuration

```env
# .env.local

# Exchange API keys (optional — only needed for higher rate limits)
BINANCE_API_KEY=
BINANCE_API_SECRET=
BYBIT_API_KEY=
BYBIT_API_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Upstash Redis (optional)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Scanner settings
TICKER_POLL_INTERVAL_MS=15000
SR_CALC_INTERVAL_MS=300000
SR_PROXIMITY_THRESHOLD_PCT=1.5
SR_CLUSTER_PCT=0.5
TOP_N_RESULTS=20
ACTIVE_EXCHANGES=binance,bybit

# Feature flags
ENABLE_OKX=false
ENABLE_BITGET=false
ENABLE_ALERTS=false
```

---

## 11. Link Generation Module

```typescript
// lib/links.ts

const EXCHANGE_TV_MAP: Record<string, string> = {
  binance: "BINANCE",
  bybit: "BYBIT",
  okx: "OKX",
  bitget: "BITGET",
};

export function getCoinglassHeatmapUrl(baseSymbol: string): string {
  return `https://www.coinglass.com/liquidation-heatmap/${baseSymbol}`;
}

export function getCoinglassFundingUrl(baseSymbol: string): string {
  return `https://www.coinglass.com/funding/${baseSymbol}`;
}

export function getCoinglassOIUrl(baseSymbol: string): string {
  return `https://www.coinglass.com/open-interest/${baseSymbol}`;
}

export function getTradingViewUrl(
  symbol: string,
  exchange: string = "binance"
): string {
  const tvExchange = EXCHANGE_TV_MAP[exchange] || "BINANCE";
  return `https://www.tradingview.com/chart/?symbol=${tvExchange}:${symbol}.P`;
}

// Usage:
// getCoinglassHeatmapUrl("BTC")
//   → "https://www.coinglass.com/liquidation-heatmap/BTC"
// getTradingViewUrl("BTCUSDT", "binance")
//   → "https://www.tradingview.com/chart/?symbol=BINANCE:BTCUSDT.P"
```

---

## 12. S/R Engine — Full Implementation Reference

```typescript
// lib/sr-engine.ts

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  openTime: number;
}

interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number;
  timeframe: string;
}

interface ProximityResult {
  level: SRLevel;
  distance_pct: number;
}

/**
 * Detect swing highs and lows from an array of candles.
 * Uses a 2-candle lookback/lookahead window.
 */
function detectSwingLevels(
  candles: Candle[],
  timeframe: string
): SRLevel[] {
  const levels: SRLevel[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const curr = candles[i];
    const prevHighs = [candles[i - 1].high, candles[i - 2].high];
    const nextHighs = [candles[i + 1].high, candles[i + 2].high];
    const prevLows = [candles[i - 1].low, candles[i - 2].low];
    const nextLows = [candles[i + 1].low, candles[i + 2].low];

    // Swing high → Resistance
    if (
      curr.high > Math.max(...prevHighs) &&
      curr.high > Math.max(...nextHighs)
    ) {
      levels.push({
        price: curr.high,
        type: "resistance",
        strength: 1,
        timeframe,
      });
    }

    // Swing low → Support
    if (
      curr.low < Math.min(...prevLows) &&
      curr.low < Math.min(...nextLows)
    ) {
      levels.push({
        price: curr.low,
        type: "support",
        strength: 1,
        timeframe,
      });
    }
  }

  return levels;
}

/**
 * Cluster levels that are within clusterPct of each other.
 * Returns averaged levels with combined strength.
 */
function clusterLevels(
  levels: SRLevel[],
  clusterPct: number = 0.5
): SRLevel[] {
  if (levels.length === 0) return [];

  // Sort by price
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clustered: SRLevel[] = [];
  let cluster: SRLevel[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = cluster[cluster.length - 1];
    const pctDiff = Math.abs(sorted[i].price - prev.price) / prev.price * 100;

    if (pctDiff <= clusterPct && sorted[i].type === prev.type) {
      cluster.push(sorted[i]);
    } else {
      // Finalize current cluster
      const avgPrice =
        cluster.reduce((sum, l) => sum + l.price, 0) / cluster.length;
      clustered.push({
        price: Math.round(avgPrice * 100) / 100,
        type: cluster[0].type,
        strength: cluster.length,
        timeframe: cluster[0].timeframe,
      });
      cluster = [sorted[i]];
    }
  }

  // Don't forget the last cluster
  const avgPrice =
    cluster.reduce((sum, l) => sum + l.price, 0) / cluster.length;
  clustered.push({
    price: Math.round(avgPrice * 100) / 100,
    type: cluster[0].type,
    strength: cluster.length,
    timeframe: cluster[0].timeframe,
  });

  return clustered;
}

/**
 * Check if current price is near any S/R level.
 */
function findNearbyLevels(
  currentPrice: number,
  levels: SRLevel[],
  thresholdPct: number = 1.5
): ProximityResult[] {
  return levels
    .map((level) => ({
      level,
      distance_pct:
        Math.round(
          (Math.abs(currentPrice - level.price) / level.price) * 10000
        ) / 100,
    }))
    .filter((r) => r.distance_pct <= thresholdPct)
    .sort((a, b) => a.distance_pct - b.distance_pct);
}

/**
 * Full pipeline: candles → clustered S/R levels.
 */
export function computeSRLevels(
  candles: Candle[],
  timeframe: string,
  clusterPct: number = 0.5
): SRLevel[] {
  const raw = detectSwingLevels(candles, timeframe);
  return clusterLevels(raw, clusterPct);
}

export { findNearbyLevels };
```

---

## 13. Deployment Strategy

### MVP (Week 1-2)

```
Phase 1 — Data Layer (Day 1-2):
  ✦ Set up Supabase tables
  ✦ Build exchange fetcher modules (Binance + Bybit)
  ✦ Ticker aggregation worker (cron or long-running)
  ✦ Verify data flows into ticker_snapshots

Phase 2 — S/R Engine (Day 3-4):
  ✦ Candle fetcher for 4H, 1D, 1W
  ✦ Swing high/low detection
  ✦ Level clustering
  ✦ Proximity checking
  ✦ S/R worker on cron

Phase 3 — API + Frontend (Day 5-7):
  ✦ /api/tickers endpoint with ranking + S/R attachment
  ✦ Next.js table UI with timeframe tabs
  ✦ S/R highlighting (row colors + badges)
  ✦ Coinglass + TradingView link buttons
  ✦ Auto-refresh via React Query

Phase 4 — Polish + Deploy (Day 8-10):
  ✦ Error handling, loading states, empty states
  ✦ Mobile responsive layout
  ✦ Deploy to Vercel
  ✦ Test with live data across market hours
```

### V2 Roadmap

```
✦ Add OKX + Bitget exchanges
✦ WebSocket real-time streaming (replace polling)
✦ Telegram/Discord alerts via n8n for S/R touches on top movers
✦ Volume profile-based S/R (in addition to swing detection)
✦ Funding rate heatmap view
✦ Historical performance tracking (did flagged S/R levels hold?)
✦ User accounts + watchlists (Supabase Auth)
✦ Embeddable widget mode for trading dashboards
```

---

## 14. Monitoring & Observability

```
Metrics to track:
─────────────────
• Exchange API latency (p50, p95, p99) per exchange
• Exchange API error rate + 429 (rate limit) frequency
• Ticker freshness: time since last successful update
• S/R calculation duration per batch
• Frontend: Time to interactive, refresh cycle success rate

Alerting:
─────────
• Exchange data stale > 60s → log warning, show "delayed" badge
• Exchange data stale > 5min → alert via Sentry/Slack
• S/R calculation fails 3x → alert + fallback to stale levels
• API response time > 2s → investigate
```

---

## 15. Security Considerations

```
• API keys stored in environment variables, never client-side
• Public exchange endpoints only — no trading or account access
• Rate limit own API routes to prevent abuse (Vercel built-in or Upstash ratelimit)
• No user authentication needed for MVP (read-only public data)
• CORS configured for own domain only
• Supabase RLS policies: service role for workers, anon for API reads
```

---

## 16. Cost Estimate (MVP)

```
Vercel (Hobby/Pro):     $0-20/mo   (API routes + cron)
Supabase (Free/Pro):    $0-25/mo   (database + real-time)
Upstash Redis:          $0-10/mo   (optional cache layer)
Domain:                 $10-15/yr
Exchange APIs:          $0          (public endpoints)
────────────────────────────────────
Total MVP:              $0-55/mo
```
