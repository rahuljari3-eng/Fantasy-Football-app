// "What would it take?" solver: pick any player on someone else's roster and
// this searches YOUR roster for the smallest, cheapest package that would
// clear the exact same fairness bar the Trade Analyzer and AI Coach already
// require -- see lib/tradeEngine.ts. It's the reverse of those: instead of
// "is this trade fair?" or "here's a trade you might like", it's "what's the
// minimum it'd cost me to get THIS specific guy?"
import { needAdjustedPackageValue, fairnessRatio, ratioIsFair, starGateOk, needFactor } from "./tradeEngine.js";
import { NEED_MULTIPLIER_FILL } from "../config/trade.js";
import type { PositionBaseline, Pricer } from "./tradeEngine.js";
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

/** Every give package is built from exactly one "core" piece (any tradeable
 * player, including a real starter -- that's the actual trade bait) plus,
 * for packages of size > 1, additional pieces drawn ONLY from bench-caliber
 * depth (RosterNeeds.tradeableDepth). Without this split, the combinatorial
 * search below was free to pick 2-3 pieces from the same unrestricted pool
 * as the core -- e.g. stacking a real RB2, WR2, and TE1 together as "filler"
 * to nudge a borderline-failing ratio a couple points, because the discount
 * curve makes a 3rd piece's contribution to giveVal nearly free once two are
 * already in. The result reads as fair by the ratio but isn't one any real
 * manager would offer: giving up three rosterable contributors to marginally
 * outbid a single ordinary player. Restricting extras to actual spare depth
 * means a 3-for-1 can only ever mean "one real piece + two throw-ins" -- and
 * if there's no real throw-in depth to offer, the solver correctly reports
 * this player isn't gettable right now instead of drafting a bad one. */
function buildCandidatePackages(corePool: Player[], depthPool: Player[], size: number): Player[][] {
  if (size === 1) return corePool.map((p) => [p]);
  return corePool.flatMap((core) => {
    const depthWithoutCore = depthPool.filter((p) => p.id !== core.id);
    return combinations(depthWithoutCore, size - 1).map((extras) => [core, ...extras]);
  });
}

/** Every give candidate's value is scaled by the RECEIVING team's need, so a
 * package can clear the fairness bar with less raw value when it fills a real
 * hole for them -- surface which positions in `give` are doing that. */
function fillsNeedFor(give: Player[], theirNeeds: RosterNeeds, baseline: PositionBaseline, pricer: Pricer): Position[] {
  const positions = new Set<Position>();
  give.forEach((p) => {
    if (needFactor(theirNeeds, baseline, p, pricer) === NEED_MULTIPLIER_FILL) positions.add(p.pos);
  });
  return [...positions];
}

/** Searches 1-piece packages first, then 2, then 3, stopping at the first
 * size where any qualify -- that's the "minimum" package. Sizes above 1 pad
 * a single core piece with bench-depth throw-ins only (see
 * buildCandidatePackages) -- never a second or third real starter. Within a
 * size, ranks by cheapest give-value first (least you'd have to part with),
 * then by fairness closest to dead even. Returns null if nothing up to 3
 * pieces clears the bar -- this player isn't realistically gettable right
 * now. */
export function findWhatItWouldTake(
  target: Player,
  coreCandidates: Player[],
  depthCandidates: Player[],
  theirNeeds: RosterNeeds,
  myNeeds: RosterNeeds,
  baseline: PositionBaseline,
  pricer: Pricer
): WhatWouldItTakeOption[] | null {
  const getVal = needAdjustedPackageValue([target], myNeeds, baseline, pricer);
  const corePool = coreCandidates.filter((p) => p.status !== "Out" && p.id !== target.id);
  const depthPool = depthCandidates.filter((p) => p.status !== "Out" && p.id !== target.id);

  for (let size = 1; size <= MAX_PIECES; size++) {
    const found: WhatWouldItTakeOption[] = [];
    for (const combo of buildCandidatePackages(corePool, depthPool, size)) {
      const giveVal = needAdjustedPackageValue(combo, theirNeeds, baseline, pricer);
      const ratio = fairnessRatio(giveVal, getVal);
      if (ratioIsFair(ratio) && starGateOk(combo, [target], pricer)) {
        found.push({ give: combo, giveVal, getVal, ratio, fillsNeedFor: fillsNeedFor(combo, theirNeeds, baseline, pricer) });
      }
    }
    if (found.length) {
      return found.sort((a, b) => a.giveVal - b.giveVal || Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1)).slice(0, MAX_OPTIONS);
    }
  }
  return null;
}
