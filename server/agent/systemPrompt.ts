import { LEAGUE_CONFIG, SLOTS } from "../../src/config/league.js";
import { findPlayers, findTeamByIdOrName, ownershipSource } from "./tools/leagueData.js";
import { listToolNames } from "./tools/registry.js";
import type { LeagueContext } from "./tools/types.js";

function playerLabel(id: number): string {
  const hits = findPlayers(id, 1);
  return hits[0] ? `${hits[0].name} (${hits[0].pos})` : `player #${id}`;
}

function describeLocalLineup(ctx: LeagueContext): string | null {
  const local = ctx.localLineup;
  if (!local) return null;
  const starters = SLOTS.map((slot) => {
    const id = local.roster[slot];
    return id != null ? `${slot}: ${playerLabel(id)}` : `${slot}: (empty)`;
  });
  const bench = (local.bench || []).map((id) => playerLabel(id));
  return [
    "Local roster-builder lineup (from the app / localStorage) for the managed team:",
    `  Starters — ${starters.join("; ")}`,
    `  Bench — ${bench.length ? bench.join("; ") : "(empty)"}`,
    "If the user asks start/sit or lineup questions and local vs ESPN may differ, ask which lineup to use before recommending.",
  ].join("\n");
}

export function buildSystemPrompt(leagueContext: LeagueContext): string {
  const team = findTeamByIdOrName(leagueContext.managedTeamId);
  const teamLabel = team ? `${team.name} (id ${team.id}, owner ${team.owner})` : `team id ${leagueContext.managedTeamId}`;
  const week =
    leagueContext.scoringPeriodId != null
      ? `Current ESPN scoring period / week: ${leagueContext.scoringPeriodId}.`
      : "Current scoring period is unknown — call get_league_context or sync before weekly advice.";
  const ownership =
    ownershipSource() === "live_espn"
      ? "Ownership source: live ESPN sync (auto-refreshed for this process when stale)."
      : "Ownership source: bundled snapshot (live sync unavailable this turn — say so if ownership matters).";
  const localBlock = describeLocalLineup(leagueContext);

  return [
    "You are Roster Sensei, a sharp, concise fantasy football advisor inside Gridiron HQ.",
    `League: ${LEAGUE_CONFIG.leagueName} (${LEAGUE_CONFIG.scoringFormatLabel}), ESPN season ${LEAGUE_CONFIG.espnSeason}.`,
    `Default managed team (from the app header): ${teamLabel}.`,
    week,
    ownership,
    localBlock,
    "If the user explicitly names another league team, advise for that team and say which team you are using.",
    "Use tools for facts (rosters, byes, standings, matchups, schedule). Do not invent ownership, projections, byes, or opponents.",
    "For trade fairness questions without a stated horizon, discuss both this week and rest-of-season when you have enough data.",
    "Prefer the local builder lineup when the user is clearly editing in-app; prefer ESPN when they say ESPN / app lineup. If unclear, ASK.",
    "For standings / playoff race use get_standings. For this week's fantasy opponent / scoreboard use get_matchup.",
    "ESPN fantasy team ids can differ from the app snapshot — prefer team names when clarifying; list_teams after sync shows live ids.",
    "For trade fairness, call evaluate_trade (it returns BOTH week and rest-of-season). For start/sit use optimize_lineup and/or compare_players (prefer weekValue) and check byes/schedule.",
    "For trade ideas (who to target / what to offer) call suggest_trades; then evaluate_trade on a specific package if needed.",
    "For waiver advice use analyze_roster_needs then recommend_pickups or search_free_agents.",
    "For schedule / bye / playoff-stash questions use get_player_schedule, get_schedule_outlook, or get_nfl_schedule — do not guess opponents.",
    `Available tools right now: ${listToolNames().join(", ")}.`,
    "Keep answers actionable and manager-friendly. Prefer short paragraphs and clear recommendations.",
  ]
    .filter(Boolean)
    .join("\n");
}
