// Direct ESPN API access for the "Refresh from ESPN" button. ESPN's read host
// (lm-api-reads.fantasy.espn.com) sends CORS headers that reflect the
// request's actual Origin for this league, so the browser can call it
// directly -- no backend proxy needed for a refresh.
import { ESPN_LEAGUE_BASE_URL } from "../config/league.js";
import type { PlayerStatus, ProjectionOverrides } from "../types.js";

export const ESPN_INJURY_LABEL_MAP: Record<string, PlayerStatus> = {
  ACTIVE: "Healthy",
  QUESTIONABLE: "Questionable",
  DOUBTFUL: "Doubtful",
  OUT: "Out",
  INJURY_RESERVE: "IR",
  SUSPENSION: "Suspended",
  NORMAL: "Healthy",
};

// Minimal shape of the bits of ESPN's response this app actually reads --
// ESPN's real payload has many more fields we don't care about.
interface EspnStatLine {
  statSourceId: number;
  scoringPeriodId: number;
  appliedTotal?: number;
}
interface EspnPlayer {
  id: number;
  injuryStatus?: string;
  stats?: EspnStatLine[];
}
interface EspnRosterEntry {
  playerPoolEntry?: {
    player?: EspnPlayer;
    /** ESPN's own live/current total for this player this scoring period --
     * equals their projection before kickoff, then their real accumulating
     * score once the game has started. */
    appliedStatTotal?: number;
  };
  lineupSlotId?: number;
}
interface EspnTeam {
  id: number;
  roster?: { entries?: EspnRosterEntry[] };
}
interface EspnLeagueResponse {
  scoringPeriodId: number;
  teams?: EspnTeam[];
}
interface EspnFreeAgentEntry {
  player?: EspnPlayer;
}

// ESPN's numeric lineupSlotId -> the same slot-label strings the rest of the
// app already understands (see ESPN_SLOT_TARGETS in lib/teamRoster.ts).
// Covers this league's standard 1QB/2RB/2WR/1TE/1FLEX/1DST/1K format.
export const ESPN_LINEUP_SLOT_LABEL: Record<number, string> = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  23: "FLEX",
  16: "DST",
  17: "K",
  20: "BE",
  21: "IR",
};

export function extractEspnProjection(stats: EspnStatLine[] | undefined, scoringPeriodId: number): number | null {
  const match = (stats || []).find((s) => s.statSourceId === 1 && s.scoringPeriodId === scoringPeriodId);
  return match ? Math.round((match.appliedTotal ?? 0) * 10) / 10 : null;
}

function toOverride(player: EspnPlayer, period: number): ProjectionOverrides[number] | null {
  const proj = extractEspnProjection(player.stats, period);
  if (proj == null) return null;
  return { proj, status: ESPN_INJURY_LABEL_MAP[player.injuryStatus ?? ""] || player.injuryStatus || "Healthy" };
}

/** Primary path: pull real Week-N projections (and current injury status)
 * directly from ESPN for every ROSTERED player across all 12 teams in one
 * request. This is ESPN's own number, not an estimate. */
export async function fetchEspnRosteredProjections(): Promise<{
  fresh: ProjectionOverrides;
  period: number;
  count: number;
}> {
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam&view=mStatus`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`);
  const data = (await res.json()) as EspnLeagueResponse;
  const period = data.scoringPeriodId;
  const fresh: ProjectionOverrides = {};

  (data.teams || []).forEach((t) => {
    (t.roster?.entries || []).forEach((e) => {
      const player = e.playerPoolEntry?.player;
      if (!player) return;
      const override = toOverride(player, period);
      if (override) fresh[player.id] = override;
    });
  });

  return { fresh, period, count: Object.keys(fresh).length };
}

/** Every team's real, current ESPN lineup: espnTeamId -> playerId -> slot
 * label ("QB", "RB", "FLEX", "BE", "IR", ...). Used to detect when a manager
 * has changed their lineup in the ESPN app so the roster builder can adopt
 * it -- see syncRosterFromEspn in useFantasyApp. */
export async function fetchEspnLineups(): Promise<Record<number, Record<number, string>>> {
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`);
  const data = (await res.json()) as EspnLeagueResponse;
  const lineups: Record<number, Record<number, string>> = {};

  (data.teams || []).forEach((t) => {
    const slots: Record<number, string> = {};
    (t.roster?.entries || []).forEach((e) => {
      const player = e.playerPoolEntry?.player;
      if (!player || e.lineupSlotId == null) return;
      slots[player.id] = ESPN_LINEUP_SLOT_LABEL[e.lineupSlotId] ?? "BE";
    });
    lineups[t.id] = slots;
  });

  return lineups;
}

export interface EspnLiveLineupEntry {
  slot: string;
  /** ESPN's own live/current total for this player this scoring period --
   * their projection before kickoff, their real accumulating score once the
   * game has started. */
  liveScore: number;
}

/** Same idea as fetchEspnLineups, but also carries each player's live score
 * (ESPN's own appliedStatTotal) -- what the Matchup tab needs to total up a
 * team's real starting lineup for the current week, including anyone who's
 * already locked in and racking up actual points. */
export async function fetchEspnLiveLineups(): Promise<Record<number, Record<number, EspnLiveLineupEntry>>> {
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`);
  const data = (await res.json()) as EspnLeagueResponse;
  const lineups: Record<number, Record<number, EspnLiveLineupEntry>> = {};

  (data.teams || []).forEach((t) => {
    const entries: Record<number, EspnLiveLineupEntry> = {};
    (t.roster?.entries || []).forEach((e) => {
      const player = e.playerPoolEntry?.player;
      if (!player || e.lineupSlotId == null) return;
      entries[player.id] = {
        slot: ESPN_LINEUP_SLOT_LABEL[e.lineupSlotId] ?? "BE",
        liveScore: Math.round((e.playerPoolEntry?.appliedStatTotal ?? 0) * 10) / 10,
      };
    });
    lineups[t.id] = entries;
  });

  return lineups;
}

/** Same idea, but for the free-agent pool (the Free Agents tab) -- a separate
 * ESPN endpoint, since /players (not team rosters) is where unrostered
 * players live. */
export async function fetchEspnFreeAgentProjections(period: number): Promise<ProjectionOverrides> {
  const filter = {
    players: {
      limit: 300,
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}/players?view=kona_player_info`, {
    headers: { Accept: "application/json", "x-fantasy-filter": JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error(`ESPN free-agent request failed (${res.status})`);
  const data = (await res.json()) as EspnFreeAgentEntry[] | EspnPlayer[];
  const fresh: ProjectionOverrides = {};

  (Array.isArray(data) ? data : []).forEach((entry) => {
    const player: EspnPlayer | undefined = "player" in entry ? entry.player : (entry as EspnPlayer);
    if (!player) return;
    const override = toOverride(player, period);
    if (override) fresh[player.id] = override;
  });

  return fresh;
}

interface EspnTransactionItem {
  type: string;
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
}
interface EspnTransaction {
  type: string;
  proposedDate: number;
  items?: EspnTransactionItem[];
}
interface EspnTransactionsResponse {
  transactions?: EspnTransaction[];
}

export interface CompletedTrade {
  id: string;
  teamAId: number;
  teamBId: number;
  /** Player ids team A received (i.e. team B sent them). */
  teamAReceived: number[];
  /** Player ids team B received (i.e. team A sent them). */
  teamBReceived: number[];
}

/** Completed trades, reconstructed from public data. ESPN keeps a trade's
 * itemized contents private (to the two teams involved) even after it's
 * accepted -- there's no "trade completed: X for Y" record on the
 * unauthenticated read this app otherwise uses -- so this replays every
 * draft pick and waiver add/drop in order to compute who "should" own each
 * player, then diffs that against who actually owns them right now. Any gap
 * can only be explained by a trade. Only pairs where players moved in BOTH
 * directions are returned -- a trade where the other side has since been
 * dropped/re-added erases its own paper trail and can't be reconstructed. */
export async function fetchEspnCompletedTrades(): Promise<CompletedTrade[]> {
  const [txRes, rosterRes] = await Promise.all([
    fetch(`${ESPN_LEAGUE_BASE_URL}?view=mTransactions2`, { headers: { Accept: "application/json" } }),
    fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam`, { headers: { Accept: "application/json" } }),
  ]);
  if (!txRes.ok) throw new Error(`ESPN transactions request failed (${txRes.status})`);
  if (!rosterRes.ok) throw new Error(`ESPN roster request failed (${rosterRes.status})`);

  const txData = (await txRes.json()) as EspnTransactionsResponse;
  const rosterData = (await rosterRes.json()) as EspnLeagueResponse;

  const currentOwner = new Map<number, number>();
  (rosterData.teams || []).forEach((t) => {
    (t.roster?.entries || []).forEach((e) => {
      const pid = e.playerPoolEntry?.player?.id;
      if (pid != null) currentOwner.set(pid, t.id);
    });
  });

  // Replay draft/waiver/free-agent moves in chronological order to compute
  // each player's expected owner if no trade had ever touched them.
  const expectedOwner = new Map<number, number>();
  const transactions = (txData.transactions || []).slice().sort((a, b) => a.proposedDate - b.proposedDate);
  transactions.forEach((t) => {
    if (!["DRAFT", "WAIVER", "FREEAGENT", "FUTURE_ROSTER"].includes(t.type)) return;
    (t.items || []).forEach((i) => {
      if (!["DRAFT", "ADD", "DROP"].includes(i.type)) return;
      if (i.toTeamId && i.toTeamId !== 0) expectedOwner.set(i.playerId, i.toTeamId);
      else if (i.fromTeamId && i.fromTeamId !== 0 && (!i.toTeamId || i.toTeamId === 0)) expectedOwner.delete(i.playerId);
    });
  });

  const groups = new Map<string, { teamAId: number; teamBId: number; aToB: number[]; bToA: number[] }>();
  currentOwner.forEach((owner, playerId) => {
    const expected = expectedOwner.get(playerId);
    if (expected == null || expected === owner) return;
    const [teamAId, teamBId] = [expected, owner].sort((a, b) => a - b);
    const key = `${teamAId}-${teamBId}`;
    const g = groups.get(key) ?? { teamAId, teamBId, aToB: [], bToA: [] };
    if (expected === teamAId) g.aToB.push(playerId);
    else g.bToA.push(playerId);
    groups.set(key, g);
  });

  return [...groups.values()]
    .filter((g) => g.aToB.length > 0 && g.bToA.length > 0)
    .map((g) => ({
      id: g.teamAId + "-" + g.teamBId,
      teamAId: g.teamAId,
      teamBId: g.teamBId,
      teamAReceived: g.bToA,
      teamBReceived: g.aToB,
    }));
}
