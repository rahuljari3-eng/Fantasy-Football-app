// Structured, deterministic assembly for the weekly team-recap feature --
// no OpenAI here (that lives server-side, see server/weeklyRecap.ts). This
// module just turns already-fetched data (league schedule, per-player
// actual scores, the news feed) into one clean summary per team, in the
// same "pure pipeline, no React" style as lib/coachTrades.ts.
import { SLOT_ELIGIBILITY } from "../config/league.js";
import type { LeagueTeam, NewsItem, Position, RosterSlotId } from "../types.js";
import type { LeagueScheduleSnapshot } from "./leagueSchedule.js";
import type { LeagueWeekScoreRow } from "./playerPerformance.js";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface LineupSlotPlayerRef {
  playerId: number;
  name: string;
  pos: Position | null;
  actualPoints: number;
}

export interface LineupSlotDiff {
  slot: RosterSlotId;
  actual: LineupSlotPlayerRef | null;
  optimal: LineupSlotPlayerRef | null;
  /** optimal points - actual points for this slot (positive = left points on the bench). */
  pointsGained: number;
}

export interface TeamLineupOptimalResult {
  actualStarterTotal: number;
  optimalStarterTotal: number;
  pointsLeftOnBench: number;
  /** Every slot where the optimal lineup differs from the actual one, sorted by pointsGained desc. */
  diffs: LineupSlotDiff[];
  /** The single biggest swap, or null if the actual lineup was already optimal. */
  topSwap: LineupSlotDiff | null;
}

function toRowRef(row: LeagueWeekScoreRow): LineupSlotPlayerRef {
  return { playerId: row.playerId, name: row.name, pos: row.pos, actualPoints: row.actualPoints ?? 0 };
}

/** Re-runs the same greedy by-slot fill lib/optimizeLineup.ts uses for
 * projections, but keyed on ACTUAL points instead -- then diffs the
 * resulting player SET against who actually started. IR players are never
 * eligible (they weren't a real swap option).
 *
 * Diffing by player-id set membership (not by literal slot label) matters:
 * a WR who actually started in FLEX and a WR who actually started in WR2
 * are both already-starters, but the greedy fill can easily assign them to
 * each other's slot label (since WR2/FLEX are interchangeable for a WR) --
 * comparing slot-by-slot would flag that relabeling as a false "should've
 * started" swap even though nothing actually changed. */
export function computeTeamLineupOptimal(teamWeekRows: LeagueWeekScoreRow[]): TeamLineupOptimalResult {
  const pool = teamWeekRows.filter((r) => r.slot !== "IR");
  const actualStarters = pool.filter((r) => r.isStarter);
  const actualStarterIds = new Set(actualStarters.map((r) => r.playerId));

  // Same greedy fill order lib/optimizeLineup.ts uses, but by actualPoints.
  const chosen = new Set<number>();
  const optimalRoster: Partial<Record<RosterSlotId, LeagueWeekScoreRow>> = {};
  const byPos = (pos: Position) =>
    pool.filter((r) => r.pos === pos && !chosen.has(r.playerId)).sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0));
  const take = (slot: RosterSlotId, row: LeagueWeekScoreRow | undefined) => {
    if (!row) return;
    optimalRoster[slot] = row;
    chosen.add(row.playerId);
  };

  take("QB", byPos("QB")[0]);
  const rbs = byPos("RB");
  take("RB1", rbs[0]);
  take("RB2", rbs[1]);
  const wrs = byPos("WR");
  take("WR1", wrs[0]);
  take("WR2", wrs[1]);
  take("TE", byPos("TE")[0]);
  const flexPool = [...byPos("RB"), ...byPos("WR"), ...byPos("TE")].sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0));
  take("FLEX", flexPool[0]);
  take("DST", byPos("DST")[0]);
  take("K", byPos("K")[0]);

  const optimalRows = Object.values(optimalRoster).filter((r): r is LeagueWeekScoreRow => !!r);
  const optimalStarterIds = new Set(optimalRows.map((r) => r.playerId));

  const actualTotal = round1(actualStarters.reduce((s, r) => s + (r.actualPoints ?? 0), 0));
  const optimalTotal = round1(optimalRows.reduce((s, r) => s + (r.actualPoints ?? 0), 0));

  // Only players who genuinely changed status are real swaps: a bench
  // player newly in the optimal lineup, paired against an actual starter
  // who fell out of it -- never two players who were both already starting.
  const addedFromBench = (Object.entries(optimalRoster) as [RosterSlotId, LeagueWeekScoreRow | undefined][])
    .filter((entry): entry is [RosterSlotId, LeagueWeekScoreRow] => !!entry[1] && !actualStarterIds.has(entry[1].playerId))
    .sort((a, b) => (b[1].actualPoints ?? 0) - (a[1].actualPoints ?? 0));

  const droppedStarters = actualStarters
    .filter((r) => !optimalStarterIds.has(r.playerId))
    .sort((a, b) => (a.actualPoints ?? 0) - (b.actualPoints ?? 0)); // worst actual starter first

  // Pair each bench upgrade with a dropped starter whose real position
  // could ALSO have filled that same slot -- pairing across incompatible
  // positions (e.g. "started an RB over a WR") would read as nonsense even
  // though both numbers are individually correct.
  const diffs: LineupSlotDiff[] = [];
  const usedDropped = new Set<number>();
  for (const [slot, added] of addedFromBench) {
    const eligible = SLOT_ELIGIBILITY[slot];
    const worstUnused =
      droppedStarters.find((d) => !usedDropped.has(d.playerId) && d.pos != null && eligible.includes(d.pos)) ?? null;
    if (worstUnused) usedDropped.add(worstUnused.playerId);
    diffs.push({
      slot,
      actual: worstUnused ? toRowRef(worstUnused) : null,
      optimal: toRowRef(added),
      pointsGained: round1((added.actualPoints ?? 0) - (worstUnused?.actualPoints ?? 0)),
    });
  }
  diffs.sort((x, y) => y.pointsGained - x.pointsGained);
  // Prefer a real "X over Y" pairing for the headline swap -- an unpaired
  // diff (no position-compatible starter to name) is a true but less
  // tellable finding, so it's still in `diffs` but not picked as `topSwap`.
  const pairedDiffs = diffs.filter((d) => d.actual != null);
  const topCandidate = pairedDiffs[0] ?? diffs[0] ?? null;
  const topSwap = topCandidate && topCandidate.pointsGained > 0.05 ? topCandidate : null;

  return {
    actualStarterTotal: actualTotal,
    optimalStarterTotal: optimalTotal,
    pointsLeftOnBench: round1(Math.max(0, optimalTotal - actualTotal)),
    diffs,
    topSwap,
  };
}

export interface TeamWeekRecapInput {
  teamId: number;
  teamName: string;
  week: number;
  result: "W" | "L" | "T";
  teamScore: number;
  opponentId: number;
  opponentName: string;
  opponentScore: number;
  nextWeek: number | null;
  nextOpponentId: number | null;
  nextOpponentName: string | null;
  swap: LineupSlotDiff | null;
  pointsLeftOnBench: number;
  newsHeadlines: { player: string; headline: string; severity?: string }[];
}

const MAX_NEWS_PER_TEAM = 3;

/** One structured summary per team for a completed week -- everything the
 * server needs to write a blurb, with no OpenAI involved yet. Skips a team
 * with no matchup found for `week` (a bye, or data not yet available)
 * rather than guessing. */
export function buildWeeklyRecapInputs(params: {
  week: number;
  leagueSchedule: LeagueScheduleSnapshot;
  leagueWeekScores: LeagueWeekScoreRow[];
  newsFeed: NewsItem[];
  allTeams: LeagueTeam[];
}): TeamWeekRecapInput[] {
  const { week, leagueSchedule, leagueWeekScores, newsFeed, allTeams } = params;
  const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]));

  const playerTeamId = new Map<number, number>();
  for (const t of allTeams) for (const p of t.roster) playerTeamId.set(p.id, t.id);

  const rowsByTeam = new Map<number, LeagueWeekScoreRow[]>();
  for (const row of leagueWeekScores) {
    if (row.fantasyTeamId == null) continue;
    const list = rowsByTeam.get(row.fantasyTeamId) ?? [];
    list.push(row);
    rowsByTeam.set(row.fantasyTeamId, list);
  }

  const newsByTeam = new Map<number, NewsItem[]>();
  const sortedNews = [...newsFeed].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  for (const item of sortedNews) {
    const teamId = playerTeamId.get(item.playerId);
    if (teamId == null) continue;
    const list = newsByTeam.get(teamId) ?? [];
    if (list.length < MAX_NEWS_PER_TEAM) list.push(item);
    newsByTeam.set(teamId, list);
  }

  const results: TeamWeekRecapInput[] = [];
  for (const team of allTeams) {
    const thisWeekMatch = leagueSchedule.schedule.find((m) => m.week === week && (m.homeId === team.id || m.awayId === team.id));
    if (!thisWeekMatch) continue;

    const isHome = thisWeekMatch.homeId === team.id;
    const teamScore = isHome ? thisWeekMatch.homePoints : thisWeekMatch.awayPoints;
    const opponentScore = isHome ? thisWeekMatch.awayPoints : thisWeekMatch.homePoints;
    const opponentId = isHome ? thisWeekMatch.awayId : thisWeekMatch.homeId;
    const result: TeamWeekRecapInput["result"] = teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T";

    const nextWeek = week + 1 <= leagueSchedule.regularSeasonWeeks ? week + 1 : null;
    const nextMatch =
      nextWeek != null ? leagueSchedule.schedule.find((m) => m.week === nextWeek && (m.homeId === team.id || m.awayId === team.id)) : undefined;
    const nextOpponentId = nextMatch ? (nextMatch.homeId === team.id ? nextMatch.awayId : nextMatch.homeId) : null;

    const optimal = computeTeamLineupOptimal(rowsByTeam.get(team.id) ?? []);

    results.push({
      teamId: team.id,
      teamName: team.name,
      week,
      result,
      teamScore: round1(teamScore),
      opponentId,
      opponentName: teamNameById.get(opponentId) ?? "Unknown",
      opponentScore: round1(opponentScore),
      nextWeek,
      nextOpponentId,
      nextOpponentName: nextOpponentId != null ? teamNameById.get(nextOpponentId) ?? "Unknown" : null,
      swap: optimal.topSwap,
      pointsLeftOnBench: optimal.pointsLeftOnBench,
      newsHeadlines: (newsByTeam.get(team.id) ?? []).map((n) => ({ player: n.player, headline: n.headline, severity: n.severity })),
    });
  }
  return results;
}
