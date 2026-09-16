/**
 * Lightweight fixture checks for discriminator helpers (no OpenAI calls).
 * Run: npm run verify:discriminator
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  buildDiscriminatorNudge,
  buildToolDigest,
  normalizeDiscriminatorResult,
  type DiscriminatorResult,
} from "../server/agent/discriminateSenseiAnswer.js";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) fail(`${label}: expected to include ${JSON.stringify(needle)}`);
}

// --- (a) unknown verdict → pass + reason ---
{
  const result = normalizeDiscriminatorResult(
    { verdict: "maybe", reasons: [], suggestedTools: [], missingDimensions: [] },
    ["evaluate_trade"]
  );
  assert(result.verdict === "pass", `a) expected pass, got ${result.verdict}`);
  assert(
    result.reasons.includes("discriminator_unknown_verdict"),
    `a) expected discriminator_unknown_verdict in reasons, got ${JSON.stringify(result.reasons)}`
  );
}

// --- (b) suggestedTools filtered to allowlist ---
{
  const result = normalizeDiscriminatorResult(
    {
      verdict: "need_more_research",
      reasons: ["need bye"],
      suggestedTools: ["get_bye_calendar", "not_a_real_tool", "get_playoff_odds"],
      missingDimensions: ["bye"],
    },
    ["get_bye_calendar", "evaluate_trade"]
  );
  assert(result.verdict === "need_more_research", `b) verdict ${result.verdict}`);
  assert(
    result.suggestedTools.length === 1 && result.suggestedTools[0] === "get_bye_calendar",
    `b) expected only get_bye_calendar, got ${JSON.stringify(result.suggestedTools)}`
  );
}

// --- (c) digest prefers citeHints and truncates ---
{
  const longBody = "X".repeat(200);
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "tool",
      tool_call_id: "1",
      content: JSON.stringify({
        citeHints: ["quote the verdict", "cite ratio"],
        verdict: "favors_you",
        bulky: longBody,
      }),
    },
    {
      role: "tool",
      tool_call_id: "2",
      content: JSON.stringify({ citeHints: ["second hint"], filler: longBody }),
    },
  ];
  const digest = buildToolDigest(messages, { maxChars: 80, maxPerPayload: 60 });
  assert(digest.length > 0, "c) digest empty");
  assert(digest.length <= 80, `c) digest longer than maxChars: ${digest.length}`);
  assertIncludes(digest, "citeHints", "c) citeHints preference");
  // citeHints should appear before other fields in the serialized chunk
  const firstChunk = digest.split("\n")[0] ?? "";
  const citeIdx = firstChunk.indexOf("citeHints");
  const bulkyIdx = firstChunk.indexOf("bulky");
  assert(citeIdx >= 0, "c) first chunk missing citeHints");
  if (bulkyIdx >= 0) {
    assert(citeIdx < bulkyIdx, "c) citeHints should appear before bulky fields");
  }
}

// --- (d) research nudge contains SYSTEM DISCRIMINATOR NUDGE and suggested tools ---
{
  const research: DiscriminatorResult = {
    verdict: "need_more_research",
    reasons: ["skipped injury context"],
    suggestedTools: ["get_league_news", "get_bye_calendar"],
    missingDimensions: ["injury", "bye"],
  };
  const nudge = buildDiscriminatorNudge(research);
  assertIncludes(nudge, "SYSTEM DISCRIMINATOR NUDGE", "d) header");
  assertIncludes(nudge, "get_league_news", "d) suggested tool");
  assertIncludes(nudge, "get_bye_calendar", "d) suggested tool");
}

// --- (e) rewrite nudge says do not call tools (unless checklist) ---
{
  const rewrite: DiscriminatorResult = {
    verdict: "rewrite",
    reasons: ["misquoted verdict"],
    suggestedTools: [],
    missingDimensions: ["grounding"],
  };
  const nudge = buildDiscriminatorNudge(rewrite);
  assertIncludes(nudge, "SYSTEM DISCRIMINATOR NUDGE", "e) header");
  assertIncludes(nudge.toLowerCase(), "do not call tools", "e) no-tools instruction");
  assertIncludes(nudge.toLowerCase(), "checklist", "e) checklist exception");
}

console.log("verify-discriminator-normalize: all checks passed");
