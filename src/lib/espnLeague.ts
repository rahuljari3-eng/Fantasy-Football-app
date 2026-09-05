// Live ESPN league reads for Roster Sensei: standings, fantasy matchups,
// and full roster / free-agent ownership sync.
import { ESPN_LEAGUE_BASE_URL } from "../config/league";
import type { LeagueTeam, Player, Position, RosterPlayer, Tier } from "../types";
import { ESPN_INJURY_LABEL_MAP, ESPN_LINEUP_SLOT_LABEL, extractEspnProjection } from "./espn";
import { getNflSchedule } from "./nflSchedule";

const ESPN_POS: Record<number, Position> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

interface EspnStatLine {
  statSourceId: number;
  scoringPeriodId: number;
  appliedTotal?: number;
}

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
  if (m.displayName) return m.displayName;
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  return name || "Unknown";
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

function enrichPlayer(
  espn: EspnPlayer,
  scoringPeriodId: number,
  known: Map<number, Player>,
  teamsById: Awaited<ReturnType<typeof getNflSchedule>>["teamsById"]
): Player | null {
  const pos = ESPN_POS[espn.defaultPositionId ?? -1];
  if (!pos) return null;

  const nfl = espn.proTeamId != null ? teamsById[espn.proTeamId] : undefined;
  const prev = known.get(espn.id);
  const proj = extractEspnProjection(espn.stats, scoringPeriodId) ?? prev?.proj ?? 0;
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
  teamsById: Awaited<ReturnType<typeof getNflSchedule>>["teamsById"]
): Promise<Player[]> {
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
  if (!res.ok) throw new Error(`ESPN free agents failed (${res.status})`);
  const data = (await res.json()) as EspnFaEntry[] | EspnPlayer[];
  const out: Player[] = [];
  for (const entry of Array.isArray(data) ? data : []) {
    const player: EspnPlayer | undefined = "player" in entry ? entry.player : (entry as EspnPlayer);
    if (!player) continue;
    const enriched = enrichPlayer(player, scoringPeriodId, known, teamsById);
    if (enriched) out.push(enriched);
  }
  return out.sort((a, b) => b.proj - a.proj);
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

  const teams: LeagueTeam[] = [];
  for (const t of data.teams || []) {
    const roster: RosterPlayer[] = [];
    for (const e of t.roster?.entries || []) {
      const player = e.playerPoolEntry?.player;
      if (!player) continue;
      const base = enrichPlayer(player, scoringPeriodId, known, schedule.teamsById);
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
  const freeAgents = (await fetchFreeAgents(scoringPeriodId, known, schedule.teamsById)).filter(
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
