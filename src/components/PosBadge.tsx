import { POS_COLORS } from "../config/league";
import type { Position } from "../types";

/** Small colored position-abbreviation pill (QB/RB/WR/...), colored per
 * config/league.ts's POS_COLORS. `label` overrides the displayed text (e.g.
 * an ESPN lineup slot like "FLEX") while still coloring by the real position. */
export function PosBadge({ pos, label, className = "" }: { pos: Position; label?: string; className?: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${POS_COLORS[pos]} ${className}`}>
      {label ?? pos}
    </span>
  );
}
