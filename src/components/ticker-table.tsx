"use client";

import type { TickerData } from "@/lib/types";
import { SRBadge } from "./sr-badge";

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatCompact(val: number): string {
  if (val >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K`;
  return val.toFixed(0);
}

function formatFunding(rate?: number): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(4)}%`;
}

function getRowHighlight(ticker: TickerData): string {
  if (ticker.near_sr.length === 0) return "";

  const hasSupport = ticker.near_sr.some((s) => s.type === "support");
  const hasResistance = ticker.near_sr.some((s) => s.type === "resistance");

  if (hasSupport && hasResistance) {
    return "border-l-4 border-purple-500 bg-purple-500/5";
  }

  const top = ticker.near_sr[0]!;
  if (top.timeframe === "1w") {
    return top.type === "resistance"
      ? "border-l-4 border-red-500 bg-red-500/5"
      : "border-l-4 border-emerald-500 bg-emerald-500/5";
  }
  if (top.timeframe === "1d") {
    return top.type === "resistance"
      ? "border-l-3 border-orange-500 bg-orange-500/5"
      : "border-l-3 border-yellow-500 bg-yellow-500/5";
  }
  return "";
}

interface TickerTableProps {
  tickers: TickerData[];
  side: "gainers" | "losers";
}

export function TickerTable({ tickers, side }: TickerTableProps) {
  if (tickers.length === 0) {
    return <div className="text-gray-500 text-sm py-4">No data available</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
            <th className="px-3 py-2 text-left w-8">#</th>
            <th className="px-3 py-2 text-left">Symbol</th>
            <th className="px-3 py-2 text-left">Exchange</th>
            <th className="px-3 py-2 text-right">Price</th>
            <th className="px-3 py-2 text-right">Change</th>
            <th className="px-3 py-2 text-right">Mkt Cap</th>
            <th className="px-3 py-2 text-right">Volume</th>
            <th className="px-3 py-2 text-right">Funding</th>
            <th className="px-3 py-2 text-left">S/R</th>
            <th className="px-3 py-2 text-center">Links</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {tickers.map((ticker, i) => (
            <tr
              key={`${ticker.symbol}-${ticker.exchange}`}
              className={`hover:bg-gray-800/50 transition-colors ${getRowHighlight(ticker)}`}
            >
              <td className="px-3 py-2.5 text-gray-500">{i + 1}</td>
              <td className="px-3 py-2.5 font-medium">
                <span className="text-white">{ticker.base_symbol}</span>
                <span className="text-gray-500 text-xs ml-1">USDT</span>
              </td>
              <td className="px-3 py-2.5">
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 capitalize">
                  {ticker.exchange}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono">
                ${formatPrice(ticker.price)}
              </td>
              <td
                className={`px-3 py-2.5 text-right font-mono font-medium ${
                  ticker.change_pct >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {ticker.change_pct > 0 ? "+" : ""}
                {ticker.change_pct.toFixed(2)}%
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 font-mono">
                {ticker.market_cap ? `$${formatCompact(ticker.market_cap)}` : "—"}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 font-mono">
                ${formatCompact(ticker.volume_24h_usd)}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 font-mono text-xs">
                {formatFunding(ticker.funding_rate)}
              </td>
              <td className="px-3 py-2.5">
                <SRBadge nearSR={ticker.near_sr} />
              </td>
              <td className="px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <a
                    href={ticker.links.coinglass_heatmap}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300 hover:bg-blue-800/50 transition-colors"
                    title="Liquidation Heatmap"
                  >
                    Liq
                  </a>
                  <a
                    href={ticker.links.tradingview}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 transition-colors"
                    title="TradingView Chart"
                  >
                    TV
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
