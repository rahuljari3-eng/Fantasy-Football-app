import { REQUIRED_STARTERS } from "../../../src/config/league.js";
import { EXTRA_PIECE_DISCOUNT, FAIR_RATIO_MAX, FAIR_RATIO_MIN, LOPSIDED_RATIO_MAX, LOPSIDED_RATIO_MIN } from "../../../src/config/trade.js";
import { ROS_WEEKS, VOR_BASELINE } from "../../../src/config/scoring.js";
import { analyzeRosterNeeds } from "../../../src/lib/rosterNeeds.js";
import { fetchLeagueNewsFeed } from "../../../src/lib/news.js";
import { playerValue, qualityScore, rosValue, vorPoints } from "../../../src/lib/scoring.js";
import { fairnessRatio, needAdjustedPackageValue, packageValue, ratioIsFair, starGateOk } from "../../../src/lib/tradeEngine.js";
import type { Player, Position } from "../../../src/types.js";
import {
  findPlayers,
  freeAgentPool,
  leagueBaseline,
  needReason,
  needsSummary,
  relevantPlayerIds,
  resolveTeam,
  serializePlayer,
  teamPlayersRanked,
  withPosRanks,
} from "./leagueData.js";
import type { ToolDefinition } from "./types.js";

function packageWithValues(players: Player[], valueFn: (p: Player) => number, floor: number): number {
  const vals = players.map(valueFn).sort((a, b) => b - a);
  if (!vals.length) return 0;
  return vals.reduce((sum, v, i) => sum + (i === 0 ? v : Math.max(0, v - floor) * Math.pow(EXTRA_PIECE_DISCOUNT, i)), 0);
}

function verdictFromRatio(ratio: number, gateOk: boolean): string {
  if (!gateOk) return "likely_unfair_star_gate";
  if (ratioIsFair(ratio)) return "roughly_even";
  if (ratio > LOPSIDED_RATIO_MAX) return "favors_you";
  if (ratio < LOPSIDED_RATIO_MIN) return "favors_them";
  if (ratio > FAIR_RATIO_MAX) return "slightly_favors_you";
  if (ratio < FAIR_RATIO_MIN) return "slightly_favors_them";
  return "roughly_even";
}

function resolvePlayerList(queries: unknown): { ok: true; players: Player[] } | { ok: false; error: string; detail?: unknown } {
  if (!Array.isArray(queries) || queries.length === 0) {
    return { ok: false, error: "expected_non_empty_array" };
  }
  const players: Player[] = [];
  const missing: unknown[] = [];
  for (const q of queries) {
    if (typeof q !== "string" && typeof q !== "number") {
      missing.push(q);
      continue;
    }
    const hits = findPlayers(q, 1);
    if (!hits.length) missing.push(q);
    else players.push(hits[0]);
  }
  if (missing.length) return { ok: false, error: "player_not_found", detail: missing };
  return { ok: true, players: withPosRanks(players) };
}

let newsCache: { at: number; items: Awaited<ReturnType<typeof fetchLeagueNewsFeed>> } | null = null;
const NEWS_TTL_MS = 60_000;

async function getNewsCached() {
  if (newsCache && Date.now() - newsCache.at < NEWS_TTL_MS) return newsCache.items;
  const items = await fetchLeagueNewsFeed(relevantPlayerIds());
  newsCache = { at: Date.now(), items };
  return items;
}

export const getPlayerTool: ToolDefinition = {
  name: "get_player",
  description: "Look up a player by ESPN id or fuzzy name. Returns bye, proj, tier, status, ownership, and quality score.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Player name or ESPN id" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const query = args.query;
    if (typeof query !== "string" && typeof query !== "number") {
      return { ok: false, error: "query_required" };
    }
    const hits = findPlayers(query, 5);
    if (!hits.length) return { ok: false, error: "player_not_found", query };
    return { ok: true, matches: hits.map(serializePlayer) };
  },
};

export const analyzeRosterNeedsTool: ToolDefinition = {
  name: "analyze_roster_needs",
  description:
    "Score a team's roster position-by-position vs the league-average starter. Returns needs, strengths, starter scores, and tradeable depth.",
  parameters: {
    type: "object",
    properties: {
      teamId: { type: "number", description: "Defaults to the managed team" },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : undefined;
    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;
    const players = teamPlayersRanked(resolved.team.id);
    const needs = analyzeRosterNeeds(players);
    const baseline = leagueBaseline();
    const { needy, strength } = needsSummary(needs, baseline);

    return {
      ok: true,
      teamId: resolved.team.id,
      name: resolved.team.name,
      needyPositions: needy.map((pos) => ({
        pos,
        reason: needReason(pos, needs, baseline),
        starterScore: Math.round(needs[pos].starterScore * 10) / 10,
        leagueBaseline: Math.round(baseline[pos] * 10) / 10,
        hasEnoughBodies: needs[pos].hasEnoughBodies,
        required: REQUIRED_STARTERS[pos],
        count: needs[pos].count,
      })),
      strengthPositions: strength,
      byPosition: Object.fromEntries(
        (Object.keys(needs) as Position[]).map((pos) => [
          pos,
          {
            starterScore: Math.round(needs[pos].starterScore * 10) / 10,
            leagueBaseline: Math.round(baseline[pos] * 10) / 10,
            hasEnoughBodies: needs[pos].hasEnoughBodies,
            starters: needs[pos].starters.map((p) => ({ id: p.id, name: p.name, qScore: Math.round(p.qScore * 10) / 10 })),
            tradeableDepth: needs[pos].tradeableDepth.map((p) => ({ id: p.id, name: p.name, qScore: Math.round(p.qScore * 10) / 10 })),
          },
        ])
      ),
    };
  },
};

export const comparePlayersTool: ToolDefinition = {
  name: "compare_players",
  description:
    "Side-by-side compare 2+ players for start/sit or stash decisions. Includes week value, ROS value, VOR, bye, status, and ownership.",
  parameters: {
    type: "object",
    properties: {
      players: {
        type: "array",
        items: { type: "string" },
        description: "Player names or ESPN ids (at least 2)",
      },
    },
    required: ["players"],
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const resolved = resolvePlayerList(args.players);
    if (!resolved.ok) return resolved;
    if (resolved.players.length < 2) return { ok: false, error: "need_at_least_two_players" };

    const rows = resolved.players.map((p) => ({
      ...serializePlayer(p),
      vor: Math.round(vorPoints(p) * 10) / 10,
      weekValue: Math.round(playerValue(p) * 10) / 10,
      rosValue: Math.round(rosValue(p) * 10) / 10,
    }));

    const byWeek = [...rows].sort((a, b) => b.weekValue - a.weekValue);
    const byRos = [...rows].sort((a, b) => b.rosValue - a.rosValue);

    return {
      ok: true,
      players: rows,
      weekLeaderId: byWeek[0]?.id ?? null,
      rosLeaderId: byRos[0]?.id ?? null,
      note: "Week value is this week's trade/start metric; rosValue is rest-of-season. Prefer week for start/sit, ROS for holds/trades.",
    };
  },
};

export const evaluateTradeTool: ToolDefinition = {
  name: "evaluate_trade",
  description:
    "Grade a trade package. ALWAYS returns both this-week and rest-of-season valuations, package discount, fairness ratio, and star-gate check. Optionally need-adjusts using opponent roster.",
  parameters: {
    type: "object",
    properties: {
      give: {
        type: "array",
        items: { type: "string" },
        description: "Players you send (names or ids)",
      },
      get: {
        type: "array",
        items: { type: "string" },
        description: "Players you receive (names or ids)",
      },
      opponentTeamId: {
        type: "number",
        description: "Optional fantasy team id on the other side (enables need-adjusted values)",
      },
    },
    required: ["give", "get"],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const giveRes = resolvePlayerList(args.give);
    const getRes = resolvePlayerList(args.get);
    if (!giveRes.ok) return { ok: false, error: "give_side_invalid", detail: giveRes };
    if (!getRes.ok) return { ok: false, error: "get_side_invalid", detail: getRes };

    const give = giveRes.players;
    const get = getRes.players;
    const gateOk = starGateOk(give, get);

    const weekGive = packageValue(give);
    const weekGet = packageValue(get);
    const weekRatio = fairnessRatio(weekGive, weekGet);

    const seasonGive = packageWithValues(give, rosValue, VOR_BASELINE * ROS_WEEKS);
    const seasonGet = packageWithValues(get, rosValue, VOR_BASELINE * ROS_WEEKS);
    const seasonRatio = fairnessRatio(seasonGive, seasonGet);

    let needAdjusted: unknown = null;
    if (typeof args.opponentTeamId === "number") {
      const baseline = leagueBaseline();
      const myNeeds = analyzeRosterNeeds(teamPlayersRanked(ctx.managedTeamId));
      const theirNeeds = analyzeRosterNeeds(teamPlayersRanked(args.opponentTeamId));
      const adjGive = needAdjustedPackageValue(give, theirNeeds, baseline);
      const adjGet = needAdjustedPackageValue(get, myNeeds, baseline);
      const adjRatio = fairnessRatio(adjGive, adjGet);
      needAdjusted = {
        giveValue: Math.round(adjGive * 10) / 10,
        getValue: Math.round(adjGet * 10) / 10,
        ratio: Math.round(adjRatio * 100) / 100,
        verdict: verdictFromRatio(adjRatio, gateOk),
        note: "Scaled by each side's positional need vs league baseline (week playerValue basis).",
      };
    }

    return {
      ok: true,
      give: give.map(serializePlayer),
      get: get.map(serializePlayer),
      starGateOk: gateOk,
      week: {
        giveValue: Math.round(weekGive * 10) / 10,
        getValue: Math.round(weekGet * 10) / 10,
        ratio: Math.round(weekRatio * 100) / 100,
        verdict: verdictFromRatio(weekRatio, gateOk),
      },
      season: {
        giveValue: Math.round(seasonGive * 10) / 10,
        getValue: Math.round(seasonGet * 10) / 10,
        ratio: Math.round(seasonRatio * 100) / 100,
        verdict: verdictFromRatio(seasonRatio, gateOk),
      },
      needAdjusted,
      fairWindow: { min: FAIR_RATIO_MIN, max: FAIR_RATIO_MAX },
    };
  },
};

export const recommendPickupsTool: ToolDefinition = {
  name: "recommend_pickups",
  description:
    "Need-aware free-agent recommendations for a team. Groups top FAs at needy positions by quality score; falls back to best overall if no needs.",
  parameters: {
    type: "object",
    properties: {
      teamId: { type: "number", description: "Defaults to managed team" },
      limitPerNeed: { type: "number", description: "Top FAs per needy position (default 3)" },
    },
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const teamId = typeof args.teamId === "number" ? args.teamId : ctx.managedTeamId;
    const limitPerNeed = typeof args.limitPerNeed === "number" ? Math.min(Math.max(args.limitPerNeed, 1), 8) : 3;
    const resolved = resolveTeam(ctx, teamId);
    if (!resolved.ok) return resolved;

    const players = teamPlayersRanked(resolved.team.id);
    const needs = analyzeRosterNeeds(players);
    const baseline = leagueBaseline();
    const { needy } = needsSummary(needs, baseline);
    const fa = freeAgentPool();

    const rankedNeeds = [...needy].sort((a, b) => {
      const relA = baseline[a] ? needs[a].starterScore / baseline[a] : 0;
      const relB = baseline[b] ? needs[b].starterScore / baseline[b] : 0;
      return relA - relB;
    });

    const recommendations = rankedNeeds
      .map((pos) => ({
        pos,
        reason: needReason(pos, needs, baseline),
        candidates: fa
          .filter((p) => p.pos === pos)
          .map((p) => ({ ...serializePlayer(p), qScore: Math.round(qualityScore(p) * 10) / 10 }))
          .sort((a, b) => b.qScore - a.qScore)
          .slice(0, limitPerNeed),
      }))
      .filter((g) => g.candidates.length > 0);

    const bestOverall =
      recommendations.length === 0
        ? fa
            .map((p) => ({ ...serializePlayer(p), qScore: Math.round(qualityScore(p) * 10) / 10 }))
            .sort((a, b) => b.qScore - a.qScore)
            .slice(0, 6)
        : [];

    return {
      ok: true,
      teamId: resolved.team.id,
      name: resolved.team.name,
      needyPositions: rankedNeeds,
      recommendations,
      bestOverallFallback: bestOverall,
    };
  },
};

export const searchFreeAgentsTool: ToolDefinition = {
  name: "search_free_agents",
  description: "Browse/search the free-agent pool by position and/or name substring. Sorted by projection.",
  parameters: {
    type: "object",
    properties: {
      pos: { type: "string", description: "Optional position filter: QB/RB/WR/TE/DST/K" },
      query: { type: "string", description: "Optional name substring" },
      limit: { type: "number", description: "Max results (default 15)" },
    },
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const pos = typeof args.pos === "string" ? (args.pos.toUpperCase() as Position) : null;
    const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
    const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 40) : 15;

    let pool = freeAgentPool();
    if (pos) pool = pool.filter((p) => p.pos === pos);
    if (query) pool = pool.filter((p) => p.name.toLowerCase().includes(query));
    pool = [...pool].sort((a, b) => b.proj - a.proj).slice(0, limit);

    return { ok: true, count: pool.length, players: pool.map(serializePlayer) };
  },
};

export const getNewsFeedTool: ToolDefinition = {
  name: "get_news_feed",
  description:
    "Live ESPN news and injury reports for players in this league or the FA pool (same source as the News tab). Use for 'any news?', injury sweeps, or before start/sit when status may have changed. Newest first.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max items (default 15)" },
      type: {
        type: "string",
        enum: ["Injury", "News", "Waiver", "Trade"],
        description: "Optional filter by item type (Injury is most useful for start/sit).",
      },
    },
    additionalProperties: false,
  },
  handler: async (_ctx, args) => {
    const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 40) : 15;
    const type = typeof args.type === "string" ? args.type : null;
    let items = await getNewsCached();
    if (type) items = items.filter((i) => i.type.toLowerCase() === type.toLowerCase());
    items = items.slice(0, limit);
    return {
      ok: true,
      count: items.length,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        playerId: n.playerId,
        player: n.player,
        headline: n.headline,
        time: n.time,
        publishedAt: n.publishedAt,
        severity: n.severity ?? null,
        link: n.link,
      })),
    };
  },
};

export const getNewsForPlayerTool: ToolDefinition = {
  name: "get_news_for_player",
  description:
    "News/injury headlines for one player (name or ESPN id), from the same ESPN feed as the News tab. Use when asking about a specific player's health, role, or recent headlines.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Player name or ESPN id" },
      limit: { type: "number", description: "Max items (default 8)" },
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
    const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 20) : 8;
    const qName = player.name.toLowerCase();
    const items = (await getNewsCached())
      .filter(
        (n) =>
          n.playerId === player.id ||
          n.player.toLowerCase() === qName ||
          n.headline.toLowerCase().includes(qName)
      )
      .slice(0, limit);
    return {
      ok: true,
      player: serializePlayer(player),
      count: items.length,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        headline: n.headline,
        time: n.time,
        publishedAt: n.publishedAt,
        severity: n.severity ?? null,
        link: n.link,
      })),
    };
  },
};
