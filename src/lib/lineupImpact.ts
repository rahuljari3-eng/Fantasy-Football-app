// "What does this trade do to the lineup I'd actually start?" -- the
// team-specific half of trade analysis that package value (lib/tradeEngine.ts)
// can't see. Package value prices players in the abstract; this replays every
// remaining fantasy week for both rosters, before and after the swap, and
// sums the starting lineup each would field. That's what catches:
//
//  - Byes: a player whose bye is still ahead misses one of YOUR weeks, and
//    stacking two starters on the same bye costs a whole lineup slot that
//    week. Depth that fills in during byes/injuries earns real points here.
//  - Roster spots: a 2-for-1 forces the receiving team to cut someone (the
//    cheapest cut is chosen), so "consolidating" is graded on what it really
//    costs, not on a fixed package discount.
//  - Streaming: an empty or below-waiver slot (a bye, an injury, no backup)
//    is filled at the level of the free agents actually available at that
//    position, both before and after the trade -- so a backup who only
//    covers a bye isn't worth more than the streamer you'd pick up anyway,
//    and the spot a 2-for-1 opens is worth exactly that streaming option.
//  - Who actually starts: a stud at a position you're already set at may
//    only replace your FLEX; a mid-tier player at your hole replaces a
//    replacement-level body. Points-over-who-he-displaces is the real gain.
//  - Playoff weeks: reported separately, since a contender's trade is
//    really judged by who starts the fantasy playoffs.
//
// Weekly expected points: the current week uses this week's consensus
// projection (already zero for byes and ruled-out players); later weeks use
// the rest-of-season PPG, discounted for injury status and nudged by
// schedule ease -- the same inputs qualityScore prices on.
import { FANTASY_PLAYOFF_START_WEEK } from "../config/scoring.js";
import { POSITIONS, REQUIRED_STARTERS } from "../config/league.js";
import { getRosCurrentWeek, getRosThroughWeek } from "./rosHorizon.js";
import { clampScheduleEase, effectiveSeasonProj, qualityScore, rosStatusMultiplier } from "./scoring.js";
import type { Player, Position } from "../types.js";

const FLEX_ELIGIBLE: Position[] = ["RB", "WR", "TE"];

/** Which free agent sets a position's streaming floor: the Nth-best healthy
 * one by expected points, not the very best -- every other manager is
 * chasing that same top pickup, so you can't count on landing him. */
const STREAMER_RANK = 2;

type StreamFloor = Record<Position, number>;

interface Sim {
  weeks: number[];
  currentWeek: number;
  floor: StreamFloor;
}

export interface SideLineupImpact {
  /** Starting-lineup points summed over the simulated weeks. */
  before: number;
  after: number;
  /** after - before, rest of season. */
  delta: number;
  /** delta averaged per simulated week. */
  perWeek: number;
  /** Average weekly delta over the fantasy-playoff weeks only (null when
   * none of the simulated weeks are playoff weeks). */
  playoffPerWeek: number | null;
  /** Players this team would cut to make room (excess incoming bodies). */
  dropped: Player[];
  /** Roster spots the trade opens up (sending more bodies than it gets) --
   * already credited as streaming at the free-agent level. */
  openSpots: number;
}

export interface LineupImpact {
  fromWeek: number;
  throughWeek: number;
  weeks: number;
  playoffWeeks: number;
  my: SideLineupImpact;
  /** Null when the other team's roster isn't known. */
  their: SideLineupImpact | null;
}

function weekList(fromWeek: number, throughWeek: number): number[] {
  const weeks: number[] = [];
  for (let w = fromWeek; w <= throughWeek; w++) weeks.push(w);
  return weeks;
}

/** Expected fantasy points from this player in a given week. */
export function expectedWeekPoints(p: Player, week: number, currentWeek: number): number {
  if (week === p.bye) return 0;
  if (week === currentWeek) return Math.max(0, p.proj);
  return effectiveSeasonProj(p) * rosStatusMultiplier(p.status) * clampScheduleEase(p.scheduleEase);
}

/** Per-position streaming level: the STREAMER_RANK-th best healthy free
 * agent's expected points per game. */
export function streamingFloor(freeAgents: Player[]): StreamFloor {
  const floor = {} as StreamFloor;
  for (const pos of POSITIONS) {
    const ppg = freeAgents
      .filter((p) => p.pos === pos && p.status !== "Out" && p.status !== "IR")
      .map((p) => effectiveSeasonProj(p) * rosStatusMultiplier(p.status))
      .sort((a, b) => b - a);
    floor[pos] = ppg[Math.min(STREAMER_RANK, ppg.length) - 1] ?? 0;
  }
  return floor;
}

/** Best legal starting lineup's points for one week: each position's
 * required starters, then the single best leftover RB/WR/TE in FLEX. Any
 * slot the roster can't fill above the streaming level gets a streamer. */
function weekLineupPoints(roster: Player[], week: number, sim: Sim): number {
  const byPos = new Map<Position, number[]>();
  for (const p of roster) {
    const pts = expectedWeekPoints(p, week, sim.currentWeek);
    const arr = byPos.get(p.pos);
    if (arr) arr.push(pts);
    else byPos.set(p.pos, [pts]);
  }
  let total = 0;
  let flex = Math.max(...FLEX_ELIGIBLE.map((pos) => sim.floor[pos]));
  for (const pos of POSITIONS) {
    const pts = (byPos.get(pos) ?? []).sort((a, b) => b - a);
    const n = REQUIRED_STARTERS[pos];
    for (let i = 0; i < n; i++) total += Math.max(pts[i] ?? 0, sim.floor[pos]);
    if (FLEX_ELIGIBLE.includes(pos) && pts.length > n) flex = Math.max(flex, pts[n]);
  }
  return total + flex;
}

interface SeasonTotals {
  total: number;
  playoff: number;
}

function seasonLineupPoints(roster: Player[], sim: Sim): SeasonTotals {
  let total = 0;
  let playoff = 0;
  for (const w of sim.weeks) {
    const pts = weekLineupPoints(roster, w, sim);
    total += pts;
    if (w >= FANTASY_PLAYOFF_START_WEEK) playoff += pts;
  }
  return { total, playoff };
}

/** Cut `count` players from `roster` (never one in `keepIds`), each time
 * choosing whoever costs the starting lineup the fewest points -- ties go
 * to the lower-quality player, which is who a manager would really drop. */
function cheapestCuts(roster: Player[], count: number, keepIds: Set<number>, sim: Sim): { roster: Player[]; dropped: Player[] } {
  let cur = roster;
  const dropped: Player[] = [];
  for (let i = 0; i < count; i++) {
    let best: { idx: number; total: number; q: number } | null = null;
    for (let idx = 0; idx < cur.length; idx++) {
      const p = cur[idx];
      if (keepIds.has(p.id)) continue;
      const total = seasonLineupPoints(
        cur.filter((_, j) => j !== idx),
        sim
      ).total;
      const q = qualityScore(p);
      if (!best || total > best.total + 1e-6 || (Math.abs(total - best.total) <= 1e-6 && q < best.q)) {
        best = { idx, total, q };
      }
    }
    if (!best) break;
    const cutIdx = best.idx;
    dropped.push(cur[cutIdx]);
    cur = cur.filter((_, j) => j !== cutIdx);
  }
  return { roster: cur, dropped };
}

function sideImpact(
  roster: Player[],
  outgoing: Player[],
  incoming: Player[],
  irIds: Set<number>,
  sim: Sim,
  playoffWeekCount: number
): SideLineupImpact {
  const outIds = new Set(outgoing.map((p) => p.id));
  const before = seasonLineupPoints(roster, sim);

  let after = [...roster.filter((p) => !outIds.has(p.id)), ...incoming];
  // Players stashed in an IR slot don't hold a bench spot, so trading one
  // away doesn't open room; likewise an incoming IR-designated player can go
  // straight to IR.
  const activeOut = outgoing.filter((p) => !irIds.has(p.id)).length;
  const activeIn = incoming.filter((p) => p.status !== "IR").length;
  const netBodies = activeIn - activeOut;

  let dropped: Player[] = [];
  if (netBodies > 0) {
    // Cut from the active roster only -- IR-slotted players aren't taking
    // the spot the incoming player needs.
    const keep = new Set([...incoming.map((p) => p.id), ...irIds]);
    ({ roster: after, dropped } = cheapestCuts(after, netBodies, keep, sim));
  }

  const afterTotals = seasonLineupPoints(after, sim);
  const delta = afterTotals.total - before.total;
  return {
    before: before.total,
    after: afterTotals.total,
    delta,
    perWeek: sim.weeks.length ? delta / sim.weeks.length : 0,
    playoffPerWeek: playoffWeekCount ? (afterTotals.playoff - before.playoff) / playoffWeekCount : null,
    dropped,
    openSpots: Math.max(0, -netBodies),
  };
}

/** Replay the rest of the fantasy season for both rosters with and without
 * the trade. `give` leaves `myRoster` for `theirRoster`; `get` goes the other
 * way. `freeAgents` sets the streaming level for empty/weak slots; `irIds`
 * marks players sitting in an IR slot (they don't occupy a bench spot).
 * Returns null when there's nothing left to simulate. */
export function evaluateLineupImpact(opts: {
  myRoster: Player[];
  theirRoster: Player[] | null;
  give: Player[];
  get: Player[];
  freeAgents: Player[];
  irIds?: Set<number>;
  /** The week `proj` (this week's projection) refers to. */
  currentWeek?: number | null;
  /** First week to simulate -- later than currentWeek once its games are
   * all final (see firstUnplayedWeek in lib/nflSchedule.ts). */
  fromWeek?: number;
  throughWeek?: number;
}): LineupImpact | null {
  const currentWeek = opts.currentWeek ?? getRosCurrentWeek();
  if (currentWeek == null || currentWeek <= 0) return null;
  const throughWeek = opts.throughWeek ?? getRosThroughWeek();
  const fromWeek = Math.max(currentWeek, opts.fromWeek ?? currentWeek);
  const weeks = weekList(fromWeek, Math.max(fromWeek, throughWeek));
  if (!opts.give.length && !opts.get.length) return null;
  const playoffWeeks = weeks.filter((w) => w >= FANTASY_PLAYOFF_START_WEEK).length;
  const irIds = opts.irIds ?? new Set<number>();
  const sim: Sim = { weeks, currentWeek, floor: streamingFloor(opts.freeAgents) };

  const my = sideImpact(opts.myRoster, opts.give, opts.get, irIds, sim, playoffWeeks);
  const their = opts.theirRoster ? sideImpact(opts.theirRoster, opts.get, opts.give, irIds, sim, playoffWeeks) : null;
  return { fromWeek, throughWeek: weeks[weeks.length - 1], weeks: weeks.length, playoffWeeks, my, their };
}
