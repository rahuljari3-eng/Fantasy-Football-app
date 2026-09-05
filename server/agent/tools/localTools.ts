import { LEAGUE_CONFIG, REQUIRED_STARTERS, SLOTS } from "../../../src/config/league.js";
import { activeTeams, findPlayers, ownershipSource, resolveTeam } from "./leagueData.js";
import type { ToolDefinition } from "./types.js";

function summarizeLocalLineup(ctx: { localLineup?: { roster: Record<string, number | undefined>; bench: number[] } }) {
  const local = ctx.localLineup;
  if (!local) return null;
  const starters = SLOTS.map((slot) => {
    const id = local.roster[slot];
    if (id == null) return { slot, playerId: null, name: null };
    const p = findPlayers(id, 1)[0];
    return { slot, playerId: id, name: p?.name ?? null, pos: p?.pos ?? null };
  });
  const bench = (local.bench || []).map((id) => {
    const p = findPlayers(id, 1)[0];
    return { playerId: id, name: p?.name ?? null, pos: p?.pos ?? null };
  });
  return { starters, bench };
}

function espnStarterSlots(teamRoster: { id: number; name: string; slot: string; starter: boolean }[]) {
  return teamRoster
    .filter((p) => p.starter)
    .map((p) => ({ playerId: p.id, name: p.name, slot: p.slot }));
}

export const getLeagueContextTool: ToolDefinition = {
  name: "get_league_context",
  description:
    "Return league identity, scoring format, roster slots, managed team, current scoring period/week, ownership source, and local builder lineup if the client sent one.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async (ctx) => {
    const resolved = resolveTeam(ctx);
    const team = resolved.ok ? resolved.team : undefined;
    const source = ownershipSource();
    const localLineup = summarizeLocalLineup(ctx);
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
      ownershipSource: source,
      localLineup,
      note:
        source === "bundled_snapshot"
          ? "Roster ownership is from a bundled snapshot (auto-sync may have failed). Say so if ownership matters."
          : "Roster ownership is from a live ESPN sync in this server process (auto-refreshed when stale).",
      lineupNote: localLineup
        ? "Client sent a local roster-builder lineup. For start/sit, ask which to use if it may differ from ESPN."
        : "No local lineup was sent — use ESPN/live roster slots.",
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
    ownershipSource: ownershipSource(),
    teams: activeTeams().map((t) => ({ id: t.id, name: t.name, owner: t.owner, rosterSize: t.roster.length })),
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
    const managed = resolveTeam(ctx);
    const advisingManaged = managed.ok && managed.team.id === team.id;
    const localLineup = advisingManaged ? summarizeLocalLineup(ctx) : null;
    const espnStarters = espnStarterSlots(team.roster);

    return {
      ok: true,
      teamId: team.id,
      name: team.name,
      owner: team.owner,
      scoringPeriodId: ctx.scoringPeriodId ?? null,
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
      espnStarters,
      localLineup,
      note: localLineup
        ? "Includes both ESPN roster slots and the client's local builder lineup. Ask which to use if they conflict."
        : undefined,
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
