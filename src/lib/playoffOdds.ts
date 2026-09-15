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

// ---- Max-flow (tiny graphs only -- a handful of teams/games per check, so
// a plain BFS-augmenting-path (Edmonds-Karp) implementation is simplest and
// fast enough; no need for anything asymptotically fancier here). ----
function maxFlow(numNodes: number, edges: { u: number; v: number; cap: number }[], source: number, sink: number): number {
  const cap: number[][] = Array.from({ length: numNodes }, () => new Array(numNodes).fill(0));
  edges.forEach(({ u, v, cap: c }) => {
    cap[u][v] += c;
  });
  let flow = 0;
  for (;;) {
    const parent = new Array(numNodes).fill(-1);
    parent[source] = source;
    const queue = [source];
    for (let qi = 0; qi < queue.length && parent[sink] === -1; qi++) {
      const u = queue[qi];
      for (let v = 0; v < numNodes; v++) {
        if (parent[v] === -1 && cap[u][v] > 0) {
          parent[v] = u;
          queue.push(v);
        }
      }
    }
    if (parent[sink] === -1) break;
    let aug = Infinity;
    for (let v = sink; v !== source; v = parent[v]) aug = Math.min(aug, cap[parent[v]][v]);
    for (let v = sink; v !== source; v = parent[v]) {
      cap[parent[v]][v] -= aug;
      cap[v][parent[v]] += aug;
    }
    flow += aug;
  }
  return flow;
}

/** Can every team in `subset` simultaneously get at least its `need` more
 * wins, given that `intraGames` (games strictly between two subset members)
 * can only produce ONE winner each -- i.e. the shared, contested part of
 * their remaining slates? Modeled as max-flow: source -> one node per game
 * (capacity 1, since a game has exactly one winner) -> that game's two
 * participants (capacity 1 each, either could win it) -> sink, capped per
 * team at their `need`. Feasible iff the max-flow saturates every team's
 * need -- if it falls short, no assignment of these shared games can get
 * everyone there at once, no matter who wins what. */
function subsetCanAllReach(subset: { teamId: number; need: number }[], intraGames: { a: number; b: number }[]): boolean {
  const totalNeed = subset.reduce((s, x) => s + x.need, 0);
  if (totalNeed === 0) return true;
  const G = intraGames.length;
  const teamNode = new Map(subset.map((s, i) => [s.teamId, 1 + G + i]));
  const source = 0;
  const sink = 1 + G + subset.length;
  const edges: { u: number; v: number; cap: number }[] = [];
  subset.forEach((s, i) => {
    if (s.need > 0) edges.push({ u: 1 + G + i, v: sink, cap: s.need });
  });
  intraGames.forEach((g, i) => {
    edges.push({ u: source, v: 1 + i, cap: 1 });
    edges.push({ u: 1 + i, v: teamNode.get(g.a)!, cap: 1 });
    edges.push({ u: 1 + i, v: teamNode.get(g.b)!, cap: 1 });
  });
  return maxFlow(sink + 1, edges, source, sink) === totalNeed;
}

// Enumerating every size-K subset of the threat pool is only tractable up to
// a point -- guard against a pathological league size blowing this up.
const MAX_SUBSET_CHECKS = 20_000;

/**
 * After teamId locks in win total W (having forced a loss on each opponent
 * in `forcedLosses` along the way), can `playoffTeamCount` or more OTHER
 * teams simultaneously finish with wins >= W? If so, teamId's W isn't
 * actually a guaranteed top-`playoffTeamCount` finish by record alone --
 * some real combination of results really can push that many teams to W or
 * past it. This is what the naive "check every other team independently"
 * approach (this file used to use, and still uses for the narrative text via
 * winOutThreatBreakdown) gets wrong: it ignores that many of those other
 * teams play EACH OTHER, so they can't all simultaneously max out. Verified
 * against this league's live schedule: a team can play every other 1-0 team
 * once in its remaining slate while those same teams play each other close
 * to twenty times -- nowhere near "all of them could tie" being real.
 */
function othersCanSimultaneouslyReach(
  teamId: number,
  W: number,
  forcedLosses: Map<number, number>,
  standings: StandingRow[],
  remainingByTeam: Map<number, { week: number; opponentId: number }[]>,
  schedule: ScheduledMatchup[],
  playoffTeamCount: number
): boolean {
  const pool = standings
    .filter((o) => o.teamId !== teamId)
    .map((o) => {
      const forced = forcedLosses.get(o.teamId) ?? 0;
      const available = (remainingByTeam.get(o.teamId)?.length ?? 0) - forced;
      return { teamId: o.teamId, floor: winPointsOf(o), available, ceiling: winPointsOf(o) + available };
    })
    .filter((o) => o.ceiling >= W);

  if (pool.length < playoffTeamCount) return false;

  const poolIds = new Set(pool.map((p) => p.teamId));
  const intraGames = schedule
    .filter((m) => !m.decided && m.homeId !== teamId && m.awayId !== teamId && poolIds.has(m.homeId) && poolIds.has(m.awayId))
    .map((m) => ({ a: m.homeId, b: m.awayId }));

  const subsetIdxCombos = combinations(pool.length, playoffTeamCount);
  if (subsetIdxCombos.length > MAX_SUBSET_CHECKS) {
    // Pathologically large league -- fall back to the conservative
    // independent-ceiling read (may say "not yet clinched" a hair early,
    // never the reverse) rather than hang the browser.
    return true;
  }

  for (const idxs of subsetIdxCombos) {
    const subset = idxs.map((i) => pool[i]);
    const subsetIds = new Set(subset.map((s) => s.teamId));
    const subsetIntraGames = intraGames.filter((g) => subsetIds.has(g.a) && subsetIds.has(g.b));
    const withNeed = subset.map((s) => {
      const need = Math.max(0, W - s.floor);
      const intraCount = subsetIntraGames.filter((g) => g.a === s.teamId || g.b === s.teamId).length;
      const freeWins = Math.max(0, s.available - intraCount);
      return { teamId: s.teamId, need: Math.max(0, need - freeWins) };
    });
    if (subsetCanAllReach(withNeed, subsetIntraGames)) return true;
  }
  return false;
}

// Box-Muller transform -- good enough for a season-scoring approximation.
function randNormal(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// How uncertain we are about a team's TRUE mean weekly output, as a fraction
// of that mean -- separate from PER_GAME_NOISE_PCT below, which is the
// week-to-week wobble around a KNOWN true mean. This is "how wrong could our
// point estimate of the mean itself be," and it's largest with no games
// played yet (pure roster projection) and shrinks toward a floor (never
// zero -- a team's true form is never perfectly knowable) as real results
// accumulate.
const STRENGTH_UNCERTAINTY_PRESEASON = 0.2;
const STRENGTH_UNCERTAINTY_FLOOR = 0.05;
const PER_GAME_NOISE_PCT = 0.16;

/** A team's assumed weekly scoring "true talent" for the simulation, PLUS
 * how uncertain that estimate itself still is. Blends season-to-date average
 * (once there's a real sample) with a roster-projection baseline the caller
 * supplies -- pure preseason projection in week 1, mostly actual performance
 * by week 5+. The uncertainty is what lets the Monte Carlo below treat an
 * early single big/bad week as one noisy data point about a still-mostly-
 * unknown team, instead of locking in that week's score as if it were now a
 * proven, unwavering weekly average for the rest of the season. */
function estimateStrength(standing: StandingRow, projected: number): { mean: number; uncertainty: number } {
  const gamesPlayed = standing.wins + standing.losses + standing.ties;
  if (gamesPlayed === 0) return { mean: projected, uncertainty: STRENGTH_UNCERTAINTY_PRESEASON };
  const avgActual = standing.pointsFor / gamesPlayed;
  const trustActual = Math.min(1, gamesPlayed / 4);
  const mean = avgActual * trustActual + projected * (1 - trustActual);
  const uncertainty = STRENGTH_UNCERTAINTY_FLOOR + (STRENGTH_UNCERTAINTY_PRESEASON - STRENGTH_UNCERTAINTY_FLOOR) * (1 - trustActual);
  return { mean, uncertainty };
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
/** Which opponents get a forced loss (and how many times) when teamId wins
 * the remaining games at `winIdxs`. Shared by winOutThreatBreakdown (the
 * narrative text) and othersCanSimultaneouslyReach (the actual clinch
 * determination), so the two stay consistent about what "winning these
 * games" implies for everyone else's record. */
function forcedLossesFromWins(
  teamId: number,
  winIdxs: number[],
  remainingByTeam: Map<number, { week: number; opponentId: number }[]>
): Map<number, number> {
  const myRemaining = remainingByTeam.get(teamId) ?? [];
  const forcedLosses = new Map<number, number>();
  for (const idx of winIdxs) {
    const oppId = myRemaining[idx]?.opponentId;
    if (oppId == null) continue;
    forcedLosses.set(oppId, (forcedLosses.get(oppId) ?? 0) + 1);
  }
  return forcedLosses;
}

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

  const forcedLosses = forcedLossesFromWins(teamId, winIdxs, remainingByTeam);

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

/** Greedy stand-in for "the w remaining games most worth winning": beat
 * whichever opponents have the highest win-out ceiling first, since
 * suppressing the biggest threats is the strongest lever available. See the
 * comment where this is called for why an exhaustive search is no longer
 * used. */
function greedyWinIdxs(
  myRemaining: { week: number; opponentId: number }[],
  w: number,
  unconditionalCeilings: Map<number, number>
): number[] {
  return myRemaining
    .map((g, i) => ({ i, ceiling: unconditionalCeilings.get(g.opponentId) ?? 0 }))
    .sort((a, b) => b.ceiling - a.ceiling)
    .slice(0, w)
    .map((x) => x.i);
}

/** True when winning the games at `winIdxs` guarantees a playoff spot no
 * matter how every other game goes -- checked via othersCanSimultaneouslyReach,
 * which accounts for other teams playing EACH OTHER (not just independently
 * assumed capable of winning out), so it doesn't falsely say "not clinched"
 * just because several teams could each individually reach the same record. */
function clinchesWithWins(
  teamId: number,
  winIdxs: number[],
  standings: StandingRow[],
  remainingByTeam: Map<number, { week: number; opponentId: number }[]>,
  floors: Map<number, number>,
  schedule: ScheduledMatchup[],
  playoffTeamCount: number
): boolean {
  const myEnd = (floors.get(teamId) ?? 0) + winIdxs.length;
  const forcedLosses = forcedLossesFromWins(teamId, winIdxs, remainingByTeam);
  return !othersCanSimultaneouslyReach(teamId, myEnd, forcedLosses, standings, remainingByTeam, schedule, playoffTeamCount);
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

  const strengthByTeam: Record<number, { mean: number; uncertainty: number }> = {};
  standings.forEach((s) => {
    strengthByTeam[s.teamId] = estimateStrength(s, projectedStrengthByTeam[s.teamId] ?? 100);
  });

  // ---- Monte Carlo playoff odds over the remaining schedule ----
  const undecided = schedule.filter((m) => !m.decided);
  const madePlayoffsCount = new Map<number, number>(standings.map((s) => [s.teamId, 0]));

  for (let sim = 0; sim < simulations; sim++) {
    const simWinPoints = new Map(standings.map((s) => [s.teamId, winPointsOf(s)]));
    const simPoints = new Map(standings.map((s) => [s.teamId, s.pointsFor]));

    // This simulated season's hypothesis for each team's TRUE weekly mean --
    // drawn once per simulation (not once per game), so a team's uncertainty
    // about their own real talent level carries consistently across all
    // their remaining games within this one simulated timeline, the same way
    // real uncertainty does (a team that's actually better than its week-1
    // score suggests stays better all season in that hypothesis, rather than
    // "forgetting" every week). Game-to-game noise is layered on top of
    // *this*, not on top of the raw point estimate.
    const simTrueMean = new Map<number, number>();
    standings.forEach((s) => {
      const { mean, uncertainty } = strengthByTeam[s.teamId] ?? { mean: 100, uncertainty: STRENGTH_UNCERTAINTY_PRESEASON };
      simTrueMean.set(s.teamId, Math.max(1, randNormal(mean, mean * uncertainty)));
    });

    undecided.forEach((m) => {
      const homeMean = simTrueMean.get(m.homeId) ?? 100;
      const awayMean = simTrueMean.get(m.awayId) ?? 100;
      const homeScore = randNormal(homeMean, homeMean * PER_GAME_NOISE_PCT);
      const awayScore = randNormal(awayMean, awayMean * PER_GAME_NOISE_PCT);
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
      clinchesWithWins(s.teamId, [], standings, remainingByTeam, floors, schedule, playoffTeamCount);

    // Season done for this team and clinch math (incl. locked PF) says we're
    // outside the cutoff — eliminated, not merely "alive without destiny".
    if (!eliminated && !clinched && gamesRemaining === 0) {
      eliminated = true;
    }

    let winsNeededToClinch: number | null = null;
    if (!clinched && !eliminated) {
      for (let w = 0; w <= gamesRemaining; w++) {
        // Which w games to win: the true minimum would need every combination
        // checked, but now that each check is itself a rigorous multi-team
        // simultaneous-feasibility solve (see othersCanSimultaneouslyReach),
        // that's no longer tractable -- beat the biggest remaining threats
        // first instead. Not guaranteed optimal in every theoretical edge
        // case, but a well-justified stand-in: suppressing the highest-
        // ceiling opponents first is the intuitively strongest move, and this
        // still reports a genuinely verified clinch, just possibly not the
        // information-theoretic minimum win count.
        const idxs = w === 0 ? [] : w === gamesRemaining ? allIdxs : greedyWinIdxs(myRemaining, w, unconditionalCeilings);
        if (clinchesWithWins(s.teamId, idxs, standings, remainingByTeam, floors, schedule, playoffTeamCount)) {
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
      const clinching = winsNeededToClinch === 0 ? [] : greedyWinIdxs(myRemaining, winsNeededToClinch, unconditionalCeilings);
      if (clinchesWithWins(s.teamId, clinching, standings, remainingByTeam, floors, schedule, playoffTeamCount)) {
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
