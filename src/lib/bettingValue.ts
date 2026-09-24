// The betting market's season-long opinion of a player ("Vegas value"),
// built from sportsbook lines rather than projection models or trades:
//
//  1. Each week, every stat the book posts a prop line for -- passing,
//     rushing and receiving yards, receptions, passing TDs, interceptions --
//     replaces the projection model's number for that stat (Sleeper's stat
//     line; lib/consensus.ts propPointsDelta). What the book doesn't post
//     (rushing/receiving TDs, mostly) stays as the model has it.
//  2. That week is calibrated per position: prop lines sit at x.5 medians,
//     a bit under the mean projections put out, so each position's Vegas
//     points are rescaled until their median matches the model's. What's
//     left is the book's opinion of who gets MORE or LESS than the model says.
//  3. Game lines take out the week's game script: points are scaled by
//     (team's usual implied total / that week's) ^ VEGAS_GAME_SCRIPT_ELASTICITY.
//  4. The season number is the average over every week with lines.
//
// scripts/recordProjections.ts records steps 1-3 each week into
// data/vegasHistory.json (frozen at kickoff, past weeks backfilled from
// closing lines) and writes step 4 to data/vegasValues.ts, which
// rankPlayerPool (lib/consensus.ts) reads.
import { VEGAS_GAME_SCRIPT_ELASTICITY, VEGAS_WEEK_MAX_ADJUST } from "../config/scoring.js";
import type { Position } from "../types.js";

export interface VegasWeekRecord {
  /** Calibrated Vegas points for the week (steps 1-2). */
  pts: number;
  /** The player's team's Vegas-implied points for that game. */
  implied?: number;
}

export interface VegasHistory {
  season: number;
  /** week -> player id -> record. */
  weeks: Record<string, Record<string, VegasWeekRecord>>;
}

export interface VegasSeasonValue {
  /** Season-average Vegas points per game (step 4). */
  pts: number;
  weeks: number;
}

export interface VegasWeekInput {
  id: number;
  pos: Position;
  /** The model's weekly points (Sleeper PPR projection). */
  base: number;
  /** propPointsDelta for the player -- null if no line matched. */
  delta: number | null;
  implied?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Steps 1-2 for one week. Players without a matching line are skipped. */
export function vegasWeek(inputs: VegasWeekInput[]): Record<string, VegasWeekRecord> {
  const raw = inputs
    .filter((i) => i.delta != null && i.base > 0)
    .map((i) => {
      const cap = i.base * VEGAS_WEEK_MAX_ADJUST;
      return { ...i, raw: i.base + Math.max(-cap, Math.min(cap, i.delta!)) };
    });
  const scaleByPos = new Map<Position, number>();
  new Set(raw.map((r) => r.pos)).forEach((pos) => {
    const ratios = raw.filter((r) => r.pos === pos).map((r) => r.raw / r.base);
    scaleByPos.set(pos, ratios.length ? median(ratios) : 1);
  });
  const out: Record<string, VegasWeekRecord> = {};
  raw.forEach((r) => {
    const pts = r.raw / (scaleByPos.get(r.pos) || 1);
    out[String(r.id)] = { pts: Math.round(pts * 10) / 10, ...(r.implied != null ? { implied: r.implied } : {}) };
  });
  return out;
}

/** Steps 3-4: each player's season-average Vegas points. */
export function vegasSeasonValues(history: VegasHistory): Record<number, VegasSeasonValue> {
  const byPlayer = new Map<string, VegasWeekRecord[]>();
  Object.values(history.weeks).forEach((players) =>
    Object.entries(players).forEach(([id, r]) => {
      const list = byPlayer.get(id) ?? [];
      list.push(r);
      byPlayer.set(id, list);
    })
  );
  const out: Record<number, VegasSeasonValue> = {};
  byPlayer.forEach((weeks, id) => {
    const implied = weeks.map((w) => w.implied).filter((v): v is number => v != null && v > 0);
    const usual = implied.length ? implied.reduce((a, b) => a + b, 0) / implied.length : null;
    const normalized = weeks.map((w) =>
      usual != null && w.implied != null && w.implied > 0 ? w.pts * Math.pow(usual / w.implied, VEGAS_GAME_SCRIPT_ELASTICITY) : w.pts
    );
    out[Number(id)] = {
      pts: Math.round((normalized.reduce((a, b) => a + b, 0) / normalized.length) * 10) / 10,
      weeks: weeks.length,
    };
  });
  return out;
}
