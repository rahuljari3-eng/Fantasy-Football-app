// Custom vs ESPN weekly projection accuracy, from the history recorded by
// scripts/recordProjections.ts (src/data/projectionHistory.json): each
// player's two projections frozen at kickoff, then his actual points once
// the week is final.

export interface ProjectionRecord {
  espn: number;
  custom: number;
  /** Null until the week is final. */
  actual: number | null;
  /** On a 0-point week only: true = he didn't play (inactive / ruled out),
   * false = he played and scored 0. See isGradedGame for which DNPs count. */
  dnp?: boolean;
  /** His injury designation (PlayerStatus) at the last recording before
   * kickoff. Absent when unknown. */
  status?: string;
  /** His designation at the first recording after kickoff. The sync can run
   * hours apart, so the last pre-kickoff look can predate inactives (~90
   * minutes before the game); a game-day ruling shows up here. */
  gameStatus?: string;
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
  /** His share of the team's offensive snaps (Sleeper), once posted. */
  snapShare?: number;
  /** Hurt during the game and never logged as returning: the share of
   * regulation elapsed when he went down (lib/gameExits.ts). */
  injuredAt?: number;
  /** The verdict on injuredAt: he really missed a meaningful part of the
   * game (scripts/recordProjections.ts injuryExitVerdict). See isFullGame. */
  injuryExit?: boolean;
}

/** A DNP with no injury designation going into the game -- healthy both
 * at the last look before kickoff and the first after: a healthy scratch /
 * coach's decision, so a real 0. A DNP a designation explains is priced by
 * the injury-status multiplier instead. */
export function isHealthyScratch(r: ProjectionRecord): boolean {
  return r.actual != null && r.dnp === true && r.status === "Healthy" && (r.gameStatus == null || r.gameStatus === "Healthy");
}

/** A final week that counts as a game for grading and season numbers: every
 * week he played (a 0 included), plus healthy scratches as 0s. A DNP with an
 * injury designation -- or with no known designation -- is left out. */
export function isGradedGame(r: ProjectionRecord): r is ProjectionRecord & { actual: number } {
  return r.actual != null && (r.dnp !== true || isHealthyScratch(r));
}

/** A graded game he wasn't knocked out of early by an injury -- what a
 * projection can fairly be held to, and what per-game averages should be
 * built from. A game cut short still counts for boom/bust (getting hurt is
 * one way to bust); see isGradedGame. */
export function isFullGame(r: ProjectionRecord): r is ProjectionRecord & { actual: number } {
  return isGradedGame(r) && r.injuryExit !== true;
}

/** Each game an injury cut short, per player id: his points and how far
 * into the game he went down -- games ESPN's season roll-up counts as full. */
export function injuryExitGames(history: ProjectionHistory): Map<number, { actual: number; injuredAt: number }[]> {
  const out = new Map<number, { actual: number; injuredAt: number }[]>();
  Object.values(history.weeks).forEach((players) =>
    Object.entries(players).forEach(([id, r]) => {
      if (!isGradedGame(r) || r.injuryExit !== true) return;
      out.set(Number(id), [...(out.get(Number(id)) ?? []), { actual: r.actual, injuredAt: r.injuredAt ?? 0 }]);
    })
  );
  return out;
}

/** How an injury cut one player's game short, for describing that game:
 * null unless it was (isFullGame). */
export function injuryExitFor(history: ProjectionHistory, playerId: number, week: number): { leftInQuarter: number; snapShare: number | null } | null {
  const r = history.weeks[String(week)]?.[String(playerId)];
  if (!r || r.injuryExit !== true || r.injuredAt == null) return null;
  return { leftInQuarter: Math.min(4, Math.floor(r.injuredAt * 4) + 1), snapShare: r.snapShare ?? null };
}

/** Healthy-scratch weeks per player id -- 0-point games ESPN's own
 * season roll-up leaves out (it only counts games he got into). */
export function healthyScratchCounts(history: ProjectionHistory): Map<number, number> {
  const out = new Map<number, number>();
  Object.values(history.weeks).forEach((players) =>
    Object.entries(players).forEach(([id, r]) => {
      if (isHealthyScratch(r)) out.set(Number(id), (out.get(Number(id)) ?? 0) + 1);
    })
  );
  return out;
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
      if (!isFullGame(r) || Math.max(r.espn, r.custom) < MIN_RELEVANT_PROJECTION) return;
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
