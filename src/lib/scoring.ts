// Player-valuation math shared by the Free Agents recommendations, the AI
// Coach's needs analysis, and the Trade Analyzer. Every tunable number lives
// in config/scoring.ts -- this file is just the formulas.
//
// The core model is Value Over Replacement (VOR), curved: a player is worth
// what he produces ABOVE a freely available waiver-wire player at his
// position, and that surplus is run through a convex curve so elite tiers are
// worth more than their linear points suggest (see config/scoring.ts).
import {
  REPLACEMENT_LEVEL,
  VOR_CURVE_ALPHA,
  VOR_BASELINE,
  BELOW_REPLACEMENT_SLOPE,
  RANK_VALUE_BASE,
  RANK_DECAY_K,
  RANK_WEIGHT,
  POINTS_WEIGHT,
  ROS_WEEKS,
  ROS_STATUS_MULTIPLIER,
  ROS_STATUS_MULTIPLIER_DEFAULT,
  ROS_TIER_TREND,
  MARKET_VALUE_WEIGHT,
} from "../config/scoring.js";
import type { Player, PlayerStatus, Position, RosterNeeds, Tier } from "../types.js";

/** Per-game points a replacement-level (waiver-wire) player scores at a position. */
export function replacementLevel(pos: Position): number {
  return REPLACEMENT_LEVEL[pos];
}

/** Weekly projected points above (positive) or below (negative) replacement. */
export function vorPoints(p: Player): number {
  return p.proj - replacementLevel(p.pos);
}

/** Convex above replacement (elite gap worth more than linear), gently linear
 * below it. */
export function curvedVor(vor: number): number {
  return vor >= 0 ? Math.pow(vor, VOR_CURVE_ALPHA) : vor * BELOW_REPLACEMENT_SLOPE;
}

/** KTC-style rank chart value: steep exponential decay from the top of a
 * position. `rank` is 1-based (1 = best projected at the position). */
export function rankValue(pos: Position, rank: number): number {
  return RANK_VALUE_BASE[pos] * Math.exp(-RANK_DECAY_K[pos] * Math.max(0, rank - 1));
}

/** Shared curve behind playerValue/seasonPlayerValue: value-over-replacement
 * blended with the rank chart when a rank is known. Floored so nobody lands
 * at or below zero. */
function valueFromProjAndRank(pos: Position, proj: number, rank: number | undefined): number {
  const pointsPart = VOR_BASELINE + curvedVor(proj - replacementLevel(pos));
  if (typeof rank !== "number") return Math.max(1, pointsPart);
  const rankPart = VOR_BASELINE + rankValue(pos, rank);
  return Math.max(1, pointsPart * POINTS_WEIGHT + rankPart * RANK_WEIGHT);
}

/** A player's standalone trade value THIS WEEK -- priced off proj/posRank,
 * ESPN's numbers for the current scoring period specifically. This is NOT raw
 * projected points. Used for week-mode trade pricing and live lineup scoring,
 * where "what is this player worth given he may not even play this week" is
 * exactly the right question. For "how good is this player, full stop" (AI
 * Coach needs outlook, recommended trades), see qualityScore/rosValue below
 * instead -- using this here would let a single Questionable/Doubtful/Out
 * week collapse a genuinely elite player's standing. */
export function playerValue(p: Player): number {
  return valueFromProjAndRank(p.pos, p.proj, p.posRank);
}

/** A player's value as a roster ASSET for the rest of the season, not just
 * this week -- used everywhere the app judges "how good is this player":
 * AI Coach needs analysis (and its position-by-position outlook), free-agent
 * recommendations, and trade-suggestion candidate filtering. Priced off
 * seasonProj/seasonPosRank (ESPN's own rest-of-season model) rather than
 * proj/posRank, specifically so a player who's Questionable/Doubtful/Out
 * *this particular week* doesn't get valued as though that's his talent
 * level -- his weekly proj (and therefore posRank) can genuinely collapse
 * toward 0 for a week he doesn't play, but that's a one-week fact, not a
 * season-long one. Discounted by the season-outlook injury multiplier (a
 * "Questionable"/"Out" tag this week barely moves a 16-game outlook, unlike a
 * single week) and nudged for tier trajectory (elite players tend to hold
 * their role over a season; deep bench/flex players carry more bust risk
 * across one). Deliberately NOT the same thing as playerValue/rosValue below,
 * which price a SPECIFIC TRADE and are explicitly split by the Trade
 * Analyzer's own week/season toggle. */
export function qualityScore(p: Player): number {
  // positionScale: the model re-leveled per position against the trade
  // market (lib/consensus.ts rankPlayerPool) -- applies to every player at
  // the position, including ones the market doesn't value.
  const model = seasonModelValue(p) * (p.positionScale ?? 1);
  // Blend in the trade market when it values this player (lib/consensus.ts
  // stamps marketQuality: the market's cross-position ordering mapped onto
  // this same value scale). The projection model alone can't tell that a
  // 1QB-league QB trades for far less than an RB scoring the same points --
  // the market can, because it's built from trades people actually made.
  return p.marketQuality != null ? model * (1 - MARKET_VALUE_WEIGHT) + p.marketQuality * MARKET_VALUE_WEIGHT : model;
}

/** qualityScore from projections alone (no market blend): season projection
 * + season rank, discounted for injury status and tier trajectory. What the
 * market's ordering gets mapped onto -- see lib/consensus.ts. */
export function seasonModelValue(p: Player): number {
  const proj = p.seasonProj ?? p.proj;
  const rank = p.seasonPosRank ?? p.posRank;
  return valueFromProjAndRank(p.pos, proj, rank) * rosStatusMultiplier(p.status) * rosTierTrend(p.tier);
}

export function isPlayerStarter(player: Player, needsObj: RosterNeeds): boolean {
  const posNeeds = needsObj[player.pos];
  return !!posNeeds && posNeeds.starters.some((p) => p.id === player.id);
}

export function rosStatusMultiplier(status: PlayerStatus): number {
  return ROS_STATUS_MULTIPLIER[status] ?? ROS_STATUS_MULTIPLIER_DEFAULT;
}

export function rosTierTrend(tier: Tier): number {
  return ROS_TIER_TREND[tier];
}

/** Rest-of-season value estimate: qualityScore (season projection, rank,
 * trade market, injury risk, tier trajectory) projected across the remaining
 * schedule. */
export function rosValue(p: Player): number {
  return qualityScore(p) * ROS_WEEKS;
}
