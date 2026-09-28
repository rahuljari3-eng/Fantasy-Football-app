// Weekly boom/bust chances: how likely a player is to boom or bust THIS week,
// given this week's projection.
//
// The bars are per player and fixed across weeks, set from his season
// baseline (rest-of-season points per game), one typical week's swing either
// side:
//   spread(p) = SPREAD_BASE + SPREAD_PER_POINT * p
//   boom bar  = baseline + spread(baseline)   (baseline 10 -> 16.4+, 20 -> 28.5+)
//   bust bar  = baseline - spread(baseline)   (baseline 10 -> 3.6-,  20 -> 11.5-)
// so a star needs a much bigger game to boom than a flex. The spread fit last
// season's ~3,200 relevant player-games (Sleeper projection vs actual PPR)
// almost exactly: 5.5 pts at a 6-pt projection, 8.9 at 22.
//
// This week's projection then decides the odds: a player projected above his
// baseline (good matchup) is likelier to clear his boom bar; below it, likelier
// to fall under his bust bar. The chance is read off real outcomes, not a bell
// curve -- every past game gives a scaled miss z = (actual - proj) /
// spread(proj), and the chance is the share of z's that would clear the bar
// from this week's projection. That keeps the real shape (scores skew right,
// can't go below 0, projections run a little high for stars). A player's own
// z's are blended with the league's, weighted as PRIOR_GAMES league games, so
// his own volatility counts once he has a real sample.
//
// Games: last season from boomBustHistory.json (scripts/buildBoomBustHistory.ts)
// plus this season's finished weeks from projectionHistory.json (the app's
// custom projection frozen at kickoff).
//
// ESPN doesn't publish boom/bust % through any API this app can read
// (docs/plans/2026-09-23-espn-boom-bust-research.md); these are the app's own.
import BOOM_BUST_HISTORY from "../data/boomBustHistory.json" with { type: "json" };
import PROJECTION_HISTORY from "../data/projectionHistory.json" with { type: "json" };
import type { ProjectionHistory } from "./projectionAccuracy.js";

export interface BoomBustHistory {
  season: number;
  source: "sleeper";
  /** ESPN id -> [week, projected, actual] per game played. */
  games: Record<string, [number, number, number][]>;
}

const SPREAD_BASE = 4.3;
const SPREAD_PER_POINT = 0.21;
/** Games projected under this are left out (a backup's 2-point projection
 * says nothing about how he plays when he's in the lineup), and no chances
 * are given for a week projected under it. */
export const MIN_BOOM_BUST_PROJECTION = 5;
/** How many league games the league-wide miss distribution counts as when
 * blended with a player's own. */
const PRIOR_GAMES = 8;

export interface BoomBustGame {
  season: number;
  week: number;
  proj: number;
  actual: number;
  /** Beat / missed that week's projection by more than a typical swing. */
  result: "boom" | "bust" | null;
}

export interface WeeklyBoomBust {
  /** 0-1 chances for this week. */
  boomChance: number;
  bustChance: number;
  /** His fixed bars, from his season baseline. */
  boomAt: number;
  bustAt: number;
  baseline: number;
  /** How many of his own games shaped the odds (0 = league-typical spread). */
  games: number;
}

const spread = (proj: number) => SPREAD_BASE + SPREAD_PER_POINT * proj;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function boomBustBars(baseline: number): { boom: number; bust: number } {
  const s = spread(baseline);
  return { boom: round1(baseline + s), bust: Math.max(0, round1(baseline - s)) };
}

function classifyGame(proj: number, actual: number): "boom" | "bust" | null {
  const bars = boomBustBars(proj);
  return actual >= bars.boom ? "boom" : actual <= bars.bust ? "bust" : null;
}

function buildGames(): Map<number, BoomBustGame[]> {
  const out = new Map<number, BoomBustGame[]>();
  const add = (id: string, g: Omit<BoomBustGame, "result">) => {
    if (g.proj < MIN_BOOM_BUST_PROJECTION) return;
    const list = out.get(Number(id)) ?? [];
    list.push({ ...g, result: classifyGame(g.proj, g.actual) });
    out.set(Number(id), list);
  };
  const past = BOOM_BUST_HISTORY as unknown as BoomBustHistory;
  Object.entries(past.games).forEach(([id, games]) => games.forEach(([week, proj, actual]) => add(id, { season: past.season, week, proj, actual })));
  const current = PROJECTION_HISTORY as ProjectionHistory;
  Object.entries(current.weeks).forEach(([week, players]) =>
    Object.entries(players).forEach(([id, r]) => {
      if (r.actual != null) add(id, { season: current.season, week: Number(week), proj: r.custom, actual: r.actual });
    })
  );
  out.forEach((list) => list.sort((a, b) => b.season - a.season || b.week - a.week));
  return out;
}

const scaledMiss = (g: BoomBustGame) => (g.actual - g.proj) / spread(g.proj);

let cache: { games: Map<number, BoomBustGame[]>; leagueZ: number[] } | null = null;
function data() {
  if (cache) return cache;
  const games = buildGames();
  const leagueZ = [...games.values()].flatMap((list) => list.map(scaledMiss)).sort((a, b) => a - b);
  cache = { games, leagueZ };
  return cache;
}

/** Share of the sorted `zs` at or above `t`. */
function shareAtLeast(zs: number[], t: number): number {
  let lo = 0;
  let hi = zs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (zs[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return zs.length ? (zs.length - lo) / zs.length : 0;
}

/** Every counted game for a player, newest first. */
export function boomBustGames(playerId: number): BoomBustGame[] {
  return data().games.get(playerId) ?? [];
}

/** Fallback baseline when no season projection is loaded: his average
 * recorded projection this season (projectionHistory.json). */
function recordedProjectionAvg(playerId: number): number | null {
  const values = Object.values((PROJECTION_HISTORY as ProjectionHistory).weeks)
    .map((players) => players[String(playerId)]?.custom)
    .filter((v): v is number => v != null && v >= MIN_BOOM_BUST_PROJECTION);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** This week's boom/bust chances. `weekProj` is this week's projection,
 * `baseline` his season points per game (Player.seasonProj; falls back to his
 * average recorded projection, then this week's). Null when he's projected
 * under MIN_BOOM_BUST_PROJECTION (bye, out, deep bench). */
export function weeklyBoomBust(playerId: number, weekProj: number, baseline: number | null | undefined): WeeklyBoomBust | null {
  if (weekProj < MIN_BOOM_BUST_PROJECTION) return null;
  const base = [baseline, recordedProjectionAvg(playerId)].find((b): b is number => b != null && b >= MIN_BOOM_BUST_PROJECTION) ?? weekProj;
  const bars = boomBustBars(base);
  const s = spread(weekProj);
  const boomT = (bars.boom - weekProj) / s;
  // "At or below the bust bar" = not strictly above it; the tiny nudge turns
  // shareAtLeast's >= into a > for that side.
  const bustT = (bars.bust - weekProj) / s + 1e-9;

  const { leagueZ } = data();
  const own = boomBustGames(playerId).map(scaledMiss);
  const blend = (t: number, above: boolean) => {
    const league = above ? shareAtLeast(leagueZ, t) : 1 - shareAtLeast(leagueZ, t);
    const mine = own.filter((z) => (above ? z >= t : z < t)).length;
    return (mine + PRIOR_GAMES * league) / (own.length + PRIOR_GAMES);
  };
  return {
    boomChance: blend(boomT, true),
    bustChance: blend(bustT, false),
    boomAt: bars.boom,
    bustAt: bars.bust,
    baseline: round1(base),
    games: own.length,
  };
}

/** The chances for a player projected exactly at his own baseline with a
 * league-typical spread -- the yardstick for "higher than usual". */
export function typicalBoomBust(): { boomChance: number; bustChance: number } {
  const { leagueZ } = data();
  const s = spread(15);
  const bars = boomBustBars(15);
  return {
    boomChance: shareAtLeast(leagueZ, (bars.boom - 15) / s),
    bustChance: 1 - shareAtLeast(leagueZ, (bars.bust - 15) / s + 1e-9),
  };
}

/** A chance this far above typical earns a badge in player lists. */
export const NOTABLE_CHANCE_RATIO = 1.5;
