import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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

const DISCRIMINATOR_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_PER_PAYLOAD = 1500;
const DEFAULT_MAX_CHARS = 12_000;

const VERDICTS = new Set<DiscriminatorVerdict>(["pass", "need_more_research", "rewrite"]);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

export function normalizeDiscriminatorResult(
  parsed: unknown,
  allowedTools: string[]
): DiscriminatorResult {
  const allowed = new Set(allowedTools);
  const obj =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const rawVerdict = typeof obj.verdict === "string" ? obj.verdict.trim() : "";
  const verdict: DiscriminatorVerdict = VERDICTS.has(rawVerdict as DiscriminatorVerdict)
    ? (rawVerdict as DiscriminatorVerdict)
    : "pass";

  const reasons = asStringArray(obj.reasons);
  const suggestedTools = asStringArray(obj.suggestedTools).filter((t) => allowed.has(t));
  const missingDimensions = asStringArray(obj.missingDimensions);

  if (!VERDICTS.has(rawVerdict as DiscriminatorVerdict) && reasons.length === 0) {
    reasons.push("discriminator_unknown_verdict");
  }

  return { verdict, reasons, suggestedTools, missingDimensions };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function digestOneToolPayload(content: string, maxPerPayload: number): string {
  const trimmed = content.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const hints = asStringArray(obj.citeHints);
      if (hints.length > 0) {
        const rest = { ...obj };
        delete rest.citeHints;
        const body = JSON.stringify({ citeHints: hints, ...rest });
        return truncate(body, maxPerPayload);
      }
    }
    return truncate(typeof parsed === "string" ? parsed : JSON.stringify(parsed), maxPerPayload);
  } catch {
    return truncate(trimmed, maxPerPayload);
  }
}

/** Compact digest of in-turn tool results for the discriminator judge. */
export function buildToolDigest(
  messages: ChatCompletionMessageParam[],
  opts?: { maxChars?: number; maxPerPayload?: number }
): string {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  const maxPerPayload = opts?.maxPerPayload ?? DEFAULT_MAX_PER_PAYLOAD;
  const parts: string[] = [];
  let total = 0;

  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    const chunk = digestOneToolPayload(content, maxPerPayload);
    if (!chunk) continue;

    const nextLen = total + (parts.length > 0 ? 1 : 0) + chunk.length;
    if (nextLen > maxChars) {
      const remaining = maxChars - total - (parts.length > 0 ? 1 : 0);
      if (remaining > 20) parts.push(truncate(chunk, remaining));
      break;
    }
    parts.push(chunk);
    total = nextLen;
  }

  return parts.join("\n");
}

export function buildDiscriminatorNudge(result: DiscriminatorResult): string {
  const lines = [
    "SYSTEM DISCRIMINATOR NUDGE:",
    ...result.reasons.map((r) => `- ${r}`),
  ];

  if (result.verdict === "need_more_research") {
    if (result.missingDimensions.length > 0) {
      lines.push(`Missing dimensions: ${result.missingDimensions.join(", ")}.`);
    }
    if (result.suggestedTools.length > 0) {
      lines.push(`Call these tools (allowlisted): ${result.suggestedTools.join(", ")}.`);
    } else {
      lines.push("Call allowlisted tools to fill the gaps above.");
    }
    lines.push("Gather the missing evidence with tools, then rewrite the final answer.");
  } else if (result.verdict === "rewrite") {
    lines.push(
      "Do not call tools unless a required research checklist item is still missing.",
      "Fix claims so they match tool results (quote evaluate_trade/suggest_trades verdicts verbatim; do not invent numbers or status)."
    );
    if (result.missingDimensions.length > 0) {
      lines.push(`Fix these dimensions: ${result.missingDimensions.join(", ")}.`);
    }
  } else {
    lines.push("Revise the answer if needed before returning.");
  }

  return lines.join("\n");
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
): Promise<DiscriminatorResult> {
  const system = [
    "You are a strict post-answer discriminator for Roster Sensei (fantasy football).",
    "Scope: ANY Sensei query (trades, start/sit, waivers, news, standings, schedule, performance, matchup, general).",
    "Judge grounding against the tool digest and whether material context for THIS question was gathered.",
    "",
    "Return ONLY JSON:",
    '{"verdict":"pass"|"need_more_research"|"rewrite","reasons":string[],"suggestedTools":string[],"missingDimensions":string[]}',
    "",
    "Verdict rules:",
    '- need_more_research: relevant context was skippable via allowlisted tools but unused (injury/news, bye/schedule, playoff odds, situational briefing / temporalAdvice, needs, matchup, standings, performance — as relevant to the question). For urgency/move/planning/bye-coverage asks, prefer suggesting get_situational_briefing and/or get_playoff_odds / get_bye_calendar when allowlisted and unused. List missingDimensions and suggestedTools from the allowlist.',
    "- rewrite: draft invents numbers/status, misquotes evaluate_trade/suggest_trades verdict or ratios, invents ESPN boom/bust %, contradicts tool digest / citeHints, or invents injury/news when tools returned empty. Do not invent a second fairness doctrine — enforce quoting tool verdicts (roughly_even / slightly_favors_you / slightly_favors_them / favors_you / favors_them / likely_unfair_star_gate); never independently re-judge whether a ratio is \"close to\" fairWindow. If temporalAdvice was too_early_to_overcommit and the draft urges panic trades with no caveat, rewrite.",
    "- pass: recommendation is grounded and material context for this question is covered (or explicitly marked unavailable after tools returned empty).",
    "",
    "suggestedTools must be subset of the provided allowlist. Prefer empty suggestedTools on rewrite/pass.",
  ].join("\n");

  const user = [
    `User question: ${input.userQuestion}`,
    `Intents: ${input.intents.join(", ") || "(none)"}`,
    `Tools used: ${input.toolsUsed.join(", ") || "(none)"}`,
    `Allowed tools: ${input.allowedTools.join(", ") || "(none)"}`,
    "",
    "Tool digest:",
    input.toolDigest.trim() || "(no tool results)",
    "",
    "Draft answer:",
    input.draftAnswer,
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: DISCRIMINATOR_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as unknown;
    return normalizeDiscriminatorResult(parsed, input.allowedTools);
  } catch (err) {
    console.error("[sensei] discriminator failed; treating as pass", err);
    return {
      verdict: "pass",
      reasons: ["discriminator_parse_failed"],
      suggestedTools: [],
      missingDimensions: [],
    };
  }
}
