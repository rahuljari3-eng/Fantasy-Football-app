---
date: 2026-09-23
topic: valuation-ros-fixes
status: implemented-on-branch
branch: fix/valuation-ros-realism
---

# Plan: Player valuation & ROS realism fixes

## Goal

Make rest-of-season (ROS) player value calendar-aware and less naive, fix trade fairness labeling inconsistencies, harden season-projection fallbacks, and keep Roster Sensei / Coach / Trade Analyzer on one shared valuation pipeline (no second formula).

## Locked product decisions

1. **ROS multiplier = remaining games, not a fixed 16.** Count NFL weeks from the current scoring period through the league’s fantasy-relevant end (regular season + fantasy playoffs if configured; default through week 17 regular / week 18 if schedule cache goes that far), minus the player’s remaining bye if it still lies ahead. Prefer a shared helper over scattering `17 - week` math.
2. **Do not invent future ESPN weekly projections.** Keep Sensei’s outlook pattern: current week = real weekly proj; later weeks = labeled baselines. Schedule strength may adjust *value*, not invent weekly ESPN numbers.
3. **Schedule-aware ROS is a coarse multiplier (±~10%), not a full opponent-by-week VOR rebuild.** Use remaining slate + available Vegas/implied-total signals when present; fall back to 1.0 when missing.
4. **Trade Analyzer stays need-agnostic by default**, but gains an optional “need-adjusted” toggle so Coach / Sensei / Analyzer can agree when the user wants that view.
5. **Sensei must not grow a parallel valuation path.** Prefer refactoring duplicates so tools call `src/lib/scoring.ts` / `tradeEngine.ts` only. Prompt/tool notes update only where field *meanings* change.

---

## Phase 0 — Documentation discovery (done)

### Sources consulted

| Source | Role |
|--------|------|
| `src/config/scoring.ts` | `ROS_WEEKS=16`, `SLEEPER_ROS_WEEKS=8`, status/tier multipliers, market weights |
| `src/config/trade.ts` | `FAIR_RATIO_*` vs `LOPSIDED_RATIO_*` (currently inverted bands) |
| `src/lib/scoring.ts` | `playerValue`, `seasonModelValue`, `qualityScore`, `rosValue` |
| `src/lib/tradeEngine.ts` | `packageValue`, `needAdjustedPackageValue`, pricers |
| `src/lib/consensus.ts` | Sleeper ROS window, `blendSeasonProj`, `rankPlayerPool` |
| `src/lib/espn.ts` | `extractEspnSeasonProjection`, scoring period |
| `src/lib/nflSchedule.ts` | `teamScheduleRemaining` (remaining slate + bye) |
| `src/lib/leagueSchedule.ts` | `currentWeek` from `status.currentMatchupPeriod` |
| `src/hooks/useFantasyApp.ts` | Trade Analyzer `tradeValue` / `rosValue` (no need adjust) |
| `server/agent/tools/leagueData.ts` | `serializePlayer` → weekValue / rosValue / qualityScore |
| `server/agent/tools/analysisTools.ts` | `evaluate_trade` local `packageWithValues` + `ROS_WEEKS` floor |
| `server/agent/tools/scheduleTools.ts` | outlook baselines (not VOR) |
| `server/agent/systemPrompt.ts`, `evidence.ts` | Field-usage guidance (no hardcoded “16”) |
| `docs/roster-sensei-agent-tools.md` | Shared valuation contract; schedule IQ rules |
| `scripts/smoke-sensei.ts` | Crash-only tool smoke |

### Allowed APIs (copy these — do not invent)

**Config / formulas**

- Tunables: `src/config/scoring.ts`, `src/config/trade.ts`
- Value: `playerValue`, `qualityScore`, `seasonModelValue`, `rosValue` — `src/lib/scoring.ts`
- Packages: `packageValue`, `needAdjustedPackageValue`, `WEEK_PRICER`, `SEASON_PRICER`, `fairnessRatio`, `ratioIsFair`, `starGateOk` — `src/lib/tradeEngine.ts`

**Week / schedule**

- Projection period: `fetchEspnRosteredProjections().period` — `src/lib/espn.ts`
- UI week: `fetchLeagueScheduleSnapshot().currentWeek` — `src/lib/leagueSchedule.ts`
- Sensei week: `ensureLiveRosters` / `getLiveLeagueCache().scoringPeriodId` — `src/lib/espnLeague.ts`
- Remaining NFL slate: `teamScheduleRemaining` — `src/lib/nflSchedule.ts`
- Consensus window: `fetchConsensusSources(season, week)` — `src/lib/consensus.ts`

**Sensei serialization**

- `serializePlayer` / `withPosRanks` / `rankPlayerPool` — `server/agent/tools/leagueData.ts` + `src/lib/consensus.ts`

### Anti-patterns

- Do **not** invent future ESPN weekly projections for value or outlook.
- Do **not** add a second valuation formula inside Sensei tools.
- Do **not** conflate `scoringPeriodId` with `status.currentMatchupPeriod` without documenting which week source each caller uses.
- Do **not** re-rank tiny 2–4 player lists for trades (wipes scarcity in `playerValue`).
- Do **not** assume ChatPage sends `scoringPeriodId` today (server fills from ESPN).
- Do **not** treat `qualityScore` and `rosValue` as the same absolute scale when comparing package totals across tools.

### Sensei inheritance reality (verify, don’t assume)

| Change | Auto-inherits? |
|--------|----------------|
| `scoring.ts` / `config/scoring.ts` formulas & `rosValue` | **Yes** via `serializePlayer` + direct imports |
| `consensus.rankPlayerPool` / Sleeper window | **Yes** (app refresh + Sensei `syncLiveRosters`) |
| `tradeEngine` package / fair / star gate | **Mostly yes**; **except** `evaluate_trade` season block uses local `packageWithValues` |
| `coachTrades` / `whatWouldItTake` | **Yes** for `suggest_trades` / `what_would_it_take` |
| Projection outlook baselines | **No** (orthogonal; update notes if semantics change) |
| Prompt / `citeHints` | **No** — update if field meanings change |

---

## Phase 1 — Dynamic remaining weeks for `rosValue`

### What to implement

1. **Add** `remainingRosWeeks(opts)` (name flexible) in `src/lib/scoring.ts` (or a tiny `src/lib/rosHorizon.ts` if scoring stays pure):
   - Inputs: `currentWeek`, optional `player.bye`, optional `throughWeek` (default: fantasy-relevant end — prefer schedule `maxWeek` capped at playoff end, else `17`/`18` consistent with `LAST_REGULAR_SEASON_WEEK` in consensus).
   - Output: integer count of **games weeks still ahead** (exclude bye if `bye >= currentWeek`, exclude past weeks). Floor at `1` so mid-bye / end-season never zeros everyone out.
2. **Replace** bare `ROS_WEEKS` constant usage in `rosValue`:
   - Prefer: `rosValue(p, weeksRemaining?)` with default from a module-level / injected current week when available.
   - Keep `ROS_WEEKS` in config as **fallback / documentation constant** (e.g. early-season estimate) only when week is unknown.
3. **Thread current week** into callers that compute absolute ROS:
   - App: `useFantasyApp` Trade Analyzer season mode (`tradeValueOf` / package floor `VOR_BASELINE * weeks`).
   - Sensei: `serializePlayer` and `evaluate_trade` season floor — pass cache `scoringPeriodId`.
4. **Package floors** that today use `VOR_BASELINE * ROS_WEEKS` must use the **same** remaining-weeks helper so discount math stays on one scale.

### Documentation references

- Copy remaining-slate loop shape from `teamScheduleRemaining` (`src/lib/nflSchedule.ts` 155–181).
- Keep `rosValue` comment contract in `src/lib/scoring.ts` 121–126 updated to say “remaining schedule,” not “16-game season.”
- Update `docs/roster-sensei-agent-tools.md` shared valuation bullet if it implies a fixed season length.

### Verification

- [ ] Grep: no production `rosValue` path still hard-multiplies a fixed `16` when `currentWeek` is known.
- [ ] Mid-season (e.g. week 10): same player’s `rosValue` is materially lower than week 1 for identical `qualityScore`.
- [ ] Trade Analyzer season **ratios** for 1-for-1 healthy swaps stay ~unchanged (both sides scale).
- [ ] Absolute Sensei `rosValue` fields move with week; `qualityScore` unchanged by this phase alone.
- [ ] `npm run smoke:sensei` still passes.

### Anti-pattern guards

- Do not multiply by remaining weeks **and** also bake remaining weeks into `seasonProj` (double count).
- Do not use bye exclusion inconsistently across players (always exclude remaining bye once).

### Sensei notes

- Auto-inherits once `rosValue` / `serializePlayer` take remaining weeks.
- Manually update `evaluate_trade` season floor if it still imports `ROS_WEEKS` literally (`analysisTools.ts` ~276–277) — prefer calling shared `packageValue` on a ros-scaled pricer (Phase 6).

---

## Phase 2 — Safer `seasonProj` fallback (stop week-collapse)

### What to implement

1. In `seasonModelValue` (`src/lib/scoring.ts` 102–106): **do not** fall back from missing `seasonProj` to a near-zero `proj` when status/bye implies this week is not talent.
   - Preferred order: `seasonProj` → last known season override / `sleeperRos` if stamped on player → only then `proj` if `proj` is “healthy-looking” (e.g. above a small floor or status Healthy and not bye).
2. Mirror the same policy in display/sort fallbacks that currently do `seasonProj ?? proj` where they feed **valuation** (`consensus` season rank sort, `useFantasyApp` override merge). Display-only UI (PlayerNewsModal) may still show week proj with a clear label.
3. When blending in `espnLeague` / consensus apply path: if ESPN season line is null but Sleeper ROS exists, keep `seasonProj` from Sleeper alone rather than writing week proj into the season field.

### Documentation references

- `Player.seasonProj` contract in `src/types.ts` (~58–63).
- `blendSeasonProj` / apply overrides in `src/lib/consensus.ts`.
- Trade pricer comment in `tradeEngine.ts` ~55–62 (Questionable week collapse).

### Verification

- [ ] Player with `proj ≈ 0`, `status: Out`, but valid Sleeper/ESPN season PPG keeps non-collapsed `qualityScore`.
- [ ] Player truly missing all season sources still gets a defined floor (`Math.max(1, …)` path), not `NaN`.
- [ ] Grep valuation call sites: no silent `seasonProj ?? proj` into `seasonModelValue` without the new guard.

### Sensei notes

- Auto-inherits via `qualityScore` / `rosValue` on `serializePlayer`.
- Outlook tool already labels `current_week_proj_fallback` — keep that disclaimer; optionally prefer refusing baseline when only collapsed week proj exists.

---

## Phase 3 — Injury ROS multipliers + IR realism

### What to implement

1. Retune `ROS_STATUS_MULTIPLIER` in `src/config/scoring.ts`:
   - Strengthen long-absence tags (e.g. Out / IR much harsher than Questionable).
   - Treat ESPN `"IR"` distinctly from one-week `"Out"` if both appear in data (map in status normalization if needed).
2. Optional v1.1 (same phase if cheap): if ESPN injury news / expected return is already available in an existing payload, multiply by `missedFraction = remainingMissed / remainingWeeks`; otherwise ship stronger static multipliers only.
3. Keep weekly `playerValue` unchanged (week proj already collapses for Out).

### Documentation references

- Existing multipliers `src/config/scoring.ts` 86–94.
- Status types in `src/types.ts`.

### Verification

- [ ] Healthy elite ≈ unchanged; IR/Out season `qualityScore` drops vs today.
- [ ] Questionable still near 1.0 (short-term tag).
- [ ] Coach needs / FA recommendations move for IR players in the expected direction.

### Sensei notes

- Auto-inherits. Optionally one line in `compare_players` note: ROS already applies season injury haircut — don’t double-penalize in prose.

---

## Phase 4 — Fair vs lopsided label cleanup

### What to implement

1. Fix `src/config/trade.ts` so **LOPSIDED band is strictly wider than FAIR**:
   - Keep accept/reject on `FAIR_RATIO_MIN/MAX` (0.92–1.12) unless product wants a tweak.
   - Set e.g. `LOPSIDED_RATIO_MIN = 0.85`, `LOPSIDED_RATIO_MAX = 1.15` (or similar), restoring the “slightly favors” middle band.
2. **Export one shared** `verdictFromRatio(ratio)` from `tradeEngine.ts` (or `src/lib/tradeVerdict.ts`) and replace private copies in:
   - `server/agent/tools/analysisTools.ts`
   - `server/agent/tools/espnLeagueTools.ts`
   - `src/pages/CoachPage.tsx`
3. Align Trade Analyzer headline coloring with the same ladder (even if it stays need-agnostic).

### Documentation references

- Comment already in `trade.ts` 22–25 describing intended semantics (today’s numbers contradict it).
- Coach `ratioVerdict` / analyzer LOPSIDED usage.

### Verification

- [ ] Ratio `1.11`: verdict is “fair” / even (inside FAIR), not “favors you.”
- [ ] Ratio `1.14`: “slightly favors” (inside LOPSIDED, outside FAIR).
- [ ] Ratio `1.20`: “lopsided / favors.”
- [ ] Sensei `evaluate_trade` `verdict` matches Coach for the same ratio.

### Sensei notes

- Update `systemPrompt.ts` trade fairness line only if verdict enum strings change.
- Tool `fairWindow` fields should continue to quote config constants.

---

## Phase 5 — Wider Sleeper ROS window

### What to implement

1. Change `SLEEPER_ROS_WEEKS` (or replace with “through `LAST_REGULAR_SEASON_WEEK`”) so `fetchConsensusSources` averages **all remaining** regular-season Sleeper weeks from `week` → 18, not a sliding 8.
2. Watch request cost: parallel fetches already exist; confirm browser refresh + `syncLiveRosters` stay acceptable. If too heavy, fetch remaining weeks but cap concurrency / cache by season.
3. Keep bye zeros excluded from the average (existing behavior).

### Documentation references

- `fetchConsensusSources` loop `src/lib/consensus.ts` 139–182.
- Config comment `SLEEPER_ROS_WEEKS` 115–118.

### Verification

- [ ] Early season: Sleeper ROS average includes weeks beyond `week+7` when those rows exist.
- [ ] Late season: window naturally shrinks to remaining weeks.
- [ ] Projection refresh still completes without timeout in local smoke.

### Sensei notes

- Auto-inherits when live roster sync refreshes consensus (`espnLeague.syncLiveRosters`).

---

## Phase 6 — Deduplicate package math + Sensei season scale

### What to implement

1. Delete local `packageWithValues` in `analysisTools.ts`; use `packageValue` / a thin `rosPricer` built from `rosValue` **or** price season packages with `SEASON_PRICER` and only scale display by remaining weeks if needed.
2. **Preferred consistency:** Coach, WWIT, completed trades, and `evaluate_trade` need-adjusted blocks stay on `qualityScore` (`SEASON_PRICER`). Trade Analyzer season mode and Sensei season **display** totals use `rosValue` (remaining weeks). Document in tool `note` that season absolute totals are ROS-scaled while need-adjusted ratios use quality scale (ratios remain comparable within a block).
3. Replace duplicated package loop in `useFantasyApp.tradeValue` with `packageValue` + appropriate pricer (week vs ros).

### Documentation references

- Canonical `packageValue` `src/lib/tradeEngine.ts` 113–119.
- Sensei duplicate `analysisTools.ts` 55–59, 276–277.
- App duplicate `useFantasyApp.ts` ~1276–1288.

### Verification

- [ ] Grep: no second copy of `EXTRA_PIECE_DISCOUNT` reduce loops outside `tradeEngine`.
- [ ] Same give/get lists → identical ratios via Coach helper vs Analyzer vs `evaluate_trade` (within floating round).
- [ ] `smoke:sensei` + manual `evaluate_trade` on a known package.

### Sensei notes

- This phase is the main “pipeline hygiene” work the user asked for: tools follow updated lib code by construction.

---

## Phase 7 — Schedule-aware ROS multiplier (coarse)

### What to implement

1. Add `scheduleEaseMultiplier(player, remainingSlots, signals?) → number` clamped to roughly `[0.90, 1.10]` (tunable in config).
2. Signal v1 (pragmatic, no new data vendor):
   - For each remaining game with a Vegas/game-line implied team total (reuse patterns from `gradeMatchup` / matchup cache when available), score “friendly” vs “tough.”
   - Average across remaining games; missing weeks contribute 1.0 (neutral).
3. Apply **once** inside `qualityScore` or `rosValue` (pick one place; document it) — not also in weekly `playerValue`.
4. If implied totals for future weeks are sparse, ship the helper + wire with neutral fallback so the API exists; expand as game-line history grows (same spirit as docs’ “optional ease tags later”).

### Documentation references

- `gradeMatchup` this-week only — `src/lib/matchup.ts`.
- `teamScheduleRemaining` — `src/lib/nflSchedule.ts`.
- Docs note on optional ease tags — `docs/roster-sensei-agent-tools.md` (`get_schedule_outlook`).

### Verification

- [ ] Soft remaining slate vs tough slate moves `rosValue` in the right direction for the same `seasonProj`.
- [ ] Missing Vegas data → multiplier `1.0` (no NaN, no crash).
- [ ] Does not change this-week `playerValue` for start/sit.

### Sensei notes

- Auto-inherits via scoring. Optionally expose `scheduleEase` on `serializePlayer` later so the model can cite it; not required for v1 if baked into `rosValue`.
- Do **not** present ease-adjusted baselines as ESPN weekly projections in outlook tools.

---

## Phase 8 — Trade Analyzer optional need-adjusted view

### What to implement

1. Add UI toggle on Trade Analyzer: “Raw value” (default, today’s behavior) vs “Need-adjusted” (calls `needAdjustedPackageValue` with opponent roster needs, same as Coach / WWIT / Sensei).
2. Reuse `analyzeRosterNeeds` + `SEASON_PRICER` for season horizon; for week horizon use `WEEK_PRICER` if need-adjust is offered there (or disable need-adjust in week mode — document choice).
3. Show both ratios when toggled so users see why Coach and Analyzer previously disagreed.

### Documentation references

- `needAdjustedPackageValue` `tradeEngine.ts` 182–194.
- Coach / WWIT call sites.
- Current Analyzer `tradeValue` path `useFantasyApp.ts` 1268–1295.

### Verification

- [ ] Default Analyzer behavior unchanged.
- [ ] Need-adjusted on → same direction as Coach for a need-filling trade.
- [ ] Sensei `evaluate_trade` with `opponentTeamId` still matches the need-adjusted toggle.

### Sensei notes

- No tool rewrite required if Analyzer calls the same helpers Sensei already uses.

---

## Phase 9 — Lower-priority hygiene (same PR train or follow-ups)

| Item | Approach |
|------|----------|
| Week value ignores market | Document clearly in UI/Sensei notes; optional light market blend behind a flag later — **not** required for ROS realism |
| Static `vegasValues.ts` staleness | On projection refresh, warn if `vegasWeeks` lags `scoringPeriodId` by >N; or regenerate via existing `scripts/recordProjections.ts` in CI/docs |
| Chat → Sensei week | Optionally pass `scoringPeriodId: leagueSchedule.currentWeek` from `ChatPage` so tools don’t rely solely on server sync |
| Unit tests | Repo has no test runner; add a minimal vitest (or script assert) for `remainingRosWeeks`, verdict ladder, and seasonProj fallback — or extend `smoke-sensei` with numeric assertions on fixtures |

---

## Phase 10 — Verification & Sensei contract pass

### What to implement

1. Update `docs/roster-sensei-agent-tools.md`:
   - Shared valuation: remaining-weeks ROS, schedule ease (if shipped), fair/lopsided bands.
   - Explicit: Sensei tools call shared libs; no parallel math.
2. Prompt / evidence pass:
   - `systemPrompt.ts` / `evidence.ts`: if `rosValue` now means “remaining weeks,” ensure horizon wording still accurate (no “full season × 16”).
   - `compare_players` / `evaluate_trade` tool notes: cite remaining-week ROS; remind not to invent weekly ESPN projs.
3. Run:
   - `npm run smoke:sensei`
   - Manual: Trade Analyzer week vs season; Coach suggestion; Sensei `evaluate_trade`, `compare_players`, `what_would_it_take`, `get_player_projection_outlook`.
4. Grep guards:
   - `ROS_WEEKS` usages reviewed one-by-one.
   - `packageWithValues` gone.
   - `LOPSIDED_RATIO` wider than `FAIR_RATIO`.

### Verification checklist (release)

- [ ] Early vs late season: absolute `rosValue` shrinks; `qualityScore` stable for healthy players absent schedule Ease phase.
- [ ] Out/IR this week does not nuke ROS when season lines exist (Phase 2+3).
- [ ] Fair label ladder consistent across Coach, Analyzer, Sensei.
- [ ] Soft vs tough remaining schedule differs after Phase 7 (or explicitly deferred with note in docs).
- [ ] Sensei answers still quote tool fields; no prompt claiming fixed 16-week ROS.

---

## Suggested implementation order

```
Phase 1 (remaining weeks) → Phase 2 (seasonProj fallback) → Phase 4 (fair bands)
  → Phase 6 (dedupe package / Sensei hygiene) → Phase 3 (injury) → Phase 5 (Sleeper window)
  → Phase 8 (Analyzer need toggle) → Phase 7 (schedule ease) → Phase 9 → Phase 10
```

Rationale: calendar correctness + collapse bugs + label bugs first (high user trust); dedupe before more consumers; schedule ease last because data sparsity makes it the riskiest.

---

## Out of scope

- Submitting trades/lineups to ESPN.
- Building full week-by-week ESPN projection inventing.
- Changing replacement levels / VOR curve shape unless a follow-up calibration pass is requested.
- New Sensei tools in `registry.ts` (not required for these fixes).
