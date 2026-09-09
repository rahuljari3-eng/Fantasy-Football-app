import { Flame, Minus, Snowflake } from "lucide-react";
import type { PlayoffOutlook } from "../lib/playoffOdds";
import type { StandingRow } from "../lib/leagueSchedule";

/** Full league standings table, with playoff odds/status from the same
 * simulation the Playoff Race sub-tab uses, and a dashed line marking the
 * cutoff between "currently in" and "currently out". */
export function StandingsPanel({
  standings,
  outlookByTeam,
  myTeamId,
  playoffTeamCount,
}: {
  standings: StandingRow[];
  outlookByTeam: Map<number, PlayoffOutlook>;
  myTeamId: number;
  playoffTeamCount: number;
}) {
  return (
    <div className="overflow-x-auto bg-[#1C1C1E] border border-[#38383A] rounded-xl">
      <table className="w-full text-sm border-collapse min-w-[680px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-[#98989D] border-b border-[#38383A]">
            <th className="py-2.5 pl-4 pr-2">#</th>
            <th className="py-2.5 pr-3">Team</th>
            <th className="py-2.5 pr-3 text-center">Record</th>
            <th className="py-2.5 pr-3 text-right">PF</th>
            <th className="py-2.5 pr-3 text-right">PA</th>
            <th className="py-2.5 pr-3 text-center">Streak</th>
            <th className="py-2.5 pr-3 text-right">Playoff odds</th>
            <th className="py-2.5 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {standings.flatMap((s, i) => {
            const outlook = outlookByTeam.get(s.teamId);
            const isMe = s.teamId === myTeamId;
            const row = (
              <tr key={s.teamId} className={`border-b border-[#38383A]/60 last:border-0 ${isMe ? "bg-[#C9A227]/10" : ""}`}>
                <td className="py-2.5 pl-4 pr-2 mono-font text-[#98989D]">{i + 1}</td>
                <td className="py-2.5 pr-3">
                  <div className={`font-medium truncate ${isMe ? "text-[#C9A227]" : ""}`}>
                    {s.name}
                    {isMe ? " (You)" : ""}
                  </div>
                  <div className="text-[11px] text-[#98989D] truncate">{s.owner}</div>
                </td>
                <td className="py-2.5 pr-3 text-center mono-font">
                  {s.wins}-{s.losses}
                  {s.ties ? `-${s.ties}` : ""}
                </td>
                <td className="py-2.5 pr-3 text-right mono-font">{s.pointsFor.toFixed(1)}</td>
                <td className="py-2.5 pr-3 text-right mono-font text-[#98989D]">{s.pointsAgainst.toFixed(1)}</td>
                <td className="py-2.5 pr-3 text-center">
                  {s.streak ? (
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        s.streak.startsWith("W") ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {s.streak.startsWith("W") ? <Flame size={11} /> : <Snowflake size={11} />} {s.streak}
                    </span>
                  ) : (
                    <Minus size={12} className="text-[#636366] mx-auto" />
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right">
                  {outlook ? (
                    <span
                      className={`mono-font font-medium ${
                        outlook.status === "clinched" ? "text-emerald-400" : outlook.status === "eliminated" ? "text-red-400" : "text-[#C9A227]"
                      }`}
                    >
                      {outlook.makeOdds.toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-[#636366]">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-4">
                  {outlook?.status === "clinched" && <span className="text-[11px] font-medium text-emerald-400">Clinched</span>}
                  {outlook?.status === "eliminated" && <span className="text-[11px] font-medium text-red-400">Eliminated</span>}
                  {outlook?.status === "alive" && <span className="text-[11px] text-[#98989D]">In the hunt</span>}
                </td>
              </tr>
            );

            if (i !== playoffTeamCount - 1 || i >= standings.length - 1) return [row];
            return [
              row,
              <tr key="cutoff-line">
                <td colSpan={8} className="p-0">
                  <div className="border-t-2 border-dashed border-[#C9A227]/50" />
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
