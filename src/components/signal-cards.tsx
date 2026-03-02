"use client";

import { useQuery } from "@tanstack/react-query";
import type { SignalResponse, SignalResult, SignalType, NewsSentiment } from "@/lib/types";

function formatPrice(price: number): string {
  if (price >= 1000)
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatVolume(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h ago`;
  return `${hours}h ${mins}m ago`;
}

const SIGNAL_LABELS: Record<SignalType, string> = {
  funding_divergence: "Funding Div",
  sr_rejection: "S/R Hold",
  volume_spike: "Vol Spike",
  oi_divergence: "OI Div",
  bos: "BOS",
  fvg: "FVG",
  displacement: "Displace",
  extreme_funding: "Ext. Funding",
  pre_breakout: "Pre-Break",
  range_compression: "Compression",
  mean_reversion: "Mean Rev",
  volume_exhaustion: "Vol Exhaust",
};

const SIGNAL_COLORS: Record<SignalType, string> = {
  funding_divergence: "bg-yellow-900/50 text-yellow-300",
  sr_rejection: "bg-blue-900/50 text-blue-300",
  volume_spike: "bg-orange-900/50 text-orange-300",
  oi_divergence: "bg-cyan-900/50 text-cyan-300",
  bos: "bg-pink-900/50 text-pink-300",
  fvg: "bg-indigo-900/50 text-indigo-300",
  displacement: "bg-rose-900/50 text-rose-300",
  extreme_funding: "bg-red-900/50 text-red-300",
  pre_breakout: "bg-violet-900/50 text-violet-300",
  range_compression: "bg-purple-900/50 text-purple-300",
  mean_reversion: "bg-teal-900/50 text-teal-300",
  volume_exhaustion: "bg-amber-900/50 text-amber-300",
};

const SENTIMENT_STYLES: Record<NewsSentiment["label"], string> = {
  Bullish: "bg-emerald-900/50 text-emerald-300",
  "Somewhat Bullish": "bg-emerald-900/30 text-emerald-400",
  Neutral: "bg-gray-800/50 text-gray-400",
  "Somewhat Bearish": "bg-red-900/30 text-red-400",
  Bearish: "bg-red-900/50 text-red-300",
};

function SignalCard({ result }: { result: SignalResult }) {
  const isLong = result.direction === "long";
  const isLowLiq = result.volume_24h_usd < 20_000_000;

  return (
    <div
      className={`flex-shrink-0 w-64 rounded-lg border p-3 ${
        isLong
          ? "border-emerald-800/60 bg-emerald-950/30"
          : "border-red-800/60 bg-red-950/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">{result.base_symbol}</span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              isLong
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {result.direction.toUpperCase()}
          </span>
          {result.rr_ratio > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400">
              {result.rr_ratio}R
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isLowLiq && (
            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
              Low Liq
            </span>
          )}
          <span className="text-xs text-gray-400 capitalize">{result.exchange}</span>
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-sm text-gray-200">
          ${formatPrice(result.price)}
        </span>
        <div className="flex items-center gap-2">
          {result.signal_age_minutes != null && result.signal_age_minutes > 0 && (
            <span className="text-[10px] text-gray-500">
              {formatAge(result.signal_age_minutes)}
            </span>
          )}
          <span
            className={`text-xs font-medium ${
              isLong ? "text-emerald-400" : "text-red-400"
            }`}
          >
            Score: {result.score}
          </span>
        </div>
      </div>

      <div className="space-y-0.5 mb-2 text-[11px] font-mono">
        <div className="flex justify-between">
          <span className="text-gray-500">TP</span>
          <span className="text-emerald-400">
            ${formatPrice(result.tp)}{" "}
            <span className="text-emerald-600">({result.tp_pct > 0 ? "+" : ""}{result.tp_pct.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">SL</span>
          <span className="text-red-400">
            ${formatPrice(result.sl)}{" "}
            <span className="text-red-600">({result.sl_pct > 0 ? "+" : ""}{result.sl_pct.toFixed(1)}%)</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Inv</span>
          <span className="text-gray-400">
            ${formatPrice(result.invalidation)}{" "}
            <span className="text-gray-600">({result.invalidation_pct > 0 ? "+" : ""}{result.invalidation_pct.toFixed(1)}%)</span>
          </span>
        </div>
      </div>

      {result.setup && (
        <p className="text-[11px] text-gray-300 leading-tight mb-2 line-clamp-2">
          {result.setup}
        </p>
      )}

      {result.news_sentiment && (
        <div className="flex items-center gap-1.5 mb-2">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${SENTIMENT_STYLES[result.news_sentiment.label]}`}
          >
            News: {result.news_sentiment.label} ({result.news_sentiment.articles})
          </span>
          {((result.direction === "long" &&
            result.news_sentiment.score <= -0.15) ||
            (result.direction === "short" &&
              result.news_sentiment.score >= 0.15)) && (
            <span className="text-[10px] text-yellow-400" title="News sentiment opposes signal direction">
              Conflicting
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-wrap gap-1">
          {result.signals.map((s, i) => (
            <span
              key={i}
              className={`text-[10px] px-1.5 py-0.5 rounded ${SIGNAL_COLORS[s.type]}`}
              title={s.label}
            >
              {SIGNAL_LABELS[s.type]}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-gray-500 ml-1 shrink-0">
          {formatVolume(result.volume_24h_usd)}
        </span>
      </div>

      <a
        href={result.links.tradingview}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-xs py-1 rounded bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 transition-colors"
      >
        TradingView
      </a>
    </div>
  );
}

export function SignalCards() {
  const { data, isLoading } = useQuery<SignalResponse>({
    queryKey: ["signals"],
    queryFn: () => fetch("/api/signals").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Trade Signals
        </h2>
        <div className="text-sm text-gray-500 py-4">Scanning for signals...</div>
      </div>
    );
  }

  if (!data?.results?.length) return null;

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Trade Signals
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700">
        {data.results.map((result) => (
          <SignalCard key={`${result.symbol}-${result.exchange}`} result={result} />
        ))}
      </div>
    </div>
  );
}
