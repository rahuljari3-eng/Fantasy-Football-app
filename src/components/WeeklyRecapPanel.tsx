import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, RefreshCw, Sparkles } from "lucide-react";
import { PosBadge } from "./PosBadge";
import { PlayerNameLink } from "./PlayerNameLink";
import type { LeagueScheduleSnapshot } from "../lib/leagueSchedule";
import type { UseWeeklyRecap } from "../hooks/useWeeklyRecap";

/** League-wide AI weekly recap -- one blurb per team for a completed week,
 * generated on demand (it's a real, billed OpenAI call) and cached locally
 * afterward. See useWeeklyRecap for the generation/caching logic. */
export function WeeklyRecapPanel({
  leagueSchedule,
  recap,
  myTeamId,
  playerHasNews,
  openPlayerNews,
}: {
  leagueSchedule: LeagueScheduleSnapshot;
  recap: UseWeeklyRecap;
  myTeamId: number;
  playerHasNews: (id: number) => boolean;
  openPlayerNews: (id: number) => void;
}) {
  const { recaps, recapWeek, loading, error, generate, checkCached, reset } = recap;

  // Deliberately independent of the header's global week picker -- that
  // control's default is the live/in-progress week, and coupling an
  // expensive, non-deterministic OpenAI call to a widely shared piece of
  // state risks a surprise regeneration from an unrelated week change
  // elsewhere in the app.
  const decidedWeeks = useMemo(() => {
    const weeks = new Set(leagueSchedule.schedule.filter((m) => m.decided).map((m) => m.week));
    return [...weeks].sort((a, b) => b - a);
  }, [leagueSchedule]);

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const week = selectedWeek ?? decidedWeeks[0] ?? null;

  // Loading an already-generated week is free (localStorage only) so it can
  // happen automatically; generating a NEW one always waits for the button.
  useEffect(() => {
    if (week == null) return;
    let cancelled = false;
    reset();
    checkCached(week).then((cached) => {
      if (cancelled) return;
      if (cached) generate(week);
    });
    return () => {
      cancelled = true;
    };
  }, [week, checkCached, generate, reset]);

  if (decidedWeeks.length === 0) {
    return <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-6 text-sm text-[#98989D]">No completed weeks yet this season.</div>;
  }

  const showingCached = recaps != null && recapWeek === week && !loading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 bg-[#000000] border border-[#38383A] rounded-full pl-3 pr-1 py-1 focus-within:border-[#C9A227]/60">
          <span className="text-[10px] text-[#98989D] mono-font tracking-wide">WEEK</span>
          <select
            value={week ?? ""}
            onChange={(e) => setSelectedWeek(Number(e.target.value))}
            className="bg-transparent text-xs font-semibold text-[#C9A227] focus:outline-none cursor-pointer pr-1 py-0.5"
          >
            {decidedWeeks.map((w) => (
              <option key={w} value={w} className="bg-[#1C1C1E] text-[#FFFFFF]">
                Week {w}
              </option>
            ))}
          </select>
        </label>
        {week != null && (
          <button
            onClick={() => generate(week, { force: true })}
            disabled={loading}
            className="hover-lift flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-[#38383A] text-[#98989D] hover:text-[#C9A227] hover:border-[#C9A227]/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {showingCached ? "Regenerate" : loading ? "Generating…" : "Generate recap"}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {!showingCached && !loading && !error && (
        <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-6 text-center">
          <Sparkles size={18} className="text-[#C9A227] mx-auto mb-2" />
          <div className="text-sm text-[#98989D]">
            No recap generated for week {week} yet -- hit "Generate recap" for an AI blurb per team covering results, news, bench regrets, and next week.
          </div>
        </div>
      )}

      {loading && !showingCached && <div className="text-xs text-[#636366] italic">Writing this week's recaps…</div>}

      {showingCached && recaps && (
        <div className="grid md:grid-cols-2 gap-3">
          {recaps.map((t) => {
            const isMe = t.teamId === myTeamId;
            const won = t.result === "W";
            const tied = t.result === "T";
            return (
              <div key={t.teamId} className={`bg-[#1C1C1E] border rounded-xl p-4 ${isMe ? "border-[#C9A227]/50" : "border-[#38383A]"}`}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className={`font-semibold truncate ${isMe ? "text-[#C9A227]" : ""}`}>
                    {t.teamName}
                    {isMe ? " (You)" : ""}
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      tied
                        ? "bg-[#2C2C2E] text-[#98989D] border-[#38383A]"
                        : won
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : "bg-red-500/15 text-red-300 border-red-500/30"
                    }`}
                  >
                    {t.result} {t.teamScore}–{t.opponentScore} vs {t.opponentName}
                  </span>
                </div>

                <p className="text-sm text-[#E5E5EA] leading-relaxed whitespace-pre-line">{t.blurb}</p>

                {t.swap?.actual && t.swap.optimal && (
                  <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-2 text-xs text-amber-200">
                    <ArrowRightLeft size={13} className="shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        Should've started
                        {t.swap.optimal.pos && <PosBadge pos={t.swap.optimal.pos} className="rounded" />}
                        <PlayerNameLink
                          name={t.swap.optimal.name}
                          hasNews={playerHasNews(t.swap.optimal.playerId)}
                          onOpen={() => openPlayerNews(t.swap!.optimal!.playerId)}
                          className="font-medium"
                        />
                        <span>over</span>
                        <PlayerNameLink
                          name={t.swap.actual.name}
                          hasNews={playerHasNews(t.swap.actual.playerId)}
                          onOpen={() => openPlayerNews(t.swap!.actual!.playerId)}
                          className="font-medium"
                        />
                      </div>
                      <div className="text-amber-200/70 mt-0.5">
                        +{t.swap.pointsGained.toFixed(1)} pts left at {t.swap.slot}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-2 border-t border-white/10 text-[11px] text-[#98989D]">
                  {t.nextOpponentName ? (
                    <>
                      Next (Week {t.nextWeek}): <span className="text-[#E5E5EA]">{t.nextOpponentName}</span>
                    </>
                  ) : (
                    "Regular season complete"
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
