// Refits the custom weekly projection's tunables (lib/projectionModel.ts
// ProjectionParams) from every finished week, and writes them to
// src/data/projectionModel.json -- how the app's projections get more accurate
// as the season goes on.
//
// The params are fit on all finished weeks, but only adopted (used by the
// app) when the walk-forward backtest -- each week projected with params fit
// on only the weeks before it -- beats the hand-set defaults by MIN_EDGE. Until
// then the defaults stay in use, so a few weeks of noise can't make the
// projections worse.
//
// Runs on the same schedule as the snapshot sync (.github/workflows/
// sync-snapshot.yml), after recordProjections has filled in actuals.
// Usage: npm run fit:projections
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PROJECTION_HISTORY from "../src/data/projectionHistory.json" with { type: "json" };
import type { ProjectionHistory } from "../src/lib/projectionAccuracy.js";
import {
  backtestProjections,
  fitProjectionParams,
  maeWithParams,
  mseWithParams,
  projectionGames,
  projectionModel,
  DEFAULT_PROJECTION_PARAMS,
  type ProjectionModel,
} from "../src/lib/projectionModel.js";

const OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data/projectionModel.json");
/** Relative walk-forward RMSE improvement over the defaults needed to adopt. */
const MIN_EDGE = 0.005;

const games = projectionGames(PROJECTION_HISTORY as ProjectionHistory);
const params = fitProjectionParams(games);
const backtest = backtestProjections(games);
const adopted = backtest.games > 0 && backtest.fittedRmse < backtest.defaultRmse * (1 - MIN_EDGE);

const rmse = (p: typeof params) => Math.sqrt(mseWithParams(p, games)).toFixed(3);
console.log(
  `Fit on ${games.length} games: RMSE ${rmse(params)} / MAE ${maeWithParams(params, games).toFixed(3)} (defaults ${rmse(DEFAULT_PROJECTION_PARAMS)} / ${maeWithParams(DEFAULT_PROJECTION_PARAMS, games).toFixed(3)})`,
  params
);
const bt = (rmse: number, mae: number) => `${rmse.toFixed(3)} / ${mae.toFixed(3)}`;
console.log(
  `Walk-forward on ${backtest.games} games (weeks ${backtest.weeks.join(", ")}), RMSE / MAE: fitted ${bt(backtest.fittedRmse, backtest.fittedMae)}, defaults ${bt(backtest.defaultRmse, backtest.defaultMae)}, ESPN ${bt(backtest.espnRmse, backtest.espnMae)} -> ${adopted ? "adopted" : "keeping defaults"}`
);

// Only rewrite when something moved, so an unchanged hourly run doesn't
// produce a commit just for a new timestamp.
const prior = projectionModel();
const same =
  JSON.stringify(prior.params) === JSON.stringify(params) &&
  prior.adopted === adopted &&
  prior.backtest?.games === backtest.games &&
  prior.backtest?.fittedRmse?.toFixed(6) === backtest.fittedRmse.toFixed(6);
if (same) {
  console.log("Model unchanged.");
} else {
  const model: ProjectionModel = { fittedAt: new Date().toISOString(), params, adopted, backtest };
  writeFileSync(OUT_FILE, JSON.stringify(model, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}.`);
}
