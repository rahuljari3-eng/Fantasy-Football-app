// Shared domain types for the whole app. Keeping these in one place means every
// page/hook/lib module agrees on the exact shape of a "player" or "team" instead
// of each file inventing its own loose object shape.

export type Position = "QB" | "RB" | "WR" | "TE" | "DST" | "K";

// Statuses are mostly the human-readable labels used across the app ("Healthy",
// "Questionable", ...), but raw ESPN roster data occasionally leaks its own enum
// value straight through (e.g. "DAY_TO_DAY") when it isn't covered by the
// ESPN_INJURY_LABEL_MAP translation table in lib/espn.ts -- so this stays a
// deliberately open string type rather than a strict enum.
export type PlayerStatus = string;

export type Tier = 1 | 2 | 3;

/** A player as they appear in the free-agent pool / your own roster data. */
export interface Player {
  id: number;
  name: string;
  pos: Position;
  team: string;
  bye: number;
  proj: number;
  tier: Tier;
  status: PlayerStatus;
  /** 1-based rank among all known players at this position (by projection),
   * filled in at runtime. Drives the rank-chart component of trade value --
   * see lib/scoring.ts. Absent on raw static data. */
  posRank?: number;
}

/** A player entry inside a league team's roster (ESPN also tells us slot/starter). */
export interface RosterPlayer extends Player {
  starter: boolean;
  /** ESPN lineup slot, e.g. "RB", "FLEX", "BE" (bench), "IR". */
  slot: string;
}

export interface LeagueTeam {
  id: number;
  name: string;
  owner: string;
  roster: RosterPlayer[];
}

/** A league roster player tagged with which fantasy team owns them — used once
 * every team's roster is flattened into one searchable pool (trade analyzer,
 * AI coach). */
export interface LeaguePlayer extends RosterPlayer {
  fantasyTeamId: number;
  fantasyTeamName: string;
}

/** Your starting lineup slot ids (distinct from ESPN's own slot strings above). */
export type RosterSlotId = "QB" | "RB1" | "RB2" | "WR1" | "WR2" | "TE" | "FLEX" | "DST" | "K";

/** Maps a starting slot to the id of the player filling it (absent = empty). */
export type RosterAssignments = Partial<Record<RosterSlotId, number>>;

export type NewsType = "Injury" | "Waiver" | "Trade" | "News";

/** How serious an injury item actually looks, graded from ESPN's own status
 * designation plus keyword cues in the report text -- see gradeInjury in
 * lib/news.ts. Only ever set on items that read like a genuine injury (or
 * possibility of one); reports that don't actually describe an injury are
 * reclassified as type "News" instead of graded here. */
export type InjurySeverity = "severe" | "moderate" | "minor";

/** A single news/injury item pulled live from ESPN, tagged to the player it's
 * about wherever ESPN tells us which player that is -- see lib/news.ts. */
export interface NewsItem {
  id: string;
  type: NewsType;
  /** The real ESPN player id this item is about, so it can be matched against
   * Player.id anywhere in the app (roster, free agents, trade analyzer, ...). */
  playerId: number;
  player: string;
  headline: string;
  /** Human-readable relative/absolute time for display (e.g. "2h ago", "Sep 2"). */
  time: string;
  /** ISO timestamp, used for sorting newest-first. */
  publishedAt: string;
  /** Real ESPN article/player-news URL this item links to. */
  link: string;
  /** Only set for type "Injury" -- see InjurySeverity. */
  severity?: InjurySeverity;
}

/** A live-refresh correction layered on top of a player's static base data,
 * keyed by ESPN player id. */
export interface ProjectionOverride {
  proj?: number;
  status?: PlayerStatus;
}

export type ProjectionOverrides = Record<number, ProjectionOverride>;

/** How favorable a player's real-world matchup looks this week, from A
 * (plus matchup) to F (brutal) -- see gradeMatchup in lib/matchup.ts. */
export type MatchupGrade = "A" | "B" | "C" | "D" | "F";

/** A player's real-world matchup for the current week, derived from that
 * week's live NFL schedule + Vegas lines (see lib/matchup.ts). Combines two
 * signals: the game's overall implied scoring environment (team total), and
 * -- for QB/RB/WR/TE -- that specific player's own posted yardage prop line,
 * which captures their expected volume/role rather than just the game
 * script. Neither comes from defense-vs-position stats, since those don't
 * exist yet in the first weeks of a season; the market already bakes in
 * matchup difficulty, injuries, and expected usage. */
export interface PlayerMatchup {
  opponent: string | null;
  homeAway: "home" | "away" | null;
  isBye: boolean;
  /** Combined grade -- team environment alone if no player prop line applies
   * (K, DST, or no line posted yet), otherwise blended with `propLine`. */
  grade: MatchupGrade | null;
  /** The implied point total driving the team-environment half of `grade` --
   * the player's own team's for offensive positions/K, the opponent's for
   * DST (a stingier expected opponent output is the better matchup for your
   * defense). Null if Vegas hasn't posted a line for this game yet. */
  impliedTotal: number | null;
  /** The player's own posted yardage prop for the week (passing/rushing/
   * receiving, whichever applies to their position) and the grade it implies
   * on its own. Null for K/DST or if no line has posted for this player. */
  propLine: { label: string; grade: MatchupGrade } | null;
  /** Human-readable summary, e.g. "vs SEA — implied 24.3 pts, 68.5 proj. rush yds". */
  label: string;
}

/** A suggestion to start a bench player over a current starter -- see
 * benchUpgradeSuggestions in useFantasyApp. */
export interface BenchSuggestion {
  benchPlayer: Player;
  starter: Player;
  slot: RosterSlotId;
  reason: string;
}

/** A player scored for roster-needs analysis: base stats plus its computed
 * injury/tier-adjusted quality score. */
export type ScoredPlayer<P extends Player = Player> = P & { qScore: number };

export interface PositionNeed {
  pos: Position;
  players: ScoredPlayer[];
  count: number;
  starters: ScoredPlayer[];
  weakestStarter: ScoredPlayer | null;
  starterScore: number;
  hasEnoughBodies: boolean;
  /** Bench players (tier 1-2, not Out) good enough that another team would want them. */
  tradeableDepth: ScoredPlayer[];
}

export type RosterNeeds = Record<Position, PositionNeed>;

export type TradeReason = "need" | "value" | "fallback";

export interface TradeSuggestion {
  id: string;
  teamId: number;
  teamName: string;
  give: Player[];
  get: Player[];
  needPos: Position;
  overlapPos: Position;
  /** Team-need-adjusted value of what you send / receive. */
  giveVal: number;
  getVal: number;
  /** getVal / giveVal -- > 1 favors you, < 1 favors the other side. */
  ratio: number;
  upgrade: number;
  reason: TradeReason;
}

export type TradeHorizon = "week" | "season";

export type TabId = "roster" | "freeagents" | "lineup" | "trade" | "coach" | "league" | "news";

export interface RefreshProgress {
  done: number;
  total: number;
}

/** A team as shown in the League tab's drill-down view -- either a real
 * LeagueTeam (opponent) or the synthetic "your team" entry built from your
 * own roster + bench. */
export interface ViewedTeam {
  id: number | "mine";
  name: string;
  owner: string;
  roster: RosterPlayer[];
}
