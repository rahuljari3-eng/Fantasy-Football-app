import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { MARKET_VALUE_WEIGHT } from "../config/scoring";
import { boomBustGames, boomBustModel, boomBustTrackRecord, typicalBoomBust, weeklyBoomBust } from "../lib/boomBust";
import { blendWeeklyProj } from "../lib/consensus";
import { newsTypeColor, newsTypeIcon } from "../lib/format";
import { qualityScore, seasonModelValue } from "../lib/scoring";
import type { NewsItem, Player, UsageLine, UsageSignal } from "../types";
import type { PlayerPerformanceResult, WeekPerformance } from "../lib/playerPerformance";
import PROJECTION_HISTORY from "../data/projectionHistory.json";
import type { ProjectionHistory } from "../lib/projectionAccuracy";
import { WeeklyChart } from "./WeeklyChart";

const HISTORY = PROJECTION_HISTORY as ProjectionHistory;

/** The app's custom projection for this player in a given week, as frozen at
 * kickoff by scripts/recordProjections.ts (null for weeks before recording began). */
function customProjection(playerId: number | undefined, week: number): number | null {
  if (playerId == null) return null;
  return HISTORY.weeks[String(week)]?.[String(playerId)]?.custom ?? null;
}

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

/** "8.3 tgt/g (proj 4.9)" for the opportunities that matter at a position. */
function usageDetail(pos: Player["pos"], usage: UsageSignal): string {
  const keys: [keyof UsageLine, string][] =
    pos === "QB" ? [["passAtt", "att"], ["rushAtt", "car"]] : pos === "RB" ? [["rushAtt", "car"], ["targets", "tgt"]] : [["targets", "tgt"], ["receptions", "rec"]];
  const lines = keys.map(([k, label]) => `${usage.actual[k].toFixed(1)} ${label}/g (proj ${usage.projected[k].toFixed(1)})`);
  return `${lines.join(" · ")} · season projection ×${usage.factor.toFixed(2)}`;
}

/** Where this player's numbers come from -- the consensus inputs stamped by
 * lib/consensus.ts, and how much of his season value is model vs market. */
function ValueBreakdown({ player }: { player: Player }) {
  const src = player.valueSources;
  const quality = qualityScore(player);
  const model = seasonModelValue(player) * (player.positionScale ?? 1);
  const hasMarket = player.marketQuality != null;
  const weekFromProjections = src ? blendWeeklyProj(src.espnWeek, src.sleeperWeek, player.pos) : null;
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
              ? `${Math.round(MARKET_VALUE_WEIGHT * 100)}% market (${player.marketQuality!.toFixed(0)}${
                  player.vegasQuality != null
                    ? `: FantasyCalc ${player.fantasyCalcQuality != null ? player.fantasyCalcQuality.toFixed(0) : "—"} + Vegas ${player.vegasQuality.toFixed(0)}`
                    : ""
                }) · ${Math.round((1 - MARKET_VALUE_WEIGHT) * 100)}% projections (${model.toFixed(0)})`
              : "Projections only — no market value for this player"
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
        {src?.usage && (
          <SourceRow
            label="Usage vs projected"
            value={`${src.usage.factor >= 1 ? "+" : ""}${((src.usage.factor - 1) * 100).toFixed(1)}%`}
            detail={usageDetail(player.pos, src.usage)}
          />
        )}
        {player.marketPosRank != null && (
          <SourceRow label="Trade market" value={`${player.pos}${player.marketPosRank}`} detail="FantasyCalc redraft value, from real trades" />
        )}
        {player.vegasProj != null && (
          <SourceRow
            label="Vegas pts/game"
            value={player.vegasProj.toFixed(1)}
            detail={`Sportsbook prop + game lines, ${player.vegasWeeks} week${player.vegasWeeks === 1 ? "" : "s"}`}
          />
        )}
      </div>
    </div>
  );
}

const RECENT_BOOM_BUST_GAMES = 8;

/** This week's chances of a boom or a bust (lib/boomBust.ts), from this
 * week's projection against his own fixed bars, plus recent games tagged. */
function BoomBustSection({ player }: { player: Player }) {
  const week = weeklyBoomBust(player.id, player.proj, player.seasonProj);
  const typical = typicalBoomBust();
  const recent = boomBustGames(player.id).slice(0, RECENT_BOOM_BUST_GAMES);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const tone = (chance: number, base: number, good: boolean) =>
    chance >= base * 1.3 ? (good ? "text-emerald-400" : "text-red-400") : chance <= base * 0.75 ? (good ? "text-red-400" : "text-emerald-400") : "text-[#E5E5EA]";

  return (
    <div className="mb-4">
      <div className="text-xs font-medium text-[#98989D] mb-1.5">Boom / bust chances this week</div>
      <div className="bg-[#000000]/40 border border-[#38383A]/60 rounded-lg px-2.5 py-2 text-xs space-y-2">
        {week ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className={`mono-font text-base ${tone(week.boomChance, typical.boomChance, true)}`}>{pct(week.boomChance)}</div>
                <div className="text-[10px] text-[#636366]">to boom · {week.boomAt}+ pts</div>
              </div>
              <div>
                <div className={`mono-font text-base ${tone(week.bustChance, typical.bustChance, false)}`}>{pct(week.bustChance)}</div>
                <div className="text-[10px] text-[#636366]">to bust · {week.bustAt} or less</div>
              </div>
            </div>
            <div className="text-[#98989D]">
              Projected <span className="mono-font text-[#E5E5EA]">{player.proj.toFixed(1)}</span> this week vs his usual{" "}
              <span className="mono-font text-[#E5E5EA]">{week.baseline.toFixed(1)}</span>. Typical player: {pct(typical.boomChance)} boom /{" "}
              {pct(typical.bustChance)} bust.
            </div>
          </>
        ) : (
          <div className="text-[#636366]">Projected under 5 points this week — no boom/bust odds.</div>
        )}
        {recent.length > 0 && (
          <div>
            <div className="text-[10px] text-[#636366] mb-1">Recent games vs. that week's projection</div>
            <div className="flex flex-wrap gap-1">
              {recent.map((g) => (
                <span
                  key={`${g.season}-${g.week}`}
                  title={`${g.season} week ${g.week}: ${g.actual} actual vs ${g.proj} projected`}
                  className={`mono-font text-[10px] px-1.5 py-px rounded border ${
                    g.result === "boom"
                      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                      : g.result === "bust"
                      ? "text-red-300 border-red-500/30 bg-red-500/10"
                      : "text-[#98989D] border-[#38383A]"
                  }`}
                >
                  {`'${String(g.season).slice(2)} W${g.week} ${g.actual}`}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="text-[10px] text-[#636366] leading-snug">
          The app's own odds, not ESPN's. His boom and bust bars sit one typical week's swing above and below his usual output, so stars need bigger
          games. This week's projection and how widely past scores landed around projections set the chances
          {week ? ` (${week.games} of his games, blended with comparable games league-wide)` : ""}. The formula retunes itself every hour from
          every finished game, and only weighs position, game environment or the betting market's lean once they've proven they help.
        </div>
        <BoomBustTrackRecordLine />
      </div>
    </div>
  );
}

/** How the boom/bust odds have held up: the predictions frozen at kickoff
 * graded against finals once there are any, else the forward backtest the
 * formula was tuned on. Either way, measured against just giving everyone
 * the league's base rate. */
function BoomBustTrackRecordLine() {
  const record = boomBustTrackRecord();
  const backtest = boomBustModel().backtest;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const edge = (brier: number, base: number) => {
    const gain = base > 0 ? (1 - brier / base) * 100 : 0;
    return gain >= 0.5 ? `${gain.toFixed(1)}% more accurate than` : gain <= -0.5 ? `${(-gain).toFixed(1)}% less accurate than` : "about even with";
  };
  if (record && record.games >= 50) {
    return (
      <div className="text-[10px] text-[#636366] leading-snug">
        Track record: {record.games} graded games — predicted {pct(record.predictedBoom)} boom / {pct(record.predictedBust)} bust, actual{" "}
        {pct(record.actualBoom)} / {pct(record.actualBust)}; {edge(record.brier, record.baseRateBrier)} giving everyone the average.
      </div>
    );
  }
  if (!backtest) return null;
  return (
    <div className="text-[10px] text-[#636366] leading-snug">
      Backtest on {backtest.games} games this season: {edge(backtest.brier, backtest.baseRateBrier)} giving everyone the average. Single weeks are
      noisy, so expect modest edges.
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
        {player && ["QB", "RB", "WR", "TE"].includes(player.pos) && <BoomBustSection player={player} />}

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
                  secondaryLabel="Custom projection"
                  points={[...performance.gameLog]
                    .sort((a, b) => a.week - b.week)
                    .map((g) => ({
                      week: g.week,
                      primary: g.actualPoints,
                      reference: g.projectedPoints,
                      secondary: customProjection(player?.id, g.week),
                    }))}
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
