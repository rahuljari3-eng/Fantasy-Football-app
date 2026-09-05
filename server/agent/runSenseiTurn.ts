import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ALL_TEAMS } from "../../src/data/allTeams.js";
import { FREE_AGENTS } from "../../src/data/freeAgents.js";
import { ensureLiveRosters, getLiveLeagueCache } from "../../src/lib/espnLeague.js";
import type { Player } from "../../src/types.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, getOpenAiTools } from "./tools/registry.js";
import type { LeagueContext } from "./tools/types.js";

export type { LeagueContext, LocalLineupContext } from "./tools/types.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 6;

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SenseiTurnResult {
  message: string;
  toolsUsed: string[];
}

function snapshotKnownPlayers(): Player[] {
  const map = new Map<number, Player>();
  for (const t of ALL_TEAMS) for (const p of t.roster) map.set(p.id, p);
  for (const p of FREE_AGENTS) if (!map.has(p.id)) map.set(p.id, p);
  return [...map.values()];
}

export async function runSenseiTurn(input: {
  messages: ChatTurnMessage[];
  leagueContext: LeagueContext;
}): Promise<SenseiTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  const toolsUsed: string[] = [];

  // Keep ownership fresh for this serverless/local process (TTL cache inside ensureLiveRosters).
  let scoringPeriodId = input.leagueContext.scoringPeriodId;
  try {
    const { snapshot, didSync } = await ensureLiveRosters(snapshotKnownPlayers());
    if (didSync) toolsUsed.push("sync_rosters");
    scoringPeriodId = scoringPeriodId ?? snapshot.scoringPeriodId;
  } catch (err) {
    console.error("[sensei] auto sync_rosters failed; continuing with snapshot", err);
  }
  if (scoringPeriodId == null) {
    scoringPeriodId = getLiveLeagueCache()?.scoringPeriodId;
  }

  const leagueContext: LeagueContext = {
    ...input.leagueContext,
    scoringPeriodId,
  };

  const history = input.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(leagueContext) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolCtx = {
    managedTeamId: leagueContext.managedTeamId,
    scoringPeriodId: leagueContext.scoringPeriodId,
    localLineup: leagueContext.localLineup,
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: getOpenAiTools(),
      tool_choice: "auto",
      temperature: 0.4,
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("Empty completion from OpenAI");

    const msg = choice.message;
    messages.push(msg);

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const text = (msg.content || "").trim();
      if (!text) throw new Error("Model returned an empty final answer");
      return { message: text, toolsUsed: dedupe(toolsUsed) };
    }

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      toolsUsed.push(call.function.name);
      const { result } = await executeTool(call.function.name, call.function.arguments || "{}", toolCtx);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    message:
      "I hit my tool-call limit before finishing. Try asking a narrower question, or ask again in a moment.",
    toolsUsed: dedupe(toolsUsed),
  };
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}
