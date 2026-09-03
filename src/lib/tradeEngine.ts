// Pure trade-fairness math used by the AI Coach's suggestion generator (see
// hooks/useCoachSuggestions.ts). Tunables live in config/trade.ts.
import { TRADE_BAND_MIN, TRADE_BAND_MAX, CONSOLIDATION_PENALTY_PER_EXTRA_PIECE } from "../config/trade";
import { playerValue } from "./scoring";
import type { Player } from "../types";

export function consolidationPenalty(giveCount: number, getCount: number): number {
  return Math.abs(giveCount - getCount) * CONSOLIDATION_PENALTY_PER_EXTRA_PIECE;
}

// diff = getVal - giveVal, from the give-side's perspective. Shifts the
// required band by the penalty, in whichever direction disadvantages the side
// sending more pieces (they need a bigger positive diff to justify
// consolidating into fewer, bigger assets; the side sending fewer, bigger
// pieces has its ceiling tightened so it can't be "gifted" a stack of
// throw-ins too cheaply either).
export function withinBand(diff: number, giveCount: number, getCount: number): boolean {
  const penalty = consolidationPenalty(giveCount, getCount);
  if (giveCount > getCount) return diff >= TRADE_BAND_MIN + penalty && diff <= TRADE_BAND_MAX + penalty;
  if (getCount > giveCount) return diff >= TRADE_BAND_MIN - penalty && diff <= TRADE_BAND_MAX - penalty;
  return diff >= TRADE_BAND_MIN && diff <= TRADE_BAND_MAX;
}

export interface BalancedPackage {
  give: Player[];
  get: Player[];
  giveVal: number;
  getVal: number;
  diff: number;
}

/** Given a starting give/get package that's outside the fairness band, try
 * adding ONE extra piece to whichever side is short, choosing the smallest
 * piece that brings the net value back inside the band. Returns null if no
 * fix exists. */
export function balancePackage(
  giveList: Player[],
  getList: Player[],
  giveVal: number,
  getVal: number,
  extraGiveOptions: Player[],
  extraGetOptions: Player[]
): BalancedPackage | null {
  const diff = getVal - giveVal;
  if (withinBand(diff, giveList.length, getList.length)) {
    return { give: giveList, get: getList, giveVal, getVal, diff };
  }

  if (diff > TRADE_BAND_MAX && extraGiveOptions.length) {
    // You're getting too much for too little -- add a throw-in from your
    // side. This makes it (at least) a 2-for-1 from your side, so check the
    // consolidation-adjusted band, not the base band.
    let bestAdd: Player | null = null;
    extraGiveOptions.forEach((p) => {
      const newDiff = getVal - (giveVal + playerValue(p));
      if (withinBand(newDiff, giveList.length + 1, getList.length) && (!bestAdd || playerValue(p) < playerValue(bestAdd))) {
        bestAdd = p;
      }
    });
    if (bestAdd) {
      const added: Player = bestAdd;
      const newGiveVal = giveVal + playerValue(added);
      return { give: [...giveList, added], get: getList, giveVal: newGiveVal, getVal, diff: getVal - newGiveVal };
    }
  }

  if (diff < TRADE_BAND_MIN && extraGetOptions.length) {
    // You're giving up too much for too little -- add a small piece from
    // their side.
    let bestAdd: Player | null = null;
    extraGetOptions.forEach((p) => {
      const newDiff = getVal + playerValue(p) - giveVal;
      if (withinBand(newDiff, giveList.length, getList.length + 1) && (!bestAdd || playerValue(p) < playerValue(bestAdd))) {
        bestAdd = p;
      }
    });
    if (bestAdd) {
      const added: Player = bestAdd;
      const newGetVal = getVal + playerValue(added);
      return { give: giveList, get: [...getList, added], giveVal, getVal: newGetVal, diff: newGetVal - giveVal };
    }
  }

  return null;
}
