export interface ToolContext {
  managedTeamId: number;
  scoringPeriodId?: number;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}
