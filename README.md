# Crypto Perpetual Futures Scanner

Real-time dashboard aggregating **top gainers and losers** across perpetual futures markets on multiple centralized exchanges.

## Features

- Multi-exchange scanning (Binance, Bybit, OKX, Bitget)
- Multi-timeframe views (5m, 15m, 1H, 4H, 1D, 1W)
- Higher-timeframe support/resistance detection with visual highlighting
- Direct links to Coinglass liquidation heatmaps and TradingView charts
- Funding rate, open interest, and volume context

## Tech Stack

- **Frontend:** Next.js 14+ (App Router), TailwindCSS, TanStack Query
- **Database:** Supabase (PostgreSQL)
- **Cache:** Upstash Redis (optional)
- **Background Jobs:** Vercel Cron + Edge Functions
- **Deployment:** Vercel

## Getting Started

```bash
npm install
cp .env.example .env.local  # configure your environment variables
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis token |

## License

Private
