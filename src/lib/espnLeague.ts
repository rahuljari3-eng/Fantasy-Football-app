// Live ESPN league reads for Roster Sensei: standings, fantasy matchups,
// and full roster / free-agent ownership sync.
import { ESPN_LEAGUE_BASE_URL, LEAGUE_CONFIG } from "../config/league.js";
import { applyPropLines, consensusFor, fetchConsensusSources, type ConsensusSources } from "./consensus.js";
import { fetchWeeklyMatchups, type PlayerPropLines } from "./matchup.js";
import type { LeagueTeam, Player, Position, RosterPlayer, Tier } from "../types.js";
import {
  ESPN_INJURY_LABEL_MAP,
  ESPN_LINEUP_SLOT_LABEL,
  ESPN_POS,
  extractEspnSeasonActual,
  type EspnStatLine,
  extractEspnProjection,
  extractEspnSeasonProjection,
} from "./espn.js";
import { getNflSchedule } from "./nflSchedule.js";

export { ESPN_POS };


interface EspnPlayer {
  id: number;
  fullName?: string;
  injuryStatus?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  stats?: EspnStatLine[];
  ownership?: { percentOwned?: number };
}

interface EspnRosterEntry {
  lineupSlotId?: number;
  playerPoolEntry?: { player?: EspnPlayer };
}

interface EspnTeamRecordOverall {
  wins?: number;
  losses?: number;
  ties?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  percentage?: number;
  streakType?: string;
  streakLength?: number;
}

interface EspnTeam {
  id: number;
  name?: string;
  abbrev?: string;
  primaryOwner?: string;
  playoffSeed?: number;
  points?: number;
  record?: { overall?: EspnTeamRecordOverall };
  roster?: { entries?: EspnRosterEntry[] };
}

interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

interface EspnMatchupSide {
  teamId?: number;
  totalPoints?: number;
}

interface EspnMatchup {
  matchupPeriodId?: number;
  winner?: string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

interface EspnLeaguePayload {
  scoringPeriodId?: number;
  teams?: EspnTeam[];
  members?: EspnMember[];
  schedule?: EspnMatchup[];
}

interface EspnFaEntry {
  player?: EspnPlayer;
}

export interface StandingRow {
  teamId: number;
  name: string;
  owner: string;
  abbrev: string | null;
  seed: number | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  winPct: number;
  streak: string | null;
}

export interface MatchupRow {
  week: number;
  home: { teamId: number; name: string; owner: string; points: number };
  away: { teamId: number; name: string; owner: string; points: number };
  winner: string;
}

export interface LiveLeagueSnapshot {
  fetchedAt: number;
  scoringPeriodId: number;
  teams: LeagueTeam[];
  freeAgents: Player[];
  standings: StandingRow[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let liveCache: LiveLeagueSnapshot | null = null;

export function getLiveLeagueCache(): LiveLeagueSnapshot | null {
  return liveCache;
}

export function clearLiveLeagueCache(): void {
  liveCache = null;
}

function memberLabel(members: EspnMember[], primaryOwner?: string): string {
  if (!primaryOwner) return "Unknown";
  const m = members.find((x) => x.id === primaryOwner);
  if (!m) return "Unknown";
  // Prefer the real name (firstName/lastName) over displayName -- ESPN's
  // displayName is the member's account username (e.g. "rishpish",
  // "ESPNFAN4620094966"), not anything meant to be shown as a person's name.
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  return name || m.displayName || "Unknown";
}

function teamIndex(teams: EspnTeam[], members: EspnMember[]) {
  const byId = new Map<number, { name: string; owner: string; abbrev: string | null }>();
  for (const t of teams) {
    byId.set(t.id, {
      name: t.name || `Team ${t.id}`,
      owner: memberLabel(members, t.primaryOwner),
      abbrev: t.abbrev ?? null,
    });
  }
  return byId;
}

function tierFromProj(proj: number, pos: Position): Tier {
  // Lightweight heuristic when we don't have snapshot metadata.
  if (pos === "DST" || pos === "K") return proj >= 8 ? 1 : proj >= 5 ? 2 : 3;
  if (proj >= 14) return 1;
  if (proj >= 9) return 2;
  return 3;
}

/** Consensus inputs for Roster Sensei's sync: the other projection/market
 * sources plus this week's sportsbook prop lines. Omitted by callers whose
 * players get the consensus layered on later anyway (the browser's Free
 * Agents pool -- see hooks/useProjectionRefresh.ts). */
interface ConsensusInputs {
  sources: ConsensusSources;
  playerProps: Record<number, PlayerPropLines>;
}

function enrichPlayer(
  espn: EspnPlayer,
  scoringPeriodId: number,
  known: Map<number, Player>,
  teamsById: Awaited<ReturnType<typeof getNflSchedule>>["teamsById"],
  consensus?: ConsensusInputs
): Player | null {
  const pos = ESPN_POS[espn.defaultPositionId ?? -1];
  if (!pos) return null;

  const nfl = espn.proTeamId != null ? teamsById[espn.proTeamId] : undefined;
  const prev = known.get(espn.id);
  const espnProj = extractEspnProjection(espn.stats, scoringPeriodId) ?? prev?.proj ?? 0;
  const espnSeasonProj = extractEspnSeasonProjection(espn.stats) ?? prev?.seasonProj;
  const actual = extractEspnSeasonActual(espn.stats);
  // Same blend the app's refresh applies (lib/consensus.ts), so Sensei's
  // values match what the user sees in the app.
  const blended = consensus
    ? consensusFor(consensus.sources, {
        id: espn.id,
        name: espn.fullName || prev?.name || "",
        pos,
        proj: espnProj,
        seasonProj: espnSeasonProj,
        actualAvg: actual?.avg,
        gamesPlayed: actual?.gamesPlayed,
      })
    : null;
  const proj = blended ? applyPropLines(blended.proj, consensus?.playerProps[espn.id], blended.modelYards) : espnProj;
  const seasonProj = blended?.seasonProj ?? espnSeasonProj;
  const status =
    ESPN_INJURY_LABEL_MAP[espn.injuryStatus ?? ""] ||
    espn.injuryStatus ||
    prev?.status ||
    "Healthy";

  return {
    id: espn.id,
    name: espn.fullName || prev?.name || `Player ${espn.id}`,
    pos,
    team: nfl?.abbrev || prev?.team || "FA",
    bye: nfl?.byeWeek ?? prev?.bye ?? 0,
    proj,
    espnProj,
    ...(seasonProj != null ? { seasonProj } : {}),
    ...(blended?.marketPosRank != null ? { marketPosRank: blended.marketPosRank, marketValue: blended.marketValue } : {}),
    ...(blended?.modelYards ? { modelYards: blended.modelYards } : {}),
    ...(blended?.valueSources ? { valueSources: blended.valueSources } : {}),
    tier: prev?.tier ?? tierFromProj(proj, pos),
    status,
  };
}

export async function fetchStandings(): Promise<{
  scoringPeriodId: number;
  standings: StandingRow[];
}> {
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mTeam&view=mStandings`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN standings failed (${res.status})`);
  const data = (await res.json()) as EspnLeaguePayload;
  const members = data.members || [];
  const teams = data.teams || [];

  const standings: StandingRow[] = teams
    .map((t) => {
      const o = t.record?.overall;
      const streakType = o?.streakType && o.streakType !== "NONE" ? o.streakType : null;
      const streak =
        streakType && o?.streakLength
          ? `${streakType === "WIN" ? "W" : streakType === "LOSS" ? "L" : streakType}${o.streakLength}`
          : null;
      return {
        teamId: t.id,
        name: t.name || `Team ${t.id}`,
        owner: memberLabel(members, t.primaryOwner),
        abbrev: t.abbrev ?? null,
        seed: t.playoffSeed ?? null,
        wins: o?.wins ?? 0,
        losses: o?.losses ?? 0,
        ties: o?.ties ?? 0,
        pointsFor: Math.round((o?.pointsFor ?? t.points ?? 0) * 10) / 10,
        pointsAgainst: Math.round((o?.pointsAgainst ?? 0) * 10) / 10,
        winPct: Math.round((o?.percentage ?? 0) * 1000) / 1000,
        streak,
      };
    })
    .sort((a, b) => {
      if (a.seed != null && b.seed != null && a.seed !== b.seed) return a.seed - b.seed;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pointsFor - a.pointsFor;
    });

  return { scoringPeriodId: data.scoringPeriodId ?? 1, standings };
}

export async function fetchMatchups(week?: number): Promise<{
  scoringPeriodId: number;
  week: number;
  matchups: MatchupRow[];
}> {
  const url =
    week != null
      ? `${ESPN_LEAGUE_BASE_URL}?view=mMatchup&view=mTeam&scoringPeriodId=${week}`
      : `${ESPN_LEAGUE_BASE_URL}?view=mMatchup&view=mTeam`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN matchups failed (${res.status})`);
  const data = (await res.json()) as EspnLeaguePayload;
  const scoringPeriodId = data.scoringPeriodId ?? 1;
  const targetWeek = week ?? scoringPeriodId;
  const index = teamIndex(data.teams || [], data.members || []);

  const matchups: MatchupRow[] = (data.schedule || [])
    .filter((m) => m.matchupPeriodId === targetWeek)
    .map((m) => {
      const homeId = m.home?.teamId ?? 0;
      const awayId = m.away?.teamId ?? 0;
      const homeMeta = index.get(homeId);
      const awayMeta = index.get(awayId);
      return {
        week: targetWeek,
        home: {
          teamId: homeId,
          name: homeMeta?.name ?? `Team ${homeId}`,
          owner: homeMeta?.owner ?? "Unknown",
          points: Math.round((m.home?.totalPoints ?? 0) * 10) / 10,
        },
        away: {
          teamId: awayId,
          name: awayMeta?.name ?? `Team ${awayId}`,
          owner: awayMeta?.owner ?? "Unknown",
          points: Math.round((m.away?.totalPoints ?? 0) * 10) / 10,
        },
        winner: m.winner || "UNDECIDED",
      };
    });

  return { scoringPeriodId, week: targetWeek, matchups };
}

async function fetchFreeAgents(
  scoringPeriodId: number,
  known: Map<number, Player>,
  teamsById: Awaited<ReturnType<typeof getNflSchedule>>["teamsById"],
  consensus?: ConsensusInputs
): Promise<Player[]> {
  const filter = {
    players: {
      // High enough to never truncate -- this league's real free-agent pool
      // runs ~1,000 players; a low cap (this used to be 300) silently hides
      // anyone ranked below it, which is its own version of the stale-roster
      // bug this pool exists to avoid.
      limit: 3000,
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}/players?view=kona_player_info`, {
    headers: { Accept: "application/json", "x-fantasy-filter": JSON.stringify(filter) },
  });
  if (!res.ok) throw new Error(`ESPN free agents failed (${res.status})`);
  const data = (await res.json()) as EspnFaEntry[] | EspnPlayer[];
  const out: Player[] = [];
  for (const entry of Array.isArray(data) ? data : []) {
    const player: EspnPlayer | undefined = "player" in entry ? entry.player : (entry as EspnPlayer);
    if (!player) continue;
    const enriched = enrichPlayer(player, scoringPeriodId, known, teamsById, consensus);
    if (enriched) out.push(enriched);
  }
  return out.sort((a, b) => b.proj - a.proj);
}

/** Client-facing: just the live free-agent pool (no standings sync), for the
 * Free Agents tab -- every player ESPN currently has as FREEAGENT or WAIVERS
 * in this league, live, instead of the bundled static snapshot.
 *
 * ESPN's own FREEAGENT/WAIVERS status filter on the /players endpoint turns
 * out NOT to be trustworthy on its own -- verified against this league's live
 * data, it happily returns players with a real `onTeamId` set (i.e. actually
 * rostered; e.g. it included a player who's rostered on MY OWN team). So this
 * also pulls the real roster list (the same view=mRoster call
 * deriveAssignmentsFromEspnSlots's sync uses) and excludes anyone who
 * actually appears on any team, the same safety net syncLiveRosters below
 * already has for its own free-agent pool.
 *
 * `knownPlayers` is optional -- just used to fill in a field ESPN's response
 * happens to omit for a given player. Caller is responsible for falling back
 * to bundled data if this throws. */
export async function fetchLiveFreeAgents(knownPlayers: Player[] = []): Promise<Player[]> {
  const known = new Map(knownPlayers.map((p) => [p.id, p]));
  const [schedule, rosterRes] = await Promise.all([
    getNflSchedule(),
    fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam`, { headers: { Accept: "application/json" } }),
  ]);
  if (!rosterRes.ok) throw new Error(`ESPN request failed (${rosterRes.status})`);
  const rosterData = (await rosterRes.json()) as EspnLeaguePayload;
  const scoringPeriodId = rosterData.scoringPeriodId ?? 1;
  const rosteredIds = new Set(
    (rosterData.teams || []).flatMap((t) => (t.roster?.entries || []).map((e) => e.playerPoolEntry?.player?.id).filter((id): id is number => id != null))
  );
  const agents = await fetchFreeAgents(scoringPeriodId, known, schedule.teamsById);
  return agents.filter((p) => !rosteredIds.has(p.id));
}

/** Pull live rosters + FA pool from ESPN and store in the server-side cache. */
export async function syncLiveRosters(knownPlayers: Player[]): Promise<LiveLeagueSnapshot> {
  const known = new Map(knownPlayers.map((p) => [p.id, p]));
  const schedule = await getNflSchedule();
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mRoster&view=mTeam&view=mStandings`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN roster sync failed (${res.status})`);
  const data = (await res.json()) as EspnLeaguePayload;
  const scoringPeriodId = data.scoringPeriodId ?? 1;
  const members = data.members || [];
  // Neither of these can fail the sync: fetchConsensusSources never throws,
  // and missing prop lines just mean projections stand as-is.
  const [sources, matchups] = await Promise.all([
    fetchConsensusSources(LEAGUE_CONFIG.espnSeason, scoringPeriodId),
    fetchWeeklyMatchups().catch(() => null),
  ]);
  const consensus: ConsensusInputs = { sources, playerProps: matchups?.playerProps ?? {} };

  const teams: LeagueTeam[] = [];
  for (const t of data.teams || []) {
    const roster: RosterPlayer[] = [];
    for (const e of t.roster?.entries || []) {
      const player = e.playerPoolEntry?.player;
      if (!player) continue;
      const base = enrichPlayer(player, scoringPeriodId, known, schedule.teamsById, consensus);
      if (!base) continue;
      const slot = ESPN_LINEUP_SLOT_LABEL[e.lineupSlotId ?? 20] ?? "BE";
      roster.push({
        ...base,
        slot,
        starter: slot !== "BE" && slot !== "IR",
      });
    }
    teams.push({
      id: t.id,
      name: t.name || `Team ${t.id}`,
      owner: memberLabel(members, t.primaryOwner),
      roster,
    });
  }

  const rosteredIds = new Set(teams.flatMap((t) => t.roster.map((p) => p.id)));
  const freeAgents = (await fetchFreeAgents(scoringPeriodId, known, schedule.teamsById, consensus)).filter(
    (p) => !rosteredIds.has(p.id)
  );

  // Standings from the same payload when present; otherwise a light refetch.
  let standings: StandingRow[];
  if (data.teams?.some((t) => t.record?.overall)) {
    standings = (data.teams || [])
      .map((t) => {
        const o = t.record?.overall;
        const streakType = o?.streakType && o.streakType !== "NONE" ? o.streakType : null;
        const streak =
          streakType && o?.streakLength
            ? `${streakType === "WIN" ? "W" : streakType === "LOSS" ? "L" : streakType}${o.streakLength}`
            : null;
        return {
          teamId: t.id,
          name: t.name || `Team ${t.id}`,
          owner: memberLabel(members, t.primaryOwner),
          abbrev: t.abbrev ?? null,
          seed: t.playoffSeed ?? null,
          wins: o?.wins ?? 0,
          losses: o?.losses ?? 0,
          ties: o?.ties ?? 0,
          pointsFor: Math.round((o?.pointsFor ?? t.points ?? 0) * 10) / 10,
          pointsAgainst: Math.round((o?.pointsAgainst ?? 0) * 10) / 10,
          winPct: Math.round((o?.percentage ?? 0) * 1000) / 1000,
          streak,
        };
      })
      .sort((a, b) => {
        if (a.seed != null && b.seed != null && a.seed !== b.seed) return a.seed - b.seed;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      });
  } else {
    standings = (await fetchStandings()).standings;
  }

  liveCache = {
    fetchedAt: Date.now(),
    scoringPeriodId,
    teams,
    freeAgents,
    standings,
  };
  return liveCache;
}

/** Return cached live snapshot if fresh; otherwise null (caller falls back to static data). */
export function getFreshLiveLeague(maxAgeMs = CACHE_TTL_MS): LiveLeagueSnapshot | null {
  if (!liveCache) return null;
  if (Date.now() - liveCache.fetchedAt > maxAgeMs) return null;
  return liveCache;
}

/**
 * Prefer a fresh live ownership cache for Sensei turns.
 * Reuses cache within TTL; otherwise runs syncLiveRosters.
 */
export async function ensureLiveRosters(
  knownPlayers: Player[],
  maxAgeMs = CACHE_TTL_MS
): Promise<{ snapshot: LiveLeagueSnapshot; didSync: boolean }> {
  const fresh = getFreshLiveLeague(maxAgeMs);
  if (fresh) return { snapshot: fresh, didSync: false };
  const snapshot = await syncLiveRosters(knownPlayers);
  return { snapshot, didSync: true };
}
