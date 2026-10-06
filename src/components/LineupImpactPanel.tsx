import { FAIR_RATIO_MAX, FAIR_RATIO_MIN } from "../config/trade";
import type { LineupImpact, SideLineupImpact } from "../lib/lineupImpact";

/** Below this many points per week, a lineup change is noise, not a story. */
const MEANINGFUL_PER_WEEK = 0.3;

function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(digits)}`;
}

function toneClass(perWeek: number): string {
  if (perWeek >= MEANINGFUL_PER_WEEK) return "text-emerald-400";
  if (perWeek <= -MEANINGFUL_PER_WEEK) return "text-red-400";
  return "text-[#98989D]";
}

function SideRow({ label, side, impact }: { label: string; side: SideLineupImpact; impact: LineupImpact }) {
  const single = impact.weeks === 1;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-[#98989D]">{label}</span>
      <span className="mono-font text-xs">
        <span className={toneClass(side.perWeek)}>
          {signed(side.delta)} pts{single ? ` in week ${impact.fromWeek}` : ` over ${impact.weeks} wks`}
        </span>
        {!single && <span className="text-[#636366]"> ({signed(side.perWeek)}/wk)</span>}
        {!single && side.playoffPerWeek != null && impact.playoffWeeks < impact.weeks && (
          <span className={`ml-2 ${toneClass(side.playoffPerWeek)}`}>playoffs {signed(side.playoffPerWeek)}/wk</span>
        )}
      </span>
    </div>
  );
}

/** One sentence reconciling the value verdict with what the trade does to
 * the lineup you'd actually start -- the two can (and often should) differ. */
function takeaway(impact: LineupImpact, ratio: number | null, horizonLabel: string): string | null {
  const mine = impact.my.perWeek;
  const theirs = impact.their?.perWeek;
  const valueFavorsYou = ratio != null && ratio > FAIR_RATIO_MAX;
  const valueFavorsThem = ratio != null && ratio < FAIR_RATIO_MIN;
  if (valueFavorsYou && mine < MEANINGFUL_PER_WEEK)
    return `Wins on value, but barely moves (or lowers) the lineup you'd start ${horizonLabel} — you'd be collecting players who don't crack your starting lineup. Fine as a value play; not a lineup fix.`;
  if (valueFavorsThem && mine >= MEANINGFUL_PER_WEEK)
    return `Overpays on value, but it's a real upgrade to the lineup you'd start — reasonable if winning now matters more than asset value.`;
  if (mine >= MEANINGFUL_PER_WEEK && theirs != null && theirs >= MEANINGFUL_PER_WEEK)
    return "Both starting lineups get better — the kind of trade that actually gets accepted.";
  if (mine >= MEANINGFUL_PER_WEEK && theirs != null && theirs <= -MEANINGFUL_PER_WEEK)
    return "Their starting lineup gets worse — expect pushback unless they're chasing value or depth.";
  if (mine <= -MEANINGFUL_PER_WEEK)
    return "Your starting lineup gets worse. Only worth it for the long-term asset value, or to set up another move.";
  return null;
}

/** Lineup impact for the Trade Analyzer: what the swap does to each team's
 * week-by-week starting lineup (byes, forced cuts, free-agent pickups and
 * who'd really start included) -- see lib/lineupImpact.ts. */
export function LineupImpactPanel({
  impact,
  ratio,
  theirName,
}: {
  impact: LineupImpact;
  ratio: number | null;
  theirName: string | null;
}) {
  const horizonLabel = impact.weeks === 1 ? `in week ${impact.fromWeek}` : "the rest of the season";
  const note = takeaway(impact, ratio, horizonLabel);
  const roster = (side: SideLineupImpact, who: string) => (
    <>
      {side.dropped.length > 0 && (
        <p>
          {who} drop {side.dropped.map((p) => p.name).join(", ")} to make room.
        </p>
      )}
      {side.openSpots > 0 && (
        <p>
          {who} open {side.openSpots === 1 ? "a roster spot" : `${side.openSpots} roster spots`} for a waiver pickup.
        </p>
      )}
    </>
  );
  return (
    <div className="mt-3 pt-3 border-t border-[#38383A] text-sm space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-[#98989D]">
        Starting-lineup impact
        <span className="normal-case tracking-normal text-[#636366] font-normal">
          {" "}
          · week {impact.fromWeek}
          {impact.weeks > 1 ? `–${impact.throughWeek}` : ""}, byes, roster spots and waiver streaming included
        </span>
      </div>
      <SideRow label="Your lineup" side={impact.my} impact={impact} />
      {impact.their && <SideRow label={`${theirName ?? "Their"} lineup`} side={impact.their} impact={impact} />}
      <div className="text-[11px] text-[#636366] space-y-0.5">
        {roster(impact.my, "You'd")}
        {impact.their && roster(impact.their, theirName ? `${theirName} would` : "They'd")}
      </div>
      {note && <p className="text-[#98989D]">{note}</p>}
    </div>
  );
}
