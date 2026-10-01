// Refits the boom/bust formula's tunables (lib/boomBust.ts BoomBustParams)
// from every finished game, and writes them to src/data/boomBustModel.json --
// how the app's own boom/bust odds get better as the season's data piles up.
//
// Each candidate is scored by a forward backtest (backtestBoomBust): every
// finished week predicted only from last season plus the weeks before it,
// graded by Brier score. The search goes one tunable at a time from the
// current params, and a change is kept only when it beats the current score
// by MIN_GAIN -- so a factor the data can't yet tell from noise (game
// environment, the market's lean) stays off rather than getting switched on
// by luck.
//
// Runs on the same schedule as the snapshot sync (.github/workflows/
// sync-snapshot.yml), after recordProjections has filled in actuals.
// Usage: npm run fit:boombust
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BOOM_BUST_PARAMS,
  backtestBoomBust,
  boomBustModel,
  type BoomBustModel,
  type BoomBustParams,
} from "../src/lib/boomBust.js";

const OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data/boomBustModel.json");
/** Relative Brier improvement a change has to make to be kept. */
const MIN_GAIN = 0.002;
const PASSES = 2;

const CANDIDATES: { [K in keyof BoomBustParams]: BoomBustParams[K][] } = {
  priorGames: [8, 15, 30, 60, 120, 1000],
  lastSeasonWeight: [0.1, 0.25, 0.5, 1],
  otherPositionWeight: [0.2, 0.5, 1],
  envBandwidth: [null, 2, 3, 5],
  gapBandwidth: [null, 0.1, 0.15, 0.25],
  shrink: [0.3, 0.5, 0.7, 0.85, 1],
};

const score = (params: BoomBustParams) => backtestBoomBust(params).brier;

let params: BoomBustParams = { ...DEFAULT_BOOM_BUST_PARAMS, ...boomBustModel().params };
let best = score(params);
console.log(`Starting params score ${best.toFixed(5)}`, params);

for (let pass = 0; pass < PASSES; pass++) {
  let changed = false;
  for (const key of Object.keys(CANDIDATES) as (keyof BoomBustParams)[]) {
    for (const value of CANDIDATES[key]) {
      if (value === params[key]) continue;
      const trial = { ...params, [key]: value } as BoomBustParams;
      const s = score(trial);
      if (s < best * (1 - MIN_GAIN)) {
        console.log(`  ${key}: ${params[key]} -> ${value} (${best.toFixed(5)} -> ${s.toFixed(5)})`);
        params = trial;
        best = s;
        changed = true;
      }
    }
  }
  if (!changed) break;
}

const backtest = backtestBoomBust(params);
const model: BoomBustModel = { fittedAt: new Date().toISOString(), params, backtest };
const skill = backtest.baseRateBrier > 0 ? (1 - backtest.brier / backtest.baseRateBrier) * 100 : 0;
console.log(
  `Fitted on ${backtest.games} games: Brier ${backtest.brier.toFixed(5)} vs base rate ${backtest.baseRateBrier.toFixed(5)} (${skill.toFixed(1)}% better)`,
  params
);

// Only rewrite when the params or backtest moved, so an unchanged hourly run
// doesn't produce a commit just for a new timestamp.
const prior = boomBustModel();
const same =
  JSON.stringify(prior.params) === JSON.stringify(params) &&
  prior.backtest?.games === backtest.games &&
  prior.backtest?.brier.toFixed(6) === backtest.brier.toFixed(6);
if (same) {
  console.log("Model unchanged.");
} else {
  writeFileSync(OUT_FILE, JSON.stringify(model, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}.`);
}
