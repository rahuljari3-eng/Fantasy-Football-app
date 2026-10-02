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
// DraftKings yardage props when posted (applyPropLines). Each record also
// keeps the inputs that number was built from -- position, Sleeper's
// projection, the props' yardage swing -- so scripts/fitProjections.ts can
// refit the blend from results (lib/projectionModel.ts). Records from before
// the inputs were kept get them filled in from that week's sources.
//
// Past weeks with no record at all (the season's weeks before recording
// began) are backfilled from ESPN's stored projections for that week's
// rostered players, Sleeper's projections, and the closing props. Free agents
// aren't covered there: ESPN only serves the free-agent pool for the current
// week.
//
// Also records each week's Vegas points (lib/bettingValue.ts) in
// src/data/vegasHistory.json -- frozen at kickoff the same way, and
// backfilled from closing lines for any past week missing -- and writes the
// season averages to src/data/vegasValues.ts for the player valuation.
//
// Also freezes each player's boom/bust odds (lib/boomBust.ts) at kickoff in
// the same projectionHistory.json records, for the boom/bust track record.
//
// Usage: npm run record:projections
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESPN_LEAGUE_BASE_URL, LEAGUE_CONFIG } from "../src/config/league.js";
import {
  applyPropLines,
  consensusFor,
  fetchConsensusSources,
  propPointsDelta,
  propYardsDelta,
  sleeperKeyFor,
  type ConsensusSources,
} from "../src/lib/consensus.js";
import { vegasSeasonValues, vegasWeek, type VegasHistory, type VegasWeekInput } from "../src/lib/bettingValue.js";
import { ALL_TEAMS } from "../src/data/allTeams.js";
import { FREE_AGENTS } from "../src/data/freeAgents.js";
import {
  ESPN_POS,
  extractEspnWeekActual,
  extractEspnWeekPlayed,
  fetchEspnFreeAgentProjections,
  fetchEspnRosteredProjections,
  type EspnPlayerSnapshot,
  type EspnStatLine,
} from "../src/lib/espn.js";
import { fetchWeeklyMatchups, type WeeklyMatchups } from "../src/lib/matchup.js";
import type { ProjectionHistory, ProjectionRecord } from "../src/lib/projectionAccuracy.js";
import { weeklyBoomBust } from "../src/lib/boomBust.js";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data");
const HISTORY_FILE = path.join(DATA_DIR, "projectionHistory.json");
const VEGAS_HISTORY_FILE = path.join(DATA_DIR, "vegasHistory.json");
const VEGAS_VALUES_FILE = path.join(DATA_DIR, "vegasValues.ts");
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

/** Actual points in `week` for each of `ids`, in this league's scoring,
 * and whether he got into the game. Primary source is that week's league
 * rosters (mRoster with scoringPeriodId=week), which carry each rostered
 * player's real line for the week: a rostered player with no line didn't
 * play, so 0 and not played. Free agents come from the league's player cards
 * (kona_playercard, filtered to their ids), which carry every week's line in
 * league scoring -- unlike the /players pool, which only serves the current
 * week. Only an actual line for `week` is used, never read as 0; anyone
 * neither source covers is left out, so the next run retries him rather than
 * recording a 0. */
async function fetchWeekActuals(week: number, ids: number[]): Promise<Map<number, { actual: number; played: boolean }>> {
  const wanted = new Set(ids);
  const out = new Map<number, { actual: number; played: boolean }>();
  const rosters = await fetchEspnRosteredProjections(week);
  rosters.snapshots.forEach((s) => {
    if (wanted.has(s.id)) out.set(s.id, { actual: s.weekActual ?? 0, played: s.weekPlayed === true });
  });
  if (out.size === wanted.size) return out;

  type KonaPlayer = { id: number; stats?: EspnStatLine[] };
  const remaining = ids.filter((id) => !out.has(id));
  const season = String(LEAGUE_CONFIG.espnSeason);
  const filter = {
    players: {
      filterIds: { value: remaining },
      filterStatsForTopScoringPeriodIds: { value: 17, additionalValue: [`00${season}`, `10${season}`] },
    },
  };
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=kona_playercard&scoringPeriodId=${week}`, {
    headers: { Accept: "application/json", "x-fantasy-filter": JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error(`ESPN actuals for week ${week} failed (${res.status})`);
  // Entries wrap the player ({ id, player: { ...stats } }); the stats are on
  // the inner player, so prefer it over the wrapper's own id.
  const data = ((await res.json()) as { players?: ({ player?: KonaPlayer } & Partial<KonaPlayer>)[] }).players ?? [];
  data.forEach((entry) => {
    const player = entry.player ?? (entry.id != null ? (entry as KonaPlayer) : undefined);
    if (!player || !wanted.has(player.id) || out.has(player.id)) return;
    const actual = extractEspnWeekActual(player.stats, week);
    if (actual != null) out.set(player.id, { actual, played: extractEspnWeekPlayed(player.stats, week) === true });
  });
  return out;
}

type PlayerProps = WeeklyMatchups["playerProps"] | undefined;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The inputs the custom projection is built from (lib/projectionModel.ts). */
function projectionInputs(src: ConsensusSources, props: PlayerProps, snap: Pick<EspnPlayerSnapshot, "id" | "name" | "pos">) {
  const key = sleeperKeyFor(src, snap.id, snap.name, snap.pos);
  const sleeperWeek = key ? src.sleeperWeek.get(key) : undefined;
  const prop = propYardsDelta(props?.[snap.id], sleeperWeek);
  return {
    pos: snap.pos,
    ...(sleeperWeek?.pts != null ? { sleeper: round2(sleeperWeek.pts) } : {}),
    ...(prop != null ? { prop: round2(prop) } : {}),
  };
}

/** One player's record for a week: both projections and their inputs. */
function projectionRecord(src: ConsensusSources, props: PlayerProps, snap: EspnPlayerSnapshot): { record: ProjectionRecord; seasonProj: number | null } {
  const c = consensusFor(src, snap);
  const custom = applyPropLines(c.proj, props?.[snap.id], c.modelYards);
  return {
    // Overwritten every run until kickoff, so this ends up as his designation
    // going into the game (empty for a backfilled week: his status now isn't
    // his status then).
    record: { espn: snap.proj, custom, actual: null, ...(snap.status ? { status: snap.status } : {}), ...projectionInputs(src, props, snap) },
    seasonProj: c.seasonProj ?? null,
  };
}

/** Name and position for players by id, from the league's player cards --
 * for records of players on no roster this run can see. */
async function fetchPlayerIdentities(ids: number[]): Promise<Map<number, { name: string; pos: EspnPlayerSnapshot["pos"] }>> {
  const out = new Map<number, { name: string; pos: EspnPlayerSnapshot["pos"] }>();
  if (!ids.length) return out;
  const filter = { players: { filterIds: { value: ids } } };
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=kona_playercard`, {
    headers: { Accept: "application/json", "x-fantasy-filter": JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error(`ESPN player cards failed (${res.status})`);
  type Card = { id: number; fullName?: string; defaultPositionId?: number };
  const data = ((await res.json()) as { players?: ({ player?: Card } & Partial<Card>)[] }).players ?? [];
  data.forEach((entry) => {
    const p = entry.player ?? (entry.id != null ? (entry as Card) : undefined);
    const pos = p ? ESPN_POS[p.defaultPositionId ?? -1] : undefined;
    if (p && pos) out.set(p.id, { name: p.fullName ?? "", pos });
  });
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
// Players re-recorded this run, for their boom/bust odds once this week's
// Vegas inputs are known (below).
const pendingBoomBust: { snap: EspnPlayerSnapshot; seasonProj: number | null }[] = [];
let recorded = 0;
let frozen = 0;
snapshots.forEach((snap) => {
  if (!SKILL.has(snap.pos)) return;
  const key = String(snap.id);
  if (snap.weekActual != null) {
    // Game has started: keep whatever was recorded before kickoff, and note
    // his designation the first time we see him after it (see gameStatus).
    if (week[key]) {
      frozen++;
      if (week[key].gameStatus == null && snap.status) week[key].gameStatus = snap.status;
    }
    return;
  }
  const { record, seasonProj } = projectionRecord(sources, matchups?.playerProps, snap);
  if (snap.proj <= 0 && record.custom <= 0) {
    // Ruled out (or bye): nobody projects him, so don't start a record --
    // but zero one recorded earlier in the week, or the stale pre-injury
    // projection is what gets frozen at kickoff.
    if (week[key]) {
      week[key] = record;
      recorded++;
    }
    return;
  }
  week[key] = record;
  pendingBoomBust.push({ snap, seasonProj });
  recorded++;
});

// Past weeks with nothing recorded: backfill from that week's rosters.
for (let w = 1; w < period; w++) {
  if (Object.keys(history.weeks[String(w)] ?? {}).length) continue;
  try {
    const [past, pastSources, pastLines] = await Promise.all([
      fetchEspnRosteredProjections(w),
      fetchConsensusSources(LEAGUE_CONFIG.espnSeason, w),
      fetchWeeklyMatchups({ week: w, season: LEAGUE_CONFIG.espnSeason }).catch(() => null),
    ]);
    const records: ProjectionHistory["weeks"][string] = {};
    past.snapshots.forEach((snap) => {
      if (!SKILL.has(snap.pos) || snap.proj <= 0) return;
      // His status now isn't his status that week; ESPN's 0 already covers it.
      records[String(snap.id)] = projectionRecord(pastSources, pastLines?.playerProps, { ...snap, status: "" }).record;
    });
    history.weeks[String(w)] = records;
    console.log(`Backfilled week ${w} projections (${Object.keys(records).length} players).`);
  } catch (err) {
    console.warn(`Couldn't backfill week ${w} projections:`, err instanceof Error ? err.message : err);
  }
}

// Records from before the inputs were kept (frozen at kickoff, or past weeks):
// fill in position, Sleeper's projection and the props' swing from that
// week's sources. The recorded projections themselves are left as they were.
for (const [w, players] of Object.entries(history.weeks)) {
  const missing = Object.keys(players).filter((id) => players[id].pos == null).map(Number);
  if (!missing.length) continue;
  try {
    const wk = Number(w);
    const [weekRosters, weekSources, weekLines] = await Promise.all([
      wk === period ? Promise.resolve(rostered) : fetchEspnRosteredProjections(wk),
      wk === period ? Promise.resolve(sources) : fetchConsensusSources(LEAGUE_CONFIG.espnSeason, wk),
      wk === period ? Promise.resolve(matchups) : fetchWeeklyMatchups({ week: wk, season: LEAGUE_CONFIG.espnSeason }).catch(() => null),
    ]);
    const known = new Map<number, { name: string; pos: EspnPlayerSnapshot["pos"] }>();
    [...weekRosters.snapshots, ...snapshots.values()].forEach((s) => known.set(s.id, s));
    const unknown = missing.filter((id) => !known.has(id));
    (await fetchPlayerIdentities(unknown)).forEach((v, id) => known.set(id, v));
    let n = 0;
    missing.forEach((id) => {
      const who = known.get(id);
      if (!who) return;
      Object.assign(players[String(id)], projectionInputs(weekSources, weekLines?.playerProps, { id, ...who }));
      n++;
    });
    console.log(`Filled projection inputs for ${n}/${missing.length} week ${w} records.`);
  } catch (err) {
    console.warn(`Couldn't fill week ${w} projection inputs:`, err instanceof Error ? err.message : err);
  }
}

// Fill actual points for every finished week still missing them -- and,
// for a 0, whether he played at all (records graded before that was kept
// get checked once too). A DNP stays recorded as 0 but is flagged so it
// isn't graded as a game (isPlayedGame in lib/projectionAccuracy.ts).
let filled = 0;
for (const [w, players] of Object.entries(history.weeks)) {
  if (Number(w) >= period) continue;
  const missing = Object.entries(players)
    .filter(([, r]) => r.actual == null || (r.actual === 0 && r.dnp == null))
    .map(([id]) => Number(id));
  if (!missing.length) continue;
  const actuals = await fetchWeekActuals(Number(w), missing);
  missing.forEach((id) => {
    const a = actuals.get(id);
    if (a == null) return;
    const record = players[String(id)];
    record.actual = a.actual;
    if (a.actual === 0) record.dnp = !a.played;
    else delete record.dnp;
    filled++;
  });
}

writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 1) + "\n");
console.log(`Week ${period}: recorded ${recorded} players, ${frozen} frozen at kickoff; filled ${filled} actuals for finished weeks.`);

// ---------- Vegas values ----------
const vegasHistory = JSON.parse(readFileSync(VEGAS_HISTORY_FILE, "utf8")) as VegasHistory;
if (vegasHistory.season !== LEAGUE_CONFIG.espnSeason) {
  vegasHistory.season = LEAGUE_CONFIG.espnSeason;
  vegasHistory.weeks = {};
}
// NFL team per player, from the synced roster files, to find his game's
// implied total.
const nflTeam = new Map<number, string>();
[...ALL_TEAMS.flatMap((t) => t.roster), ...FREE_AGENTS].forEach((p) => nflTeam.set(p.id, p.team));

function vegasInputs(src: ConsensusSources, lines: WeeklyMatchups, players: EspnPlayerSnapshot[]): VegasWeekInput[] {
  const inputs: VegasWeekInput[] = [];
  players.forEach((snap) => {
    if (!SKILL.has(snap.pos)) return;
    const key = sleeperKeyFor(src, snap.id, snap.name, snap.pos);
    const model = key ? src.sleeperWeek.get(key) : undefined;
    if (!model) return;
    const team = nflTeam.get(snap.id);
    const implied = team ? lines.teams[team]?.impliedTeamTotal : null;
    inputs.push({ id: snap.id, pos: snap.pos, base: model.pts, delta: propPointsDelta(lines.playerProps[snap.id], model), ...(implied != null ? { implied } : {}) });
  });
  return inputs;
}

// This week: re-record everyone whose game hasn't kicked off; keep the rest.
if (matchups) {
  const current = vegasWeek(vegasInputs(sources, matchups, [...snapshots.values()]));
  const kept = vegasHistory.weeks[String(period)] ?? {};
  const next: Record<string, (typeof kept)[string]> = {};
  snapshots.forEach((snap) => {
    const key = String(snap.id);
    const record = snap.weekActual != null ? kept[key] : current[key];
    if (record) next[key] = record;
  });
  vegasHistory.weeks[String(period)] = next;
}

// Past weeks with nothing recorded: backfill from closing lines.
for (let w = 1; w < period; w++) {
  if (Object.keys(vegasHistory.weeks[String(w)] ?? {}).length) continue;
  try {
    const [pastSources, pastLines] = await Promise.all([
      fetchConsensusSources(LEAGUE_CONFIG.espnSeason, w),
      fetchWeeklyMatchups({ week: w, season: LEAGUE_CONFIG.espnSeason }),
    ]);
    vegasHistory.weeks[String(w)] = vegasWeek(vegasInputs(pastSources, pastLines, [...snapshots.values()]));
    console.log(`Vegas: backfilled week ${w} (${Object.keys(vegasHistory.weeks[String(w)]).length} players).`);
  } catch (err) {
    console.warn(`Vegas: couldn't backfill week ${w}:`, err instanceof Error ? err.message : err);
  }
}

writeFileSync(VEGAS_HISTORY_FILE, JSON.stringify(vegasHistory, null, 1) + "\n");

// ---------- Boom/bust odds ----------
// The odds the app shows (lib/boomBust.ts) for everyone re-recorded above,
// frozen at kickoff along with the projections, so boomBustTrackRecord can
// grade them once the week is final.
const vegasThisWeek = vegasHistory.weeks[String(period)] ?? {};
pendingBoomBust.forEach(({ snap, seasonProj }) => {
  const record = week[String(snap.id)];
  const vegas = vegasThisWeek[String(snap.id)];
  const odds = weeklyBoomBust(snap.id, record.custom, seasonProj, {
    pos: snap.pos,
    week: period,
    implied: vegas?.implied ?? null,
    vegasPts: vegas?.pts ?? null,
  });
  if (!odds) return;
  record.boom = Math.round(odds.boomChance * 1000) / 1000;
  record.bust = Math.round(odds.bustChance * 1000) / 1000;
  record.boomAt = odds.boomAt;
  record.bustAt = odds.bustAt;
});
writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 1) + "\n");
const seasonValues = vegasSeasonValues(vegasHistory);
writeFileSync(
  VEGAS_VALUES_FILE,
  [
    "// Generated by scripts/recordProjections.ts -- do not edit by hand.",
    "// Season-average Vegas points per player (lib/bettingValue.ts), keyed by ESPN id.",
    'import type { VegasSeasonValue } from "../lib/bettingValue.js";',
    "",
    "export const VEGAS_VALUES: Record<number, VegasSeasonValue> = {",
    ...Object.entries(seasonValues).map(([id, v]) => `  ${id}: { pts: ${v.pts}, weeks: ${v.weeks} },`),
    "};",
    "",
  ].join("\n")
);
console.log(`Vegas: ${Object.keys(vegasHistory.weeks[String(period)] ?? {}).length} players this week; season values for ${Object.keys(seasonValues).length}.`);
