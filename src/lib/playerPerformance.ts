// Live / final player fantasy scores + NFL box-score lines for Sensei
// ("how did X do today?"). ESPN already ships actuals on mRoster as
// statSourceId === 0 (projections are 1) -- the rest of the app only ever
// read projections, so this module is the missing half.
import { ESPN_LEAGUE_BASE_URL, LEAGUE_CONFIG } from "../config/league.js";
import { ESPN_LINEUP_SLOT_LABEL } from "./espn.js";

interface EspnStatLine {
  statSourceId?: number;
  scoringPeriodId?: number;
  statSplitTypeId?: number;
  seasonId?: number;
  appliedTotal?: number;
  appliedAverage?: number;
  appliedStats?: Record<string, number>;
  stats?: Record<string, number>;
  externalId?: string;
  id?: string;
}

interface EspnPlayer {
  id: number;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  injuryStatus?: string;
  stats?: EspnStatLine[];
}

interface EspnRosterEntry {
  playerPoolEntry?: { player?: EspnPlayer };
  lineupSlotId?: number;
}

interface EspnTeam {
  id: number;
  abbrev?: string;
  name?: string;
  roster?: { entries?: EspnRosterEntry[] };
}

interface EspnLeagueResponse {
  scoringPeriodId?: number;
  teams?: EspnTeam[];
}

interface RosterIndexEntry {
  player: EspnPlayer;
  teamId: number | null;
  teamName: string | null;
  lineupSlotId: number | null;
}

export interface LeagueWeekScoreRow {
  playerId: number;
  name: string;
  fantasyTeamId: number | null;
  fantasyTeamName: string | null;
  slot: string;
  isStarter: boolean;
  actualPoints: number | null;
  projectedPoints: number | null;
  eventId: string | null;
  game: WeekPerformance["game"];
}

export interface TeamWeekScore {
  teamId: number;
  teamName: string;
  week: number;
  currentWeek: number;
  /** Sum of starter actuals so far (bench excluded) — what the fantasy matchup totals. */
  starterActualTotal: number;
  /** Sum of bench/IR actuals so far. */
  benchActualTotal: number;
  /** Starter projections for players who haven't scored yet, plus actuals already in. */
  starterProjectedRemaining: number;
  players: LeagueWeekScoreRow[];
  contributors: LeagueWeekScoreRow[];
  /** Bench/IR players who have actual points (do not count toward starterActualTotal). */
  benchContributors: LeagueWeekScoreRow[];
}

const STARTER_SLOTS = new Set(["QB", "RB", "WR", "TE", "FLEX", "DST", "K"]);

const NFL_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const NFL_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Fantasy-relevant ESPN stat ids → short labels (PPR league scoring items). */
const FANTASY_STAT_LABELS: Record<string, string> = {
  "3": "pass_yds",
  "4": "pass_td",
  "19": "pass_2pt",
  "20": "int",
  "24": "rush_yds",
  "25": "rush_td",
  "26": "rush_2pt",
  "42": "rec_yds",
  "43": "rec_td",
  "44": "rec_2pt",
  "53": "receptions",
  "63": "ret_td",
  "72": "fumble_lost",
  "77": "fg_0_39",
  "80": "fg_40_49",
  "85": "fg_miss",
  "86": "xp_made",
  "88": "xp_miss",
  "89": "dst_pts_allowed_0",
  "90": "dst_pts_allowed_1_6",
  "91": "dst_pts_allowed_7_13",
  "92": "dst_pts_allowed_14_17",
  "93": "dst_td",
  "95": "dst_sack",
  "96": "dst_int",
  "97": "dst_fum_rec",
  "98": "dst_safety",
  "99": "dst_block",
  "101": "dst_int_td",
  "102": "dst_fum_td",
  "103": "dst_block_td",
  "104": "dst_kick_td",
  "106": "dst_pts_allowed_28_34",
  "123": "dst_pts_allowed_35_45",
  "198": "bonus_100_rush",
  "201": "bonus_100_rec",
  "206": "bonus_300_pass",
  "209": "bonus_40_yd_rec_td",
};

export interface FantasyStatBreakdown {
  label: string;
  raw: number;
  fantasyPoints: number;
}

export interface WeekPerformance {
  week: number;
  /** Actual fantasy points (null if the game hasn't produced a scoring line yet). */
  actualPoints: number | null;
  /** ESPN's projection for that week (when available). */
  projectedPoints: number | null;
  /** Scoring-relevant appliedStats decoded into readable lines. */
  fantasyBreakdown: FantasyStatBreakdown[];
  /** NFL event id when ESPN linked the scoring line to a real game. */
  eventId: string | null;
  game: {
    name: string | null;
    status: string | null;
    score: string | null;
    kickoff: string | null;
  } | null;
  /** Position-group NFL box-score line (REC/YDS/TD etc.) when the game summary is available. */
  nflBoxLine: {
    category: string;
    labels: string[];
    stats: string[];
  } | null;
}

export interface PlayerPerformanceResult {
  playerId: number;
  name: string;
  fantasyTeamId: number | null;
  fantasyTeamName: string | null;
  currentWeek: number;
  /** The week the caller asked about (defaults to current). */
  week: number;
  thisWeek: WeekPerformance;
  /** Prior weeks this season that already have an actual scoring line, newest first. */
  gameLog: WeekPerformance[];
  seasonToDate: {
    seasonId: number;
    actualPoints: number | null;
    projectedPoints: number | null;
    gamesPlayedEstimate: number | null;
  } | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function decodeBreakdown(appliedStats: Record<string, number> | undefined): FantasyStatBreakdown[] {
  if (!appliedStats) return [];
  return Object.entries(appliedStats)
    .map(([id, fantasyPoints]) => {
      const raw = fantasyPoints; // appliedStats values are already fantasy pts for that bucket
      return {
        label: FANTASY_STAT_LABELS[id] ?? `stat_${id}`,
        raw,
        fantasyPoints: round1(fantasyPoints),
      };
    })
    .filter((s) => s.fantasyPoints !== 0)
    .sort((a, b) => Math.abs(b.fantasyPoints) - Math.abs(a.fantasyPoints));
}

/** Prefer raw counting stats (receptions, yards, TDs) over applied fantasy pts when present. */
function countingStats(raw: Record<string, number> | undefined, applied: Record<string, number> | undefined): FantasyStatBreakdown[] {
  // When ESPN includes both `stats` (counting) and `appliedStats` (fantasy pts),
  // surface counting stats with their fantasy contribution for the answer.
  if (!raw) return decodeBreakdown(applied);
  const out: FantasyStatBreakdown[] = [];
  const add = (id: string, label: string, rawVal: number | undefined) => {
    if (rawVal == null || rawVal === 0) return;
    const fp = applied?.[id];
    out.push({
      label,
      raw: round1(rawVal),
      fantasyPoints: fp != null ? round1(fp) : 0,
    });
  };
  add("3", "pass_yds", raw["3"]);
  add("4", "pass_td", raw["4"]);
  add("20", "int", raw["20"]);
  add("24", "rush_yds", raw["24"]);
  add("25", "rush_td", raw["25"]);
  add("53", "receptions", raw["53"]);
  add("42", "rec_yds", raw["42"]);
  add("43", "rec_td", raw["43"]);
  add("72", "fumble_lost", raw["72"]);
  add("95", "dst_sack", raw["95"]);
  add("96", "dst_int", raw["96"]);
  add("97", "dst_fum_rec", raw["97"]);
  add("86", "xp_made", raw["86"]);
  add("77", "fg_made", raw["77"] ?? raw["80"] ?? raw["74"]);
  // Fall back to applied-only buckets we didn't already cover.
  const covered = new Set(out.map((o) => o.label));
  for (const row of decodeBreakdown(applied)) {
    if (!covered.has(row.label) && !covered.has(row.label.replace(/^stat_/, ""))) {
      out.push(row);
    }
  }
  return out;
}

function weekLines(stats: EspnStatLine[] | undefined, source: 0 | 1): Map<number, EspnStatLine> {
  const map = new Map<number, EspnStatLine>();
  for (const s of stats || []) {
    if (s.statSourceId !== source) continue;
    const week = s.scoringPeriodId ?? 0;
    if (week <= 0) continue;
    if ((s.statSplitTypeId ?? 1) !== 1) continue;
    // Prefer the line that carries an NFL event id when duplicates exist.
    const prev = map.get(week);
    if (!prev || (s.externalId && !prev.externalId)) map.set(week, s);
  }
  return map;
}

function seasonLine(stats: EspnStatLine[] | undefined, source: 0 | 1, seasonId: number): EspnStatLine | null {
  for (const s of stats || []) {
    if (s.statSourceId !== source) continue;
    if ((s.scoringPeriodId ?? -1) !== 0) continue;
    if ((s.statSplitTypeId ?? 0) !== 0) continue;
    if (s.seasonId != null && s.seasonId !== seasonId) continue;
    return s;
  }
  return null;
}

interface ScoreboardEvent {
  id?: string;
  name?: string;
  date?: string;
  status?: { type?: { name?: string; description?: string; completed?: boolean } };
  competitions?: {
    competitors?: { team?: { abbreviation?: string }; score?: string; homeAway?: string }[];
  }[];
}

async function fetchScoreboardEvents(): Promise<Map<string, ScoreboardEvent>> {
  const res = await fetch(NFL_SCOREBOARD_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) return new Map();
  const data = (await res.json()) as { events?: ScoreboardEvent[] };
  const map = new Map<string, ScoreboardEvent>();
  for (const e of data.events || []) {
    if (e.id) map.set(String(e.id), e);
  }
  return map;
}

function formatGame(event: ScoreboardEvent | undefined): WeekPerformance["game"] {
  if (!event) return null;
  const comps = event.competitions?.[0]?.competitors || [];
  const score =
    comps.length >= 2
      ? comps
          .map((c) => `${c.team?.abbreviation ?? "?"}${c.score != null ? ` ${c.score}` : ""}`)
          .join(" – ")
      : null;
  return {
    name: event.name ?? null,
    status: event.status?.type?.description ?? event.status?.type?.name ?? null,
    score,
    kickoff: event.date ?? null,
  };
}

async function fetchNflBoxLine(
  eventId: string,
  athleteId: number
): Promise<WeekPerformance["nflBoxLine"]> {
  try {
    const res = await fetch(`${NFL_SUMMARY_URL}?event=${encodeURIComponent(eventId)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      boxscore?: {
        players?: {
          statistics?: {
            name?: string;
            labels?: string[];
            names?: string[];
            athletes?: { athlete?: { id?: string; displayName?: string }; stats?: string[] }[];
          }[];
        }[];
      };
    };
    for (const team of data.boxscore?.players || []) {
      for (const group of team.statistics || []) {
        for (const row of group.athletes || []) {
          if (String(row.athlete?.id) !== String(athleteId)) continue;
          return {
            category: group.name ?? "stats",
            labels: group.labels ?? group.names ?? [],
            stats: row.stats ?? [],
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildWeekPerformance(
  week: number,
  actual: EspnStatLine | undefined,
  projected: EspnStatLine | undefined,
  events: Map<string, ScoreboardEvent>
): WeekPerformance {
  const eventId = actual?.externalId && /^\d+$/.test(actual.externalId) ? actual.externalId : null;
  return {
    week,
    actualPoints: actual?.appliedTotal != null ? round1(actual.appliedTotal) : null,
    projectedPoints: projected?.appliedTotal != null ? round1(projected.appliedTotal) : null,
    fantasyBreakdown: countingStats(actual?.stats, actual?.appliedStats),
    eventId,
    game: eventId ? formatGame(events.get(eventId)) : null,
    nflBoxLine: null,
  };
}

let cache: {
  at: number;
  scoringPeriodId: number;
  byId: Map<number, RosterIndexEntry>;
  entries: RosterIndexEntry[];
} | null = null;
const CACHE_TTL_MS = 45_000;

async function loadRosterIndex(): Promise<{
  scoringPeriodId: number;
  byId: Map<number, RosterIndexEntry>;
  entries: RosterIndexEntry[];
}> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { scoringPeriodId: cache.scoringPeriodId, byId: cache.byId, entries: cache.entries };
  }
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam&view=mStatus`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN roster request failed (${res.status})`);
  const data = (await res.json()) as EspnLeagueResponse;
  const byId = new Map<number, RosterIndexEntry>();
  const entries: RosterIndexEntry[] = [];
  for (const t of data.teams || []) {
    const teamName = t.name || t.abbrev || `Team ${t.id}`;
    for (const e of t.roster?.entries || []) {
      const player = e.playerPoolEntry?.player;
      if (!player) continue;
      const row: RosterIndexEntry = {
        player,
        teamId: t.id,
        teamName,
        lineupSlotId: e.lineupSlotId ?? null,
      };
      byId.set(player.id, row);
      entries.push(row);
    }
  }
  cache = { at: Date.now(), scoringPeriodId: data.scoringPeriodId ?? 1, byId, entries };
  return { scoringPeriodId: cache.scoringPeriodId, byId: cache.byId, entries: cache.entries };
}

function slotLabel(lineupSlotId: number | null): string {
  if (lineupSlotId == null) return "BE";
  return ESPN_LINEUP_SLOT_LABEL[lineupSlotId] ?? "BE";
}

function toWeekScoreRow(
  entry: RosterIndexEntry,
  week: number,
  events: Map<string, ScoreboardEvent>
): LeagueWeekScoreRow {
  const actuals = weekLines(entry.player.stats, 0);
  const projs = weekLines(entry.player.stats, 1);
  const actual = actuals.get(week);
  const projected = projs.get(week);
  const eventId = actual?.externalId && /^\d+$/.test(actual.externalId) ? actual.externalId : null;
  const slot = slotLabel(entry.lineupSlotId);
  return {
    playerId: entry.player.id,
    name: entry.player.fullName || `Player ${entry.player.id}`,
    fantasyTeamId: entry.teamId,
    fantasyTeamName: entry.teamName,
    slot,
    isStarter: STARTER_SLOTS.has(slot),
    actualPoints: actual?.appliedTotal != null ? round1(actual.appliedTotal) : null,
    projectedPoints: projected?.appliedTotal != null ? round1(projected.appliedTotal) : null,
    eventId,
    game: eventId ? formatGame(events.get(eventId)) : null,
  };
}

/** Every rostered player's week actual/proj line (league-wide). */
export async function fetchLeagueWeekScores(week?: number): Promise<{
  week: number;
  currentWeek: number;
  players: LeagueWeekScoreRow[];
}> {
  const { scoringPeriodId, entries } = await loadRosterIndex();
  const targetWeek = week ?? scoringPeriodId;
  const events = await fetchScoreboardEvents();
  const players = entries
    .map((e) => toWeekScoreRow(e, targetWeek, events))
    .sort((a, b) => (b.actualPoints ?? -1) - (a.actualPoints ?? -1) || (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0));
  return { week: targetWeek, currentWeek: scoringPeriodId, players };
}

/** One fantasy team's week scoreboard: every rostered player + starter/bench totals. */
export async function fetchTeamWeekScore(teamId: number, week?: number): Promise<TeamWeekScore | null> {
  const { week: targetWeek, currentWeek, players } = await fetchLeagueWeekScores(week);
  const teamPlayers = players.filter((p) => p.fantasyTeamId === teamId);
  if (!teamPlayers.length) return null;
  const teamName = teamPlayers[0].fantasyTeamName || `Team ${teamId}`;
  const starters = teamPlayers.filter((p) => p.isStarter);
  const bench = teamPlayers.filter((p) => !p.isStarter);
  const starterActualTotal = round1(starters.reduce((s, p) => s + (p.actualPoints ?? 0), 0));
  const benchActualTotal = round1(bench.reduce((s, p) => s + (p.actualPoints ?? 0), 0));
  // Projected points still "outstanding" for starters with no actual yet.
  const starterProjectedRemaining = round1(
    starters.filter((p) => p.actualPoints == null).reduce((s, p) => s + (p.projectedPoints ?? 0), 0)
  );
  const contributors = starters
    .filter((p) => p.actualPoints != null && p.actualPoints !== 0)
    .sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0));
  const benchContributors = bench
    .filter((p) => p.actualPoints != null && p.actualPoints !== 0)
    .sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0));
  return {
    teamId,
    teamName,
    week: targetWeek,
    currentWeek,
    starterActualTotal,
    benchActualTotal,
    starterProjectedRemaining,
    players: teamPlayers.sort((a, b) => Number(b.isStarter) - Number(a.isStarter) || (b.actualPoints ?? -1) - (a.actualPoints ?? -1)),
    contributors,
    benchContributors,
  };
}

export interface NflGameSummary {
  eventId: string;
  name: string | null;
  status: string | null;
  score: string | null;
  kickoff: string | null;
  completed: boolean;
  inProgress: boolean;
}

/** NFL games on the current scoreboard (today/this slate). */
export async function fetchNflScoreboardGames(): Promise<NflGameSummary[]> {
  const events = await fetchScoreboardEvents();
  return [...events.values()].map((e) => {
    const statusName = e.status?.type?.name ?? "";
    const completed = Boolean(e.status?.type?.completed) || statusName === "STATUS_FINAL";
    const inProgress =
      !completed &&
      (statusName.includes("IN_PROGRESS") ||
        statusName.includes("HALFTIME") ||
        statusName === "STATUS_END_PERIOD" ||
        Boolean(e.status?.type?.description?.toLowerCase().includes("progress")));
    const game = formatGame(e);
    return {
      eventId: String(e.id),
      name: game?.name ?? e.name ?? null,
      status: game?.status ?? null,
      score: game?.score ?? null,
      kickoff: game?.kickoff ?? null,
      completed,
      inProgress,
    };
  });
}

/**
 * Top fantasy scorers for a week, optionally scoped to tonight's NFL games
 * (final + in-progress on the scoreboard) or a specific event id.
 */
export async function fetchTopScorers(opts: {
  week?: number;
  eventId?: string;
  tonightOnly?: boolean;
  limit?: number;
  minPoints?: number;
} = {}): Promise<{
  week: number;
  currentWeek: number;
  scope: "week" | "tonight" | "event";
  games: NflGameSummary[];
  scorers: LeagueWeekScoreRow[];
}> {
  const { week, currentWeek, players } = await fetchLeagueWeekScores(opts.week);
  const games = await fetchNflScoreboardGames();
  const limit = Math.max(1, Math.min(50, opts.limit ?? 15));
  const minPoints = opts.minPoints ?? 0;

  let scope: "week" | "tonight" | "event" = "week";
  let eventFilter: Set<string> | null = null;

  if (opts.eventId) {
    scope = "event";
    eventFilter = new Set([String(opts.eventId)]);
  } else if (opts.tonightOnly) {
    scope = "tonight";
    const tonight = games.filter((g) => g.completed || g.inProgress);
    eventFilter = new Set(tonight.map((g) => g.eventId));
  }

  let scorers = players.filter((p) => p.actualPoints != null && (p.actualPoints ?? 0) >= minPoints);
  if (eventFilter) {
    scorers = scorers.filter((p) => p.eventId != null && eventFilter!.has(p.eventId));
  }
  scorers = scorers.sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0)).slice(0, limit);

  const relevantGames =
    scope === "week"
      ? games.filter((g) => scorers.some((s) => s.eventId === g.eventId))
      : games.filter((g) => (eventFilter ? eventFilter.has(g.eventId) : true));

  return { week, currentWeek, scope, games: relevantGames, scorers };
}

async function fetchSinglePlayer(playerId: number): Promise<EspnPlayer | null> {
  const filter = {
    players: {
      filterIds: { value: [playerId] },
      limit: 1,
    },
  };
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}/players?view=kona_player_info`, {
    headers: { Accept: "application/json", "x-fantasy-filter": JSON.stringify(filter) },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { player?: EspnPlayer }[] | EspnPlayer[];
  const entry = Array.isArray(data) ? data[0] : null;
  if (!entry) return null;
  return "player" in entry && entry.player ? entry.player : (entry as EspnPlayer);
}

/** Look up one player's week performance + season game log from live ESPN data. */
export async function fetchPlayerPerformance(
  playerId: number,
  week?: number,
  opts: { includeNflBoxScore?: boolean } = {}
): Promise<PlayerPerformanceResult | null> {
  const includeBox = opts.includeNflBoxScore !== false;
  const { scoringPeriodId, byId } = await loadRosterIndex();
  let hit = byId.get(playerId);
  if (!hit) {
    const player = await fetchSinglePlayer(playerId);
    if (!player) return null;
    hit = { player, teamId: null, teamName: null, lineupSlotId: null };
  }

  const entry = hit;
  const targetWeek = week ?? scoringPeriodId;
  const actuals = weekLines(entry.player.stats, 0);
  const projs = weekLines(entry.player.stats, 1);
  const events = await fetchScoreboardEvents();

  const thisWeek = buildWeekPerformance(targetWeek, actuals.get(targetWeek), projs.get(targetWeek), events);
  if (includeBox && thisWeek.eventId && thisWeek.actualPoints != null) {
    thisWeek.nflBoxLine = await fetchNflBoxLine(thisWeek.eventId, playerId);
  }

  const gameLog: WeekPerformance[] = [...actuals.keys()]
    .filter((w) => w !== targetWeek)
    .sort((a, b) => b - a)
    .map((w) => buildWeekPerformance(w, actuals.get(w), projs.get(w), events));

  // Optionally attach box lines for the most recent prior game too (cheap enough).
  if (includeBox && gameLog[0]?.eventId && gameLog[0].actualPoints != null) {
    gameLog[0].nflBoxLine = await fetchNflBoxLine(gameLog[0].eventId!, playerId);
  }

  const seasonActual = seasonLine(entry.player.stats, 0, LEAGUE_CONFIG.espnSeason);
  const seasonProj = seasonLine(entry.player.stats, 1, LEAGUE_CONFIG.espnSeason);

  return {
    playerId,
    name: entry.player.fullName || `Player ${playerId}`,
    fantasyTeamId: entry.teamId,
    fantasyTeamName: entry.teamName,
    currentWeek: scoringPeriodId,
    week: targetWeek,
    thisWeek,
    gameLog,
    seasonToDate: seasonActual || seasonProj
      ? {
          seasonId: LEAGUE_CONFIG.espnSeason,
          actualPoints: seasonActual?.appliedTotal != null ? round1(seasonActual.appliedTotal) : null,
          projectedPoints: seasonProj?.appliedTotal != null ? round1(seasonProj.appliedTotal) : null,
          gamesPlayedEstimate: seasonActual?.appliedAverage
            ? Math.round((seasonActual.appliedTotal ?? 0) / seasonActual.appliedAverage)
            : actuals.size || null,
        }
      : null,
  };
}
