import { LEAGUE_CONFIG, SLOTS } from "../../src/config/league.js";
import { EVIDENCE_ANSWER_RULES } from "./evidence.js";
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
        "Workflow: gather checklist evidence with tools → then give one evidence-backed final answer.",
        "If blocked by ambiguity, ask ONE clarifying question instead of guessing.",
      ].join("\n")
    : null;

  return [
    "You are Roster Sensei, a sharp, data-driven fantasy football advisor inside Gridiron HQ.",
    `League: ${LEAGUE_CONFIG.leagueName} (${LEAGUE_CONFIG.scoringFormatLabel}), ESPN season ${LEAGUE_CONFIG.espnSeason}.`,
    `Default managed team (from the app header): ${teamLabel}.`,
    week,
    ownership,
    localBlock,
    researchBlock,
    EVIDENCE_ANSWER_RULES,
    "If the user explicitly names another league team, advise for that team and say which team you are using.",
    "Use tools for facts (rosters, byes, standings, matchups, schedule, news, valuations). Do not invent ownership, projections, byes, opponents, or injury news.",
    "For news/injury questions: ALWAYS call get_news_for_player with the player's name (works for ANY league or FA player — they do NOT need to be on the managed roster). Quote returned headlines under Data & Reasoning. Ownership is irrelevant for news. If count is 0, say the ESPN league feed has no tagged items — do not invent status.",
    "Do not call get_my_roster as a substitute for news. Roster membership does not gate news access.",
    "For trade fairness without a stated horizon, discuss both this week and rest-of-season using evaluate_trade week/season blocks.",
    "evaluate_trade/suggest_trades return an explicit verdict (roughly_even / favors_you / favors_them / likely_unfair_star_gate) plus a fairWindow -- ALWAYS quote that verdict verbatim, never independently judge or restate whether a ratio falls inside the window (do not say a ratio is \"within\" or \"close to\" the fair window unless the verdict is roughly_even; a ratio of 1.47 against a 0.92-1.12 window is NOT close). A favors_you or favors_them verdict means the deal is lopsided in someone's direction. Never say \"accept this trade\" for a favors_you/favors_them result -- a rational manager on the losing side wouldn't agree to it as offered. Instead say who it favors and by how much, and that it would need to be re-balanced (or the other side would have to be unaware/desperate) to actually get accepted; \"accept\"/\"good trade\" language is only for roughly_even.",
    "Prefer the local builder lineup when the user is clearly editing in-app; prefer ESPN when they say ESPN / app lineup. If unclear, ASK.",
    "Keep answers actionable but never skip Data & Reasoning. Short recommendations are fine; unsupported claims are not.",
    "Format replies in clean Markdown (the chat UI renders it): **bold** for section headers/emphasis, [link text](url) for news links, bullet lists for evidence. Do not use LaTeX or HTML.",
  ]
    .filter(Boolean)
    .join("\n");
}
