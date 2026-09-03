// Every tunable number behind the player-valuation math in lib/scoring.ts.
// Adjust these to change how the AI Coach, Trade Analyzer, and Free Agents tab
// price players -- none of the math itself needs to change.

/** A true difference-maker isn't worth "the sum of two decent players who add
 * up to the same points" -- real managers won't give up a stud for role
 * players even at raw point parity, because that production can't be split
 * or replicated. tierBonus alone is flat and linear, so on its own it can't
 * capture this: two tier-2 players can numerically out-total one tier-1 star.
 * scarcityBonus (below) adds a premium that grows QUADRATICALLY once weekly
 * projection clears this "elite" threshold. */
export const ELITE_PROJ_THRESHOLD = 18;
export const SCARCITY_COEFFICIENT = 0.15;

/** Flat per-tier value bonus added on top of raw projection. */
export const TIER_BONUS: Record<1 | 2 | 3, number> = { 1: 6, 2: 2, 3: 0 };

/** A locked-in starter is worth more than a bench player with similar raw
 * projection -- it occupies a scarce lineup slot and represents guaranteed
 * weekly production, not a speculative flex piece. */
export const STARTER_PREMIUM: Record<1 | 2 | 3, number> = { 1: 8, 2: 4, 3: 2 };

/** Discount applied on top of playerValue so a banged-up "elite" player isn't
 * counted at full strength when judging how good a position group is. */
export const INJURY_DISCOUNT: Record<string, number> = {
  Out: 0.4,
  Doubtful: 0.65,
  Questionable: 0.9,
};
export const INJURY_DISCOUNT_DEFAULT = 1;

/** Rest-of-season projection: a 16-game season total (17 weeks minus one bye)
 * built from the same weekly projection. */
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
