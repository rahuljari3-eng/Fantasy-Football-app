// AI Coach: roster-needs analysis. Heuristic, not a live model call: it scores
// your roster position-by-position by the *quality* of the players there --
// projection + tier scarcity premium, discounted for current injury risk --
// not just how many bodies you have.
import { POSITIONS, REQUIRED_STARTERS } from "../config/league.js";
import { qualityScore } from "./scoring.js";
import type { Player, PositionNeed, Position, RosterNeeds } from "../types.js";

// The one FLEX slot (RB/WR/TE eligible) isn't in REQUIRED_STARTERS -- it's
// shared across positions, not fixed to one -- so it has to be resolved
// separately, once, across all three, before any single position's starter
// count is final.
const FLEX_ELIGIBLE: Position[] = ["RB", "WR", "TE"];

export function analyzeRosterNeeds(playersList: Player[]): RosterNeeds {
  const needs = {} as RosterNeeds;

  const scoredByPos = new Map<Position, (Player & { qScore: number })[]>();
  POSITIONS.forEach((pos) => {
    scoredByPos.set(
      pos,
      playersList
        .filter((p) => p.pos === pos)
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .sort((a, b) => b.qScore - a.qScore)
    );
  });

  // Who actually fills FLEX: the single best leftover RB/WR/TE once each
  // position's own required starters are set aside -- matches this league's
  // real 2RB/2WR/1TE/1FLEX format. Without this, a legitimate flex starter
  // (usually a team's 3rd RB or 3rd WR) reads as pure bench surplus and gets
  // offered away in trades, and their position's strength score never gets
  // credit for the extra production they're actually starting every week.
  let flexPick: (Player & { qScore: number }) | null = null;
  FLEX_ELIGIBLE.forEach((pos) => {
    const candidate = (scoredByPos.get(pos) ?? [])[REQUIRED_STARTERS[pos]];
    if (candidate && (!flexPick || candidate.qScore > flexPick.qScore)) flexPick = candidate;
  });

  POSITIONS.forEach((pos) => {
    const ps = scoredByPos.get(pos) ?? [];
    const required = REQUIRED_STARTERS[pos] + (flexPick && flexPick.pos === pos ? 1 : 0);
    const starters = ps.slice(0, required);
    const bench = ps.slice(required);

    // Starter quality score: sum of the injury-adjusted value of the players
    // who'd actually start here (FLEX included for whichever position won
    // it), divided by REQUIRED slots (not starters.length) -- so a missing
    // starter drags the score down just as much as a weak one would.
    const starterScore = starters.reduce((s, p) => s + p.qScore, 0) / required;

    // Tradeable depth: bench players good enough (tier 1-2, not currently
    // Out) that another team would actually want them -- this is what
    // "surplus" really means, not just having bodies on the roster. The FLEX
    // starter has already been excluded above, so they never show up here.
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
