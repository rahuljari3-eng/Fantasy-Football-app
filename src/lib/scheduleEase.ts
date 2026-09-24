// Coarse remaining-schedule "ease" for season-long player value. Not a full
// week-by-week projection rebuild -- a small multiplier (±~10%) from home/away
// and opponent offensive environment (Vegas implied totals seen so far).
// Missing signals → 1.0. Applied via Player.scheduleEase inside qualityScore.
import { SCHEDULE_EASE_MAX, SCHEDULE_EASE_MIN } from "../config/scoring.js";
import type { VegasHistory } from "./bettingValue.js";
import { normalizeNflAbbrev, teamScheduleRemaining, type NflGameSlot, type NflScheduleSnapshot } from "./nflSchedule.js";
import type { Player } from "../types.js";

function clampEase(n: number): number {
  return Math.min(SCHEDULE_EASE_MAX, Math.max(SCHEDULE_EASE_MIN, n));
}

/** Average of per-game ease factors, or 1.0 when empty / invalid. */
export function scheduleEaseMultiplier(signals: number[]): number {
  const ok = signals.filter((s) => Number.isFinite(s));
  if (!ok.length) return 1;
  return clampEase(ok.reduce((a, b) => a + b, 0) / ok.length);
}

/** Build NFL-team → average Vegas-implied team total from recorded history. */
export function teamImpliedAverages(
  history: VegasHistory,
  idToTeam: Map<number, string>
): { byTeam: Map<string, number>; leagueAvg: number } {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const weekMap of Object.values(history.weeks)) {
    for (const [idStr, rec] of Object.entries(weekMap)) {
      if (rec.implied == null || !Number.isFinite(rec.implied)) continue;
      const team = idToTeam.get(Number(idStr));
      if (!team || team === "FA") continue;
      const key = normalizeNflAbbrev(team);
      const cur = sums.get(key) ?? { sum: 0, n: 0 };
      cur.sum += rec.implied;
      cur.n += 1;
      sums.set(key, cur);
    }
  }
  const byTeam = new Map<string, number>();
  let leagueSum = 0;
  let leagueN = 0;
  sums.forEach((v, team) => {
    const avg = v.sum / v.n;
    byTeam.set(team, avg);
    leagueSum += avg;
    leagueN += 1;
  });
  return { byTeam, leagueAvg: leagueN > 0 ? leagueSum / leagueN : 22 };
}

function gameEase(player: Player, slot: NflGameSlot, byTeam: Map<string, number>, leagueAvg: number): number {
  let s = 1;
  if (slot.home) s += 0.02;
  else s -= 0.02;
  const opp = normalizeNflAbbrev(slot.opponent);
  const oppImplied = byTeam.get(opp) ?? leagueAvg;
  const delta = leagueAvg > 0 ? (oppImplied - leagueAvg) / leagueAvg : 0;
  // Shootouts (high-scoring opponents) help skill slightly; hurt DST.
  if (player.pos === "DST") s -= delta * 0.15;
  else if (player.pos !== "K") s += delta * 0.1;
  return s;
}

/** Stamp scheduleEase on each player from remaining NFL slate + historical
 * implied totals. Neutral (1) when schedule or history is missing. */
export function applyScheduleEase<P extends Player>(
  pool: P[],
  opts: {
    schedule: NflScheduleSnapshot | null | undefined;
    currentWeek: number;
    history: VegasHistory | null | undefined;
  }
): P[] {
  if (!opts.schedule || !opts.history || !(opts.currentWeek > 0)) {
    return pool.map((p) => ({ ...p, scheduleEase: p.scheduleEase ?? 1 }));
  }

  const idToTeam = new Map<number, string>();
  pool.forEach((p) => idToTeam.set(p.id, p.team));
  const { byTeam, leagueAvg } = teamImpliedAverages(opts.history, idToTeam);
  if (byTeam.size === 0) {
    return pool.map((p) => ({ ...p, scheduleEase: 1 }));
  }

  return pool.map((p) => {
    if (!p.team || p.team === "FA") return { ...p, scheduleEase: 1 };
    const remaining = teamScheduleRemaining(opts.schedule!, p.team, opts.currentWeek);
    const games = remaining.filter((s): s is NflGameSlot => !("bye" in s && s.bye));
    if (!games.length) return { ...p, scheduleEase: 1 };
    const signals = games.map((g) => gameEase(p, g, byTeam, leagueAvg));
    return { ...p, scheduleEase: scheduleEaseMultiplier(signals) };
  });
}
