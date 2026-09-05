import { LEAGUE_CONFIG, ESPN_LEAGUE_BASE_URL } from "../../../src/config/league.js";
import {
  gamesForWeek,
  getNflSchedule,
  normalizeNflAbbrev,
  resolveNflTeam,
  teamScheduleRemaining,
} from "../../../src/lib/nflSchedule.js";
import { findPlayers, resolveTeam, serializePlayer, teamPlayersRanked } from "./leagueData.js";
import type { ToolDefinition } from "./types.js";
import type { Player } from "../../../src/types.js";

/** Default fantasy playoff window when league settings aren't fetched yet. */
const DEFAULT_PLAYOFF_WEEKS = [15, 16, 17];

async function resolveFromWeek(ctxWeek?: number): Promise<number> {
  if (typeof ctxWeek === "number" && ctxWeek > 0) return ctxWeek;
  try {
    const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mStatus`, { headers: { Accept: "application/json" } });
    if (!res.ok) return 1;
    const data = (await res.json()) as { scoringPeriodId?: number };
    return data.scoringPeriodId ?? 1;
  } catch {
    return 1;
  }
}

export const getNflScheduleTool: ToolDefinition = {
  name: "get_nfl_schedule",
  description:
    "NFL slate for a week and/or a pro team. Returns home/away matchups. Use for 'who does LAR play in week 10?' or 'what's the week 5 slate?'.",
  parameters: {
    type: "object",
    properties: {
      week: { type: "number", description: "Scoring/NFL week. Defaults to current league scoring period." },
      nflTeam: { type: "string", description: "Optional NFL abbrev or name (e.g. LAR, Jets)" },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const snap = await getNflSchedule();
    const week = typeof args.week === "number" ? args.week : await resolveFromWeek(ctx.scoringPeriodId);

    if (typeof args.nflTeam === "string") {
      const team = resolveNflTeam(snap, args.nflTeam);
      if (!team) return { ok: false, error: "nfl_team_not_found", query: args.nflTeam };
      const remaining = teamScheduleRemaining(snap, team.abbrev, week);
      const thisWeek = remaining.find((s) => s.week === week) ?? null;
      return {
        ok: true,
        season: snap.season,
        week,
        team: { abbrev: team.abbrev, name: `${team.location} ${team.name}`, byeWeek: team.byeWeek },
        thisWeek,
        remaining,
      };
    }

    return {
      ok: true,
      season: snap.season,
      week,
      games: gamesForWeek(snap, week),
      note: week ? `Bye teams that week have no game listed.` : undefined,
    };
  },
};

export const getPlayerScheduleTool: ToolDefinition = {
  name: "get_player_schedule",
  description:
    "Remaining NFL schedule for a fantasy player (bye + all remaining opponents, home/away) from the current week through season end.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Player name or ESPN id" },
      fromWeek: { type: "number", description: "Start week (defaults to current scoring period)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    if (typeof args.query !== "string" && typeof args.query !== "number") {
      return { ok: false, error: "query_required" };
    }
    const hits = findPlayers(args.query, 1);
    if (!hits.length) return { ok: false, error: "player_not_found", query: args.query };
    const player = hits[0];
    const snap = await getNflSchedule();
    const fromWeek = typeof args.fromWeek === "number" ? args.fromWeek : await resolveFromWeek(ctx.scoringPeriodId);
    const abbrev = normalizeNflAbbrev(player.team);
    const team = snap.teamsByAbbrev[abbrev];
    if (!team) {
      return {
        ok: false,
        error: "nfl_team_not_in_schedule",
        player: serializePlayer(player),
        nflTeam: player.team,
        hint: "Player team abbrev may not match ESPN schedule map.",
      };
    }
    const remaining = teamScheduleRemaining(snap, abbrev, fromWeek);
    return {
      ok: true,
      player: serializePlayer(player),
      nflTeam: { abbrev: team.abbrev, byeWeek: team.byeWeek },
      fromWeek,
      remaining,
      playoffWindow: remaining.filter((s) => DEFAULT_PLAYOFF_WEEKS.includes(s.week)),
    };
  },
};

export const getScheduleOutlookTool: ToolDefinition = {
  name: "get_schedule_outlook",
  description:
    "Remaining schedule summary for multiple players or an entire fantasy roster. Use for ROS / playoff stash questions.",
  parameters: {
    type: "object",
    properties: {
      players: {
        type: "array",
        items: { type: "string" },
        description: "Player names/ids. If omitted and teamId set, uses that roster.",
      },
      teamId: { type: "number", description: "Fantasy team id (defaults to managed team when players omitted)" },
      fromWeek: { type: "number", description: "Start week (defaults to current scoring period)" },
      throughWeek: { type: "number", description: "Optional end week (default: season end)" },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const snap = await getNflSchedule();
    const fromWeek = typeof args.fromWeek === "number" ? args.fromWeek : await resolveFromWeek(ctx.scoringPeriodId);
    const throughWeek = typeof args.throughWeek === "number" ? args.throughWeek : snap.maxWeek;

    let players: Player[] = [];
    if (Array.isArray(args.players) && args.players.length) {
      for (const q of args.players) {
        if (typeof q !== "string" && typeof q !== "number") continue;
        const hits = findPlayers(q, 1);
        if (hits[0]) players.push(hits[0]);
      }
      if (!players.length) return { ok: false, error: "no_players_resolved" };
    } else {
      const teamId = typeof args.teamId === "number" ? args.teamId : ctx.managedTeamId;
      const resolved = resolveTeam(ctx, teamId);
      if (!resolved.ok) return resolved;
      players = teamPlayersRanked(resolved.team.id);
    }

    const outlooks = players.map((p) => {
      const remaining = teamScheduleRemaining(snap, p.team, fromWeek).filter((s) => s.week <= throughWeek);
      const games = remaining.filter((s) => !("bye" in s && s.bye));
      const playoff = remaining.filter((s) => DEFAULT_PLAYOFF_WEEKS.includes(s.week));
      return {
        player: serializePlayer(p),
        byeWeek: snap.teamsByAbbrev[normalizeNflAbbrev(p.team)]?.byeWeek ?? p.bye,
        remaining,
        gamesRemaining: games.length,
        playoffSlate: playoff,
      };
    });

    return {
      ok: true,
      season: snap.season,
      fromWeek,
      throughWeek,
      playoffWeeks: DEFAULT_PLAYOFF_WEEKS,
      outlooks,
    };
  },
};

export const getPlayoffWeeksTool: ToolDefinition = {
  name: "get_playoff_weeks",
  description: "Return which scoring periods are treated as fantasy playoffs for this app (default 15–17).",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async () => ({
    ok: true,
    leagueName: LEAGUE_CONFIG.leagueName,
    playoffWeeks: DEFAULT_PLAYOFF_WEEKS,
    note: "Hardcoded default until mSettings playoff config is wired. Override later if the league differs.",
  }),
};
