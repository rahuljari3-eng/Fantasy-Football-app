import OpenAI from "openai";
import { normalizeIntents, SENSEI_INTENTS, type SenseiIntent } from "./intents.js";

export interface IntentClassification {
  intents: SenseiIntent[];
  /** Optional short note for the research agent. */
  rationale?: string;
  /** If set, research agent should ask this before heavy tool use. */
  clarifyingQuestion?: string | null;
}

const CLASSIFY_MODEL = "gpt-4o-mini";

export async function classifySenseiIntents(
  client: OpenAI,
  userMessage: string,
  recentAssistantHint?: string | null
): Promise<IntentClassification> {
  const system = [
    "You classify fantasy-football chat questions for Roster Sensei.",
    "Return ONLY JSON: {\"intents\": string[], \"rationale\": string, \"clarifyingQuestion\": string|null}",
    `Allowed intents (1–3, primary first): ${SENSEI_INTENTS.join(", ")}.`,
    "Rules:",
    "- Prefer specific intents over general.",
    "- ANY question about news, injury, health, questionable/doubtful status, 'latest on X', 'update on X', or 'what's going on with X' MUST include intent \"news\".",
    "- Use multiple intents when the question spans categories (e.g. start/sit + injury news → [\"start_sit\",\"news\"]).",
    "- trades = propose/grade packages; waivers = adds/drops/FA; news = injuries/headlines; matchup = fantasy opponent/scoreboard; schedule = NFL opponents/byes/ROS slate; standings = W-L/playoff race; start_sit = lineup/flex/who to start; general = only if nothing else fits.",
    "- clarifyingQuestion only if the user question is too ambiguous to research (else null).",
  ].join("\n");

  const user = recentAssistantHint
    ? `Recent assistant context: ${recentAssistantHint}\n\nUser: ${userMessage}`
    : userMessage;

  try {
    const completion = await client.chat.completions.create({
      model: CLASSIFY_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      intents?: unknown;
      rationale?: unknown;
      clarifyingQuestion?: unknown;
    };
    return {
      intents: normalizeIntents(parsed.intents),
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      clarifyingQuestion:
        typeof parsed.clarifyingQuestion === "string" && parsed.clarifyingQuestion.trim()
          ? parsed.clarifyingQuestion.trim()
          : null,
    };
  } catch (err) {
    console.error("[sensei] intent classification failed; falling back to general", err);
    return { intents: ["general"], clarifyingQuestion: null };
  }
}
