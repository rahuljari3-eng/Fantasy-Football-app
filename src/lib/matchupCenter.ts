// This week's head-to-head fantasy matchup: opponent, live score, remaining
// projected points, and a Monte Carlo win probability. Pure -- built from
// this week's live NFL game state (lib/matchup.ts) plus each side's real
// starting lineup and per-player live scores (lib/espn.ts's
// fetchEspnLiveLineups). Deliberately NOT sourced from ESPN's own mMatchup
// total-points field -- that field only settles once the whole scoring
// period closes out and reads as a flat 0 for every matchup in the league
// while games are still being played, so a locked-in starter's real points
// have to be totaled up here instead, one player at a time. See
// useFantasyApp for assembly.
import { gradeMatchup } from "./matchup.js";
import type { WeeklyMatchups } from "./matchup.js";
import type { Player } from "../types.js";

export interface MatchupSideInput {
  teamId: number;
  name: string;
  owner: string;
  /** This team's real starting lineup for the week. */
  starters: Player[];
  /** Each starter's live score (ESPN's own per-player appliedStatTotal),
   * keyed by player id -- their projection before kickoff, their real
   * accumulating score once the game has started. Used for starters who've
   * already locked in; a missing entry falls back to their static
   * projection so the total is never short a player just because this
   * hasn't loaded yet. */
  liveScoreByPlayerId: Record<number, number>;
}

/** A starter whose game has already started, paired with the real live score
 * they're contributing to currentScore. */
export interface PlayedPlayer {
  player: Player;
  score: number;
}

export interface TeamMatchupSide {
  teamId: number;
  name: string;
  owner: string;
  currentScore: number;
  /** Sum of projections for starters whose game hasn't kicked off yet. */
  remainingProjection: number;
  /** currentScore + remainingProjection. */
  projectedTotal: number;
  playersRemaining: number;
  /** Starters whose game hasn't kicked off yet -- still contributing
   * uncertainty to projectedTotal / winProbability. */
  remainingPlayers: Player[];
  /** Starters who've already locked in (live or final), with the real score
   * each has put up so far. */
  playedPlayers: PlayedPlayer[];
}

export interface HeadToHeadMatchup {
  week: number;
  decided: boolean;
  me: TeamMatchupSide;
  opponent: TeamMatchupSide;
  /** This team's simulated chance of winning, 0-100. */
  winProbability: number;
}

const SIMULATIONS = 8000;
// Relative standard deviation applied to a still-to-play starter's
// projection when simulating a final score. A fantasy score is a sum of
// mostly-independent player outcomes, so this is applied per player rather
// than once per team (contrast the season-long simulator in
// lib/playoffOdds.ts, which only ever needs one team-level number).
const PLAYER_STD_FACTOR = 0.4;

function randNormal(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildSide(input: MatchupSideInput, matchups: WeeklyMatchups): TeamMatchupSide {
  let currentScore = 0;
  let remainingProjection = 0;
  const remainingPlayers: Player[] = [];
  const playedPlayers: PlayedPlayer[] = [];

  input.starters.forEach((p) => {
    const state = gradeMatchup(p, matchups).gameState;
    if (state === "in" || state === "post") {
      // Locked in -- their real score counts toward the total from here on,
      // and they can no longer be subbed out (enforced separately by
      // isPlayerLocked in useFantasyApp). Falls back to their projection if
      // ESPN's live score hasn't loaded yet, so a slow fetch never drops
      // their points from the total.
      const score = input.liveScoreByPlayerId[p.id] ?? p.proj;
      currentScore += score;
      playedPlayers.push({ player: p, score: round1(score) });
    } else {
      remainingProjection += p.proj;
      remainingPlayers.push(p);
    }
  });

  playedPlayers.sort((a, b) => b.score - a.score);

  return {
    teamId: input.teamId,
    name: input.name,
    owner: input.owner,
    currentScore: round1(currentScore),
    remainingProjection: round1(remainingProjection),
    projectedTotal: round1(currentScore + remainingProjection),
    playersRemaining: remainingPlayers.length,
    remainingPlayers,
    playedPlayers,
  };
}

/** Monte Carlo win probability for "me": each side's still-to-play starters
 * are sampled independently around their projection, and already-locked
 * production is treated as fixed (it's either final or already accruing in a
 * live game, so this slightly understates in-progress variance -- a
 * reasonable simplification rather than tracking each player's live partial
 * score separately). */
function simulateWinProbability(me: TeamMatchupSide, opp: TeamMatchupSide): number {
  if (me.remainingPlayers.length === 0 && opp.remainingPlayers.length === 0) {
    if (me.currentScore > opp.currentScore) return 100;
    if (me.currentScore < opp.currentScore) return 0;
    return 50;
  }

  let wins = 0;
  for (let sim = 0; sim < SIMULATIONS; sim++) {
    let myFinal = me.currentScore;
    me.remainingPlayers.forEach((p) => {
      myFinal += Math.max(0, randNormal(p.proj, Math.max(1, p.proj * PLAYER_STD_FACTOR)));
    });
    let oppFinal = opp.currentScore;
    opp.remainingPlayers.forEach((p) => {
      oppFinal += Math.max(0, randNormal(p.proj, Math.max(1, p.proj * PLAYER_STD_FACTOR)));
    });
    if (myFinal > oppFinal) wins++;
    else if (myFinal === oppFinal) wins += 0.5;
  }
  return Math.round((wins / SIMULATIONS) * 1000) / 10;
}

export function buildHeadToHeadMatchup(
  week: number,
  decided: boolean,
  meInput: MatchupSideInput,
  oppInput: MatchupSideInput,
  matchups: WeeklyMatchups
): HeadToHeadMatchup {
  const me = buildSide(meInput, matchups);
  const opponent = buildSide(oppInput, matchups);
  const winProbability = simulateWinProbability(me, opponent);

  return { week, decided, me, opponent, winProbability };
}
