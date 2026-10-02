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
// spread(proj), and the chance is the (weighted) share of z's that would
// clear the bar from this week's projection. That keeps the real shape
// (scores skew right, can't go below 0, projections run a little high for
// stars).
//
// The app's own formula, and it tunes itself (scripts/fitBoomBust.ts, run by
// the hourly sync): past games count more the more they look like this one --
// same position, a similar game environment (team implied total), the
// betting market leaning the same way on him (Vegas points vs projection) --
// his own games are blended in, and the result is pulled toward the league's
// base rate. How much each of those counts is BoomBustParams, refit from
// every finished game by a forward backtest (each week predicted only from
// the weeks before it) and kept in boomBustModel.json. A factor the data
// doesn't support yet stays switched off until it earns its place.
//
// Games: last season from boomBustHistory.json (scripts/buildBoomBustHistory.ts)
// plus this season's finished weeks from projectionHistory.json (the app's
// custom projection frozen at kickoff), with that week's lines from
// vegasHistory.json.
//
// ESPN doesn't publish boom/bust % through any API this app can read
// (docs/plans/2026-09-23-espn-boom-bust-research.md); these are the app's own.
import BOOM_BUST_HISTORY from "../data/boomBustHistory.json" with { type: "json" };
import BOOM_BUST_MODEL from "../data/boomBustModel.json" with { type: "json" };
import PROJECTION_HISTORY from "../data/projectionHistory.json" with { type: "json" };
import VEGAS_HISTORY from "../data/vegasHistory.json" with { type: "json" };
import { ALL_TEAMS } from "../data/allTeams.js";
import { FREE_AGENTS } from "../data/freeAgents.js";
import type { VegasHistory } from "./bettingValue.js";
import { isPlayedGame, type ProjectionHistory } from "./projectionAccuracy.js";
import type { Position } from "../types.js";

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
/** A feature one side is missing (last season has no Vegas recorded) counts
 * as this -- neither like nor unlike. */
const MISSING_FEATURE_WEIGHT = 0.5;
/** This season's own base rate takes over from all games' once it has this
 * many games behind it. */
const MIN_BASE_RATE_GAMES = 100;

/** The tunables of the formula -- see the header. Fit by scripts/fitBoomBust.ts. */
export interface BoomBustParams {
  /** How many comparable games the pool counts as when blended with his own. */
  priorGames: number;
  /** One of last season's games (Sleeper's projection) against one of this season's. */
  lastSeasonWeight: number;
  /** A game at another position against one at his (1 = position ignored). */
  otherPositionWeight: number;
  /** Team implied total, points: games this far apart count ~60% as much.
   * Null = game environment ignored. */
  envBandwidth: number | null;
  /** Market lean (Vegas points minus projection, in spread units), same
   * idea. Null = market lean ignored. */
  gapBandwidth: number | null;
  /** 1 = the raw odds; 0 = everyone gets the base rate. In between pulls
   * extreme odds back toward it, which single-week noise calls for. */
  shrink: number;
}

export interface BoomBustModel {
  fittedAt: string | null;
  params: BoomBustParams;
  /** The forward backtest the params were picked on. */
  backtest: BoomBustBacktest | null;
}

export interface BoomBustBacktest {
  games: number;
  /** Mean Brier score (boom and bust averaged; lower is better) for the
   * fitted formula, and for giving everyone the base rate. */
  brier: number;
  baseRateBrier: number;
}

export const DEFAULT_BOOM_BUST_PARAMS: BoomBustParams = {
  priorGames: 30,
  lastSeasonWeight: 0.5,
  otherPositionWeight: 1,
  envBandwidth: null,
  gapBandwidth: null,
  shrink: 0.7,
};

const MODEL = BOOM_BUST_MODEL as unknown as BoomBustModel;
export function boomBustModel(): BoomBustModel {
  return MODEL;
}

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
  /** His team's implied total minus this week's league average, when lines are up. */
  gameEnvironment?: number;
  /** Betting lines' fantasy points minus his projection, when props are up. */
  marketLean?: number;
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

/** Every player id the app knows -> his position. Last season's history is
 * built from this same pool (scripts/buildBoomBustHistory.ts). */
const POS_BY_ID = new Map<number, Position>([...ALL_TEAMS.flatMap((t) => t.roster), ...FREE_AGENTS].map((p) => [p.id, p.pos]));

interface Features {
  pos?: Position;
  /** Team implied total minus that week's league average. */
  env?: number;
  /** That week's Vegas points minus the projection, in spread units. */
  gap?: number;
}

interface GameRow extends Features {
  id: number;
  season: number;
  week: number;
  /** This season's (the app's own projection), vs last season's (Sleeper's). */
  current: boolean;
  proj: number;
  actual: number;
  z: number;
  result: "boom" | "bust" | null;
}

const impliedAvgCache = new Map<number, number | null>();
function weekImpliedAvg(week: number): number | null {
  if (impliedAvgCache.has(week)) return impliedAvgCache.get(week)!;
  const values = Object.values((VEGAS_HISTORY as VegasHistory).weeks[String(week)] ?? {})
    .map((r) => r.implied)
    .filter((v): v is number => v != null);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  impliedAvgCache.set(week, avg);
  return avg;
}

/** The week the bundled Vegas history is on -- this week's lines. */
function currentVegasWeek(): number | null {
  const weeks = Object.keys((VEGAS_HISTORY as VegasHistory).weeks).map(Number);
  return weeks.length ? Math.max(...weeks) : null;
}

/** That week's market inputs for one player: his team's implied total
 * against the league's average that week, and how far the betting lines'
 * fantasy points (lib/bettingValue.ts) sit from the projection. */
function marketFeatures(week: number | null, playerId: number, proj: number, override: BoomBustContext = {}): Pick<Features, "env" | "gap"> {
  const rec = week != null ? (VEGAS_HISTORY as VegasHistory).weeks[String(week)]?.[String(playerId)] : undefined;
  const implied = override.implied !== undefined ? override.implied : rec?.implied;
  const vegasPts = override.vegasPts !== undefined ? override.vegasPts : rec?.pts;
  const avg = week != null ? weekImpliedAvg(week) : null;
  return {
    ...(implied != null && avg != null ? { env: implied - avg } : {}),
    ...(vegasPts != null && vegasPts > 0 ? { gap: (vegasPts - proj) / spread(proj) } : {}),
  };
}

function buildRows(): GameRow[] {
  const rows: GameRow[] = [];
  const add = (id: number, season: number, week: number, current: boolean, proj: number, actual: number) => {
    if (proj < MIN_BOOM_BUST_PROJECTION) return;
    rows.push({
      id,
      season,
      week,
      current,
      proj,
      actual,
      z: (actual - proj) / spread(proj),
      result: classifyGame(proj, actual),
      pos: POS_BY_ID.get(id),
      // Last season's games predate the app's Vegas recording.
      ...(current ? marketFeatures(week, id, proj) : {}),
    });
  };
  const past = BOOM_BUST_HISTORY as unknown as BoomBustHistory;
  Object.entries(past.games).forEach(([id, list]) => list.forEach(([week, proj, actual]) => add(Number(id), past.season, week, false, proj, actual)));
  const current = PROJECTION_HISTORY as ProjectionHistory;
  Object.entries(current.weeks).forEach(([week, players]) =>
    Object.entries(players).forEach(([id, r]) => {
      if (isPlayedGame(r)) add(Number(id), current.season, Number(week), true, r.custom, r.actual);
    })
  );
  return rows;
}

/** Boom/bust base rates for a set of games: this season's once it has
 * enough games, otherwise all of them. */
function baseRates(rows: GameRow[]): { boom: number; bust: number } {
  const current = rows.filter((r) => r.current);
  const pool = current.length >= MIN_BASE_RATE_GAMES ? current : rows;
  if (!pool.length) return { boom: 0, bust: 0 };
  return {
    boom: pool.filter((r) => r.result === "boom").length / pool.length,
    bust: pool.filter((r) => r.result === "bust").length / pool.length,
  };
}

const gauss = (d: number, bandwidth: number) => Math.exp(-0.5 * (d / bandwidth) ** 2);

function featureWeight(a: number | undefined, b: number | undefined, bandwidth: number | null): number {
  if (bandwidth == null) return 1;
  return a != null && b != null ? gauss(a - b, bandwidth) : MISSING_FEATURE_WEIGHT;
}

/** How much a past game counts toward this week's odds. */
function similarity(row: GameRow, target: Features, params: BoomBustParams): number {
  let w = row.current ? 1 : params.lastSeasonWeight;
  if (row.pos && target.pos && row.pos !== target.pos) w *= params.otherPositionWeight;
  w *= featureWeight(row.env, target.env, params.envBandwidth);
  w *= featureWeight(row.gap, target.gap, params.gapBandwidth);
  return w;
}

/** The formula itself, on any sample of past games -- shared by the live
 * odds and the backtest that tunes `params`. */
function oddsFrom(
  rows: GameRow[],
  rates: { boom: number; bust: number },
  playerId: number,
  weekProj: number,
  baseline: number,
  target: Features,
  params: BoomBustParams
): { boom: number; bust: number; ownGames: number } {
  const bars = boomBustBars(baseline);
  const s = spread(weekProj);
  const boomT = (bars.boom - weekProj) / s;
  const bustT = (bars.bust - weekProj) / s;

  // Comparable games league-wide: the weighted share that would clear each
  // bar from this week's projection. His own games on top, weighted as
  // priorGames comparable games, so his own volatility counts once he has a
  // real sample.
  let total = 0;
  let boomW = 0;
  let bustW = 0;
  let own = 0;
  let ownBoom = 0;
  let ownBust = 0;
  for (const row of rows) {
    const w = similarity(row, target, params);
    total += w;
    if (row.z >= boomT) boomW += w;
    if (row.z <= bustT) bustW += w;
    if (row.id === playerId) {
      own++;
      if (row.z >= boomT) ownBoom++;
      if (row.z <= bustT) ownBust++;
    }
  }
  const poolBoom = total > 0 ? boomW / total : rates.boom;
  const poolBust = total > 0 ? bustW / total : rates.bust;
  const rawBoom = (ownBoom + params.priorGames * poolBoom) / (own + params.priorGames);
  const rawBust = (ownBust + params.priorGames * poolBust) / (own + params.priorGames);
  return {
    boom: rates.boom + params.shrink * (rawBoom - rates.boom),
    bust: rates.bust + params.shrink * (rawBust - rates.bust),
    ownGames: own,
  };
}

let cache: { rows: GameRow[]; rates: { boom: number; bust: number }; games: Map<number, BoomBustGame[]> } | null = null;
function data() {
  if (cache) return cache;
  const rows = buildRows();
  const games = new Map<number, BoomBustGame[]>();
  rows.forEach((r) => {
    const list = games.get(r.id) ?? [];
    list.push({ season: r.season, week: r.week, proj: r.proj, actual: r.actual, result: r.result });
    games.set(r.id, list);
  });
  games.forEach((list) => list.sort((a, b) => b.season - a.season || b.week - a.week));
  cache = { rows, rates: baseRates(rows), games };
  return cache;
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

/** Optional inputs for weeklyBoomBust. `implied`/`vegasPts` default to this
 * week's bundled Vegas history (vegasHistory.json, kept current by the hourly
 * sync); pass them to price a week the bundle doesn't have yet. */
export interface BoomBustContext {
  pos?: Position;
  week?: number;
  implied?: number | null;
  vegasPts?: number | null;
}

const resultCache = new Map<string, WeeklyBoomBust | null>();

/** This week's boom/bust chances. `weekProj` is this week's projection,
 * `baseline` his season points per game (Player.seasonProj; falls back to his
 * average recorded projection, then this week's). Null when he's projected
 * under MIN_BOOM_BUST_PROJECTION (bye, out, deep bench). */
export function weeklyBoomBust(
  playerId: number,
  weekProj: number,
  baseline: number | null | undefined,
  ctx: BoomBustContext = {}
): WeeklyBoomBust | null {
  if (weekProj < MIN_BOOM_BUST_PROJECTION) return null;
  const key = `${playerId}|${weekProj}|${baseline}|${ctx.pos}|${ctx.week}|${ctx.implied}|${ctx.vegasPts}`;
  const hit = resultCache.get(key);
  if (hit !== undefined) return hit;

  const base = [baseline, recordedProjectionAvg(playerId)].find((b): b is number => b != null && b >= MIN_BOOM_BUST_PROJECTION) ?? weekProj;
  const bars = boomBustBars(base);
  const target: Features = {
    pos: ctx.pos ?? POS_BY_ID.get(playerId),
    ...marketFeatures(ctx.week ?? currentVegasWeek(), playerId, weekProj, ctx),
  };
  const { rows, rates } = data();
  const odds = oddsFrom(rows, rates, playerId, weekProj, base, target, MODEL.params);
  const result: WeeklyBoomBust = {
    boomChance: odds.boom,
    bustChance: odds.bust,
    boomAt: bars.boom,
    bustAt: bars.bust,
    baseline: round1(base),
    games: odds.ownGames,
    ...(target.env != null ? { gameEnvironment: round1(target.env) } : {}),
    ...(target.gap != null ? { marketLean: round1(target.gap * spread(weekProj)) } : {}),
  };
  resultCache.set(key, result);
  return result;
}

/** The chances for a player projected exactly at his own baseline with a
 * league-typical spread -- the yardstick for "higher than usual". */
export function typicalBoomBust(): { boomChance: number; bustChance: number } {
  const { rows, rates } = data();
  const odds = oddsFrom(rows, rates, Number.NaN, 15, 15, {}, { ...MODEL.params, otherPositionWeight: 1, envBandwidth: null, gapBandwidth: null });
  return { boomChance: odds.boom, bustChance: odds.bust };
}

/** A chance this far above typical earns a badge in player lists. */
export const NOTABLE_CHANCE_RATIO = 1.5;

/** Forward backtest of `params`: every finished week this season predicted
 * only from last season plus the weeks before it -- what the formula would
 * have said at the time. A player's baseline is his average projection over
 * those earlier weeks (his season projection then isn't recorded), or that
 * week's projection in week 1. Used by scripts/fitBoomBust.ts. */
export function backtestBoomBust(params: BoomBustParams): BoomBustBacktest {
  const { rows } = data();
  const weeks = [...new Set(rows.filter((r) => r.current).map((r) => r.week))].sort((a, b) => a - b);
  let n = 0;
  let model = 0;
  let base = 0;
  for (const week of weeks) {
    const train = rows.filter((r) => !r.current || r.week < week);
    const rates = baseRates(train);
    const priorProj = new Map<number, number[]>();
    train.forEach((r) => {
      if (!r.current) return;
      const list = priorProj.get(r.id) ?? [];
      list.push(r.proj);
      priorProj.set(r.id, list);
    });
    for (const t of rows) {
      if (!t.current || t.week !== week) continue;
      const prior = priorProj.get(t.id);
      const baseline = prior?.length ? prior.reduce((a, b) => a + b, 0) / prior.length : t.proj;
      const bars = boomBustBars(baseline);
      const boomHit = t.actual >= bars.boom ? 1 : 0;
      const bustHit = t.actual <= bars.bust ? 1 : 0;
      const odds = oddsFrom(train, rates, t.id, t.proj, baseline, { pos: t.pos, env: t.env, gap: t.gap }, params);
      model += ((odds.boom - boomHit) ** 2 + (odds.bust - bustHit) ** 2) / 2;
      base += ((rates.boom - boomHit) ** 2 + (rates.bust - bustHit) ** 2) / 2;
      n++;
    }
  }
  return { games: n, brier: n ? model / n : 0, baseRateBrier: n ? base / n : 0 };
}

export interface BoomBustTrackRecord {
  /** Graded player-games: predicted at kickoff, then final. */
  games: number;
  predictedBoom: number;
  actualBoom: number;
  predictedBust: number;
  actualBust: number;
  /** Mean Brier score of the recorded predictions, and of giving everyone
   * the season's actual rate -- the bar to beat. Lower is better. */
  brier: number;
  baseRateBrier: number;
}

/** How the odds the app actually showed held up: every prediction
 * scripts/recordProjections.ts froze at kickoff, graded against the final. */
export function boomBustTrackRecord(history: ProjectionHistory = PROJECTION_HISTORY as ProjectionHistory): BoomBustTrackRecord | null {
  const graded = Object.values(history.weeks).flatMap((players) =>
    Object.values(players).filter(
      (r): r is typeof r & { boom: number; bust: number; boomAt: number; bustAt: number; actual: number } =>
        r.actual != null && r.boom != null && r.bust != null && r.boomAt != null && r.bustAt != null
    )
  );
  if (!graded.length) return null;
  const n = graded.length;
  const hits = graded.map((r) => ({ boom: r.actual >= r.boomAt ? 1 : 0, bust: r.actual <= r.bustAt ? 1 : 0, r }));
  const actualBoom = hits.reduce((a, h) => a + h.boom, 0) / n;
  const actualBust = hits.reduce((a, h) => a + h.bust, 0) / n;
  return {
    games: n,
    predictedBoom: graded.reduce((a, r) => a + r.boom, 0) / n,
    actualBoom,
    predictedBust: graded.reduce((a, r) => a + r.bust, 0) / n,
    actualBust,
    brier: hits.reduce((a, h) => a + ((h.r.boom - h.boom) ** 2 + (h.r.bust - h.bust) ** 2) / 2, 0) / n,
    baseRateBrier: hits.reduce((a, h) => a + ((actualBoom - h.boom) ** 2 + (actualBust - h.bust) ** 2) / 2, 0) / n,
  };
}
