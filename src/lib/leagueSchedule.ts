// Live ESPN league standings + full regular-season schedule, fetched directly
// from the browser -- same "ESPN reflects our Origin in CORS" trick as
// lib/espn.ts, so no backend proxy is needed here either. Powers the League
// tab's Standings and Playoff Race views.
import { ESPN_LEAGUE_BASE_URL } from "../config/league.js";
import { ALL_TEAMS } from "../data/allTeams.js";

interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

interface EspnRecordSplit {
  wins?: number;
  losses?: number;
  ties?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  streakType?: string;
  streakLength?: number;
}

interface EspnTeam {
  id: number;
  name?: string;
  primaryOwner?: string;
  playoffSeed?: number;
  record?: { overall?: EspnRecordSplit };
}

interface EspnMatchupSide {
  teamId?: number;
  totalPoints?: number;
}

interface EspnScheduleEntry {
  matchupPeriodId?: number;
  winner?: string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

interface EspnLeaguePayload {
  status?: { currentMatchupPeriod?: number };
  settings?: { scheduleSettings?: { matchupPeriodCount?: number; playoffTeamCount?: number } };
  teams?: EspnTeam[];
  members?: EspnMember[];
  schedule?: EspnScheduleEntry[];
}

export interface StandingRow {
  teamId: number;
  name: string;
  owner: string;
  seed: number | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string | null;
}

/** One scheduled fantasy matchup, regular season only. An undecided (future)
 * game carries 0 points and decided=false -- that's what lets the playoff
 * math tell "hasn't happened yet" apart from "literally scored zero". */
export interface ScheduledMatchup {
  week: number;
  homeId: number;
  awayId: number;
  homePoints: number;
  awayPoints: number;
  decided: boolean;
}

export interface LeagueScheduleSnapshot {
  fetchedAt: number;
  currentWeek: number;
  regularSeasonWeeks: number;
  playoffTeamCount: number;
  standings: StandingRow[];
  schedule: ScheduledMatchup[];
}

function memberLabel(members: EspnMember[], primaryOwner?: string): string {
  if (!primaryOwner) return "Unknown";
  const m = members.find((x) => x.id === primaryOwner);
  if (!m) return "Unknown";
  if (m.displayName) return m.displayName;
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "Unknown";
}

// Prefer the real name already curated in data/leagueTeams.ts (e.g. "Rishi
// Pungaliya") over ESPN's own member displayName (e.g. "rishpish") -- same
// team ids, just a friendlier label everywhere else in the app already uses.
const OWNER_BY_TEAM_ID = new Map(ALL_TEAMS.map((t) => [t.id, t.owner]));
function ownerLabel(teamId: number, members: EspnMember[], primaryOwner?: string): string {
  return OWNER_BY_TEAM_ID.get(teamId) ?? memberLabel(members, primaryOwner);
}

export async function fetchLeagueScheduleSnapshot(): Promise<LeagueScheduleSnapshot> {
  const res = await fetch(`${ESPN_LEAGUE_BASE_URL}?view=mMatchup&view=mTeam&view=mSettings`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN standings/schedule request failed (${res.status})`);
  const data = (await res.json()) as EspnLeaguePayload;
  const members = data.members || [];

  const standings: StandingRow[] = (data.teams || []).map((t) => {
    const o = t.record?.overall;
    const streakType = o?.streakType && o.streakType !== "NONE" ? o.streakType : null;
    const streak = streakType && o?.streakLength ? `${streakType === "WIN" ? "W" : "L"}${o.streakLength}` : null;
    return {
      teamId: t.id,
      name: t.name || `Team ${t.id}`,
      owner: ownerLabel(t.id, members, t.primaryOwner),
      seed: t.playoffSeed ?? null,
      wins: o?.wins ?? 0,
      losses: o?.losses ?? 0,
      ties: o?.ties ?? 0,
      pointsFor: Math.round((o?.pointsFor ?? 0) * 10) / 10,
      pointsAgainst: Math.round((o?.pointsAgainst ?? 0) * 10) / 10,
      streak,
    };
  });

  // Ranked by win% then points-for, matching this league's own tiebreak rule
  // (playoffSeedingRule: TOTAL_POINTS_SCORED) -- ESPN's own playoffSeed field
  // isn't populated mid-season, so this is computed rather than trusted.
  standings.sort((a, b) => b.wins + b.ties * 0.5 - (a.wins + a.ties * 0.5) || b.pointsFor - a.pointsFor);

  const regularSeasonWeeks = data.settings?.scheduleSettings?.matchupPeriodCount ?? 14;
  const schedule: ScheduledMatchup[] = (data.schedule || [])
    .filter((m) => (m.matchupPeriodId ?? 0) <= regularSeasonWeeks && m.home?.teamId != null && m.away?.teamId != null)
    .map((m) => ({
      week: m.matchupPeriodId ?? 0,
      homeId: m.home!.teamId!,
      awayId: m.away!.teamId!,
      homePoints: Math.round((m.home?.totalPoints ?? 0) * 10) / 10,
      awayPoints: Math.round((m.away?.totalPoints ?? 0) * 10) / 10,
      decided: m.winner != null && m.winner !== "UNDECIDED",
    }));

  return {
    fetchedAt: Date.now(),
    currentWeek: data.status?.currentMatchupPeriod ?? 1,
    regularSeasonWeeks,
    playoffTeamCount: data.settings?.scheduleSettings?.playoffTeamCount ?? 6,
    standings,
    schedule,
  };
}
