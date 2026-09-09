import { CheckCircle2, Target, XCircle } from "lucide-react";
import type { PlayoffOutlook } from "../lib/playoffOdds";
import type { LeagueTeam } from "../types";

/** Per-team playoff-race cards: current odds, clinched/eliminated/alive
 * status, and -- for anyone still alive -- a plain-English sentence on
 * exactly what has to happen (win X of the last Y games to control it
 * outright, or who else needs to lose). */
export function PlayoffRacePanel({
  outlooks,
  teamsById,
  myTeamId,
}: {
  outlooks: PlayoffOutlook[];
  teamsById: Map<number, LeagueTeam>;
  myTeamId: number;
}) {
  const sorted = [...outlooks].sort((a, b) => b.makeOdds - a.makeOdds || b.wins - a.wins || b.pointsFor - a.pointsFor);

  return (
    <div className="space-y-2.5">
      {sorted.map((o) => {
        const team = teamsById.get(o.teamId);
        const isMe = o.teamId === myTeamId;
        return (
          <div key={o.teamId} className={`bg-[#1C1C1E] border rounded-xl p-4 ${isMe ? "border-[#C9A227]/60" : "border-[#38383A]"}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className={`font-semibold truncate ${isMe ? "text-[#C9A227]" : ""}`}>
                  {team?.name ?? `Team ${o.teamId}`}
                  {isMe ? " (You)" : ""}
                </div>
                <div className="text-xs text-[#98989D] truncate">
                  {team?.owner} · {o.wins}-{o.losses}
                  {o.ties ? `-${o.ties}` : ""} · {o.pointsFor.toFixed(1)} PF
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {o.status === "clinched" && <CheckCircle2 size={16} className="text-emerald-400" />}
                {o.status === "eliminated" && <XCircle size={16} className="text-red-400" />}
                {o.status === "alive" && <Target size={16} className="text-[#C9A227]" />}
                <span
                  className={`mono-font text-lg font-semibold ${
                    o.status === "clinched" ? "text-emerald-400" : o.status === "eliminated" ? "text-red-400" : "text-[#C9A227]"
                  }`}
                >
                  {o.makeOdds.toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="mt-2.5 text-sm text-[#E5E5E7]">{o.summary}</div>

            {o.status === "alive" && o.gamesRemaining > 0 && (
              <details className="mt-2.5 text-sm group">
                <summary className="cursor-pointer text-[#C9A227] hover:text-[#e0b82e] text-xs font-medium select-none">
                  Remaining schedule ({o.gamesRemaining} game{o.gamesRemaining === 1 ? "" : "s"})
                </summary>
                <div className="mt-2 space-y-1">
                  {o.remaining.map((g) => (
                    <div key={g.week} className="flex items-center justify-between bg-[#000000] rounded-lg px-2.5 py-1.5 text-xs">
                      <span>
                        Week {g.week} vs {g.opponentName}
                      </span>
                      <span className="text-[#98989D] mono-font">{g.opponentRecord}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
