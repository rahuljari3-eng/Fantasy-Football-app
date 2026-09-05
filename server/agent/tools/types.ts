export interface LocalLineupContext {
  /** Builder slot → player id (Gridiron HQ roster builder / localStorage). */
  roster: Record<string, number | undefined>;
  bench: number[];
}

export interface LeagueContext {
  managedTeamId: number;
  scoringPeriodId?: number;
  localLineup?: LocalLineupContext;
}

export interface ToolContext {
  managedTeamId: number;
  scoringPeriodId?: number;
  /** Present when the client sent the user's local builder lineup. */
  localLineup?: LocalLineupContext;
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
