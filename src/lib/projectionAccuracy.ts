// Custom vs ESPN weekly projection accuracy, from the history recorded by
// scripts/recordProjections.ts (src/data/projectionHistory.json): each
// player's two projections frozen at kickoff, then his actual points once
// the week is final.

export interface ProjectionRecord {
  espn: number;
  custom: number;
  /** Null until the week is final. */
  actual: number | null;
}

export interface ProjectionHistory {
  season: number;
  /** week number -> player id -> record. */
  weeks: Record<string, Record<string, ProjectionRecord>>;
}

export interface ProjectionAccuracy {
  /** Player-games compared (final weeks only). */
  games: number;
  weeks: number[];
  /** Mean absolute error, fantasy points per player-game. Lower is better. */
  espnMae: number;
  customMae: number;
}

/** Players neither source expected to matter (both under this) are left out,
 * so deep-bench near-zeros don't drown out the players you'd actually start. */
const MIN_RELEVANT_PROJECTION = 5;

export function computeProjectionAccuracy(history: ProjectionHistory): ProjectionAccuracy {
  let games = 0;
  let espnErr = 0;
  let customErr = 0;
  const weeks: number[] = [];
  Object.entries(history.weeks).forEach(([week, players]) => {
    let counted = false;
    Object.values(players).forEach((r) => {
      if (r.actual == null || Math.max(r.espn, r.custom) < MIN_RELEVANT_PROJECTION) return;
      games++;
      espnErr += Math.abs(r.espn - r.actual);
      customErr += Math.abs(r.custom - r.actual);
      counted = true;
    });
    if (counted) weeks.push(Number(week));
  });
  return {
    games,
    weeks: weeks.sort((a, b) => a - b),
    espnMae: games ? espnErr / games : 0,
    customMae: games ? customErr / games : 0,
  };
}
