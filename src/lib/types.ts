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
}

export interface TickerResponse {
  timeframe: string;
  updated_at: string;
  gainers: TickerData[];
  losers: TickerData[];
}
