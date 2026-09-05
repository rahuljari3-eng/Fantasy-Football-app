// NFL pro-team schedule from ESPN fantasy season endpoint (proTeamSchedules_wl).
// Used by Roster Sensei for bye / remaining-opponent advice.
import { LEAGUE_CONFIG } from "../config/league.ts";

const SCHEDULE_URL = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${LEAGUE_CONFIG.espnSeason}?view=proTeamSchedules_wl`;

export interface NflGameSlot {
  week: number;
  opponent: string;
  home: boolean;
  date: string | null;
  bye?: false;
}

export interface NflByeSlot {
  week: number;
  bye: true;
}

export type NflWeekSlot = NflGameSlot | NflByeSlot;

export interface NflTeamInfo {
  id: number;
  abbrev: string;
  name: string;
  location: string;
  byeWeek: number;
  /** Week → game (bye weeks have no entry). */
  gamesByWeek: Record<number, { opponentAbbrev: string; home: boolean; dateMs: number }>;
}

export interface NflScheduleSnapshot {
  season: number;
  fetchedAt: number;
  teamsByAbbrev: Record<string, NflTeamInfo>;
  teamsById: Record<number, NflTeamInfo>;
  maxWeek: number;
}

interface EspnProGame {
  awayProTeamId: number;
  homeProTeamId: number;
  date?: number;
  scoringPeriodId: number;
  id: number;
}

interface EspnProTeam {
  id: number;
  abbrev: string;
  name: string;
  location: string;
  byeWeek: number;
  proGamesByScoringPeriod?: Record<string, EspnProGame[]>;
}

interface EspnScheduleResponse {
  settings?: { proTeams?: EspnProTeam[] };
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: NflScheduleSnapshot | null = null;
let inflight: Promise<NflScheduleSnapshot> | null = null;

export async function getNflSchedule(force = false): Promise<NflScheduleSnapshot> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(SCHEDULE_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`NFL schedule fetch failed (${res.status})`);
    const data = (await res.json()) as EspnScheduleResponse;
    const snapshot = parseSchedule(data);
    cache = snapshot;
    return snapshot;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function parseSchedule(data: EspnScheduleResponse): NflScheduleSnapshot {
  const teamsByAbbrev: Record<string, NflTeamInfo> = {};
  const teamsById: Record<number, NflTeamInfo> = {};
  let maxWeek = 0;

  const rawTeams = (data.settings?.proTeams || []).filter((t) => t.id > 0 && t.abbrev);

  for (const t of rawTeams) {
    const info: NflTeamInfo = {
      id: t.id,
      abbrev: t.abbrev.toUpperCase(),
      name: t.name,
      location: t.location,
      byeWeek: t.byeWeek,
      gamesByWeek: {},
    };
    teamsByAbbrev[info.abbrev] = info;
    teamsById[info.id] = info;
  }

  for (const t of rawTeams) {
    const self = teamsById[t.id];
    if (!self) continue;
    for (const [weekStr, games] of Object.entries(t.proGamesByScoringPeriod || {})) {
      const week = Number(weekStr);
      if (!Number.isFinite(week)) continue;
      maxWeek = Math.max(maxWeek, week);
      const g = games[0];
      if (!g) continue;
      const home = g.homeProTeamId === t.id;
      const oppId = home ? g.awayProTeamId : g.homeProTeamId;
      const opp = teamsById[oppId];
      self.gamesByWeek[week] = {
        opponentAbbrev: opp?.abbrev ?? `ID:${oppId}`,
        home,
        dateMs: g.date ?? 0,
      };
    }
    if (t.byeWeek) maxWeek = Math.max(maxWeek, t.byeWeek);
  }

  if (maxWeek < 18) maxWeek = 18;

  return {
    season: LEAGUE_CONFIG.espnSeason,
    fetchedAt: Date.now(),
    teamsByAbbrev,
    teamsById,
    maxWeek,
  };
}

/** Normalize common NFL abbrev variants used in our player data vs ESPN. */
export function normalizeNflAbbrev(raw: string): string {
  const a = raw.trim().toUpperCase();
  const aliases: Record<string, string> = {
    WSH: "WAS",
    JAC: "JAX",
    ARZ: "ARI",
    LA: "LAR",
    GBP: "GB",
    KCC: "KC",
    NEP: "NE",
    NOS: "NO",
    SFO: "SF",
    TBB: "TB",
  };
  return aliases[a] ?? a;
}

/** Remaining slate from `fromWeek` through season end (includes bye week). */
export function teamScheduleRemaining(
  snap: NflScheduleSnapshot,
  nflAbbrev: string,
  fromWeek: number
): NflWeekSlot[] {
  const team = snap.teamsByAbbrev[normalizeNflAbbrev(nflAbbrev)];
  if (!team) return [];

  const clean: NflWeekSlot[] = [];
  const start = Math.max(1, fromWeek);
  for (let week = start; week <= snap.maxWeek; week++) {
    if (week === team.byeWeek) {
      clean.push({ week, bye: true });
      continue;
    }
    const g = team.gamesByWeek[week];
    if (!g) continue;
    clean.push({
      week,
      opponent: g.opponentAbbrev,
      home: g.home,
      date: g.dateMs ? new Date(g.dateMs).toISOString() : null,
      bye: false,
    });
  }
  return clean;
}

/** Unique matchups for a scoring period (home/away). */
export function gamesForWeek(
  snap: NflScheduleSnapshot,
  week: number
): { home: string; away: string; date: string | null }[] {
  const uniq = new Map<string, { home: string; away: string; date: string | null }>();
  for (const team of Object.values(snap.teamsById)) {
    const g = team.gamesByWeek[week];
    if (!g || !g.home) continue;
    uniq.set(`${team.abbrev}-${g.opponentAbbrev}`, {
      home: team.abbrev,
      away: g.opponentAbbrev,
      date: g.dateMs ? new Date(g.dateMs).toISOString() : null,
    });
  }
  return [...uniq.values()].sort((a, b) => a.home.localeCompare(b.home));
}

export function resolveNflTeam(snap: NflScheduleSnapshot, query: string): NflTeamInfo | null {
  const q = normalizeNflAbbrev(query);
  if (snap.teamsByAbbrev[q]) return snap.teamsByAbbrev[q];
  const lower = query.trim().toLowerCase();
  return (
    Object.values(snap.teamsById).find(
      (t) =>
        t.abbrev.toLowerCase() === lower ||
        t.name.toLowerCase() === lower ||
        `${t.location} ${t.name}`.toLowerCase() === lower ||
        t.location.toLowerCase() === lower
    ) ?? null
  );
}
