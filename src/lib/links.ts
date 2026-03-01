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
