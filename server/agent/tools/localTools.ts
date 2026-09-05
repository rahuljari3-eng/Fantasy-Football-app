import { LEAGUE_CONFIG, REQUIRED_STARTERS, SLOTS } from "../../../src/config/league.ts";
import { ALL_TEAMS } from "../../../src/data/allTeams.ts";
import type { ToolContext, ToolDefinition } from "./types.ts";

function resolveTeam(ctx: ToolContext, teamId?: number) {
  const id = teamId ?? ctx.managedTeamId;
  const team = ALL_TEAMS.find((t) => t.id === id);
  if (!team) return { ok: false as const, error: "team_not_found", teamId: id };
  return { ok: true as const, team };
}

export const getLeagueContextTool: ToolDefinition = {
  name: "get_league_context",
  description:
    "Return league identity, scoring format, roster slots, the currently managed team (from the app header unless overridden), and known scoring period if provided.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async (ctx) => {
    const team = ALL_TEAMS.find((t) => t.id === ctx.managedTeamId);
    return {
      ok: true,
      appName: LEAGUE_CONFIG.appName,
      leagueName: LEAGUE_CONFIG.leagueName,
      espnLeagueId: LEAGUE_CONFIG.espnLeagueId,
      espnSeason: LEAGUE_CONFIG.espnSeason,
      scoringFormatLabel: LEAGUE_CONFIG.scoringFormatLabel,
      slots: SLOTS,
      requiredStarters: REQUIRED_STARTERS,
      managedTeamId: ctx.managedTeamId,
      managedTeamName: team?.name ?? null,
      managedTeamOwner: team?.owner ?? null,
      scoringPeriodId: ctx.scoringPeriodId ?? null,
      note: "Roster ownership may be from a bundled snapshot; say so if advising on recent adds/drops/trades.",
    };
  },
};

export const listTeamsTool: ToolDefinition = {
  name: "list_teams",
  description: "List all fantasy teams in the league (id, name, owner).",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async () => ({
    ok: true,
    teams: ALL_TEAMS.map((t) => ({ id: t.id, name: t.name, owner: t.owner, rosterSize: t.roster.length })),
  }),
};

export const getMyRosterTool: ToolDefinition = {
  name: "get_my_roster",
  description:
    "Get the roster for the managed team (or another team id). Includes position, NFL team, bye, projection, injury status, starter/bench slot.",
  parameters: {
    type: "object",
    properties: {
      teamId: {
        type: "number",
        description: "Optional fantasy team id. Defaults to the managed team from the header.",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;
    const { team } = resolved;
    return {
      ok: true,
      teamId: team.id,
      name: team.name,
      owner: team.owner,
      players: team.roster.map((p) => ({
        id: p.id,
        name: p.name,
        pos: p.pos,
        nflTeam: p.team,
        bye: p.bye,
        proj: p.proj,
        tier: p.tier,
        status: p.status,
        starter: p.starter,
        slot: p.slot,
      })),
    };
  },
};

export const getByeCalendarTool: ToolDefinition = {
  name: "get_bye_calendar",
  description:
    "Group a team's players by NFL bye week. Optionally filter to a single week. Use this for bye coverage and 'is X on bye?' questions.",
  parameters: {
    type: "object",
    properties: {
      teamId: {
        type: "number",
        description: "Optional fantasy team id. Defaults to the managed team.",
      },
      week: {
        type: "number",
        description: "Optional scoring/NFL week to highlight (who is on bye that week).",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const week = typeof args.week === "number" ? args.week : undefined;
    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;
    const { team } = resolved;

    const byBye: Record<string, { id: number; name: string; pos: string; nflTeam: string }[]> = {};
    for (const p of team.roster) {
      const key = String(p.bye);
      if (!byBye[key]) byBye[key] = [];
      byBye[key].push({ id: p.id, name: p.name, pos: p.pos, nflTeam: p.team });
    }

    const onByeThisWeek =
      week != null
        ? team.roster
            .filter((p) => p.bye === week)
            .map((p) => ({ id: p.id, name: p.name, pos: p.pos, nflTeam: p.team, bye: p.bye }))
        : null;

    return {
      ok: true,
      teamId: team.id,
      name: team.name,
      currentWeekHint: ctx.scoringPeriodId ?? null,
      filterWeek: week ?? null,
      byByeWeek: byBye,
      onByeThisWeek,
    };
  },
};
