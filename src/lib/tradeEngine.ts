// Trade-evaluation math for the AI Coach's suggestion generator
// (hooks/useFantasyApp.ts). Tunables live in config/trade.ts.
//
// Model:
//  1. Every player is priced by curved Value Over Replacement (lib/scoring.ts).
//  2. A whole side of a trade is NOT the sum of its players: the best piece
//     counts in full, every extra piece contributes only its above-replacement
//     portion, steeply discounted (packageValue). You can't out-total a stud
//     by stacking role players.
//  3. Each incoming player's value is scaled by how badly the receiving team
//     needs that position (needFactor).
//  4. Fairness is the RATIO of the two sides' adjusted values, not a points
//     difference -- see fairnessRatio / ratioIsFair.
//  5. The STAR GATE independently blocks "a stud for a good starter + filler"
//     regardless of the computed ratio (starGateOk).
import {
  EXTRA_PIECE_DISCOUNT,
  FAIR_RATIO_MIN,
  FAIR_RATIO_MAX,
  REQUIRE_STAR_RETURN,
  STAR_RETURN_MIN_TOP_FRACTION,
  NEED_MULTIPLIER_FILL,
  NEED_MULTIPLIER_STACKED,
  NEED_MULTIPLIER_NEUTRAL,
} from "../config/trade.js";
import { VOR_BASELINE } from "../config/scoring.js";
import { playerValue } from "./scoring.js";
import type { Player, Position, RosterNeeds } from "../types.js";

/** A Tier-1 player is a genuine difference-maker (top ~5-8 at his position). */
export function hasStar(players: Player[]): boolean {
  return players.some((p) => p.tier === 1);
}

/** The above-replacement portion of a player's value -- what he's really worth
 * as an extra piece, since the roster spot and replacement-level baseline come
 * "for free" from anyone. */
function marginalValue(p: Player): number {
  return Math.max(0, playerValue(p) - VOR_BASELINE);
}

/** The star gate. If a side sends a Tier-1 player, the other side must return
 * (a) a Tier-1 or Tier-2 player, and (b) a single player worth at least
 * STAR_RETURN_MIN_TOP_FRACTION of that star's value. Blocks stud-for-depth
 * even when the padded package "adds up". */
export function starGateOk(give: Player[], get: Player[]): boolean {
  if (!REQUIRE_STAR_RETURN) return true;
  const topValue = (arr: Player[]) => arr.reduce((m, p) => Math.max(m, playerValue(p)), 0);
  const sideOk = (sending: Player[], receiving: Player[]): boolean => {
    const stars = sending.filter((p) => p.tier === 1);
    if (!stars.length) return true;
    const starVal = topValue(stars);
    if (!receiving.some((p) => p.tier <= 2)) return false;
    return topValue(receiving) >= starVal * STAR_RETURN_MIN_TOP_FRACTION;
  };
  return sideOk(give, get) && sideOk(get, give);
}

export type PositionBaseline = Record<Position, number>;

/** Value of one whole side of a trade: best piece full, every extra piece only
 * its marginal (above-replacement) value, discounted compounding by
 * EXTRA_PIECE_DISCOUNT. */
export function packageValue(players: Player[]): number {
  const sorted = [...players].sort((a, b) => playerValue(b) - playerValue(a));
  if (!sorted.length) return 0;
  let total = playerValue(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    total += marginalValue(sorted[i]) * Math.pow(EXTRA_PIECE_DISCOUNT, i);
  }
  return total;
}

/** (value you get) / (value you give). > 1 favors the receiving side, < 1
 * favors the other side. */
export function fairnessRatio(giveVal: number, getVal: number): number {
  return giveVal > 0 ? getVal / giveVal : Infinity;
}

export function ratioIsFair(ratio: number): boolean {
  return ratio >= FAIR_RATIO_MIN && ratio <= FAIR_RATIO_MAX;
}

/** How much an incoming player's value should be scaled for a team, given that
 * team's depth at his position versus the league-average starter there:
 * up if it fills a hole, down if they're already stacked. */
export function needFactor(needs: RosterNeeds, baseline: PositionBaseline, pos: Position): number {
  const n = needs[pos];
  if (!n) return NEED_MULTIPLIER_NEUTRAL;
  const base = baseline[pos] || 0;
  if (!n.hasEnoughBodies || (base && n.starterScore < base * 0.85)) return NEED_MULTIPLIER_FILL;
  if (base && n.starterScore > base * 1.1 && n.tradeableDepth.length > 0) return NEED_MULTIPLIER_STACKED;
  return NEED_MULTIPLIER_NEUTRAL;
}

/** packageValue for an incoming side (best piece full, extras at discounted
 * marginal value), with each piece additionally scaled by the receiving team's
 * need at that player's position. */
export function needAdjustedPackageValue(
  players: Player[],
  needs: RosterNeeds,
  baseline: PositionBaseline
): number {
  const sorted = [...players].sort((a, b) => playerValue(b) - playerValue(a));
  if (!sorted.length) return 0;
  let total = playerValue(sorted[0]) * needFactor(needs, baseline, sorted[0].pos);
  for (let i = 1; i < sorted.length; i++) {
    total += marginalValue(sorted[i]) * Math.pow(EXTRA_PIECE_DISCOUNT, i) * needFactor(needs, baseline, sorted[i].pos);
  }
  return total;
}

export interface BalancedPackage {
  give: Player[];
  get: Player[];
  /** Team-need-adjusted value of what you send. */
  giveVal: number;
  /** Team-need-adjusted value of what you receive. */
  getVal: number;
  /** getVal / giveVal. */
  ratio: number;
}

/** Try to land a give/get package inside the fairness-ratio window by adding
 * at most ONE extra piece to whichever side is light. Values are team-need
 * adjusted: `theirNeeds` receive your give-side, `yourNeeds` receive the
 * get-side. Returns null if no single add-on brings the ratio into range --
 * so a genuinely lopsided core swap is simply not surfaced rather than
 * "fixed" by tossing in a bench body. */
export function balancePackage(
  giveList: Player[],
  getList: Player[],
  theirNeeds: RosterNeeds,
  yourNeeds: RosterNeeds,
  baseline: PositionBaseline,
  extraGiveOptions: Player[],
  extraGetOptions: Player[]
): BalancedPackage | null {
  const evaluate = (give: Player[], get: Player[]): BalancedPackage => {
    const giveVal = needAdjustedPackageValue(give, theirNeeds, baseline);
    const getVal = needAdjustedPackageValue(get, yourNeeds, baseline);
    return { give, get, giveVal, getVal, ratio: fairnessRatio(giveVal, getVal) };
  };

  const acceptable = (p: BalancedPackage) => ratioIsFair(p.ratio) && starGateOk(p.give, p.get);

  const base = evaluate(giveList, getList);
  if (acceptable(base)) return base;

  // Ratio too low: you're giving more than you get -> pad your GET side with
  // the option that lands the ratio closest to 1.
  if (base.ratio < FAIR_RATIO_MIN) {
    let best: BalancedPackage | null = null;
    for (const p of extraGetOptions) {
      const cand = evaluate(giveList, [...getList, p]);
      if (acceptable(cand) && (!best || Math.abs(cand.ratio - 1) < Math.abs(best.ratio - 1))) best = cand;
    }
    if (best) return best;
  }

  // Ratio too high: you're getting more than you give -> pad your GIVE side.
  if (base.ratio > FAIR_RATIO_MAX) {
    let best: BalancedPackage | null = null;
    for (const p of extraGiveOptions) {
      const cand = evaluate([...giveList, p], getList);
      if (acceptable(cand) && (!best || Math.abs(cand.ratio - 1) < Math.abs(best.ratio - 1))) best = cand;
    }
    if (best) return best;
  }

  return null;
}

/** Build a genuine 2-for-2 around a 1-for-1 core: add ONE extra piece to each
 * side, choosing the give/get pair whose combined value ratio lands closest to
 * 1 inside the fair window. Returns null if no pair qualifies. Option lists are
 * capped for cost -- pass them best-first. */
export function balanceTwoForTwo(
  coreGive: Player,
  coreGet: Player,
  theirNeeds: RosterNeeds,
  yourNeeds: RosterNeeds,
  baseline: PositionBaseline,
  extraGiveOptions: Player[],
  extraGetOptions: Player[]
): BalancedPackage | null {
  const giveOpts = [...extraGiveOptions].sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 8);
  const getOpts = [...extraGetOptions].sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 8);

  let best: BalancedPackage | null = null;
  for (const g of giveOpts) {
    if (g.id === coreGive.id || g.id === coreGet.id) continue;
    for (const c of getOpts) {
      if (c.id === coreGet.id || c.id === coreGive.id || c.id === g.id) continue;
      const give = [coreGive, g];
      const get = [coreGet, c];
      const giveVal = needAdjustedPackageValue(give, theirNeeds, baseline);
      const getVal = needAdjustedPackageValue(get, yourNeeds, baseline);
      const ratio = fairnessRatio(giveVal, getVal);
      if (ratioIsFair(ratio) && starGateOk(give, get) && (!best || Math.abs(ratio - 1) < Math.abs(best.ratio - 1))) {
        best = { give, get, giveVal, getVal, ratio };
      }
    }
  }
  return best;
}
