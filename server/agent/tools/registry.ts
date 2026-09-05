import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getByeCalendarTool, getLeagueContextTool, getMyRosterTool, listTeamsTool } from "./localTools.ts";
import type { ToolContext, ToolDefinition } from "./types.ts";

const TOOLS: ToolDefinition[] = [getLeagueContextTool, listTeamsTool, getMyRosterTool, getByeCalendarTool];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function getOpenAiTools(): ChatCompletionTool[] {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext
): Promise<{ name: string; result: unknown }> {
  const tool = byName.get(name);
  if (!tool) {
    return { name, result: { ok: false, error: "unknown_tool", tool: name } };
  }

  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { name, result: { ok: false, error: "invalid_tool_arguments", rawArgs } };
  }

  try {
    const result = await tool.handler(ctx, args);
    return { name, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "tool_failed";
    return { name, result: { ok: false, error: message } };
  }
}

export function listToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}
