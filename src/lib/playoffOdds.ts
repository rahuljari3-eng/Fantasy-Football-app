// Playoff math for the League tab's "Playoff race" view: who's clinched, who's
// eliminated, and -- for everyone still alive -- exactly what has to happen for
// them to get in. Pure functions, no fetching; lib/leagueSchedule.ts supplies
// the live ESPN standings + schedule this operates on.
//
// Clinch / "controls own destiny" MUST respect the remaining schedule: when you
// beat an opponent, that game is a forced loss for them and comes off their
// win-ceiling. The naive "everyone's ceiling = wins + games left" check (used
// previously) falsely claims that winning out isn't enough in a round-robin,
// because it pretends every other team can still win out even against you.
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
  /** True if some set of your own remaining results guarantees a spot
   * regardless of anyone else's games (and regardless of points-for). */
  controlsOwnDestiny: boolean;
  /** Fewest remaining wins that guarantee a spot no matter what else happens.
   * Null if not clinched and even winning out doesn't guarantee one. */
  winsNeededToClinch: number | null;
  /** How far back (in wins) this team is from the current last-playoff-spot
   * pace. 0 if currently inside the cutoff line. */
  gamesBackOfCutoff: number;
  /** Other teams that could still finish with MORE wins than this team's
   * win-out total (even after forced losses from that win-out). */
  teamsThatCanFinishAhead: string[];
  /** Other teams that could TIE this team's win-out record (PF tiebreaker
   * applies). Empty when controlsOwnDestiny or when nobody can match. */
  teamsThatCanTieOnRecord: string[];
  /** @deprecated Alias of teams that block a win-out clinch (ahead + tie). */
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

/** All k-subsets of [0..n), as index arrays. */
function combinations(n: number, k: number): number[][] {
  if (k < 0 || k > n) return [];
  if (k === 0) return [[]];
  const out: number[][] = [];
  const cur: number[] = [];
  const walk = (start: number) => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i <= n - (k - cur.length); i++) {
      cur.push(i);
      walk(i + 1);
      cur.pop();
    }
  };
  walk(0);
  return out;
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

/**
 * After `teamId` wins the remaining games at `winIdxs` (and loses the rest of
 * its remaining slate), which OTHER teams can still finish strictly ahead on
 * wins, or tied on wins, in their absolute best case?
 *
 * Beating an opponent removes that game from their win-ceiling. Games this
 * team loses were already counted in the opponent's unconditional ceiling, so
 * they don't change anything. Games not involving this team are still assumed
 * winnable by each side independently (a conservative over-count — we may say
 * "not yet clinched" a hair early, never the reverse).
 *
 * League tiebreak is points-for. When both sides' win totals are fully locked
 * (no remaining games that can change them), we use actual PF. Otherwise we
 * assume worst-case PF for clinch math (tied rivals can all slot ahead of us).
 */
function winOutThreatBreakdown(
  teamId: number,
  myEnd: number,
  winIdxs: number[],
  standings: StandingRow[],
  remainingByTeam: Map<number, { week: number; opponentId: number }[]>,
  unconditionalCeilings: Map<number, number>
): { ahead: string[]; tied: string[] } {
  const myRemaining = remainingByTeam.get(teamId) ?? [];
  const myStanding = standings.find((s) => s.teamId === teamId);
  const myPf = myStanding?.pointsFor ?? 0;
  // Win totals are locked for us only once this scenario accounts for every
  // remaining game (win or loss). PF from those games is still unknown unless
  // there were no remaining games to begin with.
  const myWinsLocked = winIdxs.length === myRemaining.length || myRemaining.length === 0;
  const myPfLocked = myRemaining.length === 0;

  const forcedLosses = new Map<number, number>();
  for (const idx of winIdxs) {
    const oppId = myRemaining[idx]?.opponentId;
    if (oppId == null) continue;
    forcedLosses.set(oppId, (forcedLosses.get(oppId) ?? 0) + 1);
  }

  const ahead: string[] = [];
  const tied: string[] = [];
  for (const o of standings) {
    if (o.teamId === teamId) continue;
    const forced = forcedLosses.get(o.teamId) ?? 0;
    const adjusted = (unconditionalCeilings.get(o.teamId) ?? 0) - forced;
    if (adjusted > myEnd) {
      ahead.push(o.name);
      continue;
    }
    if (adjusted < myEnd) continue;

    // Same win total possible. If both records are fully locked, use PF.
    const theirRemaining = remainingByTeam.get(o.teamId)?.length ?? 0;
    const theirWinsLocked = theirRemaining === forced; // every remaining game is a forced loss from us
    // Or they had no remaining games at all (already done).
    const theirFullyDone = theirRemaining === 0;
    if (myWinsLocked && myPfLocked && (theirFullyDone || theirWinsLocked)) {
      if (o.pointsFor > myPf) ahead.push(o.name);
      else if (o.pointsFor < myPf) {
        /* we own the tiebreak — not a threat */
      } else tied.push(o.name);
    } else {
      // PF still in flux (or they still have other games) — worst case they
      // finish ahead of us on points for among the tied win group.
      tied.push(o.name);
    }
  }
  return { ahead, tied };
}

/** Worst playoff seed if `ahead` teams finish with more wins and every `tied`
 * rival beats us on points-for. Seed 1 = first place. */
function worstSeed(aheadCount: number, tiedCount: number): number {
  return aheadCount + tiedCount + 1;
}

/** True when winning the games at `winIdxs` guarantees a playoff spot no
 * matter how every other game goes (worst-case PF ties go against us). */
function clinchesWithWins(
  teamId: number,
  winIdxs: number[],
  standings: StandingRow[],
  remainingByTeam: Map<number, { week: number; opponentId: number }[]>,
  floors: Map<number, number>,
  unconditionalCeilings: Map<number, number>,
  playoffTeamCount: number
): boolean {
  const myEnd = (floors.get(teamId) ?? 0) + winIdxs.length;
  const { ahead, tied } = winOutThreatBreakdown(
    teamId,
    myEnd,
    winIdxs,
    standings,
    remainingByTeam,
    unconditionalCeilings
  );
  return worstSeed(ahead.length, tied.length) <= playoffTeamCount;
}

function nameList(names: string[], max = 3): string {
  if (!names.length) return "";
  const head = names.slice(0, max).join(", ");
  return names.length > max ? `${head}, and others` : head;
}

function buildSummary(args: {
  status: PlayoffStatus;
  controlsOwnDestiny: boolean;
  winsNeededToClinch: number | null;
  gamesRemaining: number;
  playoffTeamCount: number;
  ahead: string[];
  tied: string[];
}): string {
  const { status, controlsOwnDestiny, winsNeededToClinch, gamesRemaining, playoffTeamCount, ahead, tied } = args;
  const g = gamesRemaining === 1 ? "game" : "games";

  if (status === "clinched") return "Clinched a playoff spot.";
  if (status === "eliminated") return "Eliminated from playoff contention.";

  if (controlsOwnDestiny && winsNeededToClinch != null) {
    const n = winsNeededToClinch;
    const winOut = n === gamesRemaining;
    const needPhrase = winOut
      ? `win out (${gamesRemaining} ${g})`
      : `win ${n} of the last ${gamesRemaining} ${g}`;

    if (tied.length) {
      return winOut
        ? `Controls its own destiny -- ${needPhrase} and a playoff spot is locked even if ${nameList(tied)} match that record; points for would only decide seeding among any ties.`
        : `Controls its own destiny -- ${needPhrase} and a playoff spot is locked regardless of anyone else's results; points for would only decide seeding if ${nameList(tied)} finish with the same record.`;
    }
    return `Controls its own destiny -- ${needPhrase} and it's a guaranteed playoff spot no matter what anyone else does.`;
  }

  // Does not control own destiny after a win-out.
  const spots = playoffTeamCount;
  if (ahead.length && tied.length) {
    return `Does not control its own destiny -- even winning out, ${nameList(ahead)} can still finish with more wins (they need to lose elsewhere), and ${nameList(tied)} can finish with the same record, where this league's points-for tiebreaker decides who gets the last of the ${spots} playoff spots.`;
  }
  if (ahead.length) {
    return `Does not control its own destiny -- even winning out, ${nameList(ahead)} can still finish with more wins and take playoff spots first. Those teams would need to lose enough down the stretch to fall behind.`;
  }
  if (tied.length) {
    return `Does not control its own destiny -- even winning out, ${nameList(tied)} can finish with the same record, leaving more teams tied than available playoff spots. This league's points-for tiebreaker would decide who gets in among that group.`;
  }
  return "Does not control its own destiny -- winning out still isn't enough on its own; other results have to break the right way.";
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
  const unconditionalCeilings = new Map(
    standings.map((s) => [s.teamId, winPointsOf(s) + (remainingByTeam.get(s.teamId)?.length ?? 0)])
  );

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
    const myRemaining = remainingByTeam.get(s.teamId) ?? [];
    const gamesRemaining = myRemaining.length;
    const floor = floors.get(s.teamId) ?? 0;
    const ceiling = unconditionalCeilings.get(s.teamId) ?? floor;
    const allIdxs = myRemaining.map((_, i) => i);

    // Already impossible to catch on wins alone: playoffTeamCount teams have
    // MORE wins than this team can reach even winning out.
    let eliminated =
      standings.filter((o) => o.teamId !== s.teamId && winPointsOf(o) > ceiling).length >= playoffTeamCount;

    const clinched =
      !eliminated &&
      clinchesWithWins(s.teamId, [], standings, remainingByTeam, floors, unconditionalCeilings, playoffTeamCount);

    // Season done for this team and clinch math (incl. locked PF) says we're
    // outside the cutoff — eliminated, not merely "alive without destiny".
    if (!eliminated && !clinched && gamesRemaining === 0) {
      eliminated = true;
    }

    let winsNeededToClinch: number | null = null;
    if (!clinched && !eliminated) {
      for (let w = 0; w <= gamesRemaining; w++) {
        // Cap combination search — 14-choose-7 is ~3k, fine; if a team somehow
        // had a huge remaining slate, fall back to checking win-out only at the
        // end of the loop via the w === gamesRemaining single combination.
        const combos = w === 0 || w === gamesRemaining ? [w === 0 ? [] : allIdxs] : combinations(gamesRemaining, w);
        if (combos.some((idxs) => clinchesWithWins(s.teamId, idxs, standings, remainingByTeam, floors, unconditionalCeilings, playoffTeamCount))) {
          winsNeededToClinch = w;
          break;
        }
      }
    }
    const controlsOwnDestiny = !clinched && !eliminated && winsNeededToClinch != null;

    // Win-out threat breakdown (always useful for copy — even when destiny is
    // controlled, tied rivals explain that PF only affects seeding).
    const winOutBreakdown =
      !eliminated
        ? winOutThreatBreakdown(
            s.teamId,
            floor + gamesRemaining,
            allIdxs,
            standings,
            remainingByTeam,
            unconditionalCeilings
          )
        : { ahead: [] as string[], tied: [] as string[] };

    // When destiny is controlled via fewer than win-out wins, recompute ties
    // at that clinch win total with a representative clinching combo.
    let summaryAhead = winOutBreakdown.ahead;
    let summaryTied = winOutBreakdown.tied;
    if (controlsOwnDestiny && winsNeededToClinch != null && winsNeededToClinch < gamesRemaining) {
      const combos =
        winsNeededToClinch === 0 ? [[]] : combinations(gamesRemaining, winsNeededToClinch);
      const clinching = combos.find((idxs) =>
        clinchesWithWins(s.teamId, idxs, standings, remainingByTeam, floors, unconditionalCeilings, playoffTeamCount)
      );
      if (clinching) {
        const atClinch = winOutThreatBreakdown(
          s.teamId,
          floor + winsNeededToClinch,
          clinching,
          standings,
          remainingByTeam,
          unconditionalCeilings
        );
        summaryAhead = atClinch.ahead;
        summaryTied = atClinch.tied;
      }
    }

    const blockingTeams = [...summaryAhead, ...summaryTied];

    const remaining = myRemaining.map((g) => ({
      week: g.week,
      opponentId: g.opponentId,
      opponentName: nameById.get(g.opponentId) ?? `Team ${g.opponentId}`,
      opponentRecord: recordById.get(g.opponentId) ?? "",
    }));

    const status: PlayoffStatus = eliminated ? "eliminated" : clinched ? "clinched" : "alive";
    const makeOdds = eliminated ? 0 : clinched ? 100 : Math.round(((madePlayoffsCount.get(s.teamId) ?? 0) / simulations) * 1000) / 10;
    const gamesBackOfCutoff = Math.max(0, cutoffWinPoints - floor);

    const summary = buildSummary({
      status,
      controlsOwnDestiny,
      winsNeededToClinch,
      gamesRemaining,
      playoffTeamCount,
      ahead: !controlsOwnDestiny && !clinched ? winOutBreakdown.ahead : summaryAhead,
      tied: !controlsOwnDestiny && !clinched ? winOutBreakdown.tied : summaryTied,
    });

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
      teamsThatCanFinishAhead: !controlsOwnDestiny && !clinched ? winOutBreakdown.ahead : summaryAhead,
      teamsThatCanTieOnRecord: !controlsOwnDestiny && !clinched ? winOutBreakdown.tied : summaryTied,
      blockingTeams,
      remaining,
      summary,
    };
  });
}
