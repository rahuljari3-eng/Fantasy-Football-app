import { useEffect } from "react";
import { Activity, AlertTriangle, ChevronLeft } from "lucide-react";
import { SLOTS } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import { LockBadge } from "../components/LockBadge";
import { statusColor } from "../lib/format";
import type { FantasyApp } from "../hooks/useFantasyApp";

// Live game state (which drives the roster-lock rule) only ever changes
// while games are being played, so this is polled while the page is open --
// same idea as the League tab's standings poll.
const GAME_STATE_POLL_MS = 30_000;

export function LineupPage({ app }: { app: FantasyApp }) {
  const {
    roster,
    playerById,
    rosterTotal,
    autoOptimize,
    playerHasNews,
    openPlayerNews,
    isPlayerLocked,
    effectivePoints,
    refreshMatchups,
    refreshLiveLineups,
    displayWeek,
    isViewingCurrentWeek,
    weekTeamRoster,
    weekScoresLoading,
    setViewedWeek,
    leagueSchedule,
  } = app;

  useEffect(() => {
    // Only the live game-state poll -- pointless (and just extra ESPN
    // traffic) while browsing a past/future week, since that data doesn't
    // change and isn't what's being shown anyway.
    if (!isViewingCurrentWeek) return;
    refreshMatchups();
    refreshLiveLineups();
    const interval = setInterval(() => {
      refreshMatchups();
      refreshLiveLineups();
    }, GAME_STATE_POLL_MS);
    return () => clearInterval(interval);
  }, [isViewingCurrentWeek, refreshMatchups, refreshLiveLineups]);

  // While browsing a non-current week, this shows the REAL historical
  // starting lineup for that week (who was actually started, even if
  // someone left on the bench outscored them) -- see weekTeamRoster in
  // useFantasyApp, sourced from ESPN's own scoringPeriodId-scoped roster
  // snapshot, not today's lineup relabeled with old scores. ESPN only ever
  // has a real per-player projection for the CURRENT week, so a future week
  // beyond that has no data at all yet.
  const isFutureWeek = !isViewingCurrentWeek && leagueSchedule != null && displayWeek != null && displayWeek > leagueSchedule.currentWeek;
  const browsedStarters = weekTeamRoster?.starters ?? [];
  const browsedTotal = browsedStarters.reduce((sum, row) => sum + (row.actualPoints ?? row.projectedPoints ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="display-font text-xl">{isViewingCurrentWeek ? "Optimal starting lineup" : `Week ${displayWeek} — your real starting lineup`}</h2>
          <p className="text-sm text-[#98989D]">
            {isViewingCurrentWeek
              ? "Best available lineup by projected points, auto-benching anyone ruled Out."
              : isFutureWeek
              ? "ESPN doesn't publish per-player projections that far out yet -- only the current week has one."
              : `Who you actually started that week and what they scored -- even a benched player who outscored a starter stays on the bench here, same as it counted then.`}
          </p>
        </div>
        {isViewingCurrentWeek ? (
          <button
            onClick={autoOptimize}
            className="flex items-center gap-2 bg-[#C9A227] text-[#000000] font-semibold px-4 py-2 rounded-lg hover:bg-[#e0b82e] text-sm"
          >
            <Activity size={15} /> Auto-optimize from full pool
          </button>
        ) : (
          <button
            onClick={() => leagueSchedule && setViewedWeek(leagueSchedule.currentWeek)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#38383A] text-[#98989D] hover:text-[#C9A227] hover:border-[#C9A227]/50"
          >
            <ChevronLeft size={13} /> Back to current week
          </button>
        )}
      </div>

      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#38383A]">
          <span className="text-sm text-[#98989D]">{isViewingCurrentWeek ? "Projected total" : isFutureWeek ? "No projection yet" : "Actual total"}</span>
          <span className="mono-font text-2xl text-[#C9A227] font-semibold">
            {isViewingCurrentWeek ? rosterTotal.toFixed(1) : browsedTotal.toFixed(1)} pts
          </span>
        </div>
        {!isViewingCurrentWeek && weekScoresLoading && <div className="text-xs text-[#636366] italic mb-2">Loading Week {displayWeek}…</div>}
        {isViewingCurrentWeek ? (
          <div className="grid sm:grid-cols-2 gap-2">
            {SLOTS.map((slot) => {
              const id = roster[slot];
              const p = id != null ? playerById(id) : null;
              const locked = p ? isPlayerLocked(p) : false;
              return (
                <div key={slot} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${p ? "bg-[#000000] border-[#38383A]/60" : "bg-[#000000]/40 border-[#38383A]/40 border-dashed"}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="mono-font text-[11px] text-[#C9A227] w-9 shrink-0">{slot}</span>
                    {p ? (
                      <>
                        <PosBadge pos={p.pos} className="shrink-0" />
                        <div className="min-w-0">
                          <PlayerNameLink
                            name={p.name}
                            hasNews={playerHasNews(p.id)}
                            onOpen={() => openPlayerNews(p.id)}
                            className={`text-sm truncate ${locked ? "text-emerald-400" : ""}`}
                          />
                          {locked && <LockBadge />}
                          {p.status !== "Healthy" && (
                            playerHasNews(p.id) ? (
                              <button
                                type="button"
                                onClick={() => openPlayerNews(p.id)}
                                title="View related news"
                                className={`text-[11px] flex items-center gap-1 hover:underline decoration-dotted underline-offset-2 ${statusColor(p.status)}`}
                              >
                                <AlertTriangle size={10} /> {p.status}
                              </button>
                            ) : (
                              <div className={`text-[11px] flex items-center gap-1 ${statusColor(p.status)}`}>
                                <AlertTriangle size={10} /> {p.status}
                              </div>
                            )
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-[#636366] italic">Empty</span>
                    )}
                  </div>
                  {p && (
                    <span className={`mono-font text-sm font-medium shrink-0 ${locked ? "text-emerald-400" : "text-[#C9A227]"}`}>
                      {effectivePoints(p)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {browsedStarters.map((row) => {
              const p = playerById(row.playerId);
              const hasActual = row.actualPoints != null;
              const hasProj = row.projectedPoints != null;
              return (
                <div key={row.playerId} className="flex items-center justify-between rounded-lg px-3 py-2 border bg-[#000000] border-[#38383A]/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="mono-font text-[11px] text-[#C9A227] w-9 shrink-0">{row.slot}</span>
                    {p && <PosBadge pos={p.pos} className="shrink-0" />}
                    <div className="min-w-0">
                      <PlayerNameLink name={row.name} hasNews={playerHasNews(row.playerId)} onOpen={() => openPlayerNews(row.playerId)} className="text-sm truncate" />
                      <div className="text-[11px] text-[#636366]">
                        {row.game ? `${row.game.score ?? row.game.name} · ${row.game.status}` : hasActual ? "actual" : hasProj ? "projected" : "no data yet"}
                      </div>
                    </div>
                  </div>
                  <span className="mono-font text-sm font-medium shrink-0 text-[#C9A227]">{hasActual ? row.actualPoints : hasProj ? row.projectedPoints : "—"}</span>
                </div>
              );
            })}
            {!weekScoresLoading && browsedStarters.length === 0 && (
              <div className="sm:col-span-2 text-sm text-[#636366] italic px-1.5">No starters found for Week {displayWeek}.</div>
            )}
          </div>
        )}
      </div>

      {isViewingCurrentWeek && (
        <p className="text-xs text-[#636366]">
          Note: "Auto-optimize" pulls the best players from the entire pool by projection — use it to see the theoretical ceiling, then build toward it from waivers and trades. It doesn't require your saved roster.
        </p>
      )}
    </div>
  );
}
