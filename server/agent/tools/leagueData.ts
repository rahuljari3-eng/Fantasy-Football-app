import { POSITIONS, REQUIRED_STARTERS } from "../../../src/config/league.ts";
import { ALL_TEAMS } from "../../../src/data/allTeams.ts";
import { FREE_AGENTS } from "../../../src/data/freeAgents.ts";
import { getLiveLeagueCache } from "../../../src/lib/espnLeague.ts";
import { analyzeRosterNeeds } from "../../../src/lib/rosterNeeds.ts";
import { qualityScore } from "../../../src/lib/scoring.ts";
import type { LeagueTeam, Player, Position, RosterNeeds } from "../../../src/types.ts";
import type { ToolContext } from "./types.ts";

/** Stamp 1-based projection ranks within each position (needed for playerValue). */
export function withPosRanks(players: Player[]): Player[] {
  const ranks = new Map<number, number>();
  const byPos = new Map<Position, Player[]>();
  for (const p of players) {
    const list = byPos.get(p.pos) ?? [];
    list.push(p);
    byPos.set(p.pos, list);
  }
  for (const list of byPos.values()) {
    [...list]
      .sort((a, b) => b.proj - a.proj)
      .forEach((p, i) => {
        if (!ranks.has(p.id)) ranks.set(p.id, i + 1);
      });
  }
  return players.map((p) => ({ ...p, posRank: ranks.get(p.id) }));
}

/** Prefer live ESPN ownership after sync_rosters; else bundled snapshot. */
export function activeTeams(): LeagueTeam[] {
  return getLiveLeagueCache()?.teams ?? ALL_TEAMS;
}

export function activeFreeAgents(): Player[] {
  return getLiveLeagueCache()?.freeAgents ?? FREE_AGENTS;
}

export function ownershipSource(): "live_espn" | "bundled_snapshot" {
  return getLiveLeagueCache() ? "live_espn" : "bundled_snapshot";
}

/** Find a team by ESPN/snapshot id, falling back to name match (ids can drift). */
export function findTeamByIdOrName(teamId: number): LeagueTeam | undefined {
  const teams = activeTeams();
  const direct = teams.find((t) => t.id === teamId);
  if (direct) return direct;
  const snap = ALL_TEAMS.find((t) => t.id === teamId);
  if (!snap) return undefined;
  return teams.find((t) => t.name === snap.name);
}

/** Every known player (all rosters + FAs), with pos ranks. */
export function allKnownPlayers(): Player[] {
  const map = new Map<number, Player>();
  for (const t of activeTeams()) {
    for (const p of t.roster) map.set(p.id, p);
  }
  for (const p of activeFreeAgents()) {
    if (!map.has(p.id)) map.set(p.id, p);
  }
  // Keep snapshot-only players available for name lookup even after sync.
  if (getLiveLeagueCache()) {
    for (const t of ALL_TEAMS) {
      for (const p of t.roster) if (!map.has(p.id)) map.set(p.id, p);
    }
    for (const p of FREE_AGENTS) if (!map.has(p.id)) map.set(p.id, p);
  }
  return withPosRanks([...map.values()]);
}

export function freeAgentPool(): Player[] {
  const rostered = new Set<number>();
  for (const t of activeTeams()) {
    for (const p of t.roster) rostered.add(p.id);
  }
  return withPosRanks(activeFreeAgents().filter((p) => !rostered.has(p.id)));
}

export function resolveTeam(ctx: ToolContext, teamId?: number) {
  const id = teamId ?? ctx.managedTeamId;
  const team = findTeamByIdOrName(id);
  if (!team) return { ok: false as const, error: "team_not_found" as const, teamId: id };
  return { ok: true as const, team };
}

export function teamPlayersRanked(teamId: number): Player[] {
  const team = findTeamByIdOrName(teamId);
  if (!team) return [];
  return withPosRanks(team.roster.map((p) => ({ ...p })));
}

export function leagueBaseline(): Record<Position, number> {
  const baseline = {} as Record<Position, number>;
  const rosters = activeTeams().map((t) => withPosRanks(t.roster.map((p) => ({ ...p }))));
  for (const pos of POSITIONS) {
    const scores = rosters.map((r) => analyzeRosterNeeds(r)[pos].starterScore).filter((s) => s > 0);
    baseline[pos] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }
  return baseline;
}

export function needsSummary(needs: RosterNeeds, baseline: Record<Position, number>) {
  const needy: Position[] = [];
  const strength: Position[] = [];
  for (const pos of POSITIONS) {
    const n = needs[pos];
    if (!n.hasEnoughBodies || (baseline[pos] && n.starterScore < baseline[pos] * 0.85)) needy.push(pos);
    if (baseline[pos] && n.starterScore > baseline[pos] * 1.1 && n.tradeableDepth.length > 0) strength.push(pos);
  }
  return { needy, strength };
}

export function needReason(pos: Position, needs: RosterNeeds, baseline: Record<Position, number>): string {
  const n = needs[pos];
  if (!n.hasEnoughBodies) {
    return `Not enough ${pos}s to fill required starting slot${REQUIRED_STARTERS[pos] > 1 ? "s" : ""}.`;
  }
  const base = baseline[pos];
  if (base) {
    const pctBelow = Math.round((1 - n.starterScore / base) * 100);
    return `Starting ${pos} quality is ~${Math.max(pctBelow, 1)}% below the league-average starter.`;
  }
  return `${pos} is a relative weak spot.`;
}

/** Fuzzy name / id lookup across the league snapshot. */
export function findPlayers(query: string | number, limit = 5): Player[] {
  const pool = allKnownPlayers();
  if (typeof query === "number" || /^\d+$/.test(String(query))) {
    const id = typeof query === "number" ? query : Number(query);
    const hit = pool.find((p) => p.id === id);
    return hit ? [hit] : [];
  }
  const q = String(query).trim().toLowerCase();
  if (!q) return [];

  const scored = pool
    .map((p) => {
      const name = p.name.toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else {
        const parts = q.split(/\s+/);
        if (parts.every((part) => name.includes(part))) score = 50;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.proj - a.p.proj);

  return scored.slice(0, limit).map((x) => x.p);
}

export function findPlayerOwner(playerId: number): { teamId: number; teamName: string; owner: string } | null {
  for (const t of activeTeams()) {
    if (t.roster.some((p) => p.id === playerId)) {
      return { teamId: t.id, teamName: t.name, owner: t.owner };
    }
  }
  return null;
}

export function serializePlayer(p: Player) {
  const owner = findPlayerOwner(p.id);
  return {
    id: p.id,
    name: p.name,
    pos: p.pos,
    nflTeam: p.team,
    bye: p.bye,
    proj: p.proj,
    tier: p.tier,
    status: p.status,
    posRank: p.posRank ?? null,
    qualityScore: Math.round(qualityScore(p) * 10) / 10,
    ownedBy: owner,
    isFreeAgent: !owner,
  };
}

export function relevantPlayerIds(): Set<number> {
  const ids = new Set<number>();
  for (const t of activeTeams()) {
    for (const p of t.roster) ids.add(p.id);
  }
  for (const p of activeFreeAgents()) ids.add(p.id);
  return ids;
}
