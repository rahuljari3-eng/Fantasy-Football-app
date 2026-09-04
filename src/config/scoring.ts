// Every tunable number behind the player-valuation math in lib/scoring.ts.
// Adjust these to change how the AI Coach, Trade Analyzer, and Free Agents tab
// price players -- none of the math itself needs to change.
import type { Position } from "../types";

/** REPLACEMENT LEVEL: the per-game points at which a position stops mattering
 * for trades -- roughly the last player you'd actually start plus a little
 * bench depth in a 12-team league (~RB30 / WR30 / QB15 in a 1QB league / TE13,
 * streamer-level for DST & K), NOT the bottom of the rosterable pool. Set too
 * low, a merely-decent starter shows a big VOR and gets overvalued; this line
 * is deliberately tight. Value is measured ABOVE it, not from zero. */
export const REPLACEMENT_LEVEL: Record<Position, number> = {
  QB: 15.5,
  RB: 10.5,
  WR: 10.0,
  TE: 7.5,
  DST: 6.0,
  K: 8.0,
};

/** CONVEX CURVE exponent applied to value-over-replacement:
 *   curvedVOR = VOR ** VOR_CURVE_ALPHA   (for VOR >= 0)
 * Fantasy trade value is tiered/stepped, not smoothly linear in points: a
 * difference-maker who can't be replaced is worth far more than the points gap
 * to a flex-level starter suggests. A steep exponent (~1.8-2.2) reproduces
 * that -- two flex guys projecting 11 each do NOT out-value one stud
 * projecting 18. Same idea as KeepTradeCut / FantasyCalc rank-value charts. */
export const VOR_CURVE_ALPHA = 2.0;

/** Floor value every player (and the roster spot he occupies) carries, added
 * under the curved score. A rosterable player is never worth ~zero in a
 * redraft trade, and without a large-enough floor the value RATIO between two
 * near-replacement players blows up on tiny projection gaps (made worse by the
 * steep exponent above). High enough that ordinary starter-for-starter swaps
 * read as fair; the curve still drives the gap between tiers. */
export const VOR_BASELINE = 40;

/** Below-replacement players lose value linearly (no convex curve on the
 * downside), this many value points per projected point short of replacement. */
export const BELOW_REPLACEMENT_SLOPE = 0.8;

/** RANK-CHART COMPONENT. Weekly projections compress badly at the top of a
 * position (in a 1QB league every QB1 lands in a narrow points band), so
 * projection alone can't tell a genuine difference-maker from a merely-good
 * starter. Blend in a KeepTradeCut / FantasyCalc-style rank chart:
 *   rankValue = RANK_VALUE_BASE * exp(-RANK_DECAY_K[pos] * (rank - 1))
 * where rank is the player's 1-based projection rank at his position. The
 * exponential makes the top of each position steeply more valuable, and
 * per-position decay reflects how fast each position gets replaceable. */
export const RANK_VALUE_BASE = 100;

export const RANK_DECAY_K: Record<Position, number> = {
  QB: 0.16, // steep: QB1 >> QB6 even when weekly points are close
  RB: 0.085,
  WR: 0.075,
  TE: 0.15, // steep: elite TE is scarce
  DST: 0.28, // collapses almost immediately -- everyone streams
  K: 0.35,
};

/** How the final value splits between the rank chart and the points-VOR curve.
 * Must sum to 1. Rank-weighted because scarcity/tiering is the thing raw
 * projections keep missing. */
export const RANK_WEIGHT = 0.55;
export const POINTS_WEIGHT = 0.45;

/** Rest-of-season projection: a 16-game season total (17 weeks minus one bye)
 * built from the same weekly value. */
export const ROS_WEEKS = 16;

/** Season-outlook multiplier for current injury status -- a "Questionable" tag
 * barely dents a season outlook, but "Doubtful"/"Out" implies real missed-time
 * risk if it lingers. */
export const ROS_STATUS_MULTIPLIER: Record<string, number> = {
  Out: 0.75,
  Doubtful: 0.85,
  Questionable: 0.97,
};
export const ROS_STATUS_MULTIPLIER_DEFAULT = 1;

/** Season-outlook multiplier for tier trajectory -- elite players tend to hold
 * or grow their role over a season, while deep bench/flex players carry more
 * bust risk across 16 games than in any one week. */
export const ROS_TIER_TREND: Record<1 | 2 | 3, number> = { 1: 1.05, 2: 1.0, 3: 0.92 };
