---
date: 2026-09-16
topic: sensei-discriminator-loop
---

# Roster Sensei discriminator agent loop

## What We're Building

A **strict post-answer discriminator** for Roster Sensei: after the research agent produces a candidate final answer for **any query** (not only trades or draft/start-sit), a second LLM validates completeness and claim grounding against tool results. On failure it either forces more tool research or a rewrite, then re-checks, with a hard retry cap.

Failure modes to fix:
1. Thin answers that skip relevant context (injury, bye, playoff race, matchup, etc.).
2. Confident claims that contradict or invent beyond tool JSON (verdicts, ratios, headlines, odds).

## Why This Approach

Chose **Approach B (full discriminator)** over checklist-only hardening or a trades-only hybrid. A single judge after every answer is more sound: the same under-research and hallucination problems appear across start/sit, waivers, news, standings, and trades. Intent checklists remain as a first gate; the discriminator is the semantic backstop.

Supporting changes (not a substitute for the discriminator):
- Expand intent allowlists where the judge would otherwise demand tools that are currently blocked (e.g. trades → bye calendar, playoff odds, schedule outlook).
- Optionally add/enrich tools during implementation if the judge repeatedly asks for the same multi-call bundle (e.g. trade player context). Use judgment; not required for v1 of the loop.

## Key Decisions

- **Scope:** Discriminator runs on every candidate final answer when intents are non-clarifying and the research loop would otherwise return. Not limited to trades.
- **Placement:** After existing checklist + evidence-format gates (or replace soft evidence rewrite with discriminator verdict when both would fire).
- **Verdict schema (strict JSON):** `pass` | `need_more_research` | `rewrite`
  - `need_more_research`: list missing dimensions + suggested tools; inject research nudge; `tool_choice: "required"`.
  - `rewrite`: list unsupported/wrong claims; inject rewrite nudge; no new tools unless checklist still open.
  - `pass`: return the answer to the user.
- **Grounding:** Judge receives user question, draft answer, tools used, and a compact digest of tool payloads (or citeHints + key fields)—not an open-ended “does this sound good?” prompt.
- **Retry cap:** e.g. max 2 discriminator failures (research or rewrite combined) so latency stays bounded; on exhaustion, return best draft with explicit uncertainty if needed.
- **Model:** Cheap/fast model for discriminator (same class as intent classifier) unless quality demands the main Sensei model.
- **UI/debug:** Surface discriminator outcomes in server logs and optionally `toolsUsed` / debug metadata later; not required for v1 UX.

## Open Questions (resolved for plan)

- **Retry budget:** Shared pool — `MAX_DISCRIMINATOR_NUDGES = 2` covering both `need_more_research` and `rewrite`.
- **Clarifying questions:** Skip discriminator entirely (classifier early exit + `looksLikeClarifyingQuestion`).
- **Tool digest:** Build from in-turn `role: "tool"` messages; truncate per payload; prefer `citeHints` + key fields when present.

## Next Steps

→ Implementation plan: [`docs/plans/2026-09-16-sensei-discriminator-loop-plan.md`](../plans/2026-09-16-sensei-discriminator-loop-plan.md). Wire `runSenseiTurn` + `discriminateSenseiAnswer`; tighten allowlists so forced follow-up tools are legal; verify normalize/digest helpers.
