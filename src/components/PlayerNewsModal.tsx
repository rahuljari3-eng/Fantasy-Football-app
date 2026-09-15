import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { newsTypeColor, newsTypeIcon } from "../lib/format";
import type { NewsItem } from "../types";
import type { PlayerPerformanceResult, WeekPerformance } from "../lib/playerPerformance";

/** One game-log row: this week's live/final line, or a prior week's. */
function ScoreRow({ perf }: { perf: WeekPerformance }) {
  const played = perf.actualPoints != null;
  return (
    <div className="flex items-center justify-between bg-[#000000]/40 border border-[#38383A]/60 rounded-lg px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="text-sm text-[#E5E5EA]">Week {perf.week}</div>
        {perf.game && (
          <div className="text-[11px] text-[#636366] truncate">
            {perf.game.score ?? perf.game.name} · {perf.game.status}
          </div>
        )}
      </div>
      <span className={`mono-font text-sm shrink-0 ${played ? "text-[#C9A227]" : "text-[#636366]"}`}>
        {played ? perf.actualPoints : perf.projectedPoints != null ? `${perf.projectedPoints} proj` : "—"}
      </span>
    </div>
  );
}

/** Popped open by clicking a player's name or injury status anywhere in the
 * app -- shows this week's live/final line plus a recent game log (pulled
 * live from ESPN's actuals, not projections), and every news/injury item
 * ESPN has tagged to them, each linking straight out to the real article. */
export function PlayerNewsModal({
  playerName,
  items,
  performance,
  performanceLoading,
  onClose,
}: {
  playerName: string | null;
  items: NewsItem[];
  performance: PlayerPerformanceResult | null;
  performanceLoading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!playerName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playerName, onClose]);

  if (!playerName) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 animate-fade-in" onClick={onClose}>
      <div
        className="bg-[#1C1C1E] border border-[#38383A] rounded-xl w-full max-w-md max-h-[80vh] overflow-y-auto p-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="display-font text-lg">{playerName}</h3>
          <button onClick={onClose} aria-label="Close" className="text-[#98989D] hover:text-white p-1 rounded hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        {performanceLoading ? (
          <div className="text-xs text-[#636366] italic mb-3">Loading recent scores…</div>
        ) : performance ? (
          <div className="mb-4">
            <div className="text-xs font-medium text-[#98989D] mb-1.5">Recent scores</div>
            <div className="space-y-1.5">
              <ScoreRow perf={performance.thisWeek} />
              {performance.gameLog.slice(0, 3).map((g) => (
                <ScoreRow key={g.week} perf={g} />
              ))}
            </div>
          </div>
        ) : null}

        {performance && <div className="text-xs font-medium text-[#98989D] mb-1.5">News &amp; injuries</div>}
        {items.length === 0 ? (
          <div className="text-sm text-[#98989D]">No recent news or injury updates.</div>
        ) : (
          <div className="space-y-2">
            {items.map((n) => {
              const Icon = newsTypeIcon(n.type);
              return (
                <a
                  key={n.id}
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-2.5 bg-[#000000]/40 border border-[#38383A]/60 rounded-lg p-2.5 hover:border-[#C9A227]/50"
                >
                  <span className={`flex items-center justify-center w-7 h-7 rounded-lg border shrink-0 ${newsTypeColor(n.type)}`}>
                    <Icon size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[#E5E5EA]">{n.headline}</div>
                    <div className="text-[11px] text-[#636366] mt-1 mono-font flex items-center gap-1">
                      {n.time} <ExternalLink size={10} />
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
