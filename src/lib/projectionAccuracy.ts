// Custom vs ESPN weekly projection accuracy, from the history recorded by
// scripts/recordProjections.ts (src/data/projectionHistory.json): each
// player's two projections frozen at kickoff, then his actual points once
// the week is final.

export interface ProjectionRecord {
  espn: number;
  custom: number;
  /** Null until the week is final. */
  actual: number | null;
  /** The boom/bust odds the app showed (lib/boomBust.ts) and the bars they
   * were against, frozen at kickoff with the projections -- graded by
   * boomBustTrackRecord once the week is final. */
  boom?: number;
  bust?: number;
  boomAt?: number;
  bustAt?: number;
  /** The inputs the custom projection was built from (lib/projectionModel.ts),
   * so the blend can be refit from results: position, Sleeper's projection
   * (absent when Sleeper had none), and the points the sportsbook yardage
   * props implied beyond the projections' yardage (absent with no line). */
  pos?: string;
  sleeper?: number;
  prop?: number;
}

export interface ProjectionHistory {
  season: number;
  /** week number -> player id -> record. */
  weeks: Record<string, Record<string, ProjectionRecord>>;
}

/** Custom vs ESPN over one slice of player-games. */
export interface AccuracySlice {
  /** Player-games compared (final weeks only). */
  games: number;
  /** Mean absolute error, fantasy points per player-game. Lower is better. */
  espnMae: number;
  customMae: number;
  /** Player-games where each was strictly closer to the actual. */
  customCloser: number;
  espnCloser: number;
}

export interface ProjectionAccuracy extends AccuracySlice {
  weeks: number[];
  byWeek: ({ week: number } & AccuracySlice)[];
  /** Only records that kept their position (all of them since the inputs
   * started being recorded, and backfilled before that). */
  byPos: ({ pos: string } & AccuracySlice)[];
}

/** Players neither source expected to matter (both under this) are left out,
 * so deep-bench near-zeros don't drown out the players you'd actually start. */
const MIN_RELEVANT_PROJECTION = 5;
const POSITIONS = ["QB", "RB", "WR", "TE"];

type Graded = ProjectionRecord & { actual: number; week: number };

function slice(records: Graded[]): AccuracySlice {
  const out: AccuracySlice = { games: records.length, espnMae: 0, customMae: 0, customCloser: 0, espnCloser: 0 };
  records.forEach((r) => {
    const espnMiss = Math.abs(r.espn - r.actual);
    const customMiss = Math.abs(r.custom - r.actual);
    out.espnMae += espnMiss;
    out.customMae += customMiss;
    if (customMiss < espnMiss) out.customCloser++;
    else if (espnMiss < customMiss) out.espnCloser++;
  });
  if (records.length) {
    out.espnMae /= records.length;
    out.customMae /= records.length;
  }
  return out;
}

export function computeProjectionAccuracy(history: ProjectionHistory): ProjectionAccuracy {
  const graded: Graded[] = [];
  Object.entries(history.weeks).forEach(([week, players]) => {
    Object.values(players).forEach((r) => {
      if (r.actual == null || Math.max(r.espn, r.custom) < MIN_RELEVANT_PROJECTION) return;
      graded.push({ ...r, actual: r.actual, week: Number(week) });
    });
  });
  const weeks = [...new Set(graded.map((r) => r.week))].sort((a, b) => a - b);
  return {
    ...slice(graded),
    weeks,
    byWeek: weeks.map((week) => ({ week, ...slice(graded.filter((r) => r.week === week)) })),
    byPos: POSITIONS.map((pos) => ({ pos, ...slice(graded.filter((r) => r.pos === pos)) })).filter((s) => s.games > 0),
  };
}
