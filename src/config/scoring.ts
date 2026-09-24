// Every tunable number behind the player-valuation math in lib/scoring.ts.
// Adjust these to change how the AI Coach, Trade Analyzer, and Free Agents tab
// price players -- none of the math itself needs to change.
import type { Position } from "../types.js";

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
 *   rankValue = RANK_VALUE_BASE[pos] * exp(-RANK_DECAY_K[pos] * (rank - 1))
 * where rank is the player's 1-based projection rank at his position. The
 * exponential makes the top of each position steeply more valuable, and
 * per-position decay reflects how fast each position gets replaceable.
 *
 * PER-POSITION, not a single shared number: at rank 1 (rank - 1 = 0) the
 * exponential is always exactly 1, so a single shared base would hand a
 * league's TOP kicker or defense the exact same rank-chart ceiling as its top
 * RB or WR -- "best at the position" isn't a real scarcity signal for K/DST
 * the way it is for the others (any two streamable kickers are close enough
 * that nobody trades for one), so their peak is much lower. QB/RB/WR/TE keep
 * the original shared ceiling. */
export const RANK_VALUE_BASE: Record<Position, number> = {
  QB: 100,
  RB: 100,
  WR: 100,
  TE: 100,
  DST: 20,
  K: 20,
};

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

/** Fallback ROS length when the current scoring week is unknown (e.g. static
 * bundled data before a live ESPN sync): ~17 weeks minus one bye. Live paths
 * use remainingRosWeeks() in lib/rosHorizon.ts instead. */
export const ROS_WEEKS = 16;

/** Default last fantasy-relevant NFL week for remaining-ROS counts (regular
 * season through week 18 on ESPN/Sleeper calendars). */
export const ROS_HORIZON_THROUGH_WEEK = 18;

/** Season-outlook multiplier for current injury status. Questionable barely
 * dents a multi-week outlook; Out / IR imply real missed-time risk. IR is
 * harsher than a one-week Out designation. */
export const ROS_STATUS_MULTIPLIER: Record<string, number> = {
  IR: 0.45,
  Out: 0.55,
  Doubtful: 0.75,
  Questionable: 0.97,
};
export const ROS_STATUS_MULTIPLIER_DEFAULT = 1;

/** Season-outlook multiplier for tier trajectory -- elite players tend to hold
 * or grow their role over a season, while deep bench/flex players carry more
 * bust risk across a full schedule than in any one week. */
export const ROS_TIER_TREND: Record<1 | 2 | 3, number> = { 1: 1.05, 2: 1.0, 3: 0.92 };

/** Coarse remaining-schedule ease clamp applied inside qualityScore when a
 * player has scheduleEase stamped (lib/scheduleEase.ts). */
export const SCHEDULE_EASE_MIN = 0.9;
export const SCHEDULE_EASE_MAX = 1.1;

/** Minimum season PPG we'll accept as a seasonProj fallback from this week's
 * proj. Below this we treat the week number as collapsed (bye / Out) and do
 * not let it poison seasonModelValue. */
export const SEASON_PROJ_WEEK_FALLBACK_MIN = 3;

/** CONSENSUS PROJECTIONS (lib/consensus.ts). Relative weights, renormalized
 * over whichever sources actually have a number for the player. ESPN and
 * Sleeper are independent projection models and weighted equally. */
export const CONSENSUS_WEEKLY_WEIGHTS = { espn: 1, sleeper: 1 } as const;
export const CONSENSUS_SEASON_WEIGHTS = { espn: 1, sleeper: 1 } as const;

/** Actual points-per-game so far joins the season blend with weight
 *   CONSENSUS_ACTUAL_MAX_WEIGHT * gp / (gp + CONSENSUS_ACTUAL_SHRINK_GAMES)
 * -- shrinkage toward the projections, so 2 games is ~1/3 weight (a hot start
 * nudges the number) and a half season is ~2/3 (sustained production really
 * moves it). Relative to the projection weights above, which sum to 2. */
export const CONSENSUS_ACTUAL_MAX_WEIGHT = 1;
export const CONSENSUS_ACTUAL_SHRINK_GAMES = 4;

/** How many upcoming weeks of Sleeper projections to average into its
 * rest-of-season number. Large enough to cover the full remaining regular
 * season (capped at LAST_REGULAR_SEASON_WEEK in lib/consensus.ts). */
export const SLEEPER_ROS_WEEKS = 18;

/** Share of season-long value (qualityScore/rosValue) taken from the trade
 * market -- FantasyCalc redraft values, built from real trades -- vs the
 * projection model. Tuned on live 2026 data: overall value order vs the
 * market went 0.88 (model alone) -> 0.98 at 0.5 -> 0.99 at 0.65, with almost
 * nothing gained past that. The market fixes what the model gets structurally wrong
 * (cross-position value: in a 1QB league a QB scoring the same points as an
 * RB trades for far less) and reacts to role/injury news first; the model
 * keeps it anchored to this league's scoring and actual projections. */
export const MARKET_VALUE_WEIGHT = 0.65;

/** Per-position market calibration of the projection model (see
 * rankPlayerPool in lib/consensus.ts): skipped for a position with fewer than
 * MIN market-valued players, and clamped so a thin or odd market day can
 * never rescale a position by more than this. */
export const MARKET_CALIBRATION_MIN_PLAYERS = 8;
export const MARKET_CALIBRATION_MIN = 0.5;
export const MARKET_CALIBRATION_MAX = 1.5;

/** A posted sportsbook yardage prop can move a weekly projection by at most
 * this fraction of it. */
export const PROP_ADJUST_MAX_FRACTION = 0.3;

/** VEGAS VALUE (lib/bettingValue.ts): the betting market's season-long view
 * of a player, built from every week's prop lines and game lines, joins
 * FantasyCalc inside the market half of qualityScore. Its share of that half
 * is VEGAS_MARKET_SHARE * weeks / (weeks + VEGAS_SHRINK_WEEKS) -- shrunk
 * toward FantasyCalc while only a few weeks of lines exist (3 weeks: 20% of
 * the market half, ~13% of total value; 12 weeks: 32%). */
export const VEGAS_MARKET_SHARE = 0.4;
export const VEGAS_SHRINK_WEEKS = 3;

/** One week's Vegas points can move off the projection model's by at most
 * this fraction, so a stray or mis-matched line can't swing a player. */
export const VEGAS_WEEK_MAX_ADJUST = 0.5;

/** Game-line normalization: a week's Vegas points are scaled by
 * (team's usual implied total / that week's implied total) ^ this, so a
 * single shootout or slog doesn't read as a season-long role change. 0.5
 * because only part of a player's points (mostly TDs) moves with team
 * scoring. */
export const VEGAS_GAME_SCRIPT_ELASTICITY = 0.5;
