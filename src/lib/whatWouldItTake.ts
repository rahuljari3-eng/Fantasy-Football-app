// "What would it take?" solver: pick any player on someone else's roster and
// this searches YOUR roster for the smallest, cheapest package that would
// clear the exact same fairness bar the Trade Analyzer and AI Coach already
// require -- see lib/tradeEngine.ts. It's the reverse of those: instead of
// "is this trade fair?" or "here's a trade you might like", it's "what's the
// minimum it'd cost me to get THIS specific guy?"
import { needAdjustedPackageValue, fairnessRatio, ratioIsFair, starGateOk, needFactor } from "./tradeEngine.js";
import { NEED_MULTIPLIER_FILL } from "../config/trade.js";
import type { PositionBaseline } from "./tradeEngine.js";
import type { Player, Position, RosterNeeds } from "../types.js";

export interface WhatWouldItTakeOption {
  give: Player[];
  /** Team-need-adjusted value of what you'd send (valued against THEIR needs). */
  giveVal: number;
  /** Team-need-adjusted value of the target player (valued against YOUR needs). */
  getVal: number;
  ratio: number;
  /** Positions in `give` that genuinely fill a hole on the receiving team --
   * why this package can be smaller than a raw value comparison would suggest. */
  fillsNeedFor: Position[];
}

const MAX_PIECES = 3;
const MAX_OPTIONS = 4;

function combinations<T>(pool: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (pool.length < size) return [];
  const [head, ...rest] = pool;
  return [...combinations(rest, size - 1).map((c) => [head, ...c]), ...combinations(rest, size)];
}

/** Every give candidate's value is scaled by the RECEIVING team's need, so a
 * package can clear the fairness bar with less raw value when it fills a real
 * hole for them -- surface which positions in `give` are doing that. */
function fillsNeedFor(give: Player[], theirNeeds: RosterNeeds, baseline: PositionBaseline): Position[] {
  const positions = new Set<Position>();
  give.forEach((p) => {
    if (needFactor(theirNeeds, baseline, p) === NEED_MULTIPLIER_FILL) positions.add(p.pos);
  });
  return [...positions];
}

/** Searches 1-piece packages first, then 2, then 3, stopping at the first
 * size where any qualify -- that's the "minimum" package. Within that size,
 * ranks by cheapest give-value first (least you'd have to part with), then by
 * fairness closest to dead even. Returns null if nothing up to 3 pieces
 * clears the bar -- this player isn't realistically gettable right now. */
export function findWhatItWouldTake(
  target: Player,
  giveCandidates: Player[],
  theirNeeds: RosterNeeds,
  myNeeds: RosterNeeds,
  baseline: PositionBaseline
): WhatWouldItTakeOption[] | null {
  const getVal = needAdjustedPackageValue([target], myNeeds, baseline);
  const pool = giveCandidates.filter((p) => p.status !== "Out" && p.id !== target.id);

  for (let size = 1; size <= Math.min(MAX_PIECES, pool.length); size++) {
    const found: WhatWouldItTakeOption[] = [];
    for (const combo of combinations(pool, size)) {
      const giveVal = needAdjustedPackageValue(combo, theirNeeds, baseline);
      const ratio = fairnessRatio(giveVal, getVal);
      if (ratioIsFair(ratio) && starGateOk(combo, [target])) {
        found.push({ give: combo, giveVal, getVal, ratio, fillsNeedFor: fillsNeedFor(combo, theirNeeds, baseline) });
      }
    }
    if (found.length) {
      return found.sort((a, b) => a.giveVal - b.giveVal || Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1)).slice(0, MAX_OPTIONS);
    }
  }
  return null;
}
