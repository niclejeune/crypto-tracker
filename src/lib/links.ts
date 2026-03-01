const EXCHANGE_TV_MAP: Record<string, string> = {
  binance: "BINANCE",
  bybit: "BYBIT",
  okx: "OKX",
  bitget: "BITGET",
};

export function getCoinglassHeatmapUrl(baseSymbol: string): string {
  return `https://www.coinglass.com/pro/futures/LiquidationHeatMap?coin=${baseSymbol}`;
}

export function getCoinglassFundingUrl(baseSymbol: string): string {
  return `https://www.coinglass.com/FundingRate/${baseSymbol}`;
}

export function getCoinglassOIUrl(baseSymbol: string): string {
  return `https://www.coinglass.com/currencies/${baseSymbol}`;
}

export function getTradingViewUrl(
  symbol: string,
  exchange: string = "binance"
): string {
  const tvExchange = EXCHANGE_TV_MAP[exchange] || "BINANCE";
  return `https://www.tradingview.com/chart/?symbol=${tvExchange}:${symbol}.P`;
}
