// Only exchanges that TradingView actually supports for perp charts
const EXCHANGE_TV_MAP: Record<string, string> = {
  bybit: "BYBIT",
  mexc: "MEXC",
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
  exchange: string = "bybit"
): string {
  // HyperLiquid and Bitunix don't exist on TradingView — always fall back to BYBIT
  const tvExchange = EXCHANGE_TV_MAP[exchange] || "BYBIT";
  return `https://www.tradingview.com/chart/?symbol=${tvExchange}:${symbol}.P`;
}
