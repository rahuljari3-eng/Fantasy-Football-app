// Each player's role in his offense, game by game -- snap share, targets and
// target share, carries and carry share, pass attempts, catches, red-zone
// looks, air yards -- and the two signals the custom weekly projection takes
// from it (lib/projectionModel.ts):
//
//   role: how much more (or less) opportunity he's actually been getting per
//         game than Sleeper's projection assumes this week, as a fraction --
//         the earliest sign a projection hasn't caught up to a role change.
//   rz:   red-zone looks per game beyond what his volume would usually bring
//         at his position -- touchdown chances the yardage-driven
//         projections can underrate.
//
// Both are shrunk toward 0 by games played, so one big week barely moves
// them. Games an injury cut short (lib/gameExits.ts) are left out, so a
// 10-snap exit doesn't read as a shrinking role.
//
// The per-game lines come from Sleeper's weekly stats, kept in
// roleHistory.json by scripts/recordProjections.ts for finished weeks.
import ROLE_HISTORY from "../data/roleHistory.json" with { type: "json" };
import PROJECTION_HISTORY from "../data/projectionHistory.json" with { type: "json" };
import { USAGE_MIN_PROJECTED_POINTS, USAGE_OPPORTUNITY_POINTS, USAGE_SHRINK_GAMES } from "../config/scoring.js";
import type { ProjectionHistory } from "./projectionAccuracy.js";
import type { UsageLine } from "../types.js";

/** One game's role. Shares are of his team's offensive snaps / targets /
 * carries; absent when the team total wasn't posted. */
export interface RoleLine {
  snap?: number;
  tgt: number;
  tgtSh?: number;
  car: number;
  carSh?: number;
  pa: number;
  rec: number;
  rzT: number;
  rzC: number;
  air: number;
}

export interface RoleHistory {
  season: number;
  /** ESPN id -> position and week -> that game's role. */
  players: Record<string, { pos: string; weeks: Record<string, RoleLine> }>;
}

/** Per-game averages over his full games (injury exits left out). */
export interface RoleSummary {
  games: number;
  snapShare: number | null;
  targets: number;
  targetShare: number | null;
  carries: number;
  carryShare: number | null;
  passAtt: number;
  receptions: number;
  rzTargets: number;
  rzCarries: number;
  airYards: number;
}

export interface RoleSignals {
  role: number;
  rz: number;
}

const ROLE_CLAMP = 0.5;
const RZ_CLAMP = 3;
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

function avg(values: (number | undefined)[]): number | null {
  const xs = values.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** His full games before `beforeWeek`: weeks with a role line that an
 * injury didn't cut short. */
function fullGames(roles: RoleHistory, history: ProjectionHistory, id: string, beforeWeek: number): RoleLine[] {
  const player = roles.players[id];
  if (!player) return [];
  return Object.entries(player.weeks)
    .filter(([w]) => Number(w) < beforeWeek && history.weeks[w]?.[id]?.injuryExit !== true)
    .map(([, line]) => line);
}

export function roleSummary(roles: RoleHistory, history: ProjectionHistory, id: number, beforeWeek = Infinity): RoleSummary | null {
  const games = fullGames(roles, history, String(id), beforeWeek);
  if (!games.length) return null;
  const mean = (f: (l: RoleLine) => number) => round(games.reduce((s, l) => s + f(l), 0) / games.length, 1);
  const share = (f: (l: RoleLine) => number | undefined) => {
    const v = avg(games.map(f));
    return v == null ? null : round(v);
  };
  return {
    games: games.length,
    snapShare: share((l) => l.snap),
    targets: mean((l) => l.tgt),
    targetShare: share((l) => l.tgtSh),
    carries: mean((l) => l.car),
    carryShare: share((l) => l.carSh),
    passAtt: mean((l) => l.pa),
    receptions: mean((l) => l.rec),
    rzTargets: mean((l) => l.rzT),
    rzCarries: mean((l) => l.rzC),
    airYards: mean((l) => l.air),
  };
}

/** Red-zone looks per target+carry at each position, over every full game
 * before `beforeWeek` -- the usual rate a player's own is measured against. */
export function redZoneRates(roles: RoleHistory, history: ProjectionHistory, beforeWeek = Infinity): Record<string, number> {
  const totals = new Map<string, { rz: number; opp: number }>();
  Object.entries(roles.players).forEach(([id, p]) => {
    const t = totals.get(p.pos) ?? { rz: 0, opp: 0 };
    fullGames(roles, history, id, beforeWeek).forEach((l) => {
      t.rz += l.rzT + l.rzC;
      t.opp += l.tgt + l.car;
    });
    totals.set(p.pos, t);
  });
  const out: Record<string, number> = {};
  totals.forEach((t, pos) => {
    if (t.opp > 0) out[pos] = t.rz / t.opp;
  });
  return out;
}

function opportunityPoints(pos: string, l: UsageLine): number | null {
  const w = USAGE_OPPORTUNITY_POINTS[pos as keyof typeof USAGE_OPPORTUNITY_POINTS];
  return w ? l.passAtt * w.passAtt + l.rushAtt * w.rushAtt + l.targets * w.targets + l.receptions * w.receptions : null;
}

/** The two signals (see the header) from his role so far and the
 * opportunity line this week's projection assumes. 0 where there's nothing
 * to go on. */
export function roleSignals(pos: string, summary: RoleSummary | null, projected: UsageLine | null | undefined, rzRate: number | undefined): RoleSignals {
  if (!summary) return { role: 0, rz: 0 };
  const shrink = summary.games / (summary.games + USAGE_SHRINK_GAMES);
  const actual: UsageLine = { passAtt: summary.passAtt, rushAtt: summary.carries, targets: summary.targets, receptions: summary.receptions };
  const projectedPts = projected ? opportunityPoints(pos, projected) : null;
  const actualPts = opportunityPoints(pos, actual);
  const role =
    projectedPts != null && actualPts != null && projectedPts >= USAGE_MIN_PROJECTED_POINTS
      ? Math.max(-ROLE_CLAMP, Math.min(ROLE_CLAMP, shrink * (actualPts / projectedPts - 1)))
      : 0;
  const rz =
    rzRate != null
      ? Math.max(-RZ_CLAMP, Math.min(RZ_CLAMP, shrink * (summary.rzTargets + summary.rzCarries - rzRate * (summary.targets + summary.carries))))
      : 0;
  return { role: round(role, 3), rz: round(rz, 3) };
}

// The bundled data, for the app: every finished week.
const BUNDLED_ROLES = ROLE_HISTORY as unknown as RoleHistory;
const BUNDLED_HISTORY = PROJECTION_HISTORY as ProjectionHistory;
let bundledRates: Record<string, number> | null = null;

/** His role so far this season, from the bundled history. */
export function currentRoleSummary(id: number): RoleSummary | null {
  return roleSummary(BUNDLED_ROLES, BUNDLED_HISTORY, id);
}

/** This week's role signals, from the bundled history. */
export function currentRoleSignals(id: number, pos: string, projected: UsageLine | null | undefined): RoleSignals {
  bundledRates ??= redZoneRates(BUNDLED_ROLES, BUNDLED_HISTORY);
  return roleSignals(pos, currentRoleSummary(id), projected, bundledRates[pos]);
}
