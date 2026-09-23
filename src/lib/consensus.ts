// Consensus player projections + market value, blended from several
// independent sources instead of trusting ESPN's model alone. ESPN's season
// projection was the ONLY input to season-long value before this, and it
// missed badly in both directions (e.g. a QB averaging 25+ a week priced like
// a low-end QB1 because ESPN's model had him at 17.5).
//
// Sources, all public, CORS-open, no API key -- so the browser refresh
// (hooks/useProjectionRefresh.ts) and Roster Sensei's server-side roster sync
// (lib/espnLeague.ts) both call this same module:
//  - ESPN: weekly + rest-of-season projection and actual points so far
//    (already on every ESPN player payload -- see extractEspn* in lib/espn.ts).
//  - Sleeper: its own weekly PPR projections, pulled for the next several
//    weeks so it doubles as an independent rest-of-season projection (bye
//    weeks excluded from the per-game average).
//  - FantasyCalc: redraft trade values for 1QB / 12-team / PPR, computed from
//    real trades fantasy managers actually made -- the market's opinion of a
//    player, which bakes in role changes and injury news faster than any
//    projection model. Also the bridge from Sleeper ids to ESPN ids.
//  - Sportsbook prop lines (DraftKings via ESPN, see lib/matchup.ts): when a
//    player's yardage prop has posted for the week, the market's yardage
//    number replaces the projections' yardage number in his WEEKLY projection
//    (see applyPropLines).
//
// Every fetch is best-effort: a source that fails or doesn't know a player
// just drops out of that player's blend, never blocks the refresh.
// Tunables live in config/scoring.ts.
import {
  CONSENSUS_ACTUAL_SHRINK_GAMES,
  CONSENSUS_ACTUAL_MAX_WEIGHT,
  CONSENSUS_SEASON_WEIGHTS,
  CONSENSUS_WEEKLY_WEIGHTS,
  MARKET_CALIBRATION_MAX,
  MARKET_CALIBRATION_MIN,
  MARKET_CALIBRATION_MIN_PLAYERS,
  PROP_ADJUST_MAX_FRACTION,
  SLEEPER_ROS_WEEKS,
} from "../config/scoring.js";
import type { EspnPlayerSnapshot } from "./espn.js";
import { seasonModelValue } from "./scoring.js";
import type { PlayerPropLines } from "./matchup.js";
import type { ModelYards, Player, Position, ProjectionOverrides } from "../types.js";

const FANTASYCALC_URL = "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1";
const SLEEPER_PROJ_BASE = "https://api.sleeper.app/projections/nfl";
const SKILL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];
const LAST_REGULAR_SEASON_WEEK = 18;

export interface SleeperWeekProjection extends ModelYards {
  pts: number;
}

export interface MarketValue {
  /** FantasyCalc redraft value (their own scale, ~0-10,000). */
  value: number;
  /** Rank at the position by that value, 1 = most valuable. */
  posRank: number;
}

/** Everything the blend needs, fetched once per refresh. */
export interface ConsensusSources {
  /** Keyed by ESPN player id. */
  market: Map<number, MarketValue>;
  /** Sleeper data is keyed by Sleeper id; use sleeperKeyFor to look up. */
  sleeperWeek: Map<string, SleeperWeekProjection>;
  /** Sleeper per-game projection over the next SLEEPER_ROS_WEEKS weeks. */
  sleeperRos: Map<string, number>;
  espnToSleeper: Map<number, string>;
  /** Fallback id bridge for players FantasyCalc doesn't value. */
  sleeperByName: Map<string, string>;
}

/** Lowercased, punctuation- and suffix-free "name|pos" key, so "Kenneth
 * Walker III" on one site matches "Kenneth Walker" on another. */
export function nameKey(name: string, pos: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[.'’-]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${clean}|${pos}`;
}

interface FantasyCalcRow {
  value?: number;
  redraftValue?: number;
  player?: { position?: string; espnId?: string | null; sleeperId?: string | null };
}

async function fetchFantasyCalc(): Promise<{ market: Map<number, MarketValue>; espnToSleeper: Map<number, string> }> {
  const res = await fetch(FANTASYCALC_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`FantasyCalc request failed (${res.status})`);
  const rows = (await res.json()) as FantasyCalcRow[];
  const market = new Map<number, MarketValue>();
  const espnToSleeper = new Map<number, string>();

  // Re-rank within each position ourselves rather than trusting the payload's
  // positionRank, so the rank always matches the value we store.
  const byPos = new Map<string, { espnId: number; value: number }[]>();
  rows.forEach((r) => {
    const espnId = Number(r.player?.espnId);
    const pos = r.player?.position;
    const value = r.redraftValue ?? r.value;
    if (!Number.isFinite(espnId) || !espnId || !pos || value == null) return;
    if (r.player?.sleeperId) espnToSleeper.set(espnId, r.player.sleeperId);
    const list = byPos.get(pos) ?? [];
    list.push({ espnId, value });
    byPos.set(pos, list);
  });
  byPos.forEach((list) =>
    list.sort((a, b) => b.value - a.value).forEach((r, i) => market.set(r.espnId, { value: r.value, posRank: i + 1 }))
  );
  return { market, espnToSleeper };
}

interface SleeperProjRow {
  player_id?: string;
  stats?: { pts_ppr?: number; pass_yd?: number; rush_yd?: number; rec_yd?: number };
  player?: { first_name?: string; last_name?: string; position?: string };
}

async function fetchSleeperWeekRows(season: number, week: number): Promise<SleeperProjRow[]> {
  const qs = SKILL_POSITIONS.map((p) => `position%5B%5D=${p}`).join("&");
  const res = await fetch(`${SLEEPER_PROJ_BASE}/${season}/${week}?season_type=regular&${qs}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Sleeper projections failed (${res.status})`);
  return (await res.json()) as SleeperProjRow[];
}

/** Pull every source for `week` (the current fantasy scoring period).
 * Never throws -- a failed source just contributes nothing. */
export async function fetchConsensusSources(season: number, week: number): Promise<ConsensusSources> {
  const rosWeeks: number[] = [];
  for (let w = week; w <= Math.min(LAST_REGULAR_SEASON_WEEK, week + SLEEPER_ROS_WEEKS - 1); w++) rosWeeks.push(w);

  const [fc, ...weekResults] = await Promise.allSettled([fetchFantasyCalc(), ...rosWeeks.map((w) => fetchSleeperWeekRows(season, w))]);

  const { market, espnToSleeper } = fc.status === "fulfilled" ? fc.value : { market: new Map(), espnToSleeper: new Map() };
  const sleeperWeek = new Map<string, SleeperWeekProjection>();
  const sleeperByName = new Map<string, string>();
  const rosPoints = new Map<string, number[]>();

  weekResults.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    r.value.forEach((row) => {
      const id = row.player_id;
      const pts = row.stats?.pts_ppr;
      if (!id || pts == null) return;
      const first = row.player?.first_name;
      const last = row.player?.last_name;
      const pos = row.player?.position;
      if (first && last && pos) sleeperByName.set(nameKey(`${first} ${last}`, pos), id);
      if (i === 0) {
        sleeperWeek.set(id, { pts, pass: row.stats?.pass_yd, rush: row.stats?.rush_yd, rec: row.stats?.rec_yd });
      }
      // Zero = bye (or ruled out) that week; averaging it in would make a
      // player look worse per-game just for having his bye inside the window.
      if (pts > 0) {
        const list = rosPoints.get(id) ?? [];
        list.push(pts);
        rosPoints.set(id, list);
      }
    });
  });

  const sleeperRos = new Map<string, number>();
  rosPoints.forEach((list, id) => sleeperRos.set(id, list.reduce((a, b) => a + b, 0) / list.length));

  return { market, sleeperWeek, sleeperRos, espnToSleeper, sleeperByName };
}

export function sleeperKeyFor(sources: ConsensusSources, espnId: number, name: string, pos: Position): string | undefined {
  return sources.espnToSleeper.get(espnId) ?? sources.sleeperByName.get(nameKey(name, pos));
}

function weightedAverage(parts: [number | null | undefined, number][]): number | null {
  let sum = 0;
  let weight = 0;
  parts.forEach(([value, w]) => {
    if (value == null || !Number.isFinite(value) || w <= 0) return;
    sum += value * w;
    weight += w;
  });
  return weight > 0 ? sum / weight : null;
}

/** This week's consensus projection. A 0 from ESPN means bye or ruled out --
 * ESPN tracks injury designations more tightly than the other sources, so
 * that 0 is kept rather than averaged back up by a stale non-zero elsewhere. */
export function blendWeeklyProj(espnWeek: number, sleeperWeek: number | undefined): number {
  if (espnWeek <= 0) return espnWeek;
  const blended = weightedAverage([
    [espnWeek, CONSENSUS_WEEKLY_WEIGHTS.espn],
    [sleeperWeek && sleeperWeek > 0 ? sleeperWeek : null, CONSENSUS_WEEKLY_WEIGHTS.sleeper],
  ]);
  return Math.round((blended ?? espnWeek) * 10) / 10;
}

/** Rest-of-season points per game: ESPN's and Sleeper's projections, plus
 * what the player has ACTUALLY averaged so far -- weighted by a shrinkage
 * factor that grows with games played, so two big weeks nudge the number but
 * half a season of production really moves it. */
export function blendSeasonProj(input: {
  espnSeason: number | null | undefined;
  sleeperRos: number | null | undefined;
  actualAvg: number | null | undefined;
  gamesPlayed: number | null | undefined;
}): number | null {
  const gp = input.gamesPlayed ?? 0;
  const actualWeight = gp > 0 ? CONSENSUS_ACTUAL_MAX_WEIGHT * (gp / (gp + CONSENSUS_ACTUAL_SHRINK_GAMES)) : 0;
  const blended = weightedAverage([
    [input.espnSeason, CONSENSUS_SEASON_WEIGHTS.espn],
    [input.sleeperRos, CONSENSUS_SEASON_WEIGHTS.sleeper],
    [input.actualAvg != null ? Math.max(0, input.actualAvg) : null, actualWeight],
  ]);
  return blended == null ? null : Math.round(blended * 10) / 10;
}

const POINTS_PER_YARD = { pass: 0.04, rush: 0.1, rec: 0.1 } as const;

/** Swap the projections' yardage expectation for the sportsbook's, when a
 * prop line is posted: proj += (propYards - modelYards) * points-per-yard.
 * TD and reception components stay as projected (ESPN doesn't relay those
 * props as lines). Capped at +/- PROP_ADJUST_MAX_FRACTION of the projection
 * so one odd line can't swing a player wildly. */
export function applyPropLines(proj: number, props: PlayerPropLines | undefined, model: ModelYards | undefined): number {
  if (!props || !model || proj <= 0) return proj;
  let delta = 0;
  if (props.passYards != null && model.pass != null) delta += (props.passYards - model.pass) * POINTS_PER_YARD.pass;
  if (props.rushRecYards != null && (model.rush != null || model.rec != null)) {
    delta += (props.rushRecYards - (model.rush ?? 0) - (model.rec ?? 0)) * POINTS_PER_YARD.rush;
  } else {
    if (props.rushYards != null && model.rush != null) delta += (props.rushYards - model.rush) * POINTS_PER_YARD.rush;
    if (props.recYards != null && model.rec != null) delta += (props.recYards - model.rec) * POINTS_PER_YARD.rec;
  }
  const cap = proj * PROP_ADJUST_MAX_FRACTION;
  return Math.round((proj + Math.max(-cap, Math.min(cap, delta))) * 10) / 10;
}

/** The consensus numbers for one ESPN player. */
export interface ConsensusFields {
  proj: number;
  seasonProj?: number;
  marketPosRank?: number;
  marketValue?: number;
  modelYards?: ModelYards;
}

export function consensusFor(
  sources: ConsensusSources,
  espn: {
    id: number;
    name: string;
    pos: Position;
    proj: number;
    seasonProj?: number | null;
    actualAvg?: number | null;
    gamesPlayed?: number | null;
  }
): ConsensusFields {
  const market = sources.market.get(espn.id);
  if (!SKILL_POSITIONS.includes(espn.pos)) {
    return { proj: espn.proj, ...(espn.seasonProj != null ? { seasonProj: espn.seasonProj } : {}) };
  }
  const key = sleeperKeyFor(sources, espn.id, espn.name, espn.pos);
  const week = key ? sources.sleeperWeek.get(key) : undefined;
  const ros = key ? sources.sleeperRos.get(key) : undefined;
  const seasonProj = blendSeasonProj({
    espnSeason: espn.seasonProj,
    sleeperRos: ros,
    actualAvg: espn.actualAvg,
    gamesPlayed: espn.gamesPlayed,
  });
  return {
    proj: blendWeeklyProj(espn.proj, week?.pts),
    ...(seasonProj != null ? { seasonProj } : {}),
    ...(market ? { marketPosRank: market.posRank, marketValue: market.value } : {}),
    ...(week ? { modelYards: { pass: week.pass, rush: week.rush, rec: week.rec } } : {}),
  };
}

/** Stamp the pool-relative fields every valuation needs, over a whole player
 * pool (all rosters + free agents): posRank (this week's projection),
 * seasonPosRank (season projection), and marketQuality -- the pool ordered by
 * trade-market value across ALL positions, each player assigned the
 * projection model's value at that same overall rank. That keeps the market
 * on qualityScore's scale while letting it decide who's worth more than whom,
 * including across positions. Shared by the app (hooks/useFantasyApp.ts) and
 * Roster Sensei (server/agent/tools/leagueData.ts) so both price identically. */
export function rankPlayerPool<P extends Player>(pool: P[]): P[] {
  const weekRank = new Map<number, number>();
  const seasonRank = new Map<number, number>();
  const byPos = new Map<Position, P[]>();
  const seen = new Set<number>();
  pool.forEach((p) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const list = byPos.get(p.pos) ?? [];
    list.push(p);
    byPos.set(p.pos, list);
  });
  byPos.forEach((list) => {
    [...list].sort((a, b) => b.proj - a.proj).forEach((p, i) => weekRank.set(p.id, i + 1));
    [...list].sort((a, b) => (b.seasonProj ?? b.proj) - (a.seasonProj ?? a.proj)).forEach((p, i) => seasonRank.set(p.id, i + 1));
  });
  const ranked = pool.map((p) => ({ ...p, posRank: weekRank.get(p.id), seasonPosRank: seasonRank.get(p.id) }));

  const valued = new Map<number, P>();
  ranked.forEach((p) => {
    if (p.marketValue != null && !valued.has(p.id)) valued.set(p.id, p);
  });
  const modelValues = [...valued.values()].map(seasonModelValue).sort((a, b) => b - a);
  const marketQuality = new Map<number, number>();
  [...valued.values()]
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .forEach((p, i) => marketQuality.set(p.id, modelValues[i]));

  // Per-position calibration of the projection model itself: the median of
  // (market value / model value) among players the market values. The model
  // has no idea that, say, a 1QB-league QB trades for far less than an RB
  // projecting the same points -- this learns that level from the market
  // every refresh, while the order WITHIN a position still comes from the
  // projections. Without it, blending only halves a structural error.
  const positionScale = new Map<Position, number>();
  byPos.forEach((_, pos) => {
    const ratios = [...valued.values()]
      .filter((p) => p.pos === pos)
      .map((p) => marketQuality.get(p.id)! / seasonModelValue(p))
      .filter((r) => Number.isFinite(r) && r > 0)
      .sort((a, b) => a - b);
    if (ratios.length < MARKET_CALIBRATION_MIN_PLAYERS) return;
    const median = ratios[Math.floor(ratios.length / 2)];
    positionScale.set(pos, Math.min(MARKET_CALIBRATION_MAX, Math.max(MARKET_CALIBRATION_MIN, median)));
  });

  return ranked.map((p) => ({
    ...p,
    ...(marketQuality.has(p.id) ? { marketQuality: marketQuality.get(p.id) } : {}),
    ...(positionScale.has(p.pos) ? { positionScale: positionScale.get(p.pos) } : {}),
  }));
}

/** Replace raw ESPN overrides with consensus ones for every player we have an
 * ESPN snapshot for. Status is left as ESPN reported it. */
export function applyConsensusToOverrides(
  fresh: ProjectionOverrides,
  snapshots: EspnPlayerSnapshot[],
  sources: ConsensusSources
): ProjectionOverrides {
  const out: ProjectionOverrides = { ...fresh };
  snapshots.forEach((snap) => {
    const base = out[snap.id];
    if (!base) return;
    const c = consensusFor(sources, snap);
    out[snap.id] = {
      ...base,
      proj: c.proj,
      ...(c.seasonProj != null ? { seasonProj: c.seasonProj } : {}),
      ...(c.marketPosRank != null ? { marketPosRank: c.marketPosRank, marketValue: c.marketValue } : {}),
      ...(c.modelYards ? { modelYards: c.modelYards } : {}),
    };
  });
  return out;
}
