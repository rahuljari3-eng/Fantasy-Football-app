import { SLOTS } from "../../../src/config/league.js";
import { suggestTrades } from "../../../src/lib/coachTrades.js";
import { optimizeLineup } from "../../../src/lib/optimizeLineup.js";
import type { Player } from "../../../src/types.js";
import {
  activeTeams,
  findPlayers,
  freeAgentPool,
  resolveTeam,
  teamPlayersRanked,
  withPosRanks,
} from "./leagueData.js";
import type { ToolDefinition } from "./types.js";

function localPoolPlayers(ctx: {
  managedTeamId: number;
  localLineup?: { roster: Record<string, number | undefined>; bench: number[] };
}): Player[] | null {
  const local = ctx.localLineup;
  if (!local) return null;
  const ids = [
    ...SLOTS.map((s) => local.roster[s]).filter((id): id is number => typeof id === "number"),
    ...(local.bench || []),
  ];
  const unique = [...new Set(ids)];
  if (!unique.length) return null;
  const players: Player[] = [];
  for (const id of unique) {
    const hit = findPlayers(id, 1)[0];
    if (hit) players.push(hit);
  }
  return withPosRanks(players);
}

function serializeSuggestionPlayer(p: Player) {
  return {
    id: p.id,
    name: p.name,
    pos: p.pos,
    nflTeam: p.team,
    bye: p.bye,
    proj: p.proj,
    tier: p.tier,
    status: p.status,
  };
}

export const optimizeLineupTool: ToolDefinition = {
  name: "optimize_lineup",
  description:
    "Build the best weekly starting lineup by projection for a team. Excludes Out players and (when scoring period is known) players on bye. Prefer this for 'who should I start?' / flex questions. pool=roster uses the team's roster (or local builder pool when advising the managed team); roster_plus_fa also considers free agents.",
  parameters: {
    type: "object",
    properties: {
      teamId: {
        type: "number",
        description: "Fantasy team id. Defaults to the managed team.",
      },
      pool: {
        type: "string",
        enum: ["roster", "roster_plus_fa"],
        description: "Player pool. Default roster.",
      },
      useLocalLineup: {
        type: "boolean",
        description:
          "When true (default for managed team if local lineup was sent), optimize from the local builder roster+bench ids instead of ESPN roster slots.",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const pool = args.pool === "roster_plus_fa" ? "roster_plus_fa" : "roster";
    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;
    const { team } = resolved;
    const managed = resolveTeam(ctx);
    const advisingManaged = managed.ok && managed.team.id === team.id;

    const useLocal =
      typeof args.useLocalLineup === "boolean"
        ? args.useLocalLineup
        : advisingManaged && !!ctx.localLineup;

    let rosterPlayers = teamPlayersRanked(team.id);
    let poolSource: "espn_roster" | "local_lineup" = "espn_roster";
    if (useLocal && advisingManaged) {
      const localPlayers = localPoolPlayers(ctx);
      if (localPlayers?.length) {
        rosterPlayers = localPlayers;
        poolSource = "local_lineup";
      }
    }

    let players = rosterPlayers;
    if (pool === "roster_plus_fa") {
      const seen = new Set(players.map((p) => p.id));
      players = withPosRanks([...players, ...freeAgentPool().filter((p) => !seen.has(p.id))]);
    }

    const result = optimizeLineup(players, {
      byeWeek: ctx.scoringPeriodId,
      excludeOut: true,
    });

    const byId = new Map(players.map((p) => [p.id, p]));
    const starters = SLOTS.map((slot) => {
      const id = result.roster[slot];
      const p = id != null ? byId.get(id) : undefined;
      return {
        slot,
        playerId: id ?? null,
        name: p?.name ?? null,
        pos: p?.pos ?? null,
        proj: p?.proj ?? null,
        bye: p?.bye ?? null,
        status: p?.status ?? null,
      };
    });

    return {
      ok: true,
      teamId: team.id,
      teamName: team.name,
      scoringPeriodId: ctx.scoringPeriodId ?? null,
      pool,
      poolSource,
      projectedTotal: result.projectedTotal,
      starters,
      emptySlots: result.emptySlots,
      excluded: result.excluded.slice(0, 20),
      note:
        poolSource === "local_lineup"
          ? "Optimized from the client's local builder lineup. If the user meant ESPN instead, ask and re-run with useLocalLineup=false."
          : "Optimized from ESPN/live roster. If the user meant their local builder lineup, ask and re-run with useLocalLineup=true.",
    };
  },
};

export const suggestTradesTool: ToolDefinition = {
  name: "suggest_trades",
  description:
    "Propose fair coach-style trade packages for a team (need-based + value + fallback mix of 1-for-1 and 2-for-2). Use when the user asks what trades to make or who to target.",
  parameters: {
    type: "object",
    properties: {
      teamId: {
        type: "number",
        description: "Fantasy team id to advise for. Defaults to the managed team.",
      },
      max: {
        type: "number",
        description: "Max suggestions to return (default 6, max 10).",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const maxRaw = typeof args.max === "number" ? args.max : 6;
    const max = Math.max(1, Math.min(10, Math.floor(maxRaw)));

    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;
    const { team } = resolved;

    const opponents = activeTeams().filter((t) => t.id !== team.id);
    // Prefer local builder pool for managed team when available.
    const managed = resolveTeam(ctx);
    const advisingManaged = managed.ok && managed.team.id === team.id;
    let myPlayers = withPosRanks(team.roster.map((p) => ({ ...p })));
    if (advisingManaged && ctx.localLineup) {
      const localPlayers = localPoolPlayers(ctx);
      if (localPlayers?.length) myPlayers = localPlayers;
    }

    const { suggestions, needyPositions, strengthPositions } = suggestTrades({
      myPlayers,
      leagueTeams: opponents,
      max,
    });

    return {
      ok: true,
      teamId: team.id,
      teamName: team.name,
      needyPositions,
      strengthPositions,
      count: suggestions.length,
      suggestions: suggestions.map((s) => ({
        id: s.id,
        opponentTeamId: s.teamId,
        opponentTeamName: s.teamName,
        reason: s.reason,
        needPos: s.needPos,
        overlapPos: s.overlapPos,
        give: s.give.map(serializeSuggestionPlayer),
        get: s.get.map(serializeSuggestionPlayer),
        giveVal: Math.round(s.giveVal * 10) / 10,
        getVal: Math.round(s.getVal * 10) / 10,
        ratio: Math.round(s.ratio * 100) / 100,
        upgrade: Math.round(s.upgrade * 10) / 10,
      })),
      note: "Values use the same coach/trade engine as the AI Coach tab (week VOR + need adjustment). For a specific package grade, call evaluate_trade.",
    };
  },
};
