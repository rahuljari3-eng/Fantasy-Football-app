import { matchupGradeColor } from "../lib/format";
import type { PlayerMatchup } from "../types";

/** Opponent + Vegas-graded matchup quality for one player this week (see
 * lib/matchup.ts). Renders "BYE" when the player's team isn't playing. */
export function MatchupBadge({ matchup }: { matchup: PlayerMatchup }) {
  if (matchup.isBye) {
    return (
      <span
        title="On a bye this week"
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-[#38383A]/40 text-[#98989D] border-[#38383A]"
      >
        BYE
      </span>
    );
  }

  const oppText = matchup.homeAway === "home" ? `vs ${matchup.opponent}` : `@ ${matchup.opponent}`;
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="text-[11px] text-[#98989D]">{oppText}</span>
      {matchup.grade && (
        <span title={matchup.label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${matchupGradeColor(matchup.grade)}`}>
          {matchup.grade}
        </span>
      )}
    </span>
  );
}
