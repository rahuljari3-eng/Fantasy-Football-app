import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { resolveSenseiModel, type SenseiModelId } from "../../src/config/senseiModels.js";
import { ALL_TEAMS } from "../../src/data/allTeams.js";
import { FREE_AGENTS } from "../../src/data/freeAgents.js";
import { ensureLiveRosters, getLiveLeagueCache } from "../../src/lib/espnLeague.js";
import type { Player } from "../../src/types.js";
import { classifySenseiIntents } from "./classifyIntent.js";
import {
  checklistForIntents,
  heuristicIntents,
  looksLikeClarifyingQuestion,
  mergeIntents,
  missingChecklistItems,
  toolsForIntents,
  type SenseiIntent,
} from "./intents.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, getOpenAiTools, listToolNames } from "./tools/registry.js";
import type { LeagueContext } from "./tools/types.js";

export type { LeagueContext, LocalLineupContext } from "./tools/types.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 8;
const MAX_RESEARCH_NUDGES = 3;

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SenseiTurnResult {
  message: string;
  toolsUsed: string[];
  model: SenseiModelId;
  intents: SenseiIntent[];
  researchComplete: boolean;
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
  model?: string | null;
}): Promise<SenseiTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = resolveSenseiModel(input.model, process.env.OPENAI_MODEL);
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

  const latestUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const recentAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? null;

  const classification = await classifySenseiIntents(client, latestUser, recentAssistant);
  const intents = mergeIntents(classification.intents, heuristicIntents(latestUser));
  const checklist = checklistForIntents(intents);
  const allowlist = toolsForIntents(intents, listToolNames());
  const openAiTools = getOpenAiTools(allowlist);

  // Classifier already knows we must ask something before researching.
  if (classification.clarifyingQuestion) {
    return {
      message: classification.clarifyingQuestion,
      toolsUsed: dedupe(toolsUsed),
      model,
      intents,
      researchComplete: false,
    };
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(leagueContext, {
        intents,
        checklist,
        allowedTools: allowlist,
      }),
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolCtx = {
    managedTeamId: leagueContext.managedTeamId,
    scoringPeriodId: leagueContext.scoringPeriodId,
    localLineup: leagueContext.localLineup,
  };

  let nudges = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const missing = missingChecklistItems(checklist, toolsUsed);
    const researchDone = missing.length === 0;
    // Force tool calls while checklist is incomplete so the model can't
    // skip research and invent "I don't have news" after only auto-sync.
    const forceTools =
      !researchDone && openAiTools.length > 0 && nudges < MAX_RESEARCH_NUDGES && round < MAX_TOOL_ROUNDS - 1;

    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: openAiTools.length ? openAiTools : undefined,
      tool_choice: forceTools ? "required" : openAiTools.length ? "auto" : undefined,
      temperature: 0.4,
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("Empty completion from OpenAI");

    const msg = choice.message;
    messages.push(msg);

    const toolCalls = msg.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        // Ignore tools outside allowlist (shouldn't happen, but be safe).
        if (!allowlist.includes(call.function.name)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: "tool_not_allowed_for_intent",
              tool: call.function.name,
              allowedTools: allowlist,
            }),
          });
          continue;
        }
        toolsUsed.push(call.function.name);
        const { result } = await executeTool(call.function.name, call.function.arguments || "{}", toolCtx);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    const text = (msg.content || "").trim();
    if (!text) throw new Error("Model returned an empty final answer");

    if (looksLikeClarifyingQuestion(text)) {
      return {
        message: text,
        toolsUsed: dedupe(toolsUsed),
        model,
        intents,
        researchComplete: false,
      };
    }

    if (!researchDone && nudges < MAX_RESEARCH_NUDGES && round < MAX_TOOL_ROUNDS - 1) {
      nudges++;
      messages.push({
        role: "user",
        content: [
          "SYSTEM RESEARCH NUDGE: Do not finalize yet.",
          `Missing evidence: ${missing.map((m) => m.description).join("; ")}.`,
          `Call tools from this allowlist to gather it: ${allowlist.join(", ")}.`,
          "If you are blocked by ambiguity (e.g. local vs ESPN lineup), ask ONE short clarifying question instead.",
        ].join("\n"),
      });
      continue;
    }

    return {
      message: text,
      toolsUsed: dedupe(toolsUsed),
      model,
      intents,
      researchComplete: missingChecklistItems(checklist, toolsUsed).length === 0,
    };
  }

  return {
    message:
      "I hit my research limit before finishing. Try asking a narrower question, or ask again in a moment.",
    toolsUsed: dedupe(toolsUsed),
    model,
    intents,
    researchComplete: false,
  };
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}
