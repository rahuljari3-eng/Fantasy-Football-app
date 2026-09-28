// Boom/bust rates: how often a player blows past, or falls well short of,
// what he was projected for -- judged against HIS OWN projection each week,
// so a star projected for 22 needs a much bigger game to "boom" than a flex
// projected for 8.
//
// The bar is one typical miss either side of the projection. How far actual
// scores land from projections grows with the projection itself; across last
// season's ~3,200 relevant player-games (Sleeper projection vs actual PPR),
// the spread fit SPREAD_BASE + SPREAD_PER_POINT * projection almost exactly
// (5.5 pts at a 6-pt projection, 8.9 at 22). So:
//   boom = actual >= proj + spread(proj)   (projected 10 -> 16.4+, 20 -> 28.5+)
//   bust = actual <= proj - spread(proj)   (projected 10 -> 3.6-, 20 -> 11.5-)
//
// Games: last season from boomBustHistory.json (scripts/buildBoomBustHistory.ts)
// plus this season's finished weeks from projectionHistory.json (the app's
// custom projection frozen at kickoff). Rates are shrunk toward the league-wide
// rate by PRIOR_GAMES pseudo-games, so a 2-for-3 start doesn't read as 67%.
//
// ESPN doesn't publish boom/bust % through any API this app can read
// (docs/plans/2026-09-23-espn-boom-bust-research.md); these are the app's own.
import BOOM_BUST_HISTORY from "../data/boomBustHistory.json" with { type: "json" };
import PROJECTION_HISTORY from "../data/projectionHistory.json" with { type: "json" };
import type { ProjectionHistory } from "./projectionAccuracy.js";

export interface BoomBustHistory {
  season: number;
  source: "sleeper";
  /** ESPN id -> [week, projected, actual] per game played. */
  games: Record<string, [number, number, number][]>;
}

const SPREAD_BASE = 4.3;
const SPREAD_PER_POINT = 0.21;
/** Games projected under this are left out: a backup's 2-point projection
 * says nothing about how he performs when he's actually in the lineup. */
const MIN_PROJECTION = 5;
const PRIOR_GAMES = 4;
/** Fewer real games than this and no profile label is shown. */
const MIN_GAMES_FOR_PROFILE = 4;
/** A rate this far above/below the league rate earns a label. */
const HIGH = 1.3;
const LOW = 0.75;

export type BoomBustProfile = "boom" | "bust" | "volatile" | "steady" | "neutral";

export interface BoomBustGame {
  season: number;
  week: number;
  proj: number;
  actual: number;
  result: "boom" | "bust" | null;
}

export interface BoomBustStats {
  games: number;
  booms: number;
  busts: number;
  /** Shrunk rates, 0-1. */
  boomRate: number;
  bustRate: number;
  profile: BoomBustProfile;
}

export function boomBustThresholds(proj: number): { boom: number; bust: number } {
  const spread = SPREAD_BASE + SPREAD_PER_POINT * proj;
  return { boom: Math.round((proj + spread) * 10) / 10, bust: Math.max(0, Math.round((proj - spread) * 10) / 10) };
}

export function classifyGame(proj: number, actual: number): "boom" | "bust" | null {
  const t = boomBustThresholds(proj);
  return actual >= t.boom ? "boom" : actual <= t.bust ? "bust" : null;
}

function buildGames(): Map<number, BoomBustGame[]> {
  const out = new Map<number, BoomBustGame[]>();
  const add = (id: string, g: Omit<BoomBustGame, "result">) => {
    if (g.proj < MIN_PROJECTION) return;
    const list = out.get(Number(id)) ?? [];
    list.push({ ...g, result: classifyGame(g.proj, g.actual) });
    out.set(Number(id), list);
  };
  const past = BOOM_BUST_HISTORY as unknown as BoomBustHistory;
  Object.entries(past.games).forEach(([id, games]) => games.forEach(([week, proj, actual]) => add(id, { season: past.season, week, proj, actual })));
  const current = PROJECTION_HISTORY as ProjectionHistory;
  Object.entries(current.weeks).forEach(([week, players]) =>
    Object.entries(players).forEach(([id, r]) => {
      if (r.actual != null) add(id, { season: current.season, week: Number(week), proj: r.custom, actual: r.actual });
    })
  );
  out.forEach((list) => list.sort((a, b) => b.season - a.season || b.week - a.week));
  return out;
}

let cache: { games: Map<number, BoomBustGame[]>; baseBoom: number; baseBust: number } | null = null;
function data() {
  if (cache) return cache;
  const games = buildGames();
  let n = 0;
  let booms = 0;
  let busts = 0;
  games.forEach((list) =>
    list.forEach((g) => {
      n++;
      if (g.result === "boom") booms++;
      if (g.result === "bust") busts++;
    })
  );
  cache = { games, baseBoom: n ? booms / n : 0, baseBust: n ? busts / n : 0 };
  return cache;
}

/** League-wide rates -- the yardstick every player's rates are read against. */
export function leagueBoomBustRates(): { boomRate: number; bustRate: number } {
  const { baseBoom, baseBust } = data();
  return { boomRate: baseBoom, bustRate: baseBust };
}

/** Every counted game for a player, newest first. */
export function boomBustGames(playerId: number): BoomBustGame[] {
  return data().games.get(playerId) ?? [];
}

export function boomBustFor(playerId: number): BoomBustStats | null {
  const { baseBoom, baseBust } = data();
  const list = boomBustGames(playerId);
  if (!list.length) return null;
  const booms = list.filter((g) => g.result === "boom").length;
  const busts = list.filter((g) => g.result === "bust").length;
  const boomRate = (booms + PRIOR_GAMES * baseBoom) / (list.length + PRIOR_GAMES);
  const bustRate = (busts + PRIOR_GAMES * baseBust) / (list.length + PRIOR_GAMES);
  let profile: BoomBustProfile = "neutral";
  if (list.length >= MIN_GAMES_FOR_PROFILE) {
    const highBoom = boomRate >= baseBoom * HIGH;
    const highBust = bustRate >= baseBust * HIGH;
    if (highBoom && highBust) profile = "volatile";
    else if (highBoom) profile = "boom";
    else if (highBust) profile = "bust";
    else if (bustRate <= baseBust * LOW) profile = "steady";
  }
  return { games: list.length, booms, busts, boomRate, bustRate, profile };
}

export const BOOM_BUST_PROFILE_LABEL: Record<Exclude<BoomBustProfile, "neutral">, string> = {
  boom: "Boom",
  bust: "Bust risk",
  volatile: "Volatile",
  steady: "Steady",
};
