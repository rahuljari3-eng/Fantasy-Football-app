// The tunables of the custom weekly projection (lib/consensus.ts
// blendWeeklyProj + applyPropLines), learned from how past weeks actually
// turned out instead of fixed by hand -- so the projection keeps getting
// better as the season's data piles up.
//
// The projection is
//   base   = scale[pos] * ((1 - sleeperShare) * ESPN + sleeperShare * Sleeper)
//   custom = base + clamp(propWeight * propDelta, +/- propCap * base)
// where propDelta is the yardage swing the week's sportsbook props imply
// (consensus.ts propYardsDelta). scale[pos] corrects a lean the sources share
// at a position (both running high on RBs, say).
//
// scripts/recordProjections.ts records each player's inputs at kickoff in
// projectionHistory.json; scripts/fitProjections.ts refits the params hourly
// against every finished week and writes them to projectionModel.json. The
// fit is only adopted when a walk-forward backtest -- each week predicted with
// params fit on the weeks before it -- beats the hand-set defaults, so a
// pattern the data can't yet tell from noise stays out.
//
// The fit minimizes squared error, not absolute: weekly scoring is skewed
// (most games land under a player's average, a few blow up), so minimizing
// absolute error targets the median and drags every projection low -- a
// smaller "avg miss" from a projection that's systematically short. Squared
// error targets the expected points, which is what start/sit and lineup
// totals need.
import PROJECTION_MODEL from "../data/projectionModel.json" with { type: "json" };
import { PROP_ADJUST_MAX_FRACTION } from "../config/scoring.js";
import { isPlayedGame, type ProjectionHistory } from "./projectionAccuracy.js";

export const SCALED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type ScaledPosition = (typeof SCALED_POSITIONS)[number];

export interface ProjectionParams {
  /** Sleeper's share of the ESPN/Sleeper blend (0 = ESPN alone). */
  sleeperShare: number;
  /** How much of the props' implied yardage swing is applied (1 = all). */
  propWeight: number;
  /** The props can move a projection by at most this fraction of it. */
  propCap: number;
  /** Multiplier on the blend at each position. */
  scale: Record<ScaledPosition, number>;
}

export interface ProjectionBacktest {
  /** Player-games graded (finished weeks after the first, projected 5+). */
  games: number;
  weeks: number[];
  /** Root-mean-square and mean absolute error, points per player-game: the
   * params as fit on only the weeks before each graded week; the hand-set
   * defaults; ESPN alone. Adoption is decided on RMSE. */
  fittedRmse: number;
  defaultRmse: number;
  espnRmse: number;
  fittedMae: number;
  defaultMae: number;
  espnMae: number;
}

export interface ProjectionModel {
  fittedAt: string | null;
  params: ProjectionParams;
  /** True when the fit beat the defaults walk-forward and is in use. */
  adopted: boolean;
  backtest: ProjectionBacktest | null;
}

/** The blend as it was set by hand: ESPN and Sleeper equal, the full prop
 * swing capped at PROP_ADJUST_MAX_FRACTION, no position correction. */
export const DEFAULT_PROJECTION_PARAMS: ProjectionParams = {
  sleeperShare: 0.5,
  propWeight: 1,
  propCap: PROP_ADJUST_MAX_FRACTION,
  scale: { QB: 1, RB: 1, WR: 1, TE: 1 },
};

const MODEL = PROJECTION_MODEL as unknown as ProjectionModel;

export function projectionModel(): ProjectionModel {
  return MODEL;
}

/** The params the app projects with: the fit when adopted, else the defaults. */
export function projectionParams(): ProjectionParams {
  return MODEL.adopted ? MODEL.params : DEFAULT_PROJECTION_PARAMS;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The ESPN/Sleeper blend, before props. A 0 from ESPN means bye or ruled
 * out and is kept (see consensus.ts blendWeeklyProj). */
export function blendWithParams(params: ProjectionParams, espn: number, sleeper: number | null | undefined, pos: string | undefined): number {
  if (espn <= 0) return espn;
  const share = sleeper != null && sleeper > 0 ? params.sleeperShare : 0;
  const scale = params.scale[pos as ScaledPosition] ?? 1;
  return round1(scale * ((1 - share) * espn + share * (sleeper ?? 0)));
}

/** The props' yardage swing applied to a blended projection. */
export function applyPropDeltaWithParams(params: ProjectionParams, proj: number, delta: number | null | undefined): number {
  if (delta == null || proj <= 0) return proj;
  const cap = proj * params.propCap;
  return round1(proj + Math.max(-cap, Math.min(cap, params.propWeight * delta)));
}

/** One finished player-game with the inputs the projection was built from. */
export interface ProjectionGame {
  week: number;
  pos: string;
  espn: number;
  sleeper: number | null;
  prop: number | null;
  actual: number;
}

/** Same relevance cut as the accuracy comparison (projectionAccuracy.ts). */
const MIN_RELEVANT_PROJECTION = 5;

export function projectionGames(history: ProjectionHistory): ProjectionGame[] {
  const games: ProjectionGame[] = [];
  Object.entries(history.weeks).forEach(([week, players]) => {
    Object.values(players).forEach((r) => {
      if (!isPlayedGame(r) || r.pos == null || Math.max(r.espn, r.custom) < MIN_RELEVANT_PROJECTION) return;
      games.push({ week: Number(week), pos: r.pos, espn: r.espn, sleeper: r.sleeper ?? null, prop: r.prop ?? null, actual: r.actual });
    });
  });
  return games;
}

export function projectWithParams(params: ProjectionParams, g: ProjectionGame): number {
  return applyPropDeltaWithParams(params, blendWithParams(params, g.espn, g.sleeper, g.pos), g.prop);
}

/** Mean squared error -- what the fit minimizes (see the header). */
export function mseWithParams(params: ProjectionParams, games: ProjectionGame[]): number {
  if (!games.length) return 0;
  return games.reduce((sum, g) => sum + (projectWithParams(params, g) - g.actual) ** 2, 0) / games.length;
}

export function maeWithParams(params: ProjectionParams, games: ProjectionGame[]): number {
  if (!games.length) return 0;
  return games.reduce((sum, g) => sum + Math.abs(projectWithParams(params, g) - g.actual), 0) / games.length;
}

const CANDIDATES = {
  sleeperShare: [0, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1],
  propWeight: [0, 0.5, 0.75, 1, 1.25],
  propCap: [0.15, 0.3, 0.5],
  scale: [0.85, 0.9, 0.95, 0.975, 1, 1.025, 1.05, 1.1],
};
/** Relative MSE improvement a change has to make to be kept. */
const MIN_GAIN = 0.002;
const PASSES = 3;

/** Coordinate search from the defaults: one tunable at a time, a change kept
 * only when it beats the current fit by MIN_GAIN. */
export function fitProjectionParams(games: ProjectionGame[]): ProjectionParams {
  let params: ProjectionParams = { ...DEFAULT_PROJECTION_PARAMS, scale: { ...DEFAULT_PROJECTION_PARAMS.scale } };
  let best = mseWithParams(params, games);
  const tryParams = (trial: ProjectionParams) => {
    const s = mseWithParams(trial, games);
    if (s < best * (1 - MIN_GAIN)) {
      params = trial;
      best = s;
      return true;
    }
    return false;
  };
  for (let pass = 0; pass < PASSES; pass++) {
    let changed = false;
    for (const key of ["sleeperShare", "propWeight", "propCap"] as const) {
      for (const value of CANDIDATES[key]) {
        if (value !== params[key] && tryParams({ ...params, [key]: value })) changed = true;
      }
    }
    for (const pos of SCALED_POSITIONS) {
      // Fit on that position's games only, so other positions' noise can't
      // block a real correction (the other params don't change here).
      const posGames = games.filter((g) => g.pos === pos);
      let posBest = mseWithParams(params, posGames);
      for (const value of CANDIDATES.scale) {
        if (value === params.scale[pos]) continue;
        const trial = { ...params, scale: { ...params.scale, [pos]: value } };
        const s = mseWithParams(trial, posGames);
        if (s < posBest * (1 - MIN_GAIN)) {
          params = trial;
          posBest = s;
          changed = true;
        }
      }
      best = mseWithParams(params, games);
    }
    if (!changed) break;
  }
  return params;
}

/** Walk-forward: each finished week after the first projected with params fit
 * only on the weeks before it, against the defaults and ESPN alone. */
export function backtestProjections(games: ProjectionGame[]): ProjectionBacktest {
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  const errors = { fitted: [] as number[], defaults: [] as number[], espn: [] as number[] };
  const graded: number[] = [];
  weeks.slice(1).forEach((week) => {
    const params = fitProjectionParams(games.filter((g) => g.week < week));
    const test = games.filter((g) => g.week === week);
    test.forEach((g) => {
      errors.fitted.push(projectWithParams(params, g) - g.actual);
      errors.defaults.push(projectWithParams(DEFAULT_PROJECTION_PARAMS, g) - g.actual);
      errors.espn.push(g.espn - g.actual);
    });
    if (test.length) graded.push(week);
  });
  const n = errors.fitted.length;
  const rmse = (e: number[]) => (n ? Math.sqrt(e.reduce((s, x) => s + x * x, 0) / n) : 0);
  const mae = (e: number[]) => (n ? e.reduce((s, x) => s + Math.abs(x), 0) / n : 0);
  return {
    games: n,
    weeks: graded,
    fittedRmse: rmse(errors.fitted),
    defaultRmse: rmse(errors.defaults),
    espnRmse: rmse(errors.espn),
    fittedMae: mae(errors.fitted),
    defaultMae: mae(errors.defaults),
    espnMae: mae(errors.espn),
  };
}
