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
- **Data:** Stateless — live exchange API fetches cached via Next.js ISR (no database)
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
| `ACTIVE_EXCHANGES` | No | Comma-separated exchanges (default: `binance,bybit`) |
| `TOP_N_RESULTS` | No | Max results per side (default: `20`) |
| `SR_PROXIMITY_THRESHOLD_PCT` | No | S/R proximity threshold % (default: `1.5`) |

## License

Private
