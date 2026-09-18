import OpenAI from "openai";
import { resolveSenseiModel } from "../src/config/senseiModels.js";
import type { TeamWeekRecapInput } from "../src/lib/weeklyRecap.js";

export interface WeeklyRecapBlurb {
  teamId: number;
  blurb: string;
}

export interface WeeklyRecapResult {
  recaps: WeeklyRecapBlurb[];
}

function describeTeam(t: TeamWeekRecapInput): string {
  const lines = [
    `Team ${t.teamId} (${t.teamName}), week ${t.week}:`,
    `- Result: ${t.result} ${t.teamScore}-${t.opponentScore} vs ${t.opponentName}.`,
  ];
  if (t.swap) {
    const opt = t.swap.optimal;
    const act = t.swap.actual;
    if (opt && act) {
      lines.push(
        `- Should've started ${opt.name} (${opt.pos ?? "?"}, ${opt.actualPoints} pts) over ${act.name} (${act.pos ?? "?"}, ${act.actualPoints} pts) at ${t.swap.slot} -- left ${t.swap.pointsGained.toFixed(1)} points on the bench there.`
      );
    } else if (opt && !act) {
      lines.push(`- Left an empty ${t.swap.slot} slot; could've started ${opt.name} (${opt.pos ?? "?"}, ${opt.actualPoints} pts) there.`);
    }
  } else {
    lines.push(`- Started the optimal lineup -- no bench regrets this week.`);
  }
  if (t.pointsLeftOnBench > 0.05) {
    lines.push(`- Total points left on the bench: ${t.pointsLeftOnBench.toFixed(1)}.`);
  }
  if (t.newsHeadlines.length > 0) {
    lines.push(`- Recent news: ${t.newsHeadlines.map((n) => `${n.player} -- ${n.headline}`).join(" | ")}`);
  }
  lines.push(
    t.nextOpponentName
      ? `- Next week (${t.nextWeek}): plays ${t.nextOpponentName}.`
      : `- No week ${t.week + 1} matchup (end of regular season).`
  );
  return lines.join("\n");
}

const SYSTEM_PROMPT = [
  "You write short weekly recap blurbs for every team in a fantasy football league, one per team.",
  "For EACH team, in 3-5 sentences, cover in this order:",
  "1. Their result this week (score + opponent, in a natural tone -- celebratory for a win, sympathetic/pointed for a loss).",
  "2. Any team-specific news/injury update given for their players, if present.",
  "3. The 'should've started' note if one is given -- name the bench player and who they should've replaced, and the points left on the table. If the lineup was already optimal, briefly say so instead.",
  "4. A one-sentence look ahead to their next opponent, if given.",
  "Write like a knowledgeable, slightly playful beat writer -- concrete, specific, no generic filler, no bullet points, no markdown, plain prose paragraphs only.",
  "Return ONLY JSON of this exact shape: {\"recaps\": [{\"teamId\": number, \"blurb\": string}, ...]} with exactly one entry per team id given, in any order.",
].join("\n");

/** One OpenAI call writes ALL teams' blurbs at once -- deliberately not one
 * call per team (12x the cost/latency for no real benefit) and deliberately
 * not the heavy tool-calling Sensei agent loop in runSenseiTurn.ts, which is
 * shaped for interactive single-team Q&A, not batch generation from
 * already-computed stats. */
export async function generateWeeklyRecap(input: {
  week: number;
  teams: TeamWeekRecapInput[];
  model?: string | null;
}): Promise<WeeklyRecapResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  if (input.teams.length === 0) return { recaps: [] };

  const model = resolveSenseiModel(input.model, process.env.OPENAI_MODEL);
  const client = new OpenAI({ apiKey });

  const userContent = [
    `Week ${input.week} recap data for ${input.teams.length} teams:`,
    "",
    ...input.teams.map(describeTeam),
  ].join("\n\n");

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: { recaps?: unknown };
  try {
    parsed = JSON.parse(raw) as { recaps?: unknown };
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  if (!Array.isArray(parsed.recaps)) throw new Error("Model response missing a recaps array");

  const recaps: WeeklyRecapBlurb[] = parsed.recaps
    .filter((r): r is { teamId: unknown; blurb: unknown } => typeof r === "object" && r !== null)
    .map((r) => ({ teamId: Number((r as { teamId: unknown }).teamId), blurb: String((r as { blurb: unknown }).blurb ?? "") }))
    .filter((r) => Number.isFinite(r.teamId) && r.blurb.trim().length > 0);

  return { recaps };
}
