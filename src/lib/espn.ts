// Direct ESPN API access for the "Refresh from ESPN" button. ESPN's read host
// (lm-api-reads.fantasy.espn.com) sends CORS headers that reflect the
// request's actual Origin for this league, so the browser can call it
// directly -- no backend proxy needed for a refresh.
import { ESPN_LEAGUE_BASE_URL } from "../config/league";
import type { PlayerStatus, ProjectionOverrides } from "../types";

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
  playerPoolEntry?: { player?: EspnPlayer };
}
interface EspnTeam {
  roster?: { entries?: EspnRosterEntry[] };
}
interface EspnLeagueResponse {
  scoringPeriodId: number;
  teams?: EspnTeam[];
}
interface EspnFreeAgentEntry {
  player?: EspnPlayer;
}

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
