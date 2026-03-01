"use client";

interface TimeframeTabsProps {
  timeframes: string[];
  active: string;
  onChange: (tf: string) => void;
}

export function TimeframeTabs({ timeframes, active, onChange }: TimeframeTabsProps) {
  return (
    <div className="flex gap-1 mb-6 p-1 bg-gray-900 rounded-lg w-fit">
      {timeframes.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            active === tf
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          }`}
        >
          {tf.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
