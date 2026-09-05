import { SLOTS } from "../../../src/config/league.js";
import { VOR_BASELINE } from "../../../src/config/scoring.js";
import { suggestTrades } from "../../../src/lib/coachTrades.js";
import { fetchWeeklyMatchups, gradeMatchup } from "../../../src/lib/matchup.js";
import { optimizeLineup } from "../../../src/lib/optimizeLineup.js";
import { playerValue, qualityScore } from "../../../src/lib/scoring.js";
import type { Player, RosterPlayer, TradeSuggestion } from "../../../src/types.js";
import {
  activeTeams,
  allKnownPlayers,
  findPlayers,
  freeAgentPool,
  resolveTeam,
  teamPlayersRanked,
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
  // findPlayers() already returns each player carrying his true league-wide
  // posRank -- re-ranking this small local-lineup subset would collapse
  // everyone toward rank 1 and corrupt playerValue's scarcity premium.
  return players;
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
    weekValue: Math.round(playerValue(p) * 10) / 10,
    qualityScore: Math.round(qualityScore(p) * 10) / 10,
  };
}

// coachTrades.ts's "fallback" tier exists to guarantee the Coach TAB always
// has *something* to display -- it's an intentional closest-value-match
// lateral swap (ratio pinned near 1 by construction), not a real upgrade.
// Surfacing that in a chat as if it were "a trade to make" reads as
// nonsensical advice (e.g. two barely-rosterable bench players swapped for
// literally no gain). A minimum real-value floor also weeds out suggestions
// where even the "better" side is near-replacement-level -- fair or not, a
// trade nobody would actually want to make isn't useful advice.
const MIN_RELEVANT_PLAYER_VALUE = VOR_BASELINE * 1.15;
const MIN_MEANINGFUL_UPGRADE = 3;

function isMeaningfulSuggestion(s: TradeSuggestion): boolean {
  if (s.reason === "fallback") return false;
  if (Math.abs(s.upgrade) < MIN_MEANINGFUL_UPGRADE) return false;
  return [...s.give, ...s.get].some((p) => playerValue(p) >= MIN_RELEVANT_PLAYER_VALUE);
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
      // Both sides already carry their true league-wide posRank (via
      // teamPlayersRanked / freeAgentPool) -- concatenate, don't re-rank.
      players = [...players, ...freeAgentPool().filter((p) => !seen.has(p.id))];
    }

    const result = optimizeLineup(players, {
      byeWeek: ctx.scoringPeriodId,
      excludeOut: true,
    });

    const byId = new Map(players.map((p) => [p.id, p]));

    let matchups = null as Awaited<ReturnType<typeof fetchWeeklyMatchups>> | null;
    try {
      matchups = await fetchWeeklyMatchups();
    } catch {
      matchups = null;
    }

    const starters = SLOTS.map((slot) => {
      const id = result.roster[slot];
      const p = id != null ? byId.get(id) : undefined;
      const m = p && matchups ? gradeMatchup(p, matchups) : null;
      return {
        slot,
        playerId: id ?? null,
        name: p?.name ?? null,
        pos: p?.pos ?? null,
        proj: p?.proj ?? null,
        weekValue: p ? Math.round(playerValue(p) * 10) / 10 : null,
        bye: p?.bye ?? null,
        status: p?.status ?? null,
        thisWeekMatchup: m
          ? { opponent: m.opponent, homeAway: m.homeAway, isBye: m.isBye, grade: m.grade, label: m.label }
          : null,
      };
    });

    const flexSlot = starters.find((s) => s.slot === "FLEX");

    const citeHints = [
      `Projected starter total: ${result.projectedTotal} (pool=${pool}, source=${poolSource}, week=${ctx.scoringPeriodId ?? "?"}).`,
      ...starters
        .filter((s) => s.name)
        .map((s) => {
          const m = s.thisWeekMatchup?.label ? ` | ${s.thisWeekMatchup.label}` : "";
          return `${s.slot}: ${s.name} proj ${s.proj} weekValue ${s.weekValue} status ${s.status}${m}`;
        }),
    ];
    if (flexSlot?.name) {
      citeHints.push(`FLEX locked as ${flexSlot.name} on projection; cite proj/weekValue vs any named bench challenger.`);
    }
    if (result.excluded.length) {
      citeHints.push(
        `Excluded from pool: ${result.excluded
          .slice(0, 5)
          .map((e) => `${e.name} (${e.reason})`)
          .join("; ")}.`
      );
    }

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
      citeHints,
      note:
        poolSource === "local_lineup"
          ? "Optimized from the client's local builder lineup. Quote projectedTotal and per-slot proj. If the user meant ESPN instead, ask and re-run with useLocalLineup=false."
          : "Optimized from ESPN/live roster. Quote projectedTotal and per-slot proj. If the user meant their local builder lineup, ask and re-run with useLocalLineup=true.",
    };
  },
};

export const suggestTradesTool: ToolDefinition = {
  name: "suggest_trades",
  description:
    "Propose fair, WORTHWHILE coach-style trade packages for a team (need-based + value-based, 1-for-1 and 2-for-2). Already filtered to a real upgrade -- never pads the list with lateral same-value swaps or scrub-for-scrub trades just to hit a count, so it can return fewer than requested (even zero) when nothing meaningful is available. Use when the user asks what trades to make or who to target.",
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

    // Rank every player against the FULL league pool, not just the roster
    // they happen to sit on -- playerValue() leans heavily (55%) on
    // positional rank, so ranking someone only within their own ~16-man
    // roster can turn a true RB25 into a fake "RB2" and badly distort every
    // fairness ratio below. See teamPlayersRanked's own comment for why.
    const globalById = new Map(allKnownPlayers().map((p) => [p.id, p]));
    const rankGlobally = (roster: RosterPlayer[]): RosterPlayer[] =>
      roster.map((p) => (globalById.get(p.id) as RosterPlayer | undefined) ?? p);

    const opponents = activeTeams()
      .filter((t) => t.id !== team.id)
      .map((t) => ({ ...t, roster: rankGlobally(t.roster) }));
    // Prefer local builder pool for managed team when available.
    const managed = resolveTeam(ctx);
    const advisingManaged = managed.ok && managed.team.id === team.id;
    let myPlayers = teamPlayersRanked(team.id);
    if (advisingManaged && ctx.localLineup) {
      const localPlayers = localPoolPlayers(ctx);
      if (localPlayers?.length) myPlayers = localPlayers;
    }

    // Ask the engine for a wider pool than requested -- we're about to drop
    // the trivial/fallback ones below, so we need headroom to still land on
    // `max` genuinely worthwhile suggestions.
    const { suggestions: rawSuggestions, needyPositions, strengthPositions } = suggestTrades({
      myPlayers,
      leagueTeams: opponents,
      max: Math.max(max * 3, 12),
    });

    const meaningful = rawSuggestions.filter(isMeaningfulSuggestion);
    const usedFallback = meaningful.length === 0 && rawSuggestions.length > 0;
    const suggestions = (meaningful.length > 0 ? meaningful : rawSuggestions).slice(0, max);

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
      citeHints: [
        `Needs: ${needyPositions.join(", ") || "none"}; strengths: ${strengthPositions.join(", ") || "none"}.`,
        ...(suggestions.length === 0
          ? ["No trade package clears a meaningful upgrade bar right now -- say so plainly, do not invent one."]
          : []),
        ...(usedFallback
          ? [
              "Every option below is a lateral, closest-value-match swap (no real upgrade) -- there was nothing better available. Say so explicitly rather than presenting these as good trades.",
            ]
          : []),
        ...suggestions.slice(0, 3).map((s) => {
          const give = s.give.map((p) => p.name).join(" + ");
          const get = s.get.map((p) => p.name).join(" + ");
          return `vs ${s.teamName}: give ${give} (${Math.round(s.giveVal * 10) / 10}) for ${get} (${Math.round(s.getVal * 10) / 10}), ratio ${Math.round(s.ratio * 100) / 100}, upgrade ${Math.round(s.upgrade * 10) / 10}. Reason: ${s.reason}`;
        }),
      ],
      note: "Values use the same coach/trade engine as the AI Coach tab (week VOR + need adjustment) -- quote giveVal/getVal/ratio EXACTLY as given, do not recompute them from raw proj or per-player weekValue sums (package values are discounted/need-adjusted, not a plain sum). Already filtered to a meaningful upgrade bar and a minimum relevant-player-value floor -- do not add back lateral or scrub-for-scrub swaps yourself. For a specific package grade, call evaluate_trade.",
    };
  },
};
