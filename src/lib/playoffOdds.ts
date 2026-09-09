// Playoff math for the League tab's "Playoff race" view: who's clinched, who's
// eliminated, and -- for everyone still alive -- exactly what has to happen for
// them to get in. Pure functions, no fetching; lib/leagueSchedule.ts supplies
// the live ESPN standings + schedule this operates on.
import type { ScheduledMatchup, StandingRow } from "./leagueSchedule.js";

export type PlayoffStatus = "clinched" | "eliminated" | "alive";

export interface PlayoffOutlook {
  teamId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  gamesRemaining: number;
  /** Monte Carlo estimate, 0-100. Exactly 0/100 for a mathematically settled team. */
  makeOdds: number;
  status: PlayoffStatus;
  /** True if winning every remaining game guarantees a spot regardless of
   * anyone else's results. */
  controlsOwnDestiny: boolean;
  /** Fewest remaining wins that guarantee a spot no matter what else happens.
   * Null if not clinched and even winning out doesn't guarantee one. */
  winsNeededToClinch: number | null;
  /** How far back (in wins) this team is from the current last-playoff-spot
   * pace. 0 if currently inside the cutoff line. */
  gamesBackOfCutoff: number;
  /** Other teams that could still finish at or above this team's own
   * best-case (win-out) total -- the teams standing between "win out" and an
   * actual guarantee. Empty once the team controls its own destiny. */
  blockingTeams: string[];
  remaining: { week: number; opponentId: number; opponentName: string; opponentRecord: string }[];
  /** One human-readable sentence stating exactly what needs to happen. */
  summary: string;
}

const winPointsOf = (t: { wins: number; ties: number }) => t.wins + t.ties * 0.5;

function remainingGamesByTeam(schedule: ScheduledMatchup[]): Map<number, { week: number; opponentId: number }[]> {
  const map = new Map<number, { week: number; opponentId: number }[]>();
  schedule
    .filter((m) => !m.decided)
    .forEach((m) => {
      if (!map.has(m.homeId)) map.set(m.homeId, []);
      if (!map.has(m.awayId)) map.set(m.awayId, []);
      map.get(m.homeId)!.push({ week: m.week, opponentId: m.awayId });
      map.get(m.awayId)!.push({ week: m.week, opponentId: m.homeId });
    });
  return map;
}

// Box-Muller transform -- good enough for a season-scoring approximation.
function randNormal(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A team's assumed weekly scoring "true talent" for the simulation: blends
 * their season-to-date average (once there's a real sample) with a
 * roster-projection baseline the caller supplies -- pure preseason
 * projection in week 1, mostly actual performance by week 5+. */
function estimateStrength(standing: StandingRow, projected: number): number {
  const gamesPlayed = standing.wins + standing.losses + standing.ties;
  if (gamesPlayed === 0) return projected;
  const avgActual = standing.pointsFor / gamesPlayed;
  const trustActual = Math.min(1, gamesPlayed / 4);
  return avgActual * trustActual + projected * (1 - trustActual);
}

export function computePlayoffOutlook(
  standings: StandingRow[],
  schedule: ScheduledMatchup[],
  playoffTeamCount: number,
  projectedStrengthByTeam: Record<number, number>,
  simulations = 4000
): PlayoffOutlook[] {
  const remainingByTeam = remainingGamesByTeam(schedule);
  const nameById = new Map(standings.map((s) => [s.teamId, s.name]));
  const recordById = new Map(standings.map((s) => [s.teamId, `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`]));

  const floors = new Map(standings.map((s) => [s.teamId, winPointsOf(s)]));
  const ceilings = new Map(standings.map((s) => [s.teamId, winPointsOf(s) + (remainingByTeam.get(s.teamId)?.length ?? 0)]));

  // Standard "clinch" check: if fewer than `playoffTeamCount` OTHER teams
  // could even reach `floor` at their absolute best, this team is guaranteed
  // to finish at or above the cutoff no matter what happens elsewhere.
  const canClinchWithFloor = (teamId: number, floor: number) =>
    standings.filter((o) => o.teamId !== teamId && (ceilings.get(o.teamId) ?? 0) >= floor).length < playoffTeamCount;

  const sortedByCurrent = [...standings].sort((a, b) => winPointsOf(b) - winPointsOf(a) || b.pointsFor - a.pointsFor);
  const cutoffTeam = sortedByCurrent[Math.min(playoffTeamCount, sortedByCurrent.length) - 1];
  const cutoffWinPoints = cutoffTeam ? winPointsOf(cutoffTeam) : 0;

  const strengthByTeam: Record<number, number> = {};
  standings.forEach((s) => {
    strengthByTeam[s.teamId] = estimateStrength(s, projectedStrengthByTeam[s.teamId] ?? 100);
  });

  // ---- Monte Carlo playoff odds over the remaining schedule ----
  const undecided = schedule.filter((m) => !m.decided);
  const madePlayoffsCount = new Map<number, number>(standings.map((s) => [s.teamId, 0]));

  for (let sim = 0; sim < simulations; sim++) {
    const simWinPoints = new Map(standings.map((s) => [s.teamId, winPointsOf(s)]));
    const simPoints = new Map(standings.map((s) => [s.teamId, s.pointsFor]));

    undecided.forEach((m) => {
      const homeScore = randNormal(strengthByTeam[m.homeId] ?? 100, (strengthByTeam[m.homeId] ?? 100) * 0.16);
      const awayScore = randNormal(strengthByTeam[m.awayId] ?? 100, (strengthByTeam[m.awayId] ?? 100) * 0.16);
      simPoints.set(m.homeId, (simPoints.get(m.homeId) ?? 0) + homeScore);
      simPoints.set(m.awayId, (simPoints.get(m.awayId) ?? 0) + awayScore);
      if (homeScore >= awayScore) simWinPoints.set(m.homeId, (simWinPoints.get(m.homeId) ?? 0) + 1);
      else simWinPoints.set(m.awayId, (simWinPoints.get(m.awayId) ?? 0) + 1);
    });

    [...standings]
      .map((s) => ({ teamId: s.teamId, wp: simWinPoints.get(s.teamId) ?? 0, pf: simPoints.get(s.teamId) ?? 0 }))
      .sort((a, b) => b.wp - a.wp || b.pf - a.pf)
      .slice(0, playoffTeamCount)
      .forEach((r) => madePlayoffsCount.set(r.teamId, (madePlayoffsCount.get(r.teamId) ?? 0) + 1));
  }

  return standings.map((s) => {
    const gamesRemaining = remainingByTeam.get(s.teamId)?.length ?? 0;
    const floor = floors.get(s.teamId) ?? 0;
    const ceiling = ceilings.get(s.teamId) ?? floor;

    const eliminated = standings.filter((o) => o.teamId !== s.teamId && winPointsOf(o) > ceiling).length >= playoffTeamCount;
    const clinched = !eliminated && canClinchWithFloor(s.teamId, floor);

    let winsNeededToClinch: number | null = null;
    if (!clinched && !eliminated) {
      for (let w = 0; w <= gamesRemaining; w++) {
        if (canClinchWithFloor(s.teamId, floor + w)) {
          winsNeededToClinch = w;
          break;
        }
      }
    }
    const controlsOwnDestiny = !clinched && !eliminated && winsNeededToClinch != null;

    const blockingTeams =
      !clinched && !eliminated && !controlsOwnDestiny
        ? standings.filter((o) => o.teamId !== s.teamId && (ceilings.get(o.teamId) ?? 0) >= ceiling).map((o) => o.name)
        : [];

    const remaining = (remainingByTeam.get(s.teamId) ?? []).map((g) => ({
      week: g.week,
      opponentId: g.opponentId,
      opponentName: nameById.get(g.opponentId) ?? `Team ${g.opponentId}`,
      opponentRecord: recordById.get(g.opponentId) ?? "",
    }));

    const status: PlayoffStatus = eliminated ? "eliminated" : clinched ? "clinched" : "alive";
    const makeOdds = eliminated ? 0 : clinched ? 100 : Math.round(((madePlayoffsCount.get(s.teamId) ?? 0) / simulations) * 1000) / 10;
    const gamesBackOfCutoff = Math.max(0, cutoffWinPoints - floor);

    let summary: string;
    if (status === "clinched") {
      summary = "Clinched a playoff spot.";
    } else if (status === "eliminated") {
      summary = "Eliminated from playoff contention.";
    } else if (controlsOwnDestiny && winsNeededToClinch === gamesRemaining) {
      summary = `Controls its own destiny -- win out (${gamesRemaining} game${gamesRemaining === 1 ? "" : "s"}) and it's a guaranteed playoff spot no matter what anyone else does.`;
    } else if (controlsOwnDestiny) {
      summary = `Win ${winsNeededToClinch} of the last ${gamesRemaining} game${gamesRemaining === 1 ? "" : "s"} and it's a guaranteed playoff spot, regardless of anyone else's results.`;
    } else {
      const named = blockingTeams.slice(0, 3).join(", ");
      summary = `Winning out isn't enough on its own -- also needs help: ${named}${blockingTeams.length > 3 ? ", and others" : ""} would need to lose enough down the stretch to fall behind.`;
    }

    return {
      teamId: s.teamId,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      pointsFor: s.pointsFor,
      gamesRemaining,
      makeOdds,
      status,
      controlsOwnDestiny,
      winsNeededToClinch,
      gamesBackOfCutoff,
      blockingTeams,
      remaining,
      summary,
    };
  });
}
