// AI Coach trade-suggestion pipeline -- pure (no React), so the Coach tab
// (hooks/useFantasyApp.ts) and Roster Sensei's suggest_trades tool
// (server/agent/tools/coachTools.ts) run the exact same generators, ranking,
// and mix. Keep it that way: an earlier copy of this pipeline lived here AND
// in the hook, drifted, and was deleted as "dead" while the server still
// imported it. Tunables live in config/trade.ts; the per-trade math
// (pricing, fairness, star gate, mutual fit) lives in lib/tradeEngine.ts.
import { POSITIONS } from "../config/league.js";
import {
  COACH_MAX_SUGGESTIONS,
  COACH_MIN_ONE_FOR_ONE,
  COACH_MIN_OTHER_TRADES,
  COACH_MIN_TWO_FOR_TWO,
  FAIR_RATIO_MAX,
  FAIR_RATIO_MIN,
} from "../config/trade.js";
import { analyzeRosterNeeds } from "./rosterNeeds.js";
import { qualityScore } from "./scoring.js";
import {
  balancePackage,
  balanceTwoForTwo,
  compareTradeFit,
  evaluateTradeFit,
  fairnessRatio,
  isNeedPosition,
  marketCheck,
  needAdjustedPackageValue,
  ratioIsFair,
  starGateOk,
  SEASON_PRICER,
  type PositionBaseline,
} from "./tradeEngine.js";
import type { LeaguePlayer, LeagueTeam, Player, Position, RosterNeeds, ScoredPlayer, TradeFit, TradeSuggestion } from "../types.js";

/** League baseline = the average starter quality score at each position
 * across every team in the league (all opponents + you), so "need" and
 * "strength" are judged relative to what a typical starter actually looks
 * like this season. */
export function buildLeagueBaseline(rosters: Player[][]): PositionBaseline {
  const baseline = {} as PositionBaseline;
  POSITIONS.forEach((pos) => {
    const scores = rosters.map((r) => analyzeRosterNeeds(r)[pos].starterScore).filter((s) => s > 0);
    baseline[pos] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  });
  return baseline;
}

/** A position is a "need" if you're missing a starter outright, or your
 * starter quality score sits meaningfully (15%+) below the league-average
 * starter there. */
export function computeNeedyPositions(myNeeds: RosterNeeds, baseline: PositionBaseline): Position[] {
  return POSITIONS.filter((pos) => isNeedPosition(myNeeds, baseline, pos));
}

/** A position is a "strength" you can trade from if your starter score is
 * well above league average AND you actually have quality bench depth
 * sitting behind those starters. */
export function computeStrengthPositions(myNeeds: RosterNeeds, baseline: PositionBaseline): Position[] {
  return POSITIONS.filter((pos) => {
    const n = myNeeds[pos];
    if (!baseline[pos]) return false;
    return n.starterScore > baseline[pos] * 1.1 && n.tradeableDepth.length > 0;
  });
}

/** Which positions are worth putting in a trade at all: position players only
 * (QB/RB/WR/TE). Kickers and defenses are never traded -- values are
 * near-identical across the pool and managers just stream them. QBs only when
 * QB is a genuine need, since a QB-for-QB swap between two set starters in a
 * 1QB league is a pointless lateral move. */
export function isTradeablePosition(pos: Position, needyPositions: Position[]): boolean {
  return pos !== "K" && pos !== "DST" && (pos !== "QB" || needyPositions.includes("QB"));
}

/** The give-side pool every trade-suggestion generator draws from: everyone
 * at a tradeable position EXCEPT your single best player there (keep your
 * studs, trade from the rest), and not currently Out. Also what the "what
 * would it take?" solver draws from, so none of them can suggest parting with
 * a player the others would consider untouchable. */
export function computeMovablePlayers(myNeeds: RosterNeeds, isTradeablePos: (pos: Position) => boolean): Player[] {
  const movable: Player[] = [];
  POSITIONS.forEach((pos) => {
    if (!isTradeablePos(pos)) return;
    myNeeds[pos].players.slice(1).forEach((p) => {
      if (p.status !== "Out") movable.push(p);
    });
  });
  return movable;
}

/** Everything the generators need, computed once. */
export interface CoachContext {
  myPlayers: Player[];
  myNeeds: RosterNeeds;
  leagueBaseline: PositionBaseline;
  needyPositions: Position[];
  isTradeablePos: (pos: Position) => boolean;
  myMovablePlayers: Player[];
  /** Every OTHER team -- never includes your own roster. */
  leagueTeams: LeagueTeam[];
  /** leagueTeams' rosters flattened, each tagged with its fantasy team. */
  leaguePlayers: LeaguePlayer[];
  /** Mutual fit of a candidate trade: does it make BOTH starting lineups
   * better at a position each team actually needs? Fairness (the ratio
   * window) still decides whether a trade is shown at all; fit decides which
   * fair trades lead -- a WR-for-WR upgrade that just moves your hole onto
   * their roster is fair on paper but a trade they have no reason to take. */
  tradeFitFor: (theirRoster: Player[], give: Player[], get: Player[]) => TradeFit;
}

export function buildCoachContext(input: {
  myPlayers: Player[];
  leagueTeams: LeagueTeam[];
  /** Pass these when the caller already has them (the hook computes them for
   * its own UI) so they're never computed two different ways. */
  myNeeds?: RosterNeeds;
  leagueBaseline?: PositionBaseline;
}): CoachContext {
  const { myPlayers, leagueTeams } = input;
  const myNeeds = input.myNeeds ?? analyzeRosterNeeds(myPlayers);
  const leagueBaseline = input.leagueBaseline ?? buildLeagueBaseline([...leagueTeams.map((t) => t.roster), myPlayers]);
  const needyPositions = computeNeedyPositions(myNeeds, leagueBaseline);
  const isTradeablePos = (pos: Position) => isTradeablePosition(pos, needyPositions);
  return {
    myPlayers,
    myNeeds,
    leagueBaseline,
    needyPositions,
    isTradeablePos,
    myMovablePlayers: computeMovablePlayers(myNeeds, isTradeablePos),
    leagueTeams,
    leaguePlayers: leagueTeams.flatMap((t) => t.roster.map((p) => ({ ...p, fantasyTeamId: t.id, fantasyTeamName: t.name }))),
    tradeFitFor: (theirRoster, give, get) => evaluateTradeFit(myPlayers, theirRoster, give, get, leagueBaseline),
  };
}

export function suggestionKey(s: TradeSuggestion): string {
  return `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`;
}

export function dedupeSuggestions(suggestions: TradeSuggestion[]): TradeSuggestion[] {
  const seen = new Set<string>();
  const deduped: TradeSuggestion[] = [];
  suggestions.forEach((s) => {
    const key = suggestionKey(s);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(s);
  });
  return deduped;
}

// Need-based suggestions: your real weakness matched to their real weakness.
// For each upgrade at one of your need positions, try paying from EVERY
// other position where that team is thin (not just the first one found, and
// not only from a declared "strength" of yours) -- evaluateTradeFit then
// judges whether losing that piece actually costs your lineup more than the
// upgrade gains.
function needBasedSuggestions(ctx: CoachContext): TradeSuggestion[] {
  const { myNeeds, leagueBaseline, needyPositions, isTradeablePos, myMovablePlayers, leagueTeams, leaguePlayers, tradeFitFor } = ctx;
  const found: TradeSuggestion[] = [];
  needyPositions.forEach((needPos) => {
    if (!isTradeablePos(needPos)) return;
    const myWeak = myNeeds[needPos].weakestStarter;
    const myWeakQ = myWeak ? myWeak.qScore : 0;
    // Candidates ranked by quality score, not raw proj, so an injured
    // "star" doesn't outrank a healthy, reliable upgrade.
    const candidates = leaguePlayers
      .filter((p) => p.pos === needPos && p.status !== "Out")
      .map((p) => ({ ...p, qScore: qualityScore(p) }))
      .filter((p) => p.qScore > myWeakQ * 1.1) // must be a clear upgrade, not a near-lateral move
      .sort((a, b) => b.qScore - a.qScore)
      .slice(0, 10);

    candidates.forEach((cand) => {
      const theirTeam = leagueTeams.find((t) => t.id === cand.fantasyTeamId);
      if (!theirTeam) return;
      const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
      const candVal = SEASON_PRICER.value(cand);
      const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

      const overlapPositions = POSITIONS.filter(
        (sp) => sp !== needPos && isTradeablePos(sp) && isNeedPosition(theirNeeds, leagueBaseline, sp)
      );
      overlapPositions.forEach((overlapPos) => {
        const offerPool = myMovablePlayers.filter((p) => p.pos === overlapPos);
        if (!offerPool.length) return;
        const offerPlayer = offerPool.reduce((best, p) =>
          Math.abs(SEASON_PRICER.value(p) - candVal) < Math.abs(SEASON_PRICER.value(best) - candVal) ? p : best
        );
        const offerVal = SEASON_PRICER.value(offerPlayer);
        // Coarse pre-filter -- balancePackage does the real ratio check.
        const preRatio = fairnessRatio(offerVal, candVal);
        if (preRatio > 1.9 || preRatio < 0.5) return;

        const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);

        const result = balancePackage([offerPlayer], [cand], theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions, SEASON_PRICER);
        if (result) {
          found.push({
            id: `${theirTeam.id}-${result.get.map((p) => p.id).join(",")}-${result.give.map((p) => p.id).join(",")}`,
            teamId: theirTeam.id,
            teamName: theirTeam.name,
            give: result.give,
            get: result.get,
            needPos,
            overlapPos,
            giveVal: result.giveVal,
            getVal: result.getVal,
            ratio: result.ratio,
            upgrade: cand.qScore - myWeakQ,
            reason: "need",
            fit: tradeFitFor(theirTeam.roster, result.give, result.get),
          });
        }

        // Also offer a genuine 2-for-2 built around the same core.
        const twoResult = balanceTwoForTwo(offerPlayer, cand, theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions, SEASON_PRICER);
        if (twoResult) {
          found.push({
            id: `2x2-${theirTeam.id}-${twoResult.get.map((p) => p.id).join(",")}-${twoResult.give.map((p) => p.id).join(",")}`,
            teamId: theirTeam.id,
            teamName: theirTeam.name,
            give: twoResult.give,
            get: twoResult.get,
            needPos,
            overlapPos,
            giveVal: twoResult.giveVal,
            getVal: twoResult.getVal,
            ratio: twoResult.ratio,
            upgrade: cand.qScore - myWeakQ,
            reason: "need",
            fit: tradeFitFor(theirTeam.roster, twoResult.give, twoResult.get),
          });
        }
      });
    });
  });

  return dedupeSuggestions(found.sort((a, b) => compareTradeFit(a.fit, b.fit)));
}

// Mutual-fit suggestions: trades built deliberately so each side fills a
// need (or, failing a full two-way fit, fills yours while still leaving
// their starting lineup better -- tier 2). For every opponent, pair a player of yours who'd START at one of
// their need positions with one of theirs who'd upgrade one of yours, then
// try adding one more piece to either side (up to 2-for-2) to land inside
// the fair window. The other generators start from value and hope for fit;
// in practice a fair 1-for-1 almost never fills a need on both rosters (the
// player you want is usually their starter, and your surplus is usually a
// bench piece for them too), so without this the list collapses into
// same-position swaps. Capped per team so one well-matched opponent can't
// fill the list.
function mutualFitSuggestions(ctx: CoachContext): TradeSuggestion[] {
  const { myNeeds, leagueBaseline, isTradeablePos, myMovablePlayers, leagueTeams, tradeFitFor } = ctx;
  const PER_TEAM = 3;
  const MAX_EXTRA_GET = 8;
  const found: TradeSuggestion[] = [];
  const myNeedPositions = POSITIONS.filter((pos) => isTradeablePos(pos) && isNeedPosition(myNeeds, leagueBaseline, pos));
  if (!myNeedPositions.length) return found;

  const beats = (p: Player, starter: Player | null) => !starter || SEASON_PRICER.value(p) > SEASON_PRICER.value(starter);

  leagueTeams.forEach((team) => {
    const theirNeeds = analyzeRosterNeeds(team.roster);
    const theirNeedPositions = POSITIONS.filter((pos) => isTradeablePos(pos) && isNeedPosition(theirNeeds, leagueBaseline, pos));
    const helpers = myMovablePlayers.filter((p) => theirNeedPositions.includes(p.pos) && beats(p, theirNeeds[p.pos].weakestStarter));
    const targets = team.roster.filter(
      (p) => p.status !== "Out" && myNeedPositions.includes(p.pos) && beats(p, myNeeds[p.pos].weakestStarter)
    );
    if (!helpers.length || !targets.length) return;

    const theirExtras = team.roster
      .filter((p) => p.status !== "Out" && isTradeablePos(p.pos))
      .sort((a, b) => SEASON_PRICER.value(b) - SEASON_PRICER.value(a))
      .slice(0, MAX_EXTRA_GET + targets.length);

    const teamFound: TradeSuggestion[] = [];
    helpers.forEach((helper) => {
      targets.forEach((target) => {
        const giveOptions: Player[][] = [[helper], ...myMovablePlayers.filter((p) => p.id !== helper.id).map((p) => [helper, p])];
        const getOptions: Player[][] = [[target], ...theirExtras.filter((p) => p.id !== target.id).slice(0, MAX_EXTRA_GET).map((p) => [target, p])];
        giveOptions.forEach((give) => {
          const giveVal = needAdjustedPackageValue(give, theirNeeds, leagueBaseline, SEASON_PRICER);
          getOptions.forEach((get) => {
            const getVal = needAdjustedPackageValue(get, myNeeds, leagueBaseline, SEASON_PRICER);
            const ratio = fairnessRatio(giveVal, getVal);
            if (!ratioIsFair(ratio) || !starGateOk(give, get, SEASON_PRICER)) return;
            const fit = tradeFitFor(team.roster, give, get);
            if (fit.tier < 2) return;
            teamFound.push({
              id: `mut-${team.id}-${get.map((p) => p.id).join(",")}-${give.map((p) => p.id).join(",")}`,
              teamId: team.id,
              teamName: team.name,
              give,
              get,
              needPos: target.pos,
              overlapPos: helper.pos,
              giveVal,
              getVal,
              ratio,
              upgrade: fit.myGain,
              reason: "need",
              fit,
            });
          });
        });
      });
    });
    found.push(...dedupeSuggestions(teamFound.sort((a, b) => compareTradeFit(a.fit, b.fit))).slice(0, PER_TEAM));
  });
  return found.sort((a, b) => compareTradeFit(a.fit, b.fit));
}

// General value-based suggestions: run regardless of whether you have a
// clear need, so there's always something reasonable on the table.
function generalSuggestions(ctx: CoachContext): TradeSuggestion[] {
  const { myNeeds, leagueBaseline, isTradeablePos, myMovablePlayers, leagueTeams, leaguePlayers, tradeFitFor } = ctx;
  const found: TradeSuggestion[] = [];
  const movable = myMovablePlayers;

  movable.forEach((offerPlayer) => {
    const offerVal = SEASON_PRICER.value(offerPlayer);
    const candidates = leaguePlayers
      .filter((p) => p.status !== "Out" && p.fantasyTeamId && isTradeablePos(p.pos))
      .map((p) => ({ ...p, qScore: qualityScore(p) }))
      .filter((p) => {
        const myWorstAtPos = myNeeds[p.pos] ? myNeeds[p.pos].weakestStarter : null;
        const myWorstQ = myWorstAtPos ? myWorstAtPos.qScore : -Infinity;
        return p.qScore > myWorstQ * 1.06; // must actually be an upgrade somewhere on your roster
      })
      .sort((a, b) => SEASON_PRICER.value(b) - SEASON_PRICER.value(a))
      .slice(0, 6);

    candidates.forEach((cand) => {
      const theirTeam = leagueTeams.find((t) => t.id === cand.fantasyTeamId);
      if (!theirTeam) return;
      const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
      const candVal = SEASON_PRICER.value(cand);
      const preRatio = fairnessRatio(offerVal, candVal);
      if (preRatio > 1.9 || preRatio < 0.5) return;

      const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
      const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

      const result = balancePackage([offerPlayer], [cand], theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions, SEASON_PRICER);
      if (result) {
        found.push({
          id: `gen-${theirTeam.id}-${result.get.map((p) => p.id).join(",")}-${result.give.map((p) => p.id).join(",")}`,
          teamId: theirTeam.id,
          teamName: theirTeam.name,
          give: result.give,
          get: result.get,
          needPos: cand.pos,
          overlapPos: offerPlayer.pos,
          giveVal: result.giveVal,
          getVal: result.getVal,
          ratio: result.ratio,
          upgrade: result.getVal - result.giveVal,
          reason: "value",
          fit: tradeFitFor(theirTeam.roster, result.give, result.get),
        });
      }

      const twoResult = balanceTwoForTwo(offerPlayer, cand, theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions, SEASON_PRICER);
      if (twoResult) {
        found.push({
          id: `gen2x2-${theirTeam.id}-${twoResult.get.map((p) => p.id).join(",")}-${twoResult.give.map((p) => p.id).join(",")}`,
          teamId: theirTeam.id,
          teamName: theirTeam.name,
          give: twoResult.give,
          get: twoResult.get,
          needPos: cand.pos,
          overlapPos: offerPlayer.pos,
          giveVal: twoResult.giveVal,
          getVal: twoResult.getVal,
          ratio: twoResult.ratio,
          upgrade: twoResult.getVal - twoResult.giveVal,
          reason: "value",
          fit: tradeFitFor(theirTeam.roster, twoResult.give, twoResult.get),
        });
      }
    });
  });

  return dedupeSuggestions(found.sort((a, b) => compareTradeFit(a.fit, b.fit)));
}

// Guaranteed tier: simple, fair, same-position swaps so the AI Coach always
// has something on the table even when nothing clears the bar above.
function fallbackSuggestions(ctx: CoachContext): TradeSuggestion[] {
  const { myNeeds, isTradeablePos, leagueTeams, leaguePlayers, tradeFitFor } = ctx;
  const found: TradeSuggestion[] = [];
  POSITIONS.forEach((pos) => {
    if (!isTradeablePos(pos)) return;
    const myPlayersAtPos = myNeeds[pos].players;
    if (!myPlayersAtPos.length) return;
    const candidateGive = myPlayersAtPos[myPlayersAtPos.length - 1];
    if (candidateGive.status === "Out") return;
    const giveVal = SEASON_PRICER.value(candidateGive);
    const pool = leaguePlayers.filter((p) => p.pos === pos && p.status !== "Out" && p.id !== candidateGive.id);
    if (!pool.length) return;
    const closest = pool.reduce((best, p) =>
      Math.abs(SEASON_PRICER.value(p) - giveVal) < Math.abs(SEASON_PRICER.value(best) - giveVal) ? p : best
    );
    const theirTeam = leagueTeams.find((t) => t.id === closest.fantasyTeamId);
    if (!theirTeam) return;
    const getVal = SEASON_PRICER.value(closest);
    const ratio = fairnessRatio(giveVal, getVal);
    if (ratio < FAIR_RATIO_MIN || ratio > FAIR_RATIO_MAX) return;
    if (!starGateOk([candidateGive], [closest], SEASON_PRICER)) return;
    found.push({
      id: `fallback-${theirTeam.id}-${closest.id}-${candidateGive.id}`,
      teamId: theirTeam.id,
      teamName: theirTeam.name,
      give: [candidateGive],
      get: [closest],
      needPos: pos,
      overlapPos: pos,
      giveVal,
      getVal,
      ratio,
      upgrade: getVal - giveVal,
      reason: "fallback",
      fit: tradeFitFor(theirTeam.roster, [candidateGive], [closest]),
    });
  });
  return found.sort((a, b) => compareTradeFit(a.fit, b.fit) || Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
}

// Guaranteed 2-for-2 tier: pair two of your movable pieces with two of an
// opponent's, priced the same way, so the recommender always has real
// two-for-two options and never devolves into all 1-for-1s (or all 2-for-1s).
function twoForTwoFallbackSuggestions(ctx: CoachContext): TradeSuggestion[] {
  const { myNeeds, leagueBaseline, isTradeablePos, myMovablePlayers, leagueTeams, tradeFitFor } = ctx;
  const found: TradeSuggestion[] = [];
  const myMovable = [...myMovablePlayers].sort((a, b) => SEASON_PRICER.value(b) - SEASON_PRICER.value(a)).slice(0, 6);
  if (myMovable.length < 2) return found;

  const givePairs: Player[][] = [];
  for (let i = 0; i < myMovable.length; i++) {
    for (let j = i + 1; j < myMovable.length; j++) givePairs.push([myMovable[i], myMovable[j]]);
  }

  leagueTeams.forEach((team) => {
    const theirNeeds = analyzeRosterNeeds(team.roster);
    const theirActive = team.roster
      .filter((p) => p.status !== "Out" && isTradeablePos(p.pos))
      .sort((a, b) => SEASON_PRICER.value(b) - SEASON_PRICER.value(a))
      .slice(0, 12);
    if (theirActive.length < 2) return;

    // Best pair for this team = best mutual fit among the fair ones, then
    // closest to an even ratio -- not just the closest ratio, which happily
    // picks a same-position shuffle that helps neither lineup.
    type Pick = { give: Player[]; get: Player[]; giveVal: number; getVal: number; ratio: number; fit: TradeFit };
    let best: Pick | null = null;
    givePairs.forEach((give) => {
      const giveVal = needAdjustedPackageValue(give, theirNeeds, leagueBaseline, SEASON_PRICER);
      for (let i = 0; i < theirActive.length; i++) {
        for (let j = i + 1; j < theirActive.length; j++) {
          const get = [theirActive[i], theirActive[j]];
          const getVal = needAdjustedPackageValue(get, myNeeds, leagueBaseline, SEASON_PRICER);
          const ratio = getVal / giveVal;
          if (ratio < FAIR_RATIO_MIN || ratio > FAIR_RATIO_MAX || !starGateOk(give, get, SEASON_PRICER)) continue;
          const fit = tradeFitFor(team.roster, give, get);
          const cur = best as Pick | null;
          if (!cur || compareTradeFit(fit, cur.fit) < 0 || (compareTradeFit(fit, cur.fit) === 0 && Math.abs(ratio - 1) < Math.abs(cur.ratio - 1))) {
            best = { give, get, giveVal, getVal, ratio, fit };
          }
        }
      }
    });
    if (!best) return;
    const b = best as Pick;
    found.push({
      id: `2x2fb-${team.id}-${b.get.map((p) => p.id).join(",")}-${b.give.map((p) => p.id).join(",")}`,
      teamId: team.id,
      teamName: team.name,
      give: b.give,
      get: b.get,
      needPos: b.get[0].pos,
      overlapPos: b.give[0].pos,
      giveVal: b.giveVal,
      getVal: b.getVal,
      ratio: b.ratio,
      upgrade: b.getVal - b.giveVal,
      reason: "fallback",
      fit: b.fit,
    });
  });
  return found.sort((a, b) => compareTradeFit(a.fit, b.fit) || Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
}

/** Every candidate trade each generator can produce right now, before the
 * top-N mix. */
export interface CoachPools {
  mutual: TradeSuggestion[];
  need: TradeSuggestion[];
  general: TradeSuggestion[];
  fallback: TradeSuggestion[];
  twoForTwoFallback: TradeSuggestion[];
}

export function buildCoachPools(ctx: CoachContext): CoachPools {
  return {
    mutual: mutualFitSuggestions(ctx),
    need: needBasedSuggestions(ctx),
    general: generalSuggestions(ctx),
    fallback: fallbackSuggestions(ctx),
    twoForTwoFallback: twoForTwoFallbackSuggestions(ctx),
  };
}

/** The same pools with `keep` applied to every one of them -- filtering
 * BEFORE the mix, so the mix's shape minimums and reserved slots still hold
 * for whatever survives. */
export function filterPools(pools: CoachPools, keep: (s: TradeSuggestion) => boolean): CoachPools {
  return {
    mutual: pools.mutual.filter(keep),
    need: pools.need.filter(keep),
    general: pools.general.filter(keep),
    fallback: pools.fallback.filter(keep),
    twoForTwoFallback: pools.twoForTwoFallback.filter(keep),
  };
}

export function allPoolSuggestions(pools: CoachPools): TradeSuggestion[] {
  return [...pools.mutual, ...pools.need, ...pools.general, ...pools.fallback, ...pools.twoForTwoFallback];
}

/** Where the trade market alone puts a suggestion (lib/tradeEngine.ts
 * marketCheck): 0 = market-fair (or the market has no opinion), 1 = the
 * market says you win big (the other manager likely balks), 2 = the market
 * says you overpay. Every suggestion is already fair by the app's own
 * formula; this only decides how early it gets shown. */
function marketTier(s: TradeSuggestion): number {
  const tone = marketCheck(s.give, s.get)?.tone;
  return tone === "you_overpay" ? 2 : tone === "you_win" ? 1 : 0;
}

/** The list the Coach tab shows: trades the market also calls fair come
 * first, and ones the market flags (you win big, then you overpay) are only
 * used once the fair ones are exhausted -- i.e. toward the end of cycling
 * "Get new recommendations" -- and always sort to the bottom of a batch.
 * Within each market tier: shape minimums, good fits first with slots
 * reserved for other fair trades, skipping anything in `excludedKeys` (already
 * shown via "Get new recommendations") unless that would leave it short. */
export function mixCoachSuggestions(pools: CoachPools, excludedKeys: Set<string> = new Set(), max: number = COACH_MAX_SUGGESTIONS): TradeSuggestion[] {
  const tiers = new Map<string, number>();
  const tierOf = (s: TradeSuggestion) => {
    const key = suggestionKey(s);
    let t = tiers.get(key);
    if (t == null) tiers.set(key, (t = marketTier(s)));
    return t;
  };

  const combined: TradeSuggestion[] = [];
  const usedKeys = new Set<string>();
  for (const maxTier of [0, 1, 2]) {
    if (combined.length >= max) break;
    const tierPools = filterPools(pools, (s) => tierOf(s) <= maxTier);
    const skip = new Set([...excludedKeys, ...usedKeys]);
    for (const s of mixFreshSuggestions(tierPools, skip, max - combined.length)) {
      usedKeys.add(suggestionKey(s));
      combined.push(s);
    }
  }

  // If excluding already-seen suggestions leaves the list short, top it off
  // with the best previously-seen ones (market-fair first) rather than
  // showing an empty tab -- still good, reasonable trades, just not brand new.
  if (combined.length < max) {
    const everything = allPoolSuggestions(pools).sort((a, b) => tierOf(a) - tierOf(b) || rankSuggestions(a, b));
    for (const s of everything) {
      if (combined.length >= max) break;
      const key = suggestionKey(s);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      combined.push(s);
    }
  }

  // The shape minimums decide WHICH trades make the cut; display order is
  // market tier, then pure rank, so a Win-win 2-for-2 isn't buried under a
  // forced 1-for-1 that doesn't help the other side, and a market overpay
  // never sits above a market-fair trade.
  return combined.sort((a, b) => tierOf(a) - tierOf(b) || rankSuggestions(a, b));
}

/** Mutual fit leads (a trade that fills a need on BOTH rosters is the one
 * the other manager actually wants), then need-driven over value-driven,
 * then the biggest lift to your lineup. */
function rankSuggestions(a: TradeSuggestion, b: TradeSuggestion): number {
  const priority = (s: TradeSuggestion) => (s.reason === "need" ? 1 : 0);
  return b.fit.tier - a.fit.tier || priority(b) - priority(a) || compareTradeFit(a.fit, b.fit);
}

/** Up to `max` suggestions not in `excludedKeys`: shape minimums, then good
 * fits with slots reserved for other fair trades. No top-off with excluded
 * ones -- mixCoachSuggestions does that once every market tier is used. */
function mixFreshSuggestions(pools: CoachPools, excludedKeys: Set<string>, max: number): TradeSuggestion[] {
    const notExcluded = (s: TradeSuggestion) => !excludedKeys.has(suggestionKey(s));
    const deduped = dedupeSuggestions([...pools.mutual, ...pools.need, ...pools.general].filter(notExcluded));
    const byRank = rankSuggestions;

    const is1x1 = (s: TradeSuggestion) => s.give.length === 1 && s.get.length === 1;
    const is2x2 = (s: TradeSuggestion) => s.give.length === 2 && s.get.length === 2;

    const freshFallback = pools.fallback.filter(notExcluded);
    const freshTwoForTwoFallback = pools.twoForTwoFallback.filter(notExcluded);

    // Smart pools by shape, then the guaranteed fallback pools to top them up.
    const oneForOne = [...deduped.filter(is1x1), ...freshFallback.filter(is1x1)].sort(byRank);
    const twoForTwo = [...deduped.filter(is2x2), ...freshTwoForTwoFallback].sort(byRank);
    const other = deduped.filter((s) => !is1x1(s) && !is2x2(s)).sort(byRank);

    const combined: TradeSuggestion[] = [];
    const usedKeys = new Set<string>();
    const take = (list: TradeSuggestion[], limit: number) => {
      for (const s of list) {
        if (combined.length >= max || limit <= 0) return;
        const key = suggestionKey(s);
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        combined.push(s);
        limit--;
      }
    };

    // Always lead with the required mix: >=2 one-for-ones and >=2 two-for-twos.
    // Pools are rank-sorted, so these picks are already the best-fitting trades
    // of each shape.
    take(oneForOne, COACH_MIN_ONE_FOR_ONE);
    take(twoForTwo, COACH_MIN_TWO_FOR_TWO);
    // Fill the rest: as many good-fit trades (tier 2+: fills your need AND
    // leaves them better off) as exist, but hold back COACH_MIN_OTHER_TRADES
    // slots for the best of everything else -- fair trades that help you even
    // if they're not an obvious fit for the other side are still worth
    // pitching, and the list shouldn't be all one kind.
    const isGoodFit = (s: TradeSuggestion) => s.fit.tier >= 2;
    const rest = [...oneForOne, ...twoForTwo, ...other, ...freshFallback].sort(byRank);
    const goodFitsTaken = combined.filter(isGoodFit).length;
    take(rest.filter(isGoodFit), max - COACH_MIN_OTHER_TRADES - goodFitsTaken);
    take(rest.filter((s) => !isGoodFit(s)), max);
    // Not enough other trades to fill the reserve -> give it back to good fits.
    take(rest, max);

    return combined;
}

/** One-call version for callers without React state (Roster Sensei).
 * `filter` drops candidates from every pool BEFORE the mix, so the result is
 * still a proper mix (good fits + reserved other trades) of `max` survivors --
 * filtering after the mix would silently throw the reserved slots away. */
export function suggestTrades(input: {
  myPlayers: Player[];
  leagueTeams: LeagueTeam[];
  max?: number;
  filter?: (s: TradeSuggestion) => boolean;
}): {
  suggestions: TradeSuggestion[];
  /** How many candidates existed before `filter` -- lets a caller tell "nothing
   * at all" apart from "only trivial trades, all filtered out". */
  candidateCount: number;
  needyPositions: Position[];
  strengthPositions: Position[];
  baseline: PositionBaseline;
} {
  const ctx = buildCoachContext(input);
  const pools = buildCoachPools(ctx);
  const filtered = input.filter ? filterPools(pools, input.filter) : pools;
  return {
    suggestions: mixCoachSuggestions(filtered, new Set(), input.max ?? COACH_MAX_SUGGESTIONS),
    candidateCount: allPoolSuggestions(pools).length,
    needyPositions: ctx.needyPositions,
    strengthPositions: computeStrengthPositions(ctx.myNeeds, ctx.leagueBaseline),
    baseline: ctx.leagueBaseline,
  };
}
