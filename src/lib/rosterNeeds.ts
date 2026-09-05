// AI Coach: roster-needs analysis. Heuristic, not a live model call: it scores
// your roster position-by-position by the *quality* of the players there --
// projection + tier scarcity premium, discounted for current injury risk --
// not just how many bodies you have.
import { POSITIONS, REQUIRED_STARTERS } from "../config/league.js";
import { qualityScore } from "./scoring.js";
import type { Player, PositionNeed, RosterNeeds } from "../types.js";

export function analyzeRosterNeeds(playersList: Player[]): RosterNeeds {
  const needs = {} as RosterNeeds;

  POSITIONS.forEach((pos) => {
    const ps = playersList
      .filter((p) => p.pos === pos)
      .map((p) => ({ ...p, qScore: qualityScore(p) }))
      .sort((a, b) => b.qScore - a.qScore);

    const required = REQUIRED_STARTERS[pos];
    const starters = ps.slice(0, required);
    const bench = ps.slice(required);

    // Starter quality score: sum of the injury-adjusted value of the players
    // who'd actually start here, divided by REQUIRED slots (not
    // starters.length) -- so a missing starter drags the score down just as
    // much as a weak one would.
    const starterScore = starters.reduce((s, p) => s + p.qScore, 0) / required;

    // Tradeable depth: bench players good enough (tier 1-2, not currently
    // Out) that another team would actually want them -- this is what
    // "surplus" really means, not just having bodies on the roster.
    const tradeableDepth = bench.filter((p) => p.tier <= 2 && p.status !== "Out").sort((a, b) => b.qScore - a.qScore);

    const need: PositionNeed = {
      pos,
      players: ps,
      count: ps.length,
      starters,
      weakestStarter: starters.length ? starters[starters.length - 1] : null,
      starterScore,
      hasEnoughBodies: ps.length >= required,
      tradeableDepth,
    };
    needs[pos] = need;
  });

  return needs;
}
