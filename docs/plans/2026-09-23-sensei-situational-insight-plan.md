---
date: 2026-09-23
topic: sensei-situational-insight
status: implemented-on-branch
branch: feat/sensei-situational-insight
related: docs/plans/2026-09-23-valuation-ros-fixes-plan.md
---

# Plan: Roster Sensei situational insight (generic, not query-specific)

## Goal

Make Sensei consistently answer like a sharp fantasy analyst across a **wide variety** of questions — not only a fixed pair of sample prompts. The two sample Q&As in the product discussion were **motivation only** (illustrative shape: situation → concrete options → risks/timing). Success is that the same orchestration works for many asks, e.g.:

- Trade / roster construction under standings pressure (any week)
- Bye coverage and multi-week planning (near or far)
- Waiver strategy with schedule context
- Start/sit with playoff or matchup stakes
- “Is it too early to worry about X?” temporal judgment for any future event week
- Hold vs sell, stash vs stream, must-win vs build — whenever tools can ground the situation

**Illustrative answer shape (not a template locked to two queries):** (1) situation / stakes from tools, (2) 1–N concrete actions with football + schedule/bye interaction, (3) timing/risk caveat when weeks-until-event matters.

## Locked product decisions

1. **Generic capability, not hardcoded scenarios.** Heuristics, checklists, briefing, and prompt rules must be driven by *signals* (urgency language, bye/week-N, planning ahead, playoff race) — never by matching the two sample strings.
2. **No mega “answer_fantasy_question” tool.** Keep one-concern tools; Sensei remains the orchestrator (`docs/roster-sensei-agent-tools.md`).
3. **Primary fix = intents / checklists / heuristics / prompt.** Secondary = one **thin** situational briefing DTO. Tertiary = optional knobs on `suggest_trades` (same coach engine).
4. **Do not stuff standings + full schedule + all rosters into the system prompt.** Facts stay in tool results; history stays capped (`MAX_HISTORY_MESSAGES`).
5. **Boom/bust:** researched — **not available** via ESPN fantasy APIs used here (`docs/plans/2026-09-23-espn-boom-bust-research.md`). Do **not** implement boom/bust fields or proxies. Prompt only: never invent ESPN boom/%.
6. **Temporal judgment is explicit policy**, not vibes: weeks-until-event thresholds from briefing / bye calendar — applies to any target week, not only “week 11.”
7. **`suggest_trades` situational knobs** (`coverByeWeek`, `urgency`) re-rank fair packages only — never bypass fairness / star gate.

---

## Phase 0 — Documentation discovery (done)

### Sources consulted

| Source | Role |
|--------|------|
| `server/agent/runSenseiTurn.ts` | Classify → checklist → allowlist → tool loop → evidence → discriminator |
| `server/agent/intents.ts` | `INTENT_TOOLS` / `INTENT_CHECKLISTS`; waivers lack bye/schedule |
| `server/agent/classifyIntent.ts` + heuristics | Intent boosting; no “urgency / too early / pileup” heuristics yet |
| `server/agent/systemPrompt.ts` | Playoff / trade / baseline rules; no temporal planning rules |
| `server/agent/evidence.ts`, `discriminateSenseiAnswer.ts` | Evidence contract; digest prefers `citeHints` |
| `server/agent/tools/registry.ts` | Canonical tool list |
| Tools: `get_playoff_odds`, `get_bye_calendar`, `suggest_trades`, `recommend_pickups`, schedule tools | Already cover scenario data |
| `src/lib/playoffOdds.ts`, `rosterNeeds.ts`, `coachTrades.ts` | Shared math |
| `docs/roster-sensei-agent-tools.md` | No mega-tools; schedule literacy; evidence-first |
| ESPN / community API notes | Boom/bust not documented as stable public fields; `variance` sometimes empty on proj lines |

### Allowed APIs (compose — do not invent parallel math)

**Sensei tools (registry):** `get_playoff_odds`, `get_standings`, `get_bye_calendar`, `get_schedule_outlook`, `get_player_schedule`, `get_player_projection_outlook`, `analyze_roster_needs`, `suggest_trades`, `evaluate_trade`, `what_would_it_take`, `recommend_pickups`, `search_free_agents`, `compare_players`, `optimize_lineup`, …

**Libs already used by tools:** `computePlayoffOutlook`, `analyzeRosterNeeds`, `suggestTrades` / `coachTrades`, `teamScheduleRemaining`, `optimizeLineup`, shared scoring.

### Anti-patterns

- Dumping full league state into system prompt each turn.
- New composite tools that re-run coach + odds + FAs into one opaque blob without citeHints.
- Widening every intent to `general` / all tools as the default fix.
- Inventing boom/bust % or future ESPN weekly projections.
- Second valuation path outside `scoring` / `tradeEngine`.
- Checklist satisfied by the wrong tool (e.g. `get_completed_trades` counting as “needs” when user asked for forward-looking packages).

### Architecture choice (locked)

```
┌─────────────────────────────────────────────────────────┐
│  classify + heuristics  →  intents (≤3)                 │
│         ↓                                               │
│  enriched allowlists + checklists                       │
│         ↓                                               │
│  optional get_situational_briefing (tiny DTO)           │
│         ↓                                               │
│  action tools: suggest_trades / recommend_pickups / …   │
│         ↓                                               │
│  evidence + discriminator (urgency / bye / temporal)    │
└─────────────────────────────────────────────────────────┘
```

Briefing = **situation snapshot**, not recommendations. Packages and pickups still come from existing action tools.

---

## Phase 1 — Intent orchestration (highest ROI, no new tools)

### What to implement

**1. Expand allowlists** (`server/agent/intents.ts`):

| Intent | Add tools |
|--------|-----------|
| `waivers` | `get_bye_calendar`, `get_schedule_outlook`, `get_player_schedule`, optionally `get_playoff_odds` |
| `trades` | (already has odds/byes) — keep; ensure heuristics actually pull `standings`/`schedule` when needed |
| `schedule` | `recommend_pickups`, `analyze_roster_needs` (so bye-planning can propose FAs without requiring a separate waivers intent) |

**2. Enrich checklists** — keep base intent checklists lean. Append **signal-driven** extras via `situationalChecklistExtras` / `checklistForMessage` when the user message shows urgency or bye/planning language (not hardcoded to sample queries):

| Signal | Checklist id | Satisfied by |
|--------|--------------|--------------|
| Urgency / playoff pressure | `race_or_urgency` | `get_playoff_odds` / `get_standings` / `get_situational_briefing` |
| Bye / week-N / plan ahead (also with urgency) | `bye_or_near_term_schedule` | bye/schedule tools / briefing |

Simple “is this package fair?” stays on package + needs only.
**3. Heuristics** (`heuristicIntents` in `intents.ts`):

- Urgency / “before this week” / “must win” / “smart trades” → boost `trades` + `standings`.
- “bye” / “pileup” / “week N” / “cover” / “accommodate” → boost `schedule` (+ `waivers` if pickup language).
- “too early” / “plan ahead” / “in a few weeks” → boost `schedule` + keep `waivers`/`trades` if actionable.

**4. Prompt — temporal & situational voice** (`systemPrompt.ts`), short bullets only:

- For trade/waiver asks late season or with playoff pressure: call `get_playoff_odds` and open with `summary` / wins-needed / relative outlook before naming packages.
- For bye-coverage planning: state `currentWeek`, target week, **weeksUntil**; if weeksUntil ≥ **6** (tunable), prefer FA/stash framing and say it’s early to burn capital on panic trades; still list concrete options but mark them “monitor / soft targets.”
- If weeksUntil ≤ **2**, prioritize concrete coverage (streamers, 2-for-1 depth, bye-filler trades).
- Weave bye interactions across the package (who covers whose bye) only from `get_bye_calendar` / roster `bye` fields.
- Do not invent boom/bust %; cite matchup grade / status / tier / scheduleEase when talking volatility.

### Documentation references

- Copy checklist item shape from existing `INTENT_CHECKLISTS` (`intents.ts` 98–179).
- Copy heuristic patterns (`intents.ts` ~256+).
- Playoff quote rules already in `systemPrompt.ts` ~78 — extend, don’t replace.

### Verification

- [ ] Query “smart trades before this week” classifies `trades`+`standings` (or trades alone with race checklist forcing odds).
- [ ] Query “week 11 bye… it’s week 4” classifies `schedule`(+`waivers`); allowlist includes bye + pickups.
- [ ] Checklist incomplete until playoff **and** bye tools run on urgency trade asks.
- [ ] `smoke:sensei` still 28/28 (or +1 if briefing added later).
- [ ] System prompt length increase stays small (a few bullets, not a novel).

### Anti-pattern guards

- Do not set `general` for these queries by default.
- Do not add full standings tables to the system prompt.

---

## Phase 2 — Thin `get_situational_briefing` tool

### What to implement

Add **one** read-only tool that aggregates existing libs into a **capped DTO** (hard array limits, no nested full rosters).

**Suggested shape:**

```ts
{
  ok: true,
  currentWeek: number,
  targetWeek: number | null,       // parsed from args or null
  weeksUntil: number | null,
  temporalAdvice: "act_now" | "prepare" | "too_early_to_overcommit",
  playoff: { status, makeOdds, winsNeededToClinch, gamesRemaining, summary, projectedStarterTotal? } | null,
  byePileup: { week: number, count: number, byPos: Record<string, string[]>, names: string[] } | null, // max ~12 names
  needs: { needy: string[], strength: string[] },
  citeHints: string[],
  note: "Situation only — call suggest_trades / recommend_pickups / evaluate_trade for actions."
}
```

**Args:** `targetWeek?: number`, `includePlayoff?: boolean` (default true), `teamId?: number`.

**Internals (copy existing patterns):**

- Week: `ctx.scoringPeriodId` / `resolveFromWeek` (`scheduleTools.ts`).
- Playoff: same path as `get_playoff_odds` (`espnLeagueTools.ts` + `computePlayoffOutlook`).
- Byes: group managed roster by `bye === targetWeek` (same data as `get_bye_calendar`).
- Needs: `analyzeRosterNeeds` + league baseline (`analysisTools` / `leagueData`).
- `temporalAdvice`: `weeksUntil >= 6 → too_early…`; `3–5 → prepare`; `≤2 → act_now` (constants in a tiny config).

**Wire into:**

- Allowlists: `trades`, `waivers`, `schedule`, `standings` (not core — call when planning/urgency).
- Checklist: allow `get_situational_briefing` to satisfy `race_or_urgency` **and/or** `bye_or_schedule_*` (one call covers both dimensions when used).
- Registry + `smoke-sensei.ts` + docs table.

### Documentation references

- Tool definition pattern: `espnLeagueTools.get_playoff_odds` / `localTools.get_bye_calendar`.
- Doc rule: one concern — this tool’s concern is **situation snapshot**, not packages (`docs/roster-sensei-agent-tools.md` conventions).

### Verification

- [ ] Payload stays small (manual inspect; no full FA list / no full opponent rosters).
- [ ] Week-4 → target-11 returns `too_early_to_overcommit` + byePileup count.
- [ ] Week-10 → target-11 returns `act_now` or `prepare`.
- [ ] citeHints include playoff summary line + “N players on bye week W”.
- [ ] Discriminator can demand this tool when urgency language present and briefing missing.

### Anti-pattern guards

- No trade packages inside briefing.
- No invented boom/bust.
- Do not replace `get_playoff_odds` / `get_bye_calendar` — briefing calls their libs; dedicated tools remain for deep dives.

---

## Phase 3 — Prompt + discriminator polish for insight shape

### What to implement

1. **Answer shape guidance** (system prompt, short):

   - Urgency trade asks: (1) situation/playoff bar, (2) 1–3 options with football + bye interaction, (3) risks / what would change the advice.
   - Distant bye asks: situation → concrete soft options → temporal caveat from briefing.temporalAdvice.

2. **Discriminator** (`discriminateSenseiAnswer.ts`):

   - On `trades`+urgency: fail if no playoff/standings evidence in digest.
   - On schedule/bye planning: fail if no weeksUntil / bye count cited when briefing or calendar was available.
   - Allow `slightly_favors_*` in verdict enumerate (already in valuation work).

3. **Tool notes / citeHints** on `suggest_trades` and `recommend_pickups`: remind model to connect packages to briefing situation when present this turn.

### Verification

- [ ] Manual golden prompts (two user examples) produce structure above without inventing numbers.
- [ ] Discriminator nudge text mentions missing playoff/bye when stripped.

### Anti-pattern guards

- Do not require Recommendation section to list every tool field — only the situational ones that matter.

---

## Phase 4 — Optional: bye / urgency awareness in `suggest_trades`

### What to implement (only if Phase 1–3 still feel shallow)

Add **optional args** to `suggest_trades` (and lightly to `coachTrades` filters), not a new scorer:

- `coverByeWeek?: number` — prefer packages that add players with `bye !== coverByeWeek` at needy positions / reduce on-bye starters that week.
- `urgency?: "neutral" | "must_win" | "playoff_push"` — when must_win, prefer higher weekValue / matchup grade on near-term pieces (document clearly; keep fairness gates identical).

Return a short `situationNote` echoing filters applied.

### Documentation references

- Extend `coachTools.suggest_trades` parameters; keep pricing via `SEASON_PRICER` / existing fairness.

### Verification

- [x] Without new args, suggestions identical to today (regression).
- [x] With `coverByeWeek: 11`, returned packages skew toward covering that week (spot-check).
- [x] Fair window / star gate unchanged.

### Anti-pattern guards

- Do not bypass fairness for “urgency.”
- Do not fork a Sensei-only trade engine.

---

## Phase 5 — Boom / bust research spike (data-gated)

### What to implement

1. **Spike:** Inspect live ESPN payloads (`kona_player_info` / `kona_playercard` / player `stats` / any `outlook` / `draftRanksByRankType`) for boom/bust or floor/ceiling % fields for a few players; document findings in the plan or a short `docs/` note.
2. **If found:** add optional fields on serializePlayer / a tiny `get_player_volatility` tool; cite in Sensei notes.
3. **If not found:** **skip all boom/bust implementation** (no proxy volatility fields either). Prompt/tool notes: never invent ESPN boom/bust %.

### Outcome (2026-09-23)

Spike documented in `docs/plans/2026-09-23-espn-boom-bust-research.md` — **not found**. Per product decision: **no boom/bust fields, tools, or proxies**.

### Verification

- [x] Spike write-up checked in (found / not found).
- [x] No invented percentages in smoke or golden answers.

---

## Phase 6 — Verification & docs

### What to implement

1. Update `docs/roster-sensei-agent-tools.md`: situational briefing, temporal rules, waivers↔schedule composition, boom/bust status.
2. Add 2–3 **scripted golden queries** to `scripts/smoke-sensei.ts` or a sibling `scripts/smoke-sensei-situations.ts` that assert tools called include odds/bye/briefing (not answer text quality).
3. Manual chat pass on the two example query shapes.

### Verification checklist (release)

- [ ] Urgency trades open with playoff context + citeable packages.
- [ ] Distant bye planning includes temporalAdvice + concrete FA/trade soft options.
- [ ] Allowlists still prevent tool tourism for pure news / pure performance asks.
- [ ] No system-prompt bloat; briefing DTO stays small.
- [ ] `tsc -b` + smoke green.

---

## Suggested implementation order

```
Phase 1 (intents/checklists/heuristics/prompt)
  → Phase 2 (get_situational_briefing)
  → Phase 3 (discriminator + answer shape)
  → Phase 5 spike in parallel (boom/bust)
  → Phase 4 only if needed (suggest_trades knobs)
  → Phase 6 docs + smokes
```

## Out of scope

- Auto-submitting trades / claims to ESPN.
- Full Monte-Carlo player boom simulations.
- Replacing the AI Coach tab UI (Sensei can share coach engine knobs later).
- Dumping week-by-week invented ESPN projections.
