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
import { fetchLeagueScheduleSnapshot } from "../../../src/lib/leagueSchedule.js";
import { optimizeLineup } from "../../../src/lib/optimizeLineup.js";
import {
  fetchPlayerPerformance,
  fetchTeamWeekScore,
  fetchTopScorers,
} from "../../../src/lib/playerPerformance.js";
import { computePlayoffOutlook } from "../../../src/lib/playoffOdds.js";
import { fairnessRatio, packageValue, ratioIsFair, starGateOk } from "../../../src/lib/tradeEngine.js";
import type { LeagueTeam, Player } from "../../../src/types.js";
import {
  activeTeams,
  allKnownPlayers,
  findPlayers,
  findTeamByIdOrName,
  serializePlayer,
  teamPlayersRanked,
} from "./leagueData.js";
import type { ToolDefinition } from "./types.js";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Resolve a fantasy team by id, team name, abbrev-ish name, or owner name. */
function resolveFantasyTeam(query: string | number | undefined, fallbackId?: number): LeagueTeam | null {
  if (typeof query === "number") return findTeamByIdOrName(query) ?? null;
  if (typeof query === "string" && /^\d+$/.test(query.trim())) {
    return findTeamByIdOrName(Number(query.trim())) ?? null;
  }
  if (typeof query === "string" && query.trim()) {
    const q = query.trim().toLowerCase();
    const teams = activeTeams();
    const exact = teams.find((t) => t.name.toLowerCase() === q || t.owner.toLowerCase() === q);
    if (exact) return exact;
    const partial = teams.find(
      (t) => t.name.toLowerCase().includes(q) || t.owner.toLowerCase().includes(q) || q.includes(t.name.toLowerCase())
    );
    if (partial) return partial;
  }
  if (fallbackId != null) return findTeamByIdOrName(fallbackId) ?? null;
  return null;
}

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
    "Live ESPN standings: seed/rank, W-L-T, points for/against, streak. Prefer this for W-L / points questions. For playoff odds, clinch math, or 'what do I need to make the playoffs?', use get_playoff_odds instead.",
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

export const getPlayoffOddsTool: ToolDefinition = {
  name: "get_playoff_odds",
  description:
    "Playoff race outlook for the league (same engine as the League tab's Playoff Race view): Monte Carlo makeOdds %, clinched/eliminated/alive status, winsNeededToClinch (e.g. 3 of 5 remaining), controlsOwnDestiny, gamesBackOfCutoff, teamsThatCanFinishAhead / teamsThatCanTieOnRecord, remaining schedule, and a human-readable summary per team. Use for 'playoff odds', 'am I in?', 'what do I need to clinch', or who is eliminated.",
  parameters: {
    type: "object",
    properties: {
      teamId: {
        type: "number",
        description:
          "If set, return only this team's outlook (plus league context). Defaults to the full league, sorted by makeOdds.",
      },
    },
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const snap = await fetchLeagueScheduleSnapshot();

    // Same baseline the League tab uses: each team's optimal-lineup weekly
    // projection as "true talent" for the Monte Carlo (blended with actual PF
    // once enough games are played — see computePlayoffOutlook).
    const projectedStrengthByTeam: Record<number, number> = {};
    for (const t of activeTeams()) {
      const roster = teamPlayersRanked(t.id);
      projectedStrengthByTeam[t.id] = optimizeLineup(roster).projectedTotal;
    }

    const nameById = new Map(snap.standings.map((s) => [s.teamId, s.name]));
    const ownerById = new Map(snap.standings.map((s) => [s.teamId, s.owner]));

    let outlooks = computePlayoffOutlook(
      snap.standings,
      snap.schedule,
      snap.playoffTeamCount,
      projectedStrengthByTeam
    );

    if (teamId != null) {
      outlooks = outlooks.filter((o) => o.teamId === teamId);
      if (!outlooks.length) {
        return {
          ok: false,
          error: "team_not_found_in_standings",
          teamId,
          note: "ESPN team ids may differ from the bundled snapshot — call list_teams / sync_rosters and match by name.",
        };
      }
    } else {
      outlooks = [...outlooks].sort((a, b) => b.makeOdds - a.makeOdds || b.pointsFor - a.pointsFor);
    }

    return {
      ok: true,
      currentWeek: snap.currentWeek,
      regularSeasonWeeks: snap.regularSeasonWeeks,
      playoffTeamCount: snap.playoffTeamCount,
      fetchedAt: snap.fetchedAt,
      teams: outlooks.map((o) => ({
        teamId: o.teamId,
        name: nameById.get(o.teamId) ?? `Team ${o.teamId}`,
        owner: ownerById.get(o.teamId) ?? null,
        record: `${o.wins}-${o.losses}${o.ties ? `-${o.ties}` : ""}`,
        pointsFor: o.pointsFor,
        gamesRemaining: o.gamesRemaining,
        makeOdds: o.makeOdds,
        status: o.status,
        controlsOwnDestiny: o.controlsOwnDestiny,
        winsNeededToClinch: o.winsNeededToClinch,
        gamesBackOfCutoff: o.gamesBackOfCutoff,
        teamsThatCanFinishAhead: o.teamsThatCanFinishAhead,
        teamsThatCanTieOnRecord: o.teamsThatCanTieOnRecord,
        blockingTeams: o.blockingTeams,
        remaining: o.remaining,
        summary: o.summary,
      })),
      note:
        "makeOdds is a Monte Carlo estimate (0–100); clinched/eliminated/controlsOwnDestiny are exact schedule-aware math. ALWAYS quote summary verbatim for clinch language. When controlsOwnDestiny is true, also quote winsNeededToClinch vs gamesRemaining (e.g. \"win 3 of the last 5\") — do not say win-out unless winsNeededToClinch equals gamesRemaining. If controlsOwnDestiny is false, say so; if summary mentions points for, PF is the tiebreaker for berths among tied records.",
    };
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

export const getPlayerPerformanceTool: ToolDefinition = {
  name: "get_player_performance",
  description:
    "How ONE named player actually did in a fantasy week (and recent game log): actual fantasy points, projection, scoring breakdown, NFL game result, box-score line. Requires a player name/id. For 'who scored the most tonight/today' use get_week_scorers; for a fantasy team's week total / contributors use get_team_week_score. Do NOT use get_player alone for final scores.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Player name or ESPN id",
      },
      week: {
        type: "number",
        description: "Fantasy scoring period / week. Defaults to ESPN's current week.",
      },
      includeBoxScore: {
        type: "boolean",
        description: "Include NFL box-score line when a final/live game is linked (default true).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    if (typeof args.query !== "string" && typeof args.query !== "number") {
      return { ok: false, error: "query_required" };
    }
    const hits = findPlayers(args.query, 1);
    if (!hits.length) return { ok: false, error: "player_not_found", query: args.query };
    const player = hits[0];
    const week = typeof args.week === "number" ? args.week : undefined;
    const includeBoxScore = args.includeBoxScore !== false;

    const perf = await fetchPlayerPerformance(player.id, week, { includeNflBoxScore: includeBoxScore });
    if (!perf) {
      return {
        ok: false,
        error: "performance_unavailable",
        player: serializePlayer(player),
        note: "Could not load ESPN actuals for this player.",
      };
    }

    const tw = perf.thisWeek;
    const statusNote =
      tw.actualPoints != null
        ? tw.game?.status
          ? `Actuals are in (${tw.game.status}).`
          : "Actual fantasy points are available for this week."
        : tw.projectedPoints != null
          ? "No actual fantasy points yet for this week — game may still be scheduled or in progress. projectedPoints is ESPN's projection, not a final score."
          : "No actual or projected scoring line for this week yet.";

    return {
      ok: true,
      player: serializePlayer(player),
      ownedBy: perf.fantasyTeamId != null ? { teamId: perf.fantasyTeamId, teamName: perf.fantasyTeamName } : null,
      currentWeek: perf.currentWeek,
      week: perf.week,
      thisWeek: {
        actualPoints: tw.actualPoints,
        projectedPoints: tw.projectedPoints,
        vsProjection:
          tw.actualPoints != null && tw.projectedPoints != null
            ? round1(tw.actualPoints - tw.projectedPoints)
            : null,
        fantasyBreakdown: tw.fantasyBreakdown,
        game: tw.game,
        nflBoxLine: tw.nflBoxLine
          ? {
              category: tw.nflBoxLine.category,
              line: Object.fromEntries(
                tw.nflBoxLine.labels.map((label, i) => [label, tw.nflBoxLine!.stats[i] ?? null])
              ),
            }
          : null,
      },
      gameLog: perf.gameLog.map((g) => ({
        week: g.week,
        actualPoints: g.actualPoints,
        projectedPoints: g.projectedPoints,
        game: g.game,
        fantasyBreakdown: g.fantasyBreakdown,
        nflBoxLine: g.nflBoxLine
          ? {
              category: g.nflBoxLine.category,
              line: Object.fromEntries(g.nflBoxLine.labels.map((label, i) => [label, g.nflBoxLine!.stats[i] ?? null])),
            }
          : null,
      })),
      seasonToDate: perf.seasonToDate,
      note: `${statusNote} Quote thisWeek.actualPoints (and nflBoxLine / fantasyBreakdown) for "how did they do" answers — never substitute weekValue/proj from get_player as if it were the final score.`,
    };
  },
};

export const getTeamWeekScoreTool: ToolDefinition = {
  name: "get_team_week_score",
  description:
    "Fantasy team's full week scoreboard: every rostered player's actual + projected points, starter vs bench, and who has contributed so far. Use for 'what's my/X's score this week', 'who scored for Kareem Pies', or team totals. Do NOT reconstruct this by calling get_player_performance one player at a time — you will miss scorers.",
  parameters: {
    type: "object",
    properties: {
      team: {
        type: "string",
        description: "Fantasy team name, owner name, or team id. Defaults to the managed team.",
      },
      week: {
        type: "number",
        description: "Scoring period / week. Defaults to current week.",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const team = resolveFantasyTeam(
      typeof args.team === "string" || typeof args.team === "number" ? args.team : undefined,
      ctx.managedTeamId
    );
    if (!team) return { ok: false, error: "team_not_found", query: args.team ?? ctx.managedTeamId };
    const week = typeof args.week === "number" ? args.week : undefined;
    const score = await fetchTeamWeekScore(team.id, week);
    if (!score) return { ok: false, error: "team_week_unavailable", teamId: team.id, teamName: team.name };

    return {
      ok: true,
      team: { id: team.id, name: team.name, owner: team.owner },
      week: score.week,
      currentWeek: score.currentWeek,
      starterActualTotal: score.starterActualTotal,
      benchActualTotal: score.benchActualTotal,
      starterProjectedRemaining: score.starterProjectedRemaining,
      contributors: score.contributors.map((p) => ({
        name: p.name,
        playerId: p.playerId,
        slot: p.slot,
        isStarter: p.isStarter,
        actualPoints: p.actualPoints,
        game: p.game,
      })),
      benchContributors: score.benchContributors.map((p) => ({
        name: p.name,
        playerId: p.playerId,
        slot: p.slot,
        actualPoints: p.actualPoints,
        game: p.game,
      })),
      players: score.players.map((p) => ({
        name: p.name,
        playerId: p.playerId,
        slot: p.slot,
        isStarter: p.isStarter,
        actualPoints: p.actualPoints,
        projectedPoints: p.projectedPoints,
        game: p.game,
      })),
      note:
        "starterActualTotal is the fantasy matchup total so far (starters only) — quote contributors for who made up that total. benchContributors scored but do not count toward the matchup total. Players with actualPoints null have not played / no scoring line yet.",
    };
  },
};

export const getWeekScorersTool: ToolDefinition = {
  name: "get_week_scorers",
  description:
    "Leaderboard of fantasy points scored this week across the league. Use for 'who got the most points tonight/today/this week', 'top scorers', or scoring in a specific NFL game. Set tonightOnly=true for tonight's/today's completed or in-progress NFL games (no player name needed). Optional eventId scopes to one NFL game.",
  parameters: {
    type: "object",
    properties: {
      week: {
        type: "number",
        description: "Scoring period / week. Defaults to current week.",
      },
      tonightOnly: {
        type: "boolean",
        description:
          "If true, only players whose scoring line is tied to a final or in-progress NFL game on today's scoreboard (answers 'tonight' / 'today's game').",
      },
      eventId: {
        type: "string",
        description: "Optional ESPN NFL event id to scope scorers to one game.",
      },
      limit: {
        type: "number",
        description: "Max scorers to return (default 15, max 50).",
      },
    },
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const week = typeof args.week === "number" ? args.week : undefined;
    const tonightOnly = args.tonightOnly === true;
    const eventId = typeof args.eventId === "string" ? args.eventId : undefined;
    const limit = typeof args.limit === "number" ? args.limit : 15;

    const result = await fetchTopScorers({ week, tonightOnly, eventId, limit, minPoints: 0 });
    const top = result.scorers[0] ?? null;

    return {
      ok: true,
      week: result.week,
      currentWeek: result.currentWeek,
      scope: result.scope,
      games: result.games,
      topScorer: top
        ? {
            name: top.name,
            actualPoints: top.actualPoints,
            fantasyTeamName: top.fantasyTeamName,
            game: top.game,
          }
        : null,
      scorers: result.scorers.map((p, i) => ({
        rank: i + 1,
        name: p.name,
        playerId: p.playerId,
        actualPoints: p.actualPoints,
        fantasyTeamName: p.fantasyTeamName,
        slot: p.slot,
        game: p.game,
        eventId: p.eventId,
      })),
      note:
        result.scorers.length === 0
          ? "No fantasy actuals matched this scope yet — games may still be scheduled. Do not invent scorers; say so."
          : "Quote topScorer / scorers[].actualPoints directly. For 'who scored the most tonight', use tonightOnly=true rather than inventing a player name for get_player_performance.",
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
