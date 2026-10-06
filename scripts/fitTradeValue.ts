// Scores the trade-value model against real accepted redraft trades
// (src/data/marketTrades.json, recorded hourly by scripts/recordMarketTrades.ts)
// and reports how the package tunables in config/trade.ts would score if
// changed -- the evidence behind EXTRA_PIECE_DISCOUNT,
// PACKAGE_REPLACEMENT_VALUE and MARKET_VALUE_EXPONENT.
//
// THE METRIC. Both managers accepted every recorded trade, so the model's
// value gap between the two sides should be small -- but "small" can't be
// judged in absolute terms, or a model that values every player the same
// would score perfectly. So each real trade's gap is compared with the gap
// in random pairings (one trade's side vs another trade's side):
//
//   score = median |gap| over real trades / median |gap| over random pairs
//
// Rescaling every value leaves it unchanged; lower = the model tells
// trades people accepted apart from arbitrary ones better. It's reported on
// all trades, each half (a stability check -- a tunable that only wins on
// one half is noise), and uneven-count trades alone (where package math
// matters most).
//
// Usage: npm run fit:trades
import { ensureLiveRosters } from "../src/lib/espnLeague.js";
import { ALL_TEAMS } from "../src/data/allTeams.js";
import { FREE_AGENTS } from "../src/data/freeAgents.js";
import { EXTRA_PIECE_DISCOUNT, PACKAGE_REPLACEMENT_VALUE } from "../src/config/trade.js";
import { allKnownPlayers } from "../server/agent/tools/leagueData.js";
import { fairnessRatio, packageValue, SEASON_PRICER } from "../src/lib/tradeEngine.js";
import { qualityScore } from "../src/lib/scoring.js";
import { resolveMarketTrades, type MarketTradeHistory, type ResolvedMarketTrade } from "../src/lib/marketTrades.js";
import type { Player } from "../src/types.js";
import HISTORY from "../src/data/marketTrades.json" with { type: "json" };

/** Only trades from roughly the last few weeks are priced against today's
 * values -- older ones reflect injuries and roles that have since changed. */
const RECENT_DAYS = 21;

const known = new Map<number, Player>();
for (const t of ALL_TEAMS) for (const p of t.roster) known.set(p.id, p);
for (const p of FREE_AGENTS) if (!known.has(p.id)) known.set(p.id, p);
await ensureLiveRosters([...known.values()]);

const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
const recent = (HISTORY as MarketTradeHistory).trades.filter((t) => Date.parse(t.date) >= cutoff);
const trades = resolveMarketTrades(recent, allKnownPlayers());
console.log(`${trades.length} priceable trades (of ${recent.length} in the last ${RECENT_DAYS} days)\n`);
if (trades.length < 30) console.warn("Fewer than 30 trades -- treat every number below as noise.\n");

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

function score(set: ResolvedMarketTrade[], side: (s: Player[]) => number): number {
  if (set.length < 2) return NaN;
  const random: [Player[], Player[]][] = [];
  for (let i = 0; i < set.length; i++) for (const k of [7, 31, 53, 89]) random.push([set[i].side1, set[(i + k) % set.length].side2]);
  const real = median(set.map((t) => Math.abs(side(t.side2) - side(t.side1))));
  const base = median(random.map(([a, b]) => Math.abs(side(b) - side(a))));
  return base > 0 ? real / base : NaN;
}

const slices: [string, ResolvedMarketTrade[]][] = [
  ["all", trades],
  ["half A", trades.filter((_, i) => i % 2 === 0)],
  ["half B", trades.filter((_, i) => i % 2 === 1)],
  ["uneven", trades.filter((t) => t.side1.length !== t.side2.length)],
];
const row = (side: (s: Player[]) => number) => slices.map(([, set]) => score(set, side).toFixed(3).padStart(7)).join("");
console.log(`${"".padEnd(28)}${slices.map(([n]) => n.padStart(7)).join("")}`);
console.log(`${"current engine".padEnd(28)}${row((s) => packageValue(s, SEASON_PRICER))}`);

// Package tunables, same player values (qualityScore).
const pkg = (floor: number, d: number) => (s: Player[]) => {
  const v = s.map(qualityScore).sort((a, b) => b - a);
  return v.length ? v[0] + v.slice(1).reduce((sum, x, i) => sum + Math.max(0, x - floor) * Math.pow(d, i + 1), 0) : 0;
};
console.log(`\npackage grid (now: discount ${EXTRA_PIECE_DISCOUNT}, floor ${PACKAGE_REPLACEMENT_VALUE})`);
for (const floor of [20, 25, 30, 40]) {
  for (const d of [0.4, 0.6, 0.75, 0.85, 0.95]) console.log(`${`  floor ${floor}, discount ${d}`.padEnd(28)}${row(pkg(floor, d))}`);
}

// How spread out accepted trades are under the engine -- for the fair
// window in config/trade.ts.
const lean = trades
  .map((t) => {
    const r = fairnessRatio(packageValue(t.side1, SEASON_PRICER), packageValue(t.side2, SEASON_PRICER));
    return Math.max(r, 1 / r);
  })
  .sort((a, b) => a - b);
console.log("\naccepted trades, how far the engine has them leaning:");
for (const q of [0.25, 0.5, 0.75, 0.9]) console.log(`  ${q * 100}th percentile: ${((lean[Math.floor(q * lean.length)] - 1) * 100).toFixed(0)}%`);
process.exit(0);
