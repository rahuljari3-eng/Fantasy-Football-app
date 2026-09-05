import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, getOpenAiTools } from "./tools/registry.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 6;

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LeagueContext {
  managedTeamId: number;
  scoringPeriodId?: number;
}

export interface SenseiTurnResult {
  message: string;
  toolsUsed: string[];
}

export async function runSenseiTurn(input: {
  messages: ChatTurnMessage[];
  leagueContext: LeagueContext;
}): Promise<SenseiTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  const history = input.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(input.leagueContext.managedTeamId) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolsUsed: string[] = [];
  const toolCtx = {
    managedTeamId: input.leagueContext.managedTeamId,
    scoringPeriodId: input.leagueContext.scoringPeriodId,
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
