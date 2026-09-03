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

export interface NewsItem {
  id: number;
  type: NewsType;
  player: string;
  team: string;
  headline: string;
  time: string;
}

/** A live-refresh correction layered on top of a player's static base data,
 * keyed by ESPN player id. */
export interface ProjectionOverride {
  proj?: number;
  status?: PlayerStatus;
}

export type ProjectionOverrides = Record<number, ProjectionOverride>;

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
  giveVal: number;
  getVal: number;
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
