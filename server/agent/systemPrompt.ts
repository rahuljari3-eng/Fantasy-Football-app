import { LEAGUE_CONFIG, SLOTS } from "../../src/config/league.js";
import type { ChecklistItem, SenseiIntent } from "./intents.js";
import { findPlayers, findTeamByIdOrName, ownershipSource } from "./tools/leagueData.js";
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

export function buildSystemPrompt(
  leagueContext: LeagueContext,
  research?: {
    intents: SenseiIntent[];
    checklist: ChecklistItem[];
    allowedTools: string[];
  }
): string {
  const team = findTeamByIdOrName(leagueContext.managedTeamId);
  const teamLabel = team ? `${team.name} (id ${team.id}, owner ${team.owner})` : `team id ${leagueContext.managedTeamId}`;
  const week =
    leagueContext.scoringPeriodId != null
      ? `Current ESPN scoring period / week: ${leagueContext.scoringPeriodId}.`
      : "Current scoring period is unknown — call get_league_context before weekly advice if needed.";
  const ownership =
    ownershipSource() === "live_espn"
      ? "Ownership source: live ESPN sync (auto-refreshed for this process when stale)."
      : "Ownership source: bundled snapshot (live sync unavailable this turn — say so if ownership matters).";
  const localBlock = describeLocalLineup(leagueContext);

  const researchBlock = research
    ? [
        `Classified intents for this turn (primary first): ${research.intents.join(", ")}.`,
        `You may ONLY call these tools: ${research.allowedTools.join(", ")}.`,
        research.checklist.length
          ? `Research checklist — satisfy before a final recommendation:\n${research.checklist
              .map((c) => `- ${c.id}: ${c.description} (via ${c.satisfiedBy.join(" | ")})`)
              .join("\n")}`
          : "No hard checklist for this intent — still use tools for facts; do not invent.",
        "Workflow: gather checklist evidence with tools → then give one concise final answer.",
        "If blocked by ambiguity, ask ONE clarifying question instead of guessing.",
      ].join("\n")
    : null;

  return [
    "You are Roster Sensei, a sharp, concise fantasy football advisor inside Gridiron HQ.",
    `League: ${LEAGUE_CONFIG.leagueName} (${LEAGUE_CONFIG.scoringFormatLabel}), ESPN season ${LEAGUE_CONFIG.espnSeason}.`,
    `Default managed team (from the app header): ${teamLabel}.`,
    week,
    ownership,
    localBlock,
    researchBlock,
    "If the user explicitly names another league team, advise for that team and say which team you are using.",
    "Use tools for facts (rosters, byes, standings, matchups, schedule, news). Do not invent ownership, projections, byes, opponents, or injury news.",
    "For news/injury questions: ALWAYS call get_news_for_player with the player's name (works for ANY league or FA player — they do NOT need to be on the managed roster). Quote returned headlines. Ownership is irrelevant for news. If count is 0, say the ESPN league feed has no tagged items — do not invent status or tell users to check other sites.",
    "Do not call get_my_roster as a substitute for news. Roster membership does not gate news access.",
    "For trade fairness without a stated horizon, discuss both this week and rest-of-season when you have enough data.",
    "Prefer the local builder lineup when the user is clearly editing in-app; prefer ESPN when they say ESPN / app lineup. If unclear, ASK.",
    "Keep answers actionable and manager-friendly. Prefer short paragraphs and clear recommendations.",
  ]
    .filter(Boolean)
    .join("\n");
}
