---
date: 2026-09-16
topic: sensei-discriminator-loop
status: implemented-pending-live-e2e
brainstorm: docs/brainstorms/2026-09-16-sensei-discriminator-loop-brainstorm.md
---

# Plan: Roster Sensei discriminator agent loop

## Goal

After every non-clarifying candidate final answer, run a cheap second LLM that returns strict JSON (`pass` | `need_more_research` | `rewrite`). On failure, nudge the research agent (same user-role `SYSTEM … NUDGE` pattern as today) and continue the existing tool loop until pass or caps hit.

## Phase 0 — Documentation discovery (done)

### Sources consulted

| Source | Role |
|--------|------|
| `server/agent/runSenseiTurn.ts` | Research loop, caps, nudge injection, return shape |
| `server/agent/classifyIntent.ts` | Cheap JSON LLM pattern to copy |
| `server/agent/evidence.ts` | Format gate + nudge helper |
| `server/agent/intents.ts` | Allowlists / checklists |
| `server/agent/systemPrompt.ts` | Trade verdict / evidence rules judge must enforce |
| `server/agent/tools/registry.ts` | Allowlist enforcement |
| `src/config/senseiModels.ts` | Model IDs |
| `docs/brainstorms/2026-09-16-sensei-discriminator-loop-brainstorm.md` | Locked product decisions |
| `docs/roster-sensei-agent-tools.md` | Canonical agent workflow (update after ship) |
| `package.json` | `openai@^7.10.0`; no test runner |

### Allowed APIs (copy these — do not invent)

1. **Cheap JSON call** — copy `classifySenseiIntents` (`server/agent/classifyIntent.ts:36–63`):
   - `client.chat.completions.create`
   - `model: "gpt-4o-mini"`, `temperature: 0`
   - `response_format: { type: "json_object" }`
   - `JSON.parse` + field allowlisting; catch → safe fallback
2. **Main agent loop** — extend `runSenseiTurn` (`server/agent/runSenseiTurn.ts`); keep `tool_choice: "required"` when forcing research (`:137–145`).
3. **Nudges** — `messages.push({ role: "user", content: "SYSTEM … NUDGE:…" })` (`:196–225`). Never system-role nudges.
4. **Allowlist** — `toolsForIntents` / `INTENT_TOOLS` / `getOpenAiTools`; blocked tools return `tool_not_allowed_for_intent`.
5. **Client contract** — keep `SenseiTurnResult` stable (`message`, `toolsUsed`, `model`, `intents`, `researchComplete`).

### Anti-patterns

- No Responses API, Zod, or `json_schema` (repo does not use them).
- No multi-agent specialist workers.
- Do not invent tools not in `registry.ts` (e.g. doc-only `get_team_roster`).
- Do not re-judge trade fairness independently of tool `verdict` / `fairWindow`.
- Do not run discriminator on clarifying-question exits.
- Do not force tools outside the intent allowlist without extending `INTENT_TOOLS` first.

### Critical gap to close in Phase 2

Loop today only tracks `toolsUsed: string[]`. Judge needs a **tool-result digest** — build from in-turn `role: "tool"` messages already appended to `messages` (truncate; prefer `citeHints` + key fields).

---

## Phase 1 — Discriminator module (pure + OpenAI)

### What to implement

Create `server/agent/discriminateSenseiAnswer.ts` by **copying** the classifyIntent call shape.

**Exports:**

```ts
export type DiscriminatorVerdict = "pass" | "need_more_research" | "rewrite";

export interface DiscriminatorResult {
  verdict: DiscriminatorVerdict;
  /** Human-readable gaps / wrong claims for the nudge. */
  reasons: string[];
  /** Tools the agent should call next (filtered to allowlist by caller). */
  suggestedTools: string[];
  /** Dimensions still missing (injury, bye, playoff, needs, matchup, grounding, format, …). */
  missingDimensions: string[];
}

export async function discriminateSenseiAnswer(
  client: OpenAI,
  input: {
    userQuestion: string;
    draftAnswer: string;
    intents: string[];
    toolsUsed: string[];
    allowedTools: string[];
    toolDigest: string;
  }
): Promise<DiscriminatorResult>
```

**System prompt requirements for the judge:**

- Scope: **any** Sensei query (not trades-only).
- Fail `need_more_research` when relevant context was skippable via allowlisted tools but unused (injury/news, bye/schedule, playoff odds, needs, matchup, standings, performance — as relevant to the question).
- Fail `rewrite` when draft invents numbers/status, misquotes `evaluate_trade`/`suggest_trades` verdict or ratios, or contradicts tool digest / citeHints.
- `pass` only if recommendation is grounded and material context for *this* question is covered (or explicitly marked unavailable after tools returned empty).
- Never invent a second fairness doctrine — enforce quoting tool verdicts.
- Return **only** JSON:
  `{"verdict":"pass"|"need_more_research"|"rewrite","reasons":string[],"suggestedTools":string[],"missingDimensions":string[]}`

**Helpers in same file (or tiny sibling):**

- `normalizeDiscriminatorResult(parsed, allowedTools): DiscriminatorResult` — allowlist verdict enum; filter `suggestedTools` to `allowedTools`; default on parse failure → `{ verdict: "pass", reasons: ["discriminator_parse_failed"], … }` **or** prefer `"rewrite"` only if draft clearly empty — **decision: on parse/API failure → `pass`** (availability over false rejects), log error.
- `buildDiscriminatorNudge(result): string` — `SYSTEM DISCRIMINATOR NUDGE:` + reasons + for research: list suggested tools / missing dimensions + “call tools then rewrite”; for rewrite: “do not call tools unless checklist incomplete; fix claims to match tool results”.
- `buildToolDigest(messages: ChatCompletionMessageParam[], opts?: { maxChars?: number }): string` — scan `role === "tool"` contents; truncate each payload (e.g. 1500 chars) and total (e.g. 12k chars); if object has `citeHints`, include those first.

### Documentation references

- Copy call pattern: `server/agent/classifyIntent.ts:36–63`
- Verdict rules align with: `server/agent/systemPrompt.ts` trade/evidence bullets; `server/agent/evidence.ts` `EVIDENCE_ANSWER_RULES`
- Product rules: `docs/brainstorms/2026-09-16-sensei-discriminator-loop-brainstorm.md`

### Verification

- [ ] Module compiles under existing `tsc`
- [ ] `normalizeDiscriminatorResult` rejects unknown verdicts → `pass` or maps safely
- [ ] `suggestedTools` never includes names outside allowlist after normalize
- [ ] Digest builder truncates and prefers citeHints (manual fixture strings OK)

### Anti-pattern guards

- Do not use Zod / `json_schema`
- Do not hardcode Sensei UI model — use `gpt-4o-mini` like classifier
- Do not put full untruncated tool JSON into the judge prompt

---

## Phase 2 — Wire into `runSenseiTurn` + allowlist support

### What to implement

**A. Caps** in `runSenseiTurn.ts` (alongside existing caps at `:25–28`):

```ts
const MAX_DISCRIMINATOR_NUDGES = 2;
```

Shared pool for both `need_more_research` and `rewrite`.

**B. Hook** — after checklist research nudge and evidence-format nudge succeed (i.e. replace the bare `return` at `:228–234`), before returning to the user:

1. If `looksLikeClarifyingQuestion` already returned — skip (already handled).
2. If `discriminatorNudges >= MAX_DISCRIMINATOR_NUDGES` or `round >= MAX_TOOL_ROUNDS - 1` — return draft (do not block forever).
3. Else call `discriminateSenseiAnswer(...)` with `latestUser`, draft `text`, `intents`, `toolsUsed`, `allowlist`, `buildToolDigest(messages)`.
4. On `pass` → return as today.
5. On `need_more_research`:
   - `discriminatorNudges++`
   - push user nudge from `buildDiscriminatorNudge`
   - ensure next iteration can force tools: treat like research incomplete — either temporarily expand “force tools” when last discriminator verdict was research, **or** set a flag `forceToolsAfterDiscriminator = true` used in `forceTools` expression next round
6. On `rewrite`:
   - `discriminatorNudges++`
   - push rewrite nudge
   - do **not** set force-tools flag (unless checklist still open)

**C. `forceTools` update** — extend the existing expression so discriminator research also forces tools:

```ts
const forceTools =
  openAiTools.length > 0 &&
  round < MAX_TOOL_ROUNDS - 1 &&
  (
    (!researchDone && nudges < MAX_RESEARCH_NUDGES) ||
    forceToolsAfterDiscriminator
  );
```

Clear `forceToolsAfterDiscriminator` after a tool-calling round completes.

**D. Keep evidence gate** as the cheap format filter *before* the discriminator (saves judge calls on missing `**Recommendation**`). Discriminator still may fail `rewrite` for format/grounding if needed.

**E. Allowlist expansion** in `server/agent/intents.ts` so the judge can legally demand context tools:

`INTENT_TOOLS.trades` add:

- `get_bye_calendar`
- `get_schedule_outlook`
- `get_player_schedule`
- `get_playoff_odds`

Optional checklist hardening (support only — not a substitute for the judge): add trades checklist items for injury news and bye/schedule **or** leave checklist as-is and rely on discriminator. **Plan choice: expand allowlist only in v1; let discriminator drive depth** (matches Approach B). Revisit checklist if under-calling persists.

**F. Optional tool enrichment (judgment — include if cheap):**

If `evaluate_trade` / player payloads already expose `status` and `bye`, ensure citeHints mention them so the judge can ground. Prefer enhancing existing `evaluate_trade` citeHints over a brand-new tool in v1. Only add `get_trade_context` if Phase 5 manual tests still show chronic multi-call misses.

**G. Logging:** `console.info` discriminator verdict + reasons (no secrets); helps debug without changing API shape.

### Documentation references

- Hook site: `server/agent/runSenseiTurn.ts:210–234`
- Research force-tools: `:132–145`
- Nudge pattern: `:196–225`
- Trades tools: `server/agent/intents.ts:42–51`

### Verification

- [ ] Clarifying answers never call discriminator (trace with log or temporary assert)
- [ ] `need_more_research` → next completion uses `tool_choice: "required"` when tools exist
- [ ] Suggested tools outside allowlist cannot be executed (still filtered)
- [ ] After 2 discriminator nudges, answer returns anyway
- [ ] `SenseiTurnResult` / `POST /api/chat` unchanged for client
- [ ] Trades allowlist includes bye / schedule / playoff odds tools

### Anti-pattern guards

- Do not move nudges to `role: "system"`
- Do not skip checklist gate
- Do not increase `MAX_TOOL_ROUNDS` without measuring latency
- Do not change ChatPage contract

---

## Phase 3 — Docs + lightweight verification helpers

### What to implement

1. Update `docs/roster-sensei-agent-tools.md` agent workflow diagram to insert discriminator after evidence gate.
2. Update brainstorm status / link to this plan if needed.
3. Add a small **runnable script** (no new test framework required):
   - `server/agent/discriminateSenseiAnswer.fixtures.ts` or `scripts/verify-discriminator-normalize.ts`
   - Exercises `normalizeDiscriminatorResult` + `buildToolDigest` with fixture JSON
   - Run via `npx tsx scripts/verify-discriminator-normalize.ts`
4. Optional: add npm script `"verify:discriminator": "tsx scripts/verify-discriminator-normalize.ts"`.

Do **not** add Vitest/Jest unless you explicitly want a test stack later.

### Documentation references

- Workflow section: `docs/roster-sensei-agent-tools.md` (~lines 106–129)
- Brainstorm: `docs/brainstorms/2026-09-16-sensei-discriminator-loop-brainstorm.md`

### Verification

- [ ] Docs match code flow
- [ ] Fixture script exits 0 on expected normalize/digest cases

### Anti-pattern guards

- Do not document phantom tools
- Do not claim multi-agent specialists shipped

---

## Phase 4 — Manual end-to-end verification

### What to verify (against live `/api/chat` with `OPENAI_API_KEY`)

| Case | Expectation |
|------|-------------|
| Trade with injured star (e.g. AJ Brown–style) | Judge rejects pure-value answer until news/status + needs/bye considered; final answer cites injury |
| Trade that misstates verdict | Judge `rewrite` if draft says “fair/accept” while tool `favors_them` |
| Start/sit without bye/schedule when relevant | `need_more_research` or grounded bye callout |
| Pure clarifying question | No discriminator; fast short reply |
| News with `count: 0` | Must not invent injury; pass only if honest about empty feed |
| Waivers / standings | Discriminator runs; may pass quickly if tools + answer aligned |

### Verification checklist

- [ ] Chat UI still shows message + tools accordion
- [ ] Latency acceptable with ≤2 extra mini calls on hard questions
- [ ] Server logs show pass/research/rewrite path
- [ ] No `tool_not_allowed_for_intent` loops for judge-suggested bye/playoff tools on trades

### Anti-pattern guards

- Do not tune by weakening the judge into always-`pass`
- Do not remove evidence format gate without measuring format regression

---

## Phase 5 — Final verification (orchestrator)

1. Grep: discriminator wired only after evidence gate; clarifying paths skip it.
2. Grep: no Zod / Responses API introduced.
3. Confirm `INTENT_TOOLS.trades` includes schedule/bye/playoff tools.
4. Run `npx tsc -b` (or project build) and fixture script.
5. Spot-check one live trade + one non-trade query.

---

## Execution order

```text
Phase 1 (module) → Phase 2 (wire + allowlists) → Phase 3 (docs + fixtures) → Phase 4 (manual E2E) → Phase 5 (final checks)
```

Each phase is self-contained enough for a fresh agent context if given this plan + the brainstorm path.

## Out of scope (v1)

- Multi-agent specialist workers
- Changing ChatPage / returning discriminator metadata to the client
- New test framework
- New bundled `get_trade_context` tool (revisit only after Phase 4 misses)
- Applying different retry budgets per intent
