# Projection model log

A running record of how the custom weekly projection
(`src/lib/projectionModel.ts`, `src/lib/consensus.ts`) is being tuned, written
by the weekly projection-review routine and by hand. Newest entry first. Each
entry starts with `## YYYY-MM-DD`; the SessionStart hook
(`scripts/projectionReviewHook.sh`) shows unseen entries when a Claude Code
session opens.

Each entry says: how Custom did vs ESPN, what was tried, the walk-forward
evidence, what (if anything) changed in the shipped calculation, and ideas
queued for next time. Experiments that failed are recorded too, so they aren't
re-run blindly.

## 2026-10-25 — Baseline review (weeks 1–6, week 7 partial)

**Standing:** Custom beats ESPN all season: MAE 5.64 vs 5.78 over 1,082
player-games (closer 577–454). Every week ahead or tied (week 4). Edge comes
from RB/WR (−0.18 each); TE small (−0.09); QB flat (6.06 vs 6.05). Week 7
unofficial live grade: 5.35 vs 5.54, QB −0.27 for once.

**Shipped calculation:** the hand-set defaults (`DEFAULT_PROJECTION_PARAMS`):
50/50 ESPN/Sleeper, full prop swing capped at 30%, no position scale, no
questionable discount, role/rz off. The hourly `fit:projections` refit has
never been adopted (`adopted: false` every week since Oct 2) — it loses to the
defaults walk-forward, and its params swing week to week (propWeight
1 → 0.75 → 0 → 0.5), i.e. fitting noise.

**Experiments (walk-forward, weeks 2–6, 931 games, RMSE / MAE):**

| Approach | RMSE | MAE |
|---|---|---|
| Defaults (shipped) | 7.017 | 5.548 |
| Current 7-param fitter | 7.045 | 5.577 |
| 2-param (sleeperShare, propWeight) | 7.027 | 5.524 |
| 2-param, shrunk to defaults | 7.021 | 5.536 |
| Per-position 2-param | 7.037 | 5.538 |
| Per-position 2-param, shrunk | 7.015 | 5.528 |
| ESPN alone | 7.048 | 5.673 |
| Sleeper alone | 7.051 | 5.589 |

Nothing clears the 0.5% RMSE adoption bar; per-position shrunk is within noise
of the defaults. Full-data per-position fits lean RB toward Sleeper + more
props (s=1, w=1.25) and QB away from props (w=0) — worth re-checking as data
grows, not shipping yet.

**Changed:** nothing in the calculation. Added this log, the weekly review
routine, and the SessionStart review hook.

**Next to try:** re-run per-position shrunk with week 7+; QB-specific inputs
(rushing props, Vegas implied team total); whether the 7-param fitter should be
replaced by the shrunk 2-param fit so the hourly refit stops chasing noise.
