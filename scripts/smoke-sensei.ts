// Smoke test for Roster Sensei's tools: calls every tool once with realistic
// arguments against the live league and fails if any of them CRASHES.
//
// A tool returning its own error code (e.g. { ok: false, error:
// "team_not_found" }) is fine -- that's an answer. What this catches is a
// thrown exception, which executeTool turns into { ok: false, error:
// "<exception message>" } -- e.g. "Cannot read properties of undefined
// (reading 'value')", which is exactly how evaluate_trade and friends shipped
// broken for a while without anyone noticing.
//
// Usage: npm run smoke:sensei   (needs network: ESPN, Sleeper, FantasyCalc)
import { DEFAULT_TEAM_ID, ALL_TEAMS } from "../src/data/allTeams.js";
import { executeTool, toolNames } from "../server/agent/tools/registry.js";
import type { ToolContext } from "../server/agent/tools/types.js";

const ctx: ToolContext = { managedTeamId: DEFAULT_TEAM_ID };
const myTeam = ALL_TEAMS.find((t) => t.id === DEFAULT_TEAM_ID)!;
const opponent = ALL_TEAMS.find((t) => t.id !== DEFAULT_TEAM_ID)!;
const byValue = (roster: typeof myTeam.roster) => [...roster].filter((p) => p.pos !== "K" && p.pos !== "DST").sort((a, b) => b.proj - a.proj);
const mine = byValue(myTeam.roster);
const theirs = byValue(opponent.roster);

// Arguments for tools whose required args can't be empty. Everything else
// is called with {} (defaults to the managed team / current week).
const ARGS: Record<string, Record<string, unknown>> = {
  get_player: { query: mine[0].name },
  compare_players: { players: [mine[0].name, theirs[0].name] },
  evaluate_trade: { give: [mine[1].name], get: [theirs[1].name], opponentTeamId: opponent.id },
  what_would_it_take: { target: theirs[0].name },
  get_news_for_player: { query: mine[0].name },
  get_player_schedule: { query: mine[0].name },
  get_player_performance: { query: mine[0].name },
  get_player_projection_outlook: { query: mine[0].name },
  get_schedule_outlook: { players: [mine[0].name] },
  get_situational_briefing: { targetWeek: 11 },
  suggest_trades: { max: 3, coverByeWeek: 11, urgency: "must_win" },
};

// Tool-defined error codes are snake_case; anything else came from a throw.
const isCrash = (result: unknown): string | null => {
  if (!result || typeof result !== "object") return null;
  const r = result as { ok?: boolean; error?: unknown };
  if (r.ok !== false || typeof r.error !== "string") return null;
  return /^[a-z0-9_]+$/.test(r.error) ? null : r.error;
};

const names = toolNames();
let failures = 0;
for (const name of names) {
  const started = Date.now();
  const { result } = await executeTool(name, JSON.stringify(ARGS[name] ?? {}), ctx);
  const crash = isCrash(result);
  const ms = Date.now() - started;
  if (crash) {
    failures++;
    console.log(`FAIL ${name} (${ms}ms): ${crash}`);
  } else {
    const r = result as { ok?: boolean; error?: string };
    console.log(`ok   ${name} (${ms}ms)${r?.ok === false ? ` -- returned ${r.error}` : ""}`);
  }
}

console.log(`\n${names.length - failures}/${names.length} tools ran without crashing.`);
process.exit(failures ? 1 : 0);
