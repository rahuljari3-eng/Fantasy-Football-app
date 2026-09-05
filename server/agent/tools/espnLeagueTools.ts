import { ALL_TEAMS } from "../../../src/data/allTeams.js";
import { FREE_AGENTS } from "../../../src/data/freeAgents.js";
import {
  fetchMatchups,
  fetchStandings,
  getLiveLeagueCache,
  syncLiveRosters,
} from "../../../src/lib/espnLeague.js";
import type { LeagueTeam, Player } from "../../../src/types.js";
import type { ToolDefinition } from "./types.js";

function snapshotKnownPlayers(): Player[] {
  // Prefer static snapshot metadata (tier/bye) when enriching live ESPN rows.
  const map = new Map<number, Player>();
  for (const t of ALL_TEAMS) for (const p of t.roster) map.set(p.id, p);
  for (const p of FREE_AGENTS) if (!map.has(p.id)) map.set(p.id, p);
  return [...map.values()];
}

export const getStandingsTool: ToolDefinition = {
  name: "get_standings",
  description:
    "Live ESPN standings: seed/rank, W-L-T, points for/against, streak. Prefer this for playoff-race or 'where am I?' questions.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async () => {
    const cached = getLiveLeagueCache();
    if (cached?.standings?.length) {
      return {
        ok: true,
        source: "live_cache",
        scoringPeriodId: cached.scoringPeriodId,
        fetchedAt: cached.fetchedAt,
        standings: cached.standings,
      };
    }
    const { scoringPeriodId, standings } = await fetchStandings();
    return { ok: true, source: "espn", scoringPeriodId, standings };
  },
};

export const getMatchupTool: ToolDefinition = {
  name: "get_matchup",
  description:
    "Live ESPN fantasy matchups for a scoring period (default: current week). Optionally filter to one team id.",
  parameters: {
    type: "object",
    properties: {
      week: {
        type: "number",
        description: "Scoring period / matchup week. Defaults to ESPN's current scoringPeriodId.",
      },
      teamId: {
        type: "number",
        description: "If set, return only the matchup involving this fantasy team id.",
      },
    },
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const week = typeof args.week === "number" ? args.week : undefined;
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const { scoringPeriodId, week: resolvedWeek, matchups } = await fetchMatchups(week);
    const filtered =
      teamId == null
        ? matchups
        : matchups.filter((m) => m.home.teamId === teamId || m.away.teamId === teamId);
    return {
      ok: true,
      scoringPeriodId,
      week: resolvedWeek,
      matchups: filtered,
      note:
        teamId != null && filtered.length === 0
          ? "No matchup found for that teamId this week — ESPN team ids may differ from the bundled snapshot; call sync_rosters or list_teams after sync."
          : undefined,
    };
  },
};

export const syncRostersTool: ToolDefinition = {
  name: "sync_rosters",
  description:
    "Refresh live who-owns-whom and the free-agent pool from ESPN. Updates the server cache used by roster/FA/needs/trade tools for this API process. Call when ownership may have changed (adds, drops, trades) or before important advice.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async () => {
    const snap = await syncLiveRosters(snapshotKnownPlayers());
    const summary = snap.teams.map((t: LeagueTeam) => ({
      id: t.id,
      name: t.name,
      owner: t.owner,
      rosterSize: t.roster.length,
    }));
    return {
      ok: true,
      scoringPeriodId: snap.scoringPeriodId,
      fetchedAt: snap.fetchedAt,
      teamCount: snap.teams.length,
      freeAgentCount: snap.freeAgents.length,
      teams: summary,
      note: "Subsequent roster/FA/analysis tools in this server process will prefer this live ownership. ESPN team ids may differ from the app's bundled snapshot — match teams by name when needed.",
    };
  },
};
