import { Scale, TrendingDown, TrendingUp } from "lucide-react";
import { LOPSIDED_RATIO_MIN, LOPSIDED_RATIO_MAX } from "../config/trade";
import { fairnessRatio, starGateOk } from "../lib/tradeEngine";
import { PosBadge } from "./PosBadge";
import type { CompletedTrade } from "../lib/espn";
import type { Pricer } from "../lib/tradeEngine";
import type { LeagueTeam, Player } from "../types";

/** Grades every completed trade in the league -- both sides, regardless of
 * who made it -- the same way the interactive analyzer above grades a trade
 * you're building yourself. See fetchEspnCompletedTrades for how these are
 * reconstructed from public ESPN data (a pending offer is private, but once
 * two rosters have actually swapped players there's a real, public before/
 * after to grade). */
export function CompletedTradesPanel({
  trades,
  allTeams,
  playerById,
  tradeSideValue,
  pricer,
}: {
  trades: CompletedTrade[];
  allTeams: LeagueTeam[];
  playerById: (id: number) => Player | undefined;
  tradeSideValue: (ids: number[]) => number;
  /** Same This week/Rest of season pricer as the rest of the Trade Analyzer's
   * `tradeSideValue`, so the star gate's "was this a stud?" check agrees with
   * the values shown right next to it. */
  pricer: Pricer;
}) {
  if (trades.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="text-sm font-medium text-[#98989D] flex items-center gap-1.5">
        <Scale size={14} /> Completed trades in the league
      </div>
      {trades.map((t) => {
        const teamA = allTeams.find((x) => x.id === t.teamAId);
        const teamB = allTeams.find((x) => x.id === t.teamBId);
        const aPlayers = t.teamAReceived.map(playerById).filter((p): p is Player => !!p);
        const bPlayers = t.teamBReceived.map(playerById).filter((p): p is Player => !!p);
        const aVal = tradeSideValue(t.teamAReceived);
        const bVal = tradeSideValue(t.teamBReceived);
        // A reconstructed trade can have one side with no tracked players --
        // it moved only picks/FAAB this app doesn't track, or a player that
        // was later dropped and re-added, which erases that specific
        // player's own paper trail (see fetchEspnCompletedTrades). Either
        // way there's nothing real to grade the trade against, so skip the
        // fairness/star-gate math rather than showing a bogus ratio.
        const incomplete = aPlayers.length === 0 || bPlayers.length === 0;
        // From team A's perspective: what A gave up is what B received, and
        // vice versa -- same ratio/star-gate math the interactive analyzer uses.
        const ratio = fairnessRatio(bVal, aVal);
        const starGateViolation = !incomplete && !starGateOk(bPlayers, aPlayers, pricer);
        const favorsA = !incomplete && !starGateViolation && ratio > LOPSIDED_RATIO_MAX;
        const favorsB = !incomplete && (starGateViolation || ratio < LOPSIDED_RATIO_MIN);

        return (
          <div key={t.id} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-1.5">
              <div className="text-sm font-medium">
                {teamA?.name ?? `Team ${t.teamAId}`} <span className="text-[#636366] font-normal">vs</span> {teamB?.name ?? `Team ${t.teamBId}`}
              </div>
              <div className={`text-xs font-medium flex items-center gap-1 ${favorsA || favorsB ? "text-[#C9A227]" : "text-[#98989D]"}`}>
                {incomplete ? (
                  "Can't grade -- return side incomplete"
                ) : favorsA ? (
                  <>
                    <TrendingUp size={13} /> {teamA?.name ?? "Team A"} won this trade
                  </>
                ) : favorsB ? (
                  <>
                    <TrendingDown size={13} /> {teamB?.name ?? "Team B"} won this trade
                  </>
                ) : (
                  "Roughly even"
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { team: teamA, val: aVal, players: aPlayers },
                { team: teamB, val: bVal, players: bPlayers },
              ].map((side, i) => (
                <div key={i} className="bg-[#000000] rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-[#98989D]">{side.team?.name ?? "Unknown team"} received</span>
                    <span className="mono-font text-xs text-[#C9A227]">{side.val.toFixed(1)} val</span>
                  </div>
                  <div className="space-y-1">
                    {side.players.length > 0 ? (
                      side.players.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 text-sm">
                          <PosBadge pos={p.pos} className="rounded" />
                          {p.name}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[#636366] italic">
                        No tracked players -- likely picks/FAAB, or a player traded again since
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[11px] text-[#636366] mt-2.5">
              {incomplete ? (
                "One side's return couldn't be fully reconstructed from public ESPN data, so this trade isn't graded."
              ) : (
                <>
                  {starGateViolation && <span className="text-amber-400">A Tier-1 player moved without a Tier-1/2 player coming back. </span>}
                  Fairness ratio {ratio.toFixed(2)} (relative to {teamA?.name ?? "Team A"}).
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
