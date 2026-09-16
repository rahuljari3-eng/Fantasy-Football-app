import { LEAGUE_CONFIG, ESPN_LEAGUE_BASE_URL } from "../../../src/config/league.js";
import { fetchWeeklyMatchups, gradeMatchup } from "../../../src/lib/matchup.js";
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
    const nextGame = remaining.find((s) => !("bye" in s && s.bye));
    const nextHint = !nextGame
      ? "No remaining games found in schedule cache."
      : nextGame.bye
        ? `Week ${nextGame.week}: BYE`
        : `Week ${nextGame.week}: ${nextGame.home ? "vs" : "@"} ${nextGame.opponent}`;
    return {
      ok: true,
      player: serializePlayer(player),
      nflTeam: { abbrev: team.abbrev, byeWeek: team.byeWeek },
      fromWeek,
      remaining,
      playoffWindow: remaining.filter((s) => DEFAULT_PLAYOFF_WEEKS.includes(s.week)),
      citeHints: [
        `${player.name} (${player.team}): bye week ${team.byeWeek}; from week ${fromWeek}.`,
        `Next slate: ${nextHint}.`,
        `Playoff weeks ${DEFAULT_PLAYOFF_WEEKS.join("/")}: ${remaining.filter((s) => DEFAULT_PLAYOFF_WEEKS.includes(s.week)).length} schedule entries.`,
      ],
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

/**
 * Honest week-by-week outlook: ESPN only publishes a real fantasy projection
 * for the *current* scoring week. Future weeks use season PPG (or current
 * week proj as fallback) labeled as baselines — never invent weekly ESPN projs.
 */
export const getPlayerProjectionOutlookTool: ToolDefinition = {
  name: "get_player_projection_outlook",
  description:
    "Week-by-week projection outlook for one or more players: real ESPN proj for the current week, then schedule (opponent/bye) for remaining weeks with a clearly labeled season-PPG baseline (ESPN does NOT publish true future weekly fantasy projections). Use for trades, playoff stash, or 'how's their schedule the next few weeks?' — never treat baselinePoints as ESPN weekly proj.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Single player name or ESPN id" },
      players: {
        type: "array",
        items: { type: "string" },
        description: "Multiple player names/ids (e.g. both sides of a trade). Prefer over repeating the tool.",
      },
      fromWeek: { type: "number", description: "Start week (defaults to current scoring period)" },
      throughWeek: { type: "number", description: "End week (default: season end)" },
      weeksAhead: {
        type: "number",
        description: "If set, outlook covers fromWeek .. fromWeek+weeksAhead-1 (overrides throughWeek)",
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const queries: string[] = [];
    if (Array.isArray(args.players)) {
      for (const q of args.players) {
        if (typeof q === "string" || typeof q === "number") queries.push(String(q));
      }
    }
    if (typeof args.query === "string" || typeof args.query === "number") {
      queries.push(String(args.query));
    }
    if (!queries.length) {
      return { ok: false, error: "query_or_players_required" };
    }

    const snap = await getNflSchedule();
    const fromWeek = typeof args.fromWeek === "number" ? args.fromWeek : await resolveFromWeek(ctx.scoringPeriodId);
    let throughWeek =
      typeof args.throughWeek === "number" ? args.throughWeek : snap.maxWeek;
    if (typeof args.weeksAhead === "number" && args.weeksAhead > 0) {
      throughWeek = fromWeek + Math.floor(args.weeksAhead) - 1;
    }

    let matchups: Awaited<ReturnType<typeof fetchWeeklyMatchups>> | null = null;
    try {
      matchups = await fetchWeeklyMatchups();
    } catch {
      matchups = null;
    }

    const outlooks = [];
    const notFound: string[] = [];

    for (const q of queries.slice(0, 8)) {
      const hits = findPlayers(q, 1);
      if (!hits.length) {
        notFound.push(q);
        continue;
      }
      const player = hits[0];
      const seasonPpg = player.seasonProj ?? null;
      const baselineSource =
        seasonPpg != null ? ("season_ppg_baseline" as const) : ("current_week_proj_fallback" as const);
      const baselinePoints = Math.round((seasonPpg ?? player.proj) * 10) / 10;

      const remaining = teamScheduleRemaining(snap, player.team, fromWeek).filter(
        (s) => s.week <= throughWeek
      );

      const weeks = remaining.map((slot) => {
        if ("bye" in slot && slot.bye) {
          return {
            week: slot.week,
            bye: true as const,
            projectedPoints: 0,
            source: "bye" as const,
          };
        }
        const game = slot as { week: number; opponent: string; home: boolean; date: string | null };
        if (game.week === fromWeek) {
          const m = matchups ? gradeMatchup(player, matchups) : null;
          return {
            week: game.week,
            bye: false as const,
            opponent: game.opponent,
            home: game.home,
            date: game.date,
            projectedPoints: player.proj,
            source: "espn_weekly" as const,
            thisWeekMatchup: m
              ? {
                  opponent: m.opponent,
                  homeAway: m.homeAway,
                  isBye: m.isBye,
                  grade: m.grade,
                  impliedTotal: m.impliedTotal,
                  label: m.label,
                }
              : null,
          };
        }
        return {
          week: game.week,
          bye: false as const,
          opponent: game.opponent,
          home: game.home,
          date: game.date,
          baselinePoints,
          source: baselineSource,
          note: "Not an ESPN weekly fantasy projection — season PPG (or current-week proj) baseline for schedule planning only.",
        };
      });

      const games = weeks.filter((w) => !w.bye);
      const byeWeeks = weeks.filter((w) => w.bye).map((w) => w.week);
      const thisWeekRow = weeks.find((w) => w.week === fromWeek && !w.bye);
      const futureBaselines = weeks.filter(
        (w) => !w.bye && w.week !== fromWeek && "baselinePoints" in w
      ) as { baselinePoints: number }[];
      const baselineSum = Math.round(
        futureBaselines.reduce((s, w) => s + w.baselinePoints, 0) * 10
      ) / 10;

      outlooks.push({
        player: serializePlayer(player),
        currentWeek: fromWeek,
        thisWeek: {
          source: "espn_weekly" as const,
          projectedPoints: player.proj,
          seasonPpg,
          matchup:
            thisWeekRow && "thisWeekMatchup" in thisWeekRow ? thisWeekRow.thisWeekMatchup : null,
        },
        weeks,
        summary: {
          gamesInWindow: games.length,
          byeWeeks,
          thisWeekEspnProj: player.proj,
          futureWeeksBaselineSum: baselineSum,
          baselineSource,
        },
        citeHints: [
          `${player.name}: week ${fromWeek} ESPN proj ${player.proj}` +
            (seasonPpg != null ? `; season PPG ${seasonPpg}` : " (no season PPG — future baselines use this-week proj)"),
          byeWeeks.length
            ? `Bye week(s) in window: ${byeWeeks.join(", ")} → 0.`
            : "No bye in this window.",
          `Weeks after ${fromWeek}: baselinePoints are ${baselineSource.replace(/_/g, " ")}, NOT ESPN weekly projections.`,
        ],
      });
    }

    if (!outlooks.length) {
      return { ok: false, error: "no_players_resolved", notFound };
    }

    return {
      ok: true,
      season: snap.season,
      fromWeek,
      throughWeek,
      playoffWeeks: DEFAULT_PLAYOFF_WEEKS,
      disclaimer:
        "ESPN publishes a real fantasy projection only for the current scoring week. Future weeks use season PPG (preferred) or current-week proj as a labeled baseline — do not present baselinePoints as ESPN weekly projections.",
      outlooks,
      notFound: notFound.length ? notFound : undefined,
    };
  },
};
