import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { MARKET_VALUE_WEIGHT } from "../config/scoring";
import { blendWeeklyProj } from "../lib/consensus";
import { newsTypeColor, newsTypeIcon } from "../lib/format";
import { qualityScore, seasonModelValue } from "../lib/scoring";
import type { NewsItem, Player } from "../types";
import type { PlayerPerformanceResult, WeekPerformance } from "../lib/playerPerformance";
import { WeeklyChart } from "./WeeklyChart";

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

function SourceRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-t border-[#38383A]/60 first:border-0">
      <span className="text-[#98989D]">{label}</span>
      <span className="text-right">
        <span className="mono-font text-[#E5E5EA]">{value}</span>
        {detail && <span className="block text-[10px] text-[#636366]">{detail}</span>}
      </span>
    </div>
  );
}

/** Where this player's numbers come from -- the consensus inputs stamped by
 * lib/consensus.ts, and how much of his season value is model vs market. */
function ValueBreakdown({ player }: { player: Player }) {
  const src = player.valueSources;
  const quality = qualityScore(player);
  const model = seasonModelValue(player) * (player.positionScale ?? 1);
  const hasMarket = player.marketQuality != null;
  const weekFromProjections = src ? blendWeeklyProj(src.espnWeek, src.sleeperWeek) : null;
  const propsApplied = weekFromProjections != null && Math.abs(weekFromProjections - player.proj) >= 0.05;
  const fmt = (v: number | undefined) => (v == null ? null : v.toFixed(1));
  const parts = (items: [string, string | null][]) =>
    items
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");

  return (
    <div className="mb-4">
      <div className="text-xs font-medium text-[#98989D] mb-1.5">How this value is built</div>
      <div className="bg-[#000000]/40 border border-[#38383A]/60 rounded-lg px-2.5 py-1 text-xs">
        <SourceRow
          label="Season value"
          value={quality.toFixed(0)}
          detail={
            hasMarket
              ? `${Math.round(MARKET_VALUE_WEIGHT * 100)}% trade market (${player.marketQuality!.toFixed(0)}) · ${Math.round((1 - MARKET_VALUE_WEIGHT) * 100)}% projections (${model.toFixed(0)})`
              : "Projections only — no trade-market value for this player"
          }
        />
        <SourceRow
          label="Season pts/game"
          value={(player.seasonProj ?? player.proj).toFixed(1)}
          detail={
            src
              ? parts([
                  ["ESPN", fmt(src.espnSeason)],
                  ["Sleeper", fmt(src.sleeperRos)],
                  ["Actual", src.actualAvg != null ? `${src.actualAvg.toFixed(1)} (${src.gamesPlayed}g)` : null],
                ]) || undefined
              : undefined
          }
        />
        <SourceRow
          label="This week"
          value={player.proj.toFixed(1)}
          detail={
            src
              ? [parts([["ESPN", fmt(src.espnWeek)], ["Sleeper", fmt(src.sleeperWeek)]]), propsApplied ? "adjusted to DraftKings yardage props" : null]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        {player.marketPosRank != null && (
          <SourceRow label="Trade market" value={`${player.pos}${player.marketPosRank}`} detail="FantasyCalc redraft value, from real trades" />
        )}
      </div>
    </div>
  );
}

/** Popped open by clicking a player's name or injury status anywhere in the
 * app -- shows this week's live/final line plus a recent game log (pulled
 * live from ESPN's actuals, not projections), and every news/injury item
 * ESPN has tagged to them, each linking straight out to the real article. */
export function PlayerNewsModal({
  playerName,
  player,
  items,
  performance,
  performanceLoading,
  onClose,
}: {
  playerName: string | null;
  /** The effective (consensus-valued) player, for the value breakdown. */
  player: Player | null;
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

        {player && <ValueBreakdown player={player} />}

        {performanceLoading ? (
          <div className="text-xs text-[#636366] italic mb-3">Loading recent scores…</div>
        ) : performance ? (
          <div className="mb-4">
            {performance.gameLog.length > 0 && (
              <div className="mb-3">
                <WeeklyChart
                  title="Actual vs. projected, by week"
                  primaryLabel="Actual"
                  referenceLabel="ESPN projection"
                  points={[...performance.gameLog]
                    .sort((a, b) => a.week - b.week)
                    .map((g) => ({ week: g.week, primary: g.actualPoints, reference: g.projectedPoints }))}
                />
              </div>
            )}
            <div className="text-xs font-medium text-[#98989D] mb-1.5">Recent scores</div>
            <div className="space-y-1.5">
              <ScoreRow perf={performance.thisWeek} />
              {performance.gameLog.slice(0, 3).map((g) => (
                <ScoreRow key={g.week} perf={g} />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-[#636366] mb-3">Couldn't load recent scores from ESPN right now — try again in a minute.</div>
        )}

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
