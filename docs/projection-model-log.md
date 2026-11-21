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

## 2026-11-21 — No change: week 11 not final yet; Questionable discount close but short

**Standing (through week 10; week 11 still in progress, so same data as the
Nov 20 entry):** Custom MAE 5.56 vs ESPN 5.68 over 1,840 player-games, closer
990–767, ahead or tied every week (tie in week 4). By position: QB 6.12 vs
6.14, RB 5.47 vs 5.62, WR 5.50 vs 5.65, TE 5.34 vs 5.41. Most recent finished
week (10): 5.69 vs 5.74, closer 98–85; lost at QB (5.97 vs 5.78) and RB (6.19
vs 6.15), won WR and TE. `projectionModel.json`: not adopted (refit 6.998 vs
defaults 6.991 walk-forward RMSE, 1,689 games, weeks 2–10); defaults remain in
use.

**Where Custom is weak:** Questionable players who played (20 graded games,
Custom 6.67 MAE, and it ran 5.8 pts too high on average); and players where
Sleeper sits 2+ points above ESPN (108 games; Custom 5.50 vs ESPN 5.41 MAE).

**Experiments (walk-forward, weeks 2–10, 1,689 games; each week fit only on
earlier weeks; shipped = defaults, 6.991 / 5.495):**

| Idea | RMSE | MAE | QB / RB / WR / TE MAE | Weeks better |
|---|---|---|---|---|
| Shipped (defaults) | 6.991 | 5.495 | 6.049 / 5.378 / 5.463 / 5.269 | — |
| Questionable discount, fit on Q games, shrunk (10-game prior toward 1) | 6.974 (−0.24%) | 5.484 | 6.016 / 5.375 / 5.458 / 5.247 | 6 of 6 weeks with Q games (3 weeks had none) |
| Same, 20-game prior | 6.979 (−0.18%) | 5.486 | 6.019 / 5.375 / 5.460 / 5.254 | 6 of 6 |
| Separate Sleeper share when Sleeper > ESPN vs below (shrunk, 500-game prior) | 6.990 (−0.01%) | 5.497 | 6.067 / 5.381 / 5.458 / 5.268 | 5 of 9 |
| Same, unshrunk | 6.997 (+0.08%) | 5.497 | 6.105 / 5.372 / 5.450 / 5.272 | 4 of 9 |

The Questionable discount helps every week it applies and never hurts, but it
only touches ~1% of games, so it can't reach the 0.5% overall RMSE bar.
On all data the best discount is 0.7 or lower (Q RMSE 8.57 → 6.17), but that's
20 games. The asymmetric Sleeper share is noise — rejected.

**Changed:** nothing in the calculation.

**Needs owner's decision:** the Nov 20 question (judge a change that only
touches one group — QBs, or now Questionable players — on that group's own
RMSE, with the other checks unchanged) is still open. A yes would make two
changes eligible: the QB Vegas implied total and a shrunk Questionable
discount (~0.9). Separately, the Nov 20 entry says the routine's pushes were
getting 403s; if this entry isn't on main, that's still happening.

**Next to try:** re-run both pending candidates once week 11 is final; check
whether high projections (20+, 69 games, ran 2.6 pts low) are a real lean or
noise once there are more of them.

## 2026-11-20 — Recovered: Nov 3/10/17/20 routine runs couldn't push (by hand)

The cloud routine has run every Tuesday, but GitHub rejects its push with a 403
("Claude doesn't have GitHub access"), so its entries were lost. This is a
summary of what the Nov 17 and Nov 20 runs found, from their run logs.

**Standing (through week 10):** Custom MAE 5.56 vs ESPN 5.68 over 1,840
player-games, closer 990–767, ahead or tied every week (tie in week 4). By
position: RB 5.47 vs 5.62, WR 5.50 vs 5.65, TE 5.34 vs 5.41, QB 6.12 vs 6.14.
Week 10: 5.69 vs 5.74 (QB 5.97 vs 5.78 and RB lost). Hourly refit still not
adopted (6.998 vs 6.991 walk-forward RMSE).

**Experiments (walk-forward, weeks 2–10, 1,689 games; shipped 6.991 / 5.495):**

| Idea | RMSE | MAE | Weeks better |
|---|---|---|---|
| QB + Vegas implied team total (shrunk) | 6.986 | 5.489 | 8 of 9 |
| QB prop weight 0–0.5 | 6.984–6.985 | 5.492–5.493 | 6 of 9 |
| Per-position prop weight | 6.989–7.000 | 5.499–5.514 | 5–6 of 9 |
| Prop weight 0.5 for all (refit's pick) | 6.982 | 5.519 (worse) | 5 of 9 |

QB-only: the implied-total input cuts QB MAE 6.05 → 6.00 and QB RMSE ~0.5%;
the fit is about +0.3 pts per point of team total above ~22.8.

**Changed:** nothing in the calculation.

**Needs owner's decision:** QBs are ~16% of graded games, so a QB-only fix
can't clear the 0.5% all-positions bar. Allow single-position changes to be
judged on that position's own RMSE (other checks unchanged)? If yes, the QB
Vegas implied total is the first candidate.

**Next to try:** the above if approved; re-check the questionable discount
once more than ~20 graded Questionable games exist.

## 2026-11-02 — QB inputs: what the prop feed does and doesn't carry (by hand)

**Standing:** Custom still ahead through week 7 (MAE 5.59 vs 5.73, 1,269
games). Week 8 unofficial live grade (Sunday games, MNF pending): 5.81 vs
5.89; QB the only position behind (7.58 vs 7.52). Season QB edge is ~0
(−0.4%), won 3/8 weeks, and when Custom moves a QB ≥1.5 pts off ESPN it's
right only 14–16 — the prop swing isn't helping QBs.

**Checked (no calculation change):**
- QB rushing-yard lines (ESPN prop type 12) are posted for every starter and
  are already in the prop delta: e.g. week 8 Lamar's −1.69 was −0.20 passing,
  −1.48 rushing. So "add QB rushing props" is not a lever — it's already in.
- QB TD markets come through ESPN's prop feed without prices: passing TDs are
  a bare 1.5 line for nearly everyone; anytime/2+/3+ scorer are empty. No
  usable per-QB TD signal without a priced odds source.

**Next to try:** the Vegas implied team total as a QB input (already in
`vegasHistory.json` for backtesting) to cover the TD gap the yardage props
miss; and per-position prop weight with QB → 0, which the full-data fit
already leans toward.

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
