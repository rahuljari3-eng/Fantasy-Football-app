import { NEWS_FEED } from "../data/news";
import { newsTypeColor, newsTypeIcon } from "../lib/format";
import type { FantasyApp } from "../hooks/useFantasyApp";

// Doesn't need the shared app state, but takes the same `{ app }` prop shape
// as every other page so App.tsx can render whichever tab is active uniformly.
export function NewsPage(_props: { app: FantasyApp }) {
  return (
    <div className="space-y-4">
      <h2 className="display-font text-xl">News & injury feed</h2>
      <p className="text-sm text-[#98989D] max-w-2xl">
        Sample feed shown in the format a live source would use. Swap src/data/news.ts for a real feed (e.g. Sleeper or ESPN's API) to make this live.
      </p>
      <div className="space-y-2">
        {NEWS_FEED.map((n) => {
          const Icon = newsTypeIcon(n.type);
          return (
            <div key={n.id} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-3.5 flex gap-3 hover:border-[#48484A]">
              <span className={`flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 ${newsTypeColor(n.type)}`}>
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{n.player}</span>
                    {n.team !== "—" && <span className="text-[#98989D]"> · {n.team}</span>}
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${newsTypeColor(n.type)}`}>{n.type}</span>
                </div>
                <div className="text-sm text-[#E5E5EA] mt-0.5">{n.headline}</div>
                <div className="text-[11px] text-[#636366] mt-1.5 mono-font">{n.time}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
