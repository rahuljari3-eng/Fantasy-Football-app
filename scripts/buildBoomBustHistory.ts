// Builds src/data/boomBustHistory.json: last season's week-by-week projected
// vs actual PPR points for every QB/RB/WR/TE in this league's player pool,
// keyed by ESPN id -- the larger sample behind each player's boom/bust rates
// (lib/boomBust.ts). This season's games come from projectionHistory.json
// instead, which the scheduled sync keeps current.
//
// Source is Sleeper: this league didn't exist on ESPN last season, so ESPN
// has no league-scored history for it, but Sleeper keeps both its pre-game
// projection and the final PPR line for every past week (this league scores
// PPR, so the points match). Only games a player was active for count.
// Games an injury knocked him out of early are flagged (lib/gameExits.ts):
// they count toward league-wide odds but not his own volatility.
//
// A one-off per season. Usage: npm run build:boombust
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUE_CONFIG } from "../src/config/league.js";
import { ALL_TEAMS } from "../src/data/allTeams.js";
import { FREE_AGENTS } from "../src/data/freeAgents.js";
import { fetchConsensusSources, nameKey } from "../src/lib/consensus.js";
import { fetchInjuryExits, isInjuryExit } from "../src/lib/gameExits.js";
import type { BoomBustHistory } from "../src/lib/boomBust.js";

const OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data/boomBustHistory.json");
const SEASON = LEAGUE_CONFIG.espnSeason - 1;
/** Fantasy regular season plus playoffs; week 18 is mostly resting starters. */
const LAST_WEEK = 17;
const POSITIONS = ["QB", "RB", "WR", "TE"];

interface SleeperRow {
  player_id: string;
  stats?: { pts_ppr?: number; gms_active?: number; off_snp?: number; tm_off_snp?: number };
  player?: { first_name?: string; last_name?: string; position?: string };
}

async function fetchRows(kind: "projections" | "stats", week: number): Promise<SleeperRow[]> {
  const qs = POSITIONS.map((p) => `position%5B%5D=${p}`).join("&");
  const res = await fetch(`https://api.sleeper.com/${kind}/nfl/${SEASON}/${week}?season_type=regular&${qs}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Sleeper ${kind} week ${week} failed (${res.status})`);
  return (await res.json()) as SleeperRow[];
}

// Sleeper id -> ESPN id: FantasyCalc's cross-reference first, then name +
// position against the league's current player pool.
const sources = await fetchConsensusSources(LEAGUE_CONFIG.espnSeason, 1);
const sleeperToEspn = new Map<string, number>();
sources.espnToSleeper.forEach((sleeperId, espnId) => sleeperToEspn.set(sleeperId, espnId));
const pool = [...ALL_TEAMS.flatMap((t) => t.roster), ...FREE_AGENTS].filter((p) => POSITIONS.includes(p.pos));
const poolIds = new Set(pool.map((p) => p.id));
const espnByName = new Map(pool.map((p) => [nameKey(p.name, p.pos), p.id]));

function espnIdFor(row: SleeperRow): number | undefined {
  const byId = sleeperToEspn.get(row.player_id);
  if (byId != null && poolIds.has(byId)) return byId;
  const { first_name: first, last_name: last, position: pos } = row.player ?? {};
  return first && last && pos ? espnByName.get(nameKey(`${first} ${last}`, pos)) : undefined;
}

const history: BoomBustHistory = { season: SEASON, source: "sleeper", games: {} };
type Game = { week: number; proj: number; actual: number; snapShare: number | null; injuredAt: number | null };
const games = new Map<number, Game[]>();
const players = pool.map((p) => ({ id: p.id, name: p.name, pos: p.pos }));
for (let week = 1; week <= LAST_WEEK; week++) {
  const [projections, stats, exits] = await Promise.all([
    fetchRows("projections", week),
    fetchRows("stats", week),
    // Teams have changed since, so names match on that game's box score only.
    fetchInjuryExits(SEASON, week, players),
  ]);
  const projected = new Map(projections.map((r) => [r.player_id, r.stats?.pts_ppr]));
  stats.forEach((row) => {
    const proj = projected.get(row.player_id);
    const actual = row.stats?.pts_ppr ?? 0;
    if (!row.stats?.gms_active || proj == null || proj <= 0) return;
    const id = espnIdFor(row);
    if (id == null) return;
    const team = row.stats.tm_off_snp;
    const list = games.get(id) ?? [];
    list.push({
      week,
      proj: Math.round(proj * 10) / 10,
      actual: Math.round(actual * 10) / 10,
      snapShare: team ? (row.stats.off_snp ?? 0) / team : null,
      injuredAt: exits.get(id) ?? null,
    });
    games.set(id, list);
  });
}

let total = 0;
let exitCount = 0;
games.forEach((list, id) => {
  const usual = list.filter((g) => g.injuredAt == null && g.snapShare != null).map((g) => g.snapShare!);
  history.games[String(id)] = list.map((g) => {
    total++;
    if (!isInjuryExit(g.injuredAt, g.snapShare, usual)) return [g.week, g.proj, g.actual];
    exitCount++;
    return [g.week, g.proj, g.actual, 1];
  });
});

// Sleeper relabels players now and then (a two-way WR filed as DB) and they
// drop out of these rows; keep the games an earlier build found for anyone
// still in the pool rather than lose them.
const prior: BoomBustHistory | null = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")) : null;
if (prior?.season === SEASON) {
  Object.entries(prior.games).forEach(([id, list]) => {
    if (history.games[id] || !poolIds.has(Number(id))) return;
    history.games[id] = list;
    total += list.length;
  });
}

writeFileSync(OUT_FILE, JSON.stringify(history) + "\n");
console.log(`${SEASON}: ${total} player-games for ${Object.keys(history.games).length} players; ${exitCount} cut short by injury.`);
