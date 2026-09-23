// Records this week's Custom and ESPN weekly projections for every QB/RB/WR/
// TE, and fills in actual points for finished weeks, in
// src/data/projectionHistory.json -- the data behind the Build roster tab's
// "which projection is more accurate" comparison (lib/projectionAccuracy.ts).
//
// Runs on the same schedule as the snapshot sync (.github/workflows/
// sync-snapshot.yml). Each run overwrites a player's projections for the
// current week with the latest numbers UNTIL his game kicks off, then leaves
// them frozen -- so what's scored is the last projection before the game,
// not one updated mid-game.
//
// "Custom" here is computed exactly the way the app computes the number it
// shows: ESPN + Sleeper blend (lib/consensus.ts), then adjusted to
// DraftKings yardage props when posted (applyPropLines).
//
// Usage: npm run record:projections
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUE_CONFIG } from "../src/config/league.js";
import { applyPropLines, consensusFor, fetchConsensusSources } from "../src/lib/consensus.js";
import {
  extractEspnWeekActual,
  fetchEspnFreeAgentProjections,
  fetchEspnRosteredProjections,
  type EspnPlayerSnapshot,
  type EspnStatLine,
} from "../src/lib/espn.js";
import { fetchWeeklyMatchups } from "../src/lib/matchup.js";
import type { ProjectionHistory } from "../src/lib/projectionAccuracy.js";

const HISTORY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data/projectionHistory.json");
const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const ESPN_PLAYERS_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${LEAGUE_CONFIG.espnSeason}/players`;

/** Actual points in `week` for each of `ids`. Uses ESPN's season-wide player
 * card view -- the league-scoped /players route ignores the id filter and
 * only carries season totals. A player with no scoring line for a finished
 * week didn't play: 0. */
async function fetchWeekActuals(week: number, ids: number[]): Promise<Map<number, number>> {
  type KonaPlayer = { id: number; stats?: EspnStatLine[] };
  const out = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const filter = {
      filterIds: { value: chunk },
      filterStatsForTopScoringPeriodIds: { value: 17, additionalValue: [`00${LEAGUE_CONFIG.espnSeason}`] },
    };
    // scoringPeriodId=0 is what makes ESPN include every week's stat lines.
    const res = await fetch(`${ESPN_PLAYERS_URL}?view=kona_playercard&scoringPeriodId=0`, {
      headers: { Accept: "application/json", "X-Fantasy-Filter": JSON.stringify(filter) },
    });
    if (!res.ok) throw new Error(`ESPN actuals for week ${week} failed (${res.status})`);
    const data = (await res.json()) as ({ player?: KonaPlayer } | KonaPlayer)[];
    data.forEach((entry) => {
      const player: KonaPlayer | undefined = "id" in entry ? entry : entry.player;
      if (player && chunk.includes(player.id)) out.set(player.id, extractEspnWeekActual(player.stats, week) ?? 0);
    });
  }
  return out;
}

const history = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as ProjectionHistory;
if (history.season !== LEAGUE_CONFIG.espnSeason) {
  history.season = LEAGUE_CONFIG.espnSeason;
  history.weeks = {};
}

const rostered = await fetchEspnRosteredProjections();
const period = rostered.period;
const [freeAgents, sources, matchups] = await Promise.all([
  fetchEspnFreeAgentProjections(period),
  fetchConsensusSources(LEAGUE_CONFIG.espnSeason, period),
  fetchWeeklyMatchups().catch(() => null),
]);

// ESPN's free-agent view can include rostered players; first sighting wins.
const snapshots = new Map<number, EspnPlayerSnapshot>();
[...rostered.snapshots, ...freeAgents.snapshots].forEach((s) => {
  if (!snapshots.has(s.id)) snapshots.set(s.id, s);
});

const week = (history.weeks[String(period)] ??= {});
let recorded = 0;
let frozen = 0;
snapshots.forEach((snap) => {
  if (!SKILL.has(snap.pos) || snap.proj <= 0) return;
  const key = String(snap.id);
  if (snap.weekActual != null) {
    // Game has started: keep whatever was recorded before kickoff.
    if (week[key]) frozen++;
    return;
  }
  const c = consensusFor(sources, snap);
  const custom = applyPropLines(c.proj, matchups?.playerProps[snap.id], c.modelYards);
  week[key] = { espn: snap.proj, custom, actual: null };
  recorded++;
});

// Fill actual points for every finished week still missing them.
let filled = 0;
for (const [w, players] of Object.entries(history.weeks)) {
  if (Number(w) >= period) continue;
  const missing = Object.entries(players).filter(([, r]) => r.actual == null).map(([id]) => Number(id));
  if (!missing.length) continue;
  const actuals = await fetchWeekActuals(Number(w), missing);
  missing.forEach((id) => {
    const a = actuals.get(id);
    if (a != null) {
      players[String(id)].actual = a;
      filled++;
    }
  });
}

writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 1) + "\n");
console.log(`Week ${period}: recorded ${recorded} players, ${frozen} frozen at kickoff; filled ${filled} actuals for finished weeks.`);
