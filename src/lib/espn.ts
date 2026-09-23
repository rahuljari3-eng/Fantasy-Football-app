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
  statSplitTypeId?: number;
  appliedTotal?: number;
  appliedAverage?: number;
}
interface EspnPlayer {
  id: number;
  injuryStatus?: string;
  stats?: EspnStatLine[];
}
interface EspnRosterEntry {
  playerPoolEntry?: {
    player?: EspnPlayer;
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

/** This one week's real actual score (statSourceId 0 = actual, scoped to
 * scoringPeriodId so it never picks up the season-level roll-up entry ESPN
 * also sends with scoringPeriodId 0). Null until that player's game for the
 * week has actually started. */
export function extractEspnWeekActual(stats: EspnStatLine[] | undefined, scoringPeriodId: number): number | null {
  const match = (stats || []).find(
    (s) => s.statSourceId === 0 && s.scoringPeriodId === scoringPeriodId && (s.statSplitTypeId ?? 1) === 1
  );
  return match ? Math.round((match.appliedTotal ?? 0) * 10) / 10 : null;
}

/** ESPN's own full-season points-per-game projection (statSourceId 1 =
 * projection, scoringPeriodId 0 = season-level rather than one week) -- see
 * Player.seasonProj. Unlike extractEspnProjection, this doesn't collapse to
 * ~0 for a player who's Questionable/Doubtful/Out this particular week; it's
 * ESPN's season-long model, so a short absence barely moves it. ESPN sends a
 * couple of season-level entries with different statSplitTypeId; either is
 * fine here, just prefer 2 ("rest of season") when both are present. */
export function extractEspnSeasonProjection(stats: EspnStatLine[] | undefined): number | null {
  const candidates = (stats || []).filter((s) => s.statSourceId === 1 && s.scoringPeriodId === 0);
  if (candidates.length === 0) return null;
  const match = candidates.find((s) => s.statSplitTypeId === 2) ?? candidates[0];
  const avg = match.appliedAverage ?? (match.appliedTotal != null ? match.appliedTotal / 17 : null);
  return avg != null ? Math.round(avg * 10) / 10 : null;
}

function toOverride(player: EspnPlayer, period: number): ProjectionOverrides[number] | null {
  const proj = extractEspnProjection(player.stats, period);
  if (proj == null) return null;
  const seasonProj = extractEspnSeasonProjection(player.stats);
  return {
    proj,
    status: ESPN_INJURY_LABEL_MAP[player.injuryStatus ?? ""] || player.injuryStatus || "Healthy",
    ...(seasonProj != null ? { seasonProj } : {}),
  };
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
  /** This one scoring period's total for the player -- their projection
   * before kickoff, their real actual score once the game has started. */
  liveScore: number;
}

/** Same idea as fetchEspnLineups, but also carries each player's live score
 * for the CURRENT week -- what the Matchup tab needs to total up a team's
 * real starting lineup for the current week, including anyone who's already
 * locked in and racking up actual points.
 *
 * Deliberately NOT `playerPoolEntry.appliedStatTotal`: that field is ESPN's
 * season-to-date actual total, not a single week's score (it silently sums
 * every completed week plus whatever's live right now) -- using it here was
 * showing a player's week-1 + week-2 total as if it were just this week's
 * score once more than one week had actuals. Each player's own per-week stat
 * line (scoped by scoringPeriodId) is the only reliable single-week number. */
export async function fetchEspnLiveLineups(): Promise<Record<number, Record<number, EspnLiveLineupEntry>>> {
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`);
  const data = (await res.json()) as EspnLeagueResponse;
  const period = data.scoringPeriodId;
  const lineups: Record<number, Record<number, EspnLiveLineupEntry>> = {};

  (data.teams || []).forEach((t) => {
    const entries: Record<number, EspnLiveLineupEntry> = {};
    (t.roster?.entries || []).forEach((e) => {
      const player = e.playerPoolEntry?.player;
      if (!player || e.lineupSlotId == null) return;
      const weekScore = extractEspnWeekActual(player.stats, period) ?? extractEspnProjection(player.stats, period) ?? 0;
      entries[player.id] = {
        slot: ESPN_LINEUP_SLOT_LABEL[e.lineupSlotId] ?? "BE",
        liveScore: weekScore,
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
      // See the matching comment in lib/espnLeague.ts -- this league's real FA
      // pool runs ~1,000 players, well past the old 300 cap.
      limit: 3000,
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
  id?: string;
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
  const rosterRes = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam`, { headers: { Accept: "application/json" } });
  if (!rosterRes.ok) throw new Error(`ESPN roster request failed (${rosterRes.status})`);
  const rosterData = (await rosterRes.json()) as EspnLeagueResponse;
  const currentWeek = rosterData.scoringPeriodId ?? 1;

  // view=mTransactions2 with no explicit scoringPeriodId only returns the
  // CURRENT week's transactions -- not the whole season. That silently broke
  // this reconstruction entirely: with no draft results in the replay, there
  // was no "expected owner" baseline for almost any player to diff against,
  // so nothing ever looked like a trade. Fetch every week from 1 through now
  // and merge, so the draft, every waiver/FA move, and any trade from an
  // earlier week are all actually in the replay.
  const weeks = Array.from({ length: currentWeek }, (_, i) => i + 1);
  const txResponses = await Promise.all(
    weeks.map((w) => fetch(`${ESPN_LEAGUE_BASE_URL}?view=mTransactions2&scoringPeriodId=${w}`, { headers: { Accept: "application/json" } }))
  );
  if (txResponses.some((r) => !r.ok)) throw new Error("ESPN transactions request failed");
  const txPayloads = (await Promise.all(txResponses.map((r) => r.json()))) as EspnTransactionsResponse[];
  const seenIds = new Set<string>();
  const allTransactions: EspnTransaction[] = [];
  txPayloads.forEach((payload) => {
    (payload.transactions || []).forEach((t) => {
      if (t.id && seenIds.has(t.id)) return;
      if (t.id) seenIds.add(t.id);
      allTransactions.push(t);
    });
  });

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
  const transactions = allTransactions.slice().sort((a, b) => a.proposedDate - b.proposedDate);
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

  // A group only exists here at all because a specific player's current
  // owner disagrees with their draft/waiver baseline -- and the replay never
  // touches expectedOwner on a TRADE item, so that disagreement can ONLY be
  // explained by a real trade having moved them. That holds even when just
  // one side has entries: the other side either sent back a pick/FAAB this
  // reconstruction doesn't track, or sent back a player who was later
  // dropped and re-added, which silently erases that specific player's own
  // diff (see the big comment above) without invalidating the rest of the
  // trade.
  //
  // A player traded TWICE breaks this in a different way: expectedOwner is
  // always their ORIGINAL draft/waiver owner, so their diff lands on
  // (original owner, final owner) -- skipping the team they passed through
  // in the middle. E.g. Kareem Pies trades Rashee Rice to ConkInSon (for
  // Luther Burden III + Travis Etienne Jr.), and ConkInSon later ships
  // Rashee Rice onward to Gibbs me head as part of a totally separate deal.
  // Naively that shows up as two disconnected, seemingly-lopsided groups --
  // "Kareem Pies gave Rashee Rice to Gibbs me head for nothing" and
  // "ConkInSon gave Burden + Etienne to Kareem Pies for nothing" -- with
  // ConkInSon, the real middleman, invisible in both.
  //
  // Repair this by looking for a one-sided group (X gave to R, nothing
  // tracked back) whose player(s) can be explained by ANOTHER one-sided
  // group where some team Z gave to X, nothing tracked back -- but only
  // when Z already has an independently-confirmed (both sides non-empty)
  // trade with R. That confirmation is the load-bearing part: without it,
  // "X's dangling give" and "X's dangling receive" are just as easily two
  // unrelated one-sided trades, and guessing wrong would misattribute
  // players to a team that never touched them. With it, folding X's give
  // into the (X, Z) group -- and adding the same players to Z's side of the
  // already-confirmed (Z, R) trade -- reflects a real two-hop trade chain.
  const isClean = (g: { aToB: number[]; bToA: number[] }) => g.aToB.length > 0 && g.bToA.length > 0;
  const oneSidedGive = (g: { teamAId: number; teamBId: number; aToB: number[]; bToA: number[] }) =>
    g.aToB.length > 0
      ? { giver: g.teamAId, receiver: g.teamBId, players: g.aToB }
      : { giver: g.teamBId, receiver: g.teamAId, players: g.bToA };

  const removedKeys = new Set<string>();
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;
    for (const [key, g] of groups) {
      if (removedKeys.has(key) || isClean(g)) continue;
      const { giver: x, receiver: r, players } = oneSidedGive(g);
      const qualifying = [...groups.entries()]
        .filter(([zKey, zg]) => zKey !== key && !removedKeys.has(zKey) && !isClean(zg) && oneSidedGive(zg).receiver === x)
        .map(([zKey, zg]) => ({ zKey, z: oneSidedGive(zg).giver }))
        .filter(({ z }) => {
          const targetKey = [z, r].sort((n, m) => n - m).join("-");
          const target = groups.get(targetKey);
          return target && !removedKeys.has(targetKey) && isClean(target);
        });
      if (qualifying.length !== 1) continue;

      const { zKey, z } = qualifying[0];
      const zGroup = groups.get(zKey)!;
      if (zGroup.teamAId === x) zGroup.aToB = [...zGroup.aToB, ...players];
      else zGroup.bToA = [...zGroup.bToA, ...players];
      removedKeys.add(key);

      const targetKey = [z, r].sort((n, m) => n - m).join("-");
      const target = groups.get(targetKey)!;
      if (target.teamAId === z) target.aToB = [...target.aToB, ...players];
      else target.bToA = [...target.bToA, ...players];

      mergedSomething = true;
      break; // groups mutated -- rescan from scratch
    }
  }

  return [...groups.entries()]
    .filter(([key]) => !removedKeys.has(key))
    .map(([, g]) => ({
      id: g.teamAId + "-" + g.teamBId,
      teamAId: g.teamAId,
      teamBId: g.teamBId,
      teamAReceived: g.bToA,
      teamBReceived: g.aToB,
    }));
}
