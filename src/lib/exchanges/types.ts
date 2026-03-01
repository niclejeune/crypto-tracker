export interface RawTicker {
  symbol: string;
  base_symbol: string;
  exchange: string;
  price: number;
  price_change_24h: number;
  volume_24h_usd: number;
  funding_rate?: number;
  open_interest?: number;
}
