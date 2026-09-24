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
//  6. MUTUAL FIT (evaluateTradeFit) is separate from fairness: it re-runs both
//     teams' depth charts after the swap and asks whether each side's actual
//     starting lineup gets better at a position it needs. Fairness decides
//     whether a trade is shown at all; fit decides which fair trades lead.
import {
  EXTRA_PIECE_DISCOUNT,
  FAIR_RATIO_MIN,
  FAIR_RATIO_MAX,
  REQUIRE_STAR_RETURN,
  STAR_RETURN_MIN_TOP_FRACTION,
  STAR_RANK_THRESHOLD,
  NEED_MULTIPLIER_FILL,
  NEED_MULTIPLIER_STACKED,
  NEED_MULTIPLIER_NEUTRAL,
  NEED_BASELINE_FRACTION,
  NEED_HELP_MIN_GAIN,
} from "../config/trade.js";
import { POSITIONS, REQUIRED_STARTERS } from "../config/league.js";
import { analyzeRosterNeeds } from "./rosterNeeds.js";
import { VOR_BASELINE } from "../config/scoring.js";
import { playerValue, qualityScore } from "./scoring.js";
import type { Player, Position, RosterNeeds, TradeFit } from "../types.js";

/** Which "how good is this player" number a piece of trade math prices
 * against, plus which positional rank backs the star check -- see the two
 * exported instances below. Every function in this module that touches
 * value takes one explicitly rather than assuming `playerValue`, so a caller
 * can't accidentally price a season-long question (AI Coach, "what would it
 * take?") off a single week's projection, or vice versa. */
export interface Pricer {
  value: (p: Player) => number;
  rank: (p: Player) => number | undefined;
}

/** This week only -- proj/posRank. Right for the interactive Trade
 * Analyzer's "This week" mode, where "is this fair" is genuinely a
 * single-week question. */
export const WEEK_PRICER: Pricer = { value: playerValue, rank: (p) => p.posRank };

/** Rest-of-season outlook -- seasonProj/seasonPosRank (qualityScore already
 * falls back to proj/posRank when those aren't set), the same number the AI
 * Coach's needs analysis (lib/rosterNeeds.ts) already prices every player by.
 * Right for anything judging "how good is this player, full stop": the AI
 * Coach's suggestion engine and "players to trade for," and the "What would
 * it take?" solver (which has no week/season toggle of its own and is asking
 * a long-term "what's this realistically cost me" question either way). A
 * single Questionable/bye-week projection collapsing `playerValue` to near
 * zero would otherwise make a good player look nearly free to acquire, or a
 * throw-in from your own roster look like it's worth almost nothing to give
 * up -- exactly backwards for a season-long recommendation. */
export const SEASON_PRICER: Pricer = { value: qualityScore, rank: (p) => p.seasonPosRank ?? p.posRank };

/** A genuine difference-maker: true league-wide positional rank inside
 * STAR_RANK_THRESHOLD. NOT the same thing as Tier -- Tier is derived from
 * ESPN ownership% (>=80% owned = Tier 1), which covers roughly two-thirds of
 * every rostered player and would make almost any decent starter "a star".
 * Falls back to Tier 1 only when no rank has been stamped on this player
 * (defensive -- every normal call path ranks players before pricing them). */
function isStar(p: Player, pricer: Pricer): boolean {
  const rank = pricer.rank(p);
  if (typeof rank === "number") return rank <= (STAR_RANK_THRESHOLD[p.pos] ?? 8);
  return p.tier === 1;
}

export function hasStar(players: Player[], pricer: Pricer): boolean {
  return players.some((p) => isStar(p, pricer));
}

/** The above-replacement portion of a player's value -- what he's really worth
 * as an extra piece, since the roster spot and replacement-level baseline come
 * "for free" from anyone. */
function marginalValue(p: Player, pricer: Pricer): number {
  return Math.max(0, pricer.value(p) - VOR_BASELINE);
}

/** The star gate. If a side sends a genuine star (see isStar), the other side
 * must return (a) a Tier-1 or Tier-2 player, and (b) a single player worth at
 * least STAR_RETURN_MIN_TOP_FRACTION of that star's value. Blocks stud-for-
 * depth even when the padded package "adds up". */
export function starGateOk(give: Player[], get: Player[], pricer: Pricer): boolean {
  if (!REQUIRE_STAR_RETURN) return true;
  const topValue = (arr: Player[]) => arr.reduce((m, p) => Math.max(m, pricer.value(p)), 0);
  const sideOk = (sending: Player[], receiving: Player[]): boolean => {
    const stars = sending.filter((p) => isStar(p, pricer));
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
export function packageValue(players: Player[], pricer: Pricer): number {
  const sorted = [...players].sort((a, b) => pricer.value(b) - pricer.value(a));
  if (!sorted.length) return 0;
  let total = pricer.value(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    total += marginalValue(sorted[i], pricer) * Math.pow(EXTRA_PIECE_DISCOUNT, i);
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

/** Would the other manager -- and the trade market -- also call this fair?
 * The need-adjusted ratio is your formula; on top of it a suggestion must:
 *
 *  1. Not be lopsided for them on straight value (no team-need scaling):
 *     what you get can't be worth more than FAIR_RATIO_MAX times what you
 *     give. The need-adjusted ratio alone can call a trade fair because the
 *     players you get sit at a position you're already deep at -- e.g.
 *     TreVeyon Henderson for Tyler Shough + Christian Watson -- while the
 *     other manager hands over a quarter more value than he gets back.
 *     Paying extra for a need (straight-value ratio below 1) stays fine.
 *  2. Land inside the same fair window priced by the trade market alone
 *     (MARKET_PRICER). Otherwise your formula could say "you win" while the
 *     market badge says "you overpay ~20%" -- usually a player the
 *     projections like far more than the market does (or vice versa), or the
 *     need bonus stacking on top. A trade real managers price as an overpay
 *     isn't one worth suggesting, and one they price as a steal won't be
 *     accepted. */
export function otherSideWouldConsider(give: Player[], get: Player[], pricer: Pricer): boolean {
  if (fairnessRatio(packageValue(give, pricer), packageValue(get, pricer)) > FAIR_RATIO_MAX) return false;
  return ratioIsFair(fairnessRatio(packageValue(give, MARKET_PRICER), packageValue(get, MARKET_PRICER)));
}

/** How much an incoming player's value should be scaled for a team, given
 * that team's depth at his position versus the league-average starter there:
 * up if he genuinely fills a hole, down if they're already stacked.
 *
 * The FILL bonus only applies if this specific player would actually upgrade
 * the team's current weakest starter there -- not just because the position
 * happens to be a declared need. Without that check, a bench-caliber player
 * (a backup who wouldn't start for anyone) got the same +15% "fills a need"
 * bonus as a genuine starter-quality upgrade, purely because his position
 * was thin -- inflating scrubs enough that trading away a real starter for
 * two of them could read as "fair". A team missing enough bodies to fill the
 * position at all (hasEnoughBodies false) is the one case where literally
 * anyone helps, so that still bypasses the upgrade check. */
export function needFactor(needs: RosterNeeds, baseline: PositionBaseline, player: Player, pricer: Pricer): number {
  const n = needs[player.pos];
  if (!n) return NEED_MULTIPLIER_NEUTRAL;
  const base = baseline[player.pos] || 0;
  if (!n.hasEnoughBodies) return NEED_MULTIPLIER_FILL;
  const isRealUpgrade = !n.weakestStarter || pricer.value(player) > pricer.value(n.weakestStarter);
  if (isRealUpgrade && base && n.starterScore < base * 0.85) return NEED_MULTIPLIER_FILL;
  if (base && n.starterScore > base * 1.1 && n.tradeableDepth.length > 0) return NEED_MULTIPLIER_STACKED;
  return NEED_MULTIPLIER_NEUTRAL;
}

/** packageValue for an incoming side (best piece full, extras at discounted
 * marginal value), with each piece additionally scaled by the receiving team's
 * need at that player's position. */
export function needAdjustedPackageValue(
  players: Player[],
  needs: RosterNeeds,
  baseline: PositionBaseline,
  pricer: Pricer
): number {
  const sorted = [...players].sort((a, b) => pricer.value(b) - pricer.value(a));
  if (!sorted.length) return 0;
  let total = pricer.value(sorted[0]) * needFactor(needs, baseline, sorted[0], pricer);
  for (let i = 1; i < sorted.length; i++) {
    total += marginalValue(sorted[i], pricer) * Math.pow(EXTRA_PIECE_DISCOUNT, i) * needFactor(needs, baseline, sorted[i], pricer);
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
  extraGetOptions: Player[],
  pricer: Pricer
): BalancedPackage | null {
  const evaluate = (give: Player[], get: Player[]): BalancedPackage => {
    const giveVal = needAdjustedPackageValue(give, theirNeeds, baseline, pricer);
    const getVal = needAdjustedPackageValue(get, yourNeeds, baseline, pricer);
    return { give, get, giveVal, getVal, ratio: fairnessRatio(giveVal, getVal) };
  };

  const acceptable = (p: BalancedPackage) => ratioIsFair(p.ratio) && starGateOk(p.give, p.get, pricer) && otherSideWouldConsider(p.give, p.get, pricer);

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
  extraGetOptions: Player[],
  pricer: Pricer
): BalancedPackage | null {
  const giveOpts = [...extraGiveOptions].sort((a, b) => pricer.value(b) - pricer.value(a)).slice(0, 8);
  const getOpts = [...extraGetOptions].sort((a, b) => pricer.value(b) - pricer.value(a)).slice(0, 8);

  let best: BalancedPackage | null = null;
  for (const g of giveOpts) {
    if (g.id === coreGive.id || g.id === coreGet.id) continue;
    for (const c of getOpts) {
      if (c.id === coreGet.id || c.id === coreGive.id || c.id === g.id) continue;
      const give = [coreGive, g];
      const get = [coreGet, c];
      const giveVal = needAdjustedPackageValue(give, theirNeeds, baseline, pricer);
      const getVal = needAdjustedPackageValue(get, yourNeeds, baseline, pricer);
      const ratio = fairnessRatio(giveVal, getVal);
      if (ratioIsFair(ratio) && starGateOk(give, get, pricer) && otherSideWouldConsider(give, get, pricer) && (!best || Math.abs(ratio - 1) < Math.abs(best.ratio - 1))) {
        best = { give, get, giveVal, getVal, ratio };
      }
    }
  }
  return best;
}

/** A genuine hole: can't fill the required starting slots, or starter quality
 * sits meaningfully below the league-average starter there. */
export function isNeedPosition(needs: RosterNeeds, baseline: PositionBaseline, pos: Position): boolean {
  const n = needs[pos];
  if (!n.hasEnoughBodies) return true;
  if (!baseline[pos]) return false;
  return n.starterScore < baseline[pos] * NEED_BASELINE_FRACTION;
}

function starterTotal(needs: RosterNeeds): number {
  return POSITIONS.reduce((sum, pos) => sum + needs[pos].starters.reduce((s, p) => s + p.qScore, 0), 0);
}

/** Quality of a position's fixed starting slots only. Deliberately NOT
 * PositionNeed.starterScore: that's a per-slot average that also counts FLEX
 * for whichever position won it, so losing a FLEX-starting TE shrinks the TE
 * denominator and can make the position look *better* -- exactly backwards
 * for "did this trade fill their TE hole". */
function fixedSlotScore(needs: RosterNeeds, pos: Position): number {
  const slots = REQUIRED_STARTERS[pos];
  return needs[pos].players.slice(0, slots).reduce((s, p) => s + p.qScore, 0) / slots;
}

function needsHelped(before: RosterNeeds, after: RosterNeeds, baseline: PositionBaseline): Position[] {
  return POSITIONS.filter(
    (pos) => isNeedPosition(before, baseline, pos) && fixedSlotScore(after, pos) > fixedSlotScore(before, pos) * (1 + NEED_HELP_MIN_GAIN)
  );
}

/** Whether a trade makes BOTH teams' starting lineups better where they're
 * actually thin -- the thing that makes the other manager want to say yes.
 * Priced by qualityScore (the season-long number the needs analysis and
 * SEASON_PRICER already use), by re-running each roster's depth chart with the
 * players swapped, so it accounts for who'd actually start, the shared FLEX,
 * and what each side loses at the position it gives from. */
export function evaluateTradeFit(
  myRoster: Player[],
  theirRoster: Player[],
  give: Player[],
  get: Player[],
  baseline: PositionBaseline
): TradeFit {
  const giveIds = new Set(give.map((p) => p.id));
  const getIds = new Set(get.map((p) => p.id));
  const myBefore = analyzeRosterNeeds(myRoster);
  const theirBefore = analyzeRosterNeeds(theirRoster);
  const myAfter = analyzeRosterNeeds([...myRoster.filter((p) => !giveIds.has(p.id)), ...get]);
  const theirAfter = analyzeRosterNeeds([...theirRoster.filter((p) => !getIds.has(p.id)), ...give]);

  const myGain = starterTotal(myAfter) - starterTotal(myBefore);
  const theirGain = starterTotal(theirAfter) - starterTotal(theirBefore);
  const myNeedsHelped = needsHelped(myBefore, myAfter, baseline);
  const theirNeedsHelped = needsHelped(theirBefore, theirAfter, baseline);

  // Tier 3 doesn't require THEIR overall lineup total to rise: filling their
  // hole usually costs them a piece elsewhere, and the fairness ratio (which
  // already scales for team need) is what says that exchange is even. What
  // makes it a trade they'd want is that it fixes a position they need.
  let tier = 0;
  if (myNeedsHelped.length && theirNeedsHelped.length && myGain > 0) tier = 3;
  else if (myNeedsHelped.length && myGain > 0 && theirGain > 0) tier = 2;
  else if (myGain > 0 && theirGain > 0) tier = 1;
  return { myGain, theirGain, myNeedsHelped, theirNeedsHelped, tier };
}

/** Sort key among fair trades: better mutual fit first, then how much it
 * lifts your lineup, with the other side's gain as a smaller tiebreaker (a
 * trade they'd actually want is worth more than one they'd merely tolerate). */
export function compareTradeFit(a: TradeFit, b: TradeFit): number {
  return b.tier - a.tier || b.myGain + 0.5 * b.theirGain - (a.myGain + 0.5 * a.theirGain);
}

/** The trade market's opinion alone: each player priced by marketQuality
 * (FantasyCalc redraft value mapped onto this app's value scale -- see
 * lib/consensus.ts rankPlayerPool), falling back to qualityScore for
 * players the market doesn't value. Same scale and package math as
 * SEASON_PRICER, so its ratio reads against the same fair window. */
export const MARKET_PRICER: Pricer = { value: (p) => p.marketQuality ?? qualityScore(p), rank: (p) => p.seasonPosRank ?? p.posRank };

export interface MarketCheck {
  /** getVal / giveVal with every player priced by the market. */
  ratio: number;
  label: string;
  tone: "fair" | "you_overpay" | "you_win";
}

/** "Would the trade market call this fair?" -- shown next to the app's own
 * ratio so a disagreement is visible at a glance. Null when the market
 * doesn't value anyone on one of the sides (nothing to compare). */
export function marketCheck(give: Player[], get: Player[]): MarketCheck | null {
  if (!give.some((p) => p.marketQuality != null) || !get.some((p) => p.marketQuality != null)) return null;
  const ratio = fairnessRatio(packageValue(give, MARKET_PRICER), packageValue(get, MARKET_PRICER));
  if (ratioIsFair(ratio)) return { ratio, label: "Market: fair", tone: "fair" };
  const pct = Math.round(Math.abs(1 - ratio) * 100);
  return ratio < 1
    ? { ratio, label: `Market: you overpay ~${pct}%`, tone: "you_overpay" }
    : { ratio, label: `Market: you win by ~${pct}%`, tone: "you_win" };
}
