import { FAIR_RATIO_MAX, FAIR_RATIO_MIN, LOPSIDED_RATIO_MAX, LOPSIDED_RATIO_MIN } from "../../../src/config/trade.js";
import { ALL_TEAMS } from "../../../src/data/allTeams.js";
import { FREE_AGENTS } from "../../../src/data/freeAgents.js";
import { fetchEspnCompletedTrades } from "../../../src/lib/espn.js";
import {
  fetchMatchups,
  fetchStandings,
  getLiveLeagueCache,
  syncLiveRosters,
} from "../../../src/lib/espnLeague.js";
import { fairnessRatio, packageValue, ratioIsFair, starGateOk } from "../../../src/lib/tradeEngine.js";
import type { LeagueTeam, Player } from "../../../src/types.js";
import { allKnownPlayers, findTeamByIdOrName, serializePlayer } from "./leagueData.js";
import type { ToolDefinition } from "./types.js";

function completedTradeVerdict(
  ratio: number,
  gateOk: boolean
): "roughly_even" | "favors_team_a" | "favors_team_b" | "slightly_favors_team_a" | "slightly_favors_team_b" | "likely_unfair_star_gate" {
  if (!gateOk) return "likely_unfair_star_gate";
  if (ratioIsFair(ratio)) return "roughly_even";
  if (ratio > LOPSIDED_RATIO_MAX) return "favors_team_a";
  if (ratio < LOPSIDED_RATIO_MIN) return "favors_team_b";
  if (ratio > FAIR_RATIO_MAX) return "slightly_favors_team_a";
  if (ratio < FAIR_RATIO_MIN) return "slightly_favors_team_b";
  return "roughly_even";
}

function playersFromIds(ids: number[], byId: Map<number, Player>): Player[] {
  return ids.map((id) => byId.get(id)).filter((p): p is Player => !!p);
}

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

export const getCompletedTradesTool: ToolDefinition = {
  name: "get_completed_trades",
  description:
    "List completed (accepted) trades already on the books in this ESPN league — who swapped whom. Use for trade history, 'what trades happened', or 'has anyone traded X'. Reconstructs bilateral swaps from public ESPN data (not pending offers). Optional teamId filters to one fantasy team. Includes player names and the same fairness grade as the Trade Analyzer's Completed trades panel.",
  parameters: {
    type: "object",
    properties: {
      teamId: {
        type: "number",
        description: "If set, only return trades involving this fantasy team id.",
      },
    },
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const raw = await fetchEspnCompletedTrades();
    const trades = teamId == null ? raw : raw.filter((t) => t.teamAId === teamId || t.teamBId === teamId);
    const byId = new Map(allKnownPlayers().map((p) => [p.id, p]));

    const enriched = trades.map((t) => {
      const teamA = findTeamByIdOrName(t.teamAId);
      const teamB = findTeamByIdOrName(t.teamBId);
      const teamAName = teamA?.name ?? `Team ${t.teamAId}`;
      const teamBName = teamB?.name ?? `Team ${t.teamBId}`;
      const aPlayers = playersFromIds(t.teamAReceived, byId);
      const bPlayers = playersFromIds(t.teamBReceived, byId);
      const unresolvedA = t.teamAReceived.filter((id) => !byId.has(id));
      const unresolvedB = t.teamBReceived.filter((id) => !byId.has(id));

      // From team A's perspective: gave what B received, got what A received.
      const aGaveVal = packageValue(bPlayers);
      const aGotVal = packageValue(aPlayers);
      const ratio = fairnessRatio(aGaveVal, aGotVal);
      const gateOk = starGateOk(bPlayers, aPlayers);
      const verdict = completedTradeVerdict(ratio, gateOk);
      const favorsTeamB = verdict === "favors_team_b" || verdict === "slightly_favors_team_b" || verdict === "likely_unfair_star_gate";
      const favorsTeamA = verdict === "favors_team_a" || verdict === "slightly_favors_team_a";

      return {
        id: t.id,
        teamA: { id: t.teamAId, name: teamAName, owner: teamA?.owner ?? null },
        teamB: { id: t.teamBId, name: teamBName, owner: teamB?.owner ?? null },
        teamAReceived: aPlayers.map(serializePlayer),
        teamBReceived: bPlayers.map(serializePlayer),
        unresolvedPlayerIds: unresolvedA.length || unresolvedB.length
          ? { teamAReceived: unresolvedA, teamBReceived: unresolvedB }
          : undefined,
        grade: {
          teamAReceivedValue: Math.round(aGotVal * 10) / 10,
          teamBReceivedValue: Math.round(aGaveVal * 10) / 10,
          fairnessRatio: Math.round(ratio * 100) / 100,
          starGateOk: gateOk,
          verdict,
          winner: favorsTeamA
            ? { id: t.teamAId, name: teamAName }
            : favorsTeamB
              ? { id: t.teamBId, name: teamBName }
              : null,
          fairWindow: { min: FAIR_RATIO_MIN, max: FAIR_RATIO_MAX },
        },
      };
    });

    return {
      ok: true,
      count: enriched.length,
      trades: enriched,
      note:
        "Reconstructed from ESPN public transactions + current rosters — only bilateral swaps that still leave a paper trail (players still rostered). Pending offers and one-sided moves after subsequent drops are omitted. Quote grade.verdict when discussing who won a deal.",
    };
  },
};
