// Player-valuation math shared by the Free Agents recommendations, the AI
// Coach's needs analysis, and the Trade Analyzer. Every tunable number lives
// in config/scoring.ts -- this file is just the formulas.
import {
  ELITE_PROJ_THRESHOLD,
  SCARCITY_COEFFICIENT,
  TIER_BONUS,
  STARTER_PREMIUM,
  INJURY_DISCOUNT,
  INJURY_DISCOUNT_DEFAULT,
  ROS_WEEKS,
  ROS_STATUS_MULTIPLIER,
  ROS_STATUS_MULTIPLIER_DEFAULT,
  ROS_TIER_TREND,
} from "../config/scoring";
import type { Player, PlayerStatus, RosterNeeds, Tier } from "../types";

export function tierBonus(p: Player): number {
  return TIER_BONUS[p.tier];
}

/** Quadratic bonus once a player's weekly projection clears the "elite"
 * threshold -- see config/scoring.ts for why this needs to be quadratic
 * rather than a flat per-tier bonus. */
export function scarcityBonus(p: Player): number {
  const excess = Math.max(0, p.proj - ELITE_PROJ_THRESHOLD);
  return excess * excess * SCARCITY_COEFFICIENT;
}

export function playerValue(p: Player): number {
  return p.proj + tierBonus(p) + scarcityBonus(p);
}

export function injuryDiscount(status: PlayerStatus): number {
  return INJURY_DISCOUNT[status] ?? INJURY_DISCOUNT_DEFAULT;
}

export function qualityScore(p: Player): number {
  return playerValue(p) * injuryDiscount(p.status);
}

export function starterPremium(tier: Tier): number {
  return STARTER_PREMIUM[tier];
}

export function isPlayerStarter(player: Player, needsObj: RosterNeeds): boolean {
  const posNeeds = needsObj[player.pos];
  return !!posNeeds && posNeeds.starters.some((p) => p.id === player.id);
}

export function starterAdjustedValue(player: Player, isStarting: boolean): number {
  return playerValue(player) + (isStarting ? starterPremium(player.tier) : 0);
}

export function rosStatusMultiplier(status: PlayerStatus): number {
  return ROS_STATUS_MULTIPLIER[status] ?? ROS_STATUS_MULTIPLIER_DEFAULT;
}

export function rosTierTrend(tier: Tier): number {
  return ROS_TIER_TREND[tier];
}

/** Rest-of-season value estimate: projects a 16-game season total from the
 * same weekly projection, adjusted for tier trajectory and current injury
 * status. A heuristic scaling of the weekly proj, not an independently
 * modeled season projection. */
export function rosValue(p: Player): number {
  return (p.proj + scarcityBonus(p)) * ROS_WEEKS * rosStatusMultiplier(p.status) * rosTierTrend(p.tier);
}
