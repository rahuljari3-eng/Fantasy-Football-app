// Records real, accepted redraft trades from FantasyCalc's public trade feed
// in src/data/marketTrades.json -- the ground truth the trade-value model is
// scored and fit against (scripts/fitTradeValue.ts). Every trade there was
// accepted by both managers, so a well-calibrated valuation should call the
// typical one close to even.
//
// The feed only exposes the latest ~50 trades per format (about two hours'
// worth), so this runs on the hourly snapshot sync (.github/workflows/
// sync-snapshot.yml) and appends anything new. Only 1QB / PPR formats with
// 10, 12, or 14 teams are kept -- close enough to this league (12-team 1QB
// PPR) that the same package math applies.
//
// Usage: npm run record:trades
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MarketTrade, MarketTradeHistory } from "../src/lib/marketTrades.js";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/marketTrades.json");
const TEAM_COUNTS = [10, 12, 14];
/** Trades older than this are pruned -- player values move too much over a
 * season for a stale trade to say anything about today's prices. */
const KEEP_DAYS = 120;

interface FcPlayer {
  name: string;
  position: string;
  espnId?: string | null;
}
interface FcTrade {
  id: string;
  date: string;
  side1: FcPlayer[];
  side2: FcPlayer[];
}

function compactSide(side: FcPlayer[]) {
  return side.map((p) => ({ name: p.name, pos: p.position, espnId: p.espnId ? Number(p.espnId) : null }));
}

async function fetchFormat(numTeams: number): Promise<MarketTrade[]> {
  const url = `https://api.fantasycalc.com/trades?isDynasty=false&numQbs=1&numTeams=${numTeams}&ppr=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`FantasyCalc trades (${numTeams} teams) failed: ${res.status}`);
  const data = (await res.json()) as FcTrade[];
  return data.map((t) => ({ id: t.id, date: t.date, numTeams, side1: compactSide(t.side1), side2: compactSide(t.side2) }));
}

const history: MarketTradeHistory = (() => {
  try {
    return JSON.parse(readFileSync(OUT, "utf8")) as MarketTradeHistory;
  } catch {
    return { trades: [] };
  }
})();

const byId = new Map(history.trades.map((t) => [t.id, t]));
let added = 0;
for (const n of TEAM_COUNTS) {
  try {
    for (const t of await fetchFormat(n)) {
      if (byId.has(t.id)) continue;
      byId.set(t.id, t);
      added++;
    }
  } catch (err) {
    console.warn(String(err));
  }
}

const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
const trades = [...byId.values()].filter((t) => Date.parse(t.date) >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
// One trade per line, so the hourly commit diff is just the new trades.
writeFileSync(OUT, `{"trades":[\n${trades.map((t) => JSON.stringify(t)).join(",\n")}\n]}\n`);
console.log(`market trades: +${added} new, ${trades.length} kept`);
