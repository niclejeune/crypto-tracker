export interface TickerData {
  symbol: string;
  base_symbol: string;
  exchange: string;
  price: number;
  change_pct: number;
  volume_24h_usd: number;
  market_cap?: number;
  open_interest?: number;
  funding_rate?: number;
  near_sr: ProximityResult[];
  links: {
    coinglass_heatmap: string;
    coinglass_funding: string;
    coinglass_oi: string;
    tradingview: string;
  };
}

export interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number;
  timeframe: string;
}

export interface ProximityResult {
  timeframe: string;
  type: "support" | "resistance";
  level: number;
  distance_pct: number;
  strength: number;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  openTime: number;
  volume?: number;
}

export interface NewsSentiment {
  score: number; // -1 (max bearish) to +1 (max bullish)
  label: "Bearish" | "Somewhat Bearish" | "Neutral" | "Somewhat Bullish" | "Bullish";
  articles: number;
  sources: string[]; // "cryptopanic" | "alphavantage"
}

export type SignalDirection = "long" | "short";
export type SignalType =
  | "funding_divergence"
  | "sr_rejection"
  | "volume_spike"
  | "oi_divergence"
  | "bos"
  | "fvg"
  | "displacement"
  | "extreme_funding"
  | "pre_breakout"
  | "range_compression"
  | "mean_reversion"
  | "volume_exhaustion";

export interface Signal {
  type: SignalType;
  direction: SignalDirection;
  weight: number;
  label: string;
}

export interface SignalResult {
  symbol: string;
  base_symbol: string;
  exchange: string;
  price: number;
  direction: SignalDirection;
  score: number;
  signals: Signal[];
  setup: string;
  tp: number;
  sl: number;
  invalidation: number;
  tp_pct: number;
  sl_pct: number;
  invalidation_pct: number;
  rr_ratio: number;
  volume_24h_usd: number;
  signal_age_minutes?: number;
  news_sentiment?: NewsSentiment;
  links: TickerData["links"];
}

export interface SignalResponse {
  updated_at: string;
  results: SignalResult[];
}

export interface TickerResponse {
  timeframe: string;
  updated_at: string;
  gainers: TickerData[];
  losers: TickerData[];
}
