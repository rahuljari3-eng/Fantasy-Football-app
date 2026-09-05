/** Multi-intent routing for Roster Sensei's structured research loop. */

export const SENSEI_INTENTS = [
  "start_sit",
  "trades",
  "waivers",
  "news",
  "matchup",
  "schedule",
  "standings",
  "general",
] as const;

export type SenseiIntent = (typeof SENSEI_INTENTS)[number];

export interface ChecklistItem {
  id: string;
  description: string;
  /** Satisfied when any of these tools have been called this turn. */
  satisfiedBy: string[];
}

/** Always available regardless of intent. */
export const CORE_TOOLS = [
  "get_league_context",
  "get_player",
  "get_my_roster",
  "list_teams",
  "sync_rosters",
] as const;

const INTENT_TOOLS: Record<SenseiIntent, string[]> = {
  start_sit: [
    "optimize_lineup",
    "compare_players",
    "get_bye_calendar",
    "get_player_schedule",
    "get_schedule_outlook",
    "get_news_for_player",
  ],
  trades: [
    "suggest_trades",
    "evaluate_trade",
    "analyze_roster_needs",
    "compare_players",
    "get_standings",
  ],
  waivers: [
    "analyze_roster_needs",
    "recommend_pickups",
    "search_free_agents",
    "get_news_feed",
    "get_news_for_player",
  ],
  news: ["get_news_feed", "get_news_for_player", "get_player"],
  matchup: ["get_matchup", "get_standings", "get_player_schedule", "get_bye_calendar"],
  schedule: [
    "get_nfl_schedule",
    "get_player_schedule",
    "get_schedule_outlook",
    "get_playoff_weeks",
    "get_bye_calendar",
  ],
  standings: ["get_standings", "get_matchup"],
  general: [], // means "all tools" — handled in merge
};

const INTENT_CHECKLISTS: Record<SenseiIntent, ChecklistItem[]> = {
  start_sit: [
    {
      id: "lineup_or_compare",
      description: "Optimize or compare candidates for the start/sit decision",
      satisfiedBy: ["optimize_lineup", "compare_players"],
    },
    {
      id: "bye_or_schedule",
      description: "Check bye weeks and/or upcoming opponents",
      satisfiedBy: ["get_bye_calendar", "get_player_schedule", "get_schedule_outlook"],
    },
  ],
  trades: [
    {
      id: "trade_packages",
      description: "Propose packages and/or grade a specific trade",
      satisfiedBy: ["suggest_trades", "evaluate_trade"],
    },
    {
      id: "needs_context",
      description: "Understand roster needs before trading",
      satisfiedBy: ["analyze_roster_needs", "get_my_roster"],
    },
  ],
  waivers: [
    {
      id: "needs",
      description: "Identify roster needs",
      satisfiedBy: ["analyze_roster_needs"],
    },
    {
      id: "fa_pool",
      description: "Inspect free-agent / pickup options",
      satisfiedBy: ["recommend_pickups", "search_free_agents"],
    },
  ],
  news: [
    {
      id: "news_lookup",
      description: "Pull live news/injury items",
      satisfiedBy: ["get_news_feed", "get_news_for_player"],
    },
  ],
  matchup: [
    {
      id: "fantasy_matchup",
      description: "Load this week's fantasy matchup / scoreboard",
      satisfiedBy: ["get_matchup"],
    },
  ],
  schedule: [
    {
      id: "schedule_data",
      description: "Load NFL schedule / outlook / byes",
      satisfiedBy: [
        "get_nfl_schedule",
        "get_player_schedule",
        "get_schedule_outlook",
        "get_bye_calendar",
        "get_playoff_weeks",
      ],
    },
  ],
  standings: [
    {
      id: "standings_table",
      description: "Load live standings",
      satisfiedBy: ["get_standings"],
    },
  ],
  general: [],
};

const MAX_INTENTS = 3;

export function isSenseiIntent(value: unknown): value is SenseiIntent {
  return typeof value === "string" && (SENSEI_INTENTS as readonly string[]).includes(value);
}

export function normalizeIntents(raw: unknown): SenseiIntent[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SenseiIntent[] = [];
  for (const item of list) {
    if (!isSenseiIntent(item)) continue;
    if (out.includes(item)) continue;
    out.push(item);
    if (out.length >= MAX_INTENTS) break;
  }
  return out.length ? out : ["general"];
}

/** Union tool allowlists. `general` alone (or present) opens the full registry. */
export function toolsForIntents(intents: SenseiIntent[], allToolNames: string[]): string[] {
  if (intents.includes("general") && intents.length === 1) return [...allToolNames];
  if (intents.includes("general")) {
    // general + specifics → still prefer union of specifics + core, not literally everything,
    // unless ONLY general. When combined, expand to all for safety.
    return [...allToolNames];
  }

  const set = new Set<string>(CORE_TOOLS);
  for (const intent of intents) {
    for (const name of INTENT_TOOLS[intent]) set.add(name);
  }

  // News-only asks: don't tempt the model into get_my_roster (it then invents
  // "not on your roster so I can't help" and skips the news feed).
  const needsRoster =
    intents.includes("start_sit") || intents.includes("trades") || intents.includes("waivers");
  if (intents[0] === "news" && !needsRoster) {
    set.delete("get_my_roster");
    set.delete("list_teams");
  }

  // Keep only tools that actually exist.
  return allToolNames.filter((n) => set.has(n));
}

/** Union checklists; primary intent's items first. Dedupes by checklist id. */
export function checklistForIntents(intents: SenseiIntent[]): ChecklistItem[] {
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const intent of intents) {
    for (const item of INTENT_CHECKLISTS[intent]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export function missingChecklistItems(
  checklist: ChecklistItem[],
  toolsUsed: string[]
): ChecklistItem[] {
  const used = new Set(toolsUsed);
  return checklist.filter((item) => !item.satisfiedBy.some((t) => used.has(t)));
}

export function looksLikeClarifyingQuestion(text: string): boolean {
  const t = text.trim();
  if (!t.includes("?")) return false;
  const qCount = (t.match(/\?/g) ?? []).length;
  return t.length < 450 && qCount <= 3;
}

/** Cheap keyword boost so obvious asks don't get misclassified as `general`. */
export function heuristicIntents(message: string): SenseiIntent[] {
  const m = message.toLowerCase();
  const out: SenseiIntent[] = [];
  if (
    /\b(news|headline|injury|injuries|injured|hurt|questionable|doubtful|hamstring|groin|ankle|knee|concussion|pup|ir\b|limited practice|full practice)\b/.test(
      m
    ) ||
    /\b(latest|update|updates|status|word on|what's going on with|whats going on with|how is|how'?s)\b/.test(m)
  ) {
    out.push("news");
  }
  if (/\b(start|sit|flex|lineup|bench)\b/.test(m)) out.push("start_sit");
  if (/\b(trade|trades|package|offer)\b/.test(m)) out.push("trades");
  if (/\b(waiver|waivers|pickup|pickups|free agent|add\/drop|add or drop)\b/.test(m)) out.push("waivers");
  if (/\b(matchup|who am i playing|scoreboard|opponent this week)\b/.test(m)) out.push("matchup");
  if (/\b(schedule|bye|playoff weeks|ros schedule|upcoming opponents)\b/.test(m)) out.push("schedule");
  if (/\b(standing|standings|playoff race|record)\b/.test(m)) out.push("standings");
  return out;
}

/** Merge classifier + heuristics; heuristics win over a lone `general`. */
export function mergeIntents(classified: SenseiIntent[], heuristic: SenseiIntent[]): SenseiIntent[] {
  let merged = [...classified];
  for (const h of heuristic) {
    if (!merged.includes(h)) merged = [h, ...merged];
  }
  if (heuristic.length && merged.includes("general")) {
    merged = merged.filter((i) => i !== "general");
  }
  return normalizeIntents(merged);
}
