// AI Coach trade-suggestion pipeline — pure version for Roster Sensei (and
// optionally the Coach tab). Tunables live in config/trade.ts.
import { POSITIONS } from "../config/league.js";
import {
  COACH_MAX_SUGGESTIONS,
  COACH_MIN_ONE_FOR_ONE,
  COACH_MIN_TWO_FOR_TWO,
  FAIR_RATIO_MAX,
  FAIR_RATIO_MIN,
} from "../config/trade.js";
import { analyzeRosterNeeds } from "./rosterNeeds.js";
import { playerValue, qualityScore } from "./scoring.js";
import {
  balancePackage,
  balanceTwoForTwo,
  fairnessRatio,
  needAdjustedPackageValue,
  starGateOk,
  type PositionBaseline,
} from "./tradeEngine.js";
import type { LeaguePlayer, LeagueTeam, Player, Position, ScoredPlayer, TradeSuggestion } from "../types.js";

function suggestionKey(s: TradeSuggestion): string {
  return `${s.teamId}-${s.get
    .map((p) => p.id)
    .sort()
    .join(",")}`;
}

function dedupeSuggestions(suggestions: TradeSuggestion[]): TradeSuggestion[] {
  const seen = new Set<string>();
  const out: TradeSuggestion[] = [];
  for (const s of suggestions) {
    const key = suggestionKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function isTradeablePos(pos: Position, needyPositions: Position[]): boolean {
  return pos !== "K" && pos !== "DST" && (pos !== "QB" || needyPositions.includes("QB"));
}

function computeNeedy(myNeeds: ReturnType<typeof analyzeRosterNeeds>, baseline: PositionBaseline): Position[] {
  return POSITIONS.filter((pos) => {
    const n = myNeeds[pos];
    if (!n.hasEnoughBodies) return true;
    if (!baseline[pos]) return false;
    return n.starterScore < baseline[pos] * 0.85;
  });
}

function computeStrength(myNeeds: ReturnType<typeof analyzeRosterNeeds>, baseline: PositionBaseline): Position[] {
  return POSITIONS.filter((pos) => {
    const n = myNeeds[pos];
    if (!baseline[pos]) return false;
    return n.starterScore > baseline[pos] * 1.1 && n.tradeableDepth.length > 0;
  });
}

export function buildLeagueBaseline(rosters: Player[][]): PositionBaseline {
  const baseline = {} as PositionBaseline;
  for (const pos of POSITIONS) {
    const scores = rosters.map((r) => analyzeRosterNeeds(r)[pos].starterScore).filter((s) => s > 0);
    baseline[pos] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }
  return baseline;
}

function needBasedSuggestions(
  myNeeds: ReturnType<typeof analyzeRosterNeeds>,
  needyPositions: Position[],
  strengthPositions: Position[],
  baseline: PositionBaseline,
  leaguePlayers: LeaguePlayer[],
  leagueTeams: LeagueTeam[]
): TradeSuggestion[] {
  const found: TradeSuggestion[] = [];
  for (const needPos of needyPositions) {
    if (needPos === "K" || needPos === "DST") continue;
    const myWeak = myNeeds[needPos].weakestStarter;
    const myWeakQ = myWeak ? myWeak.qScore : 0;
    const candidates = leaguePlayers
      .filter((p) => p.pos === needPos && p.status !== "Out")
      .map((p) => ({ ...p, qScore: qualityScore(p) }))
      .filter((p) => p.qScore > myWeakQ * 1.1)
      .sort((a, b) => b.qScore - a.qScore)
      .slice(0, 10);

    for (const cand of candidates) {
      const theirTeam = leagueTeams.find((t) => t.id === cand.fantasyTeamId);
      if (!theirTeam) continue;
      const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
      const overlapPos = strengthPositions
        .filter((sp) => sp !== "K" && sp !== "DST" && sp !== "QB")
        .find((sp) => {
          const tn = theirNeeds[sp];
          if (!tn.hasEnoughBodies) return true;
          if (!baseline[sp]) return false;
          return tn.starterScore < baseline[sp] * 0.85;
        });
      if (!overlapPos) continue;

      const candVal = playerValue(cand);
      const depthOptions = myNeeds[overlapPos].tradeableDepth;
      if (!depthOptions.length) continue;
      const offerPlayer = depthOptions.reduce((best, p) =>
        Math.abs(playerValue(p) - candVal) < Math.abs(playerValue(best) - candVal) ? p : best
      );
      const offerVal = playerValue(offerPlayer);
      const preRatio = fairnessRatio(offerVal, candVal);
      if (preRatio > 1.9 || preRatio < 0.5) continue;

      const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter(
        (p) => p.id !== offerPlayer.id
      );
      const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter(
        (p) => p.id !== cand.id
      );

      const result = balancePackage(
        [offerPlayer],
        [cand],
        theirNeeds,
        myNeeds,
        baseline,
        extraGiveOptions,
        extraGetOptions
      );
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
        });
      }

      const twoResult = balanceTwoForTwo(
        offerPlayer,
        cand,
        theirNeeds,
        myNeeds,
        baseline,
        extraGiveOptions,
        extraGetOptions
      );
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
        });
      }
    }
  }
  return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
}

function generalSuggestions(
  myNeeds: ReturnType<typeof analyzeRosterNeeds>,
  needyPositions: Position[],
  baseline: PositionBaseline,
  leaguePlayers: LeaguePlayer[],
  leagueTeams: LeagueTeam[]
): TradeSuggestion[] {
  const found: TradeSuggestion[] = [];
  const movable: Player[] = [];
  for (const pos of POSITIONS) {
    if (!isTradeablePos(pos, needyPositions)) continue;
    for (const p of myNeeds[pos].players.slice(1)) {
      if (p.status !== "Out") movable.push(p);
    }
  }

  for (const offerPlayer of movable) {
    const offerVal = playerValue(offerPlayer);
    const candidates = leaguePlayers
      .filter((p) => p.status !== "Out" && p.fantasyTeamId && isTradeablePos(p.pos, needyPositions))
      .map((p) => ({ ...p, qScore: qualityScore(p) }))
      .filter((p) => {
        const myWorstAtPos = myNeeds[p.pos] ? myNeeds[p.pos].weakestStarter : null;
        const myWorstQ = myWorstAtPos ? myWorstAtPos.qScore : -Infinity;
        return p.qScore > myWorstQ * 1.06;
      })
      .sort((a, b) => playerValue(b) - playerValue(a))
      .slice(0, 6);

    for (const cand of candidates) {
      const theirTeam = leagueTeams.find((t) => t.id === cand.fantasyTeamId);
      if (!theirTeam) continue;
      const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
      const candVal = playerValue(cand);
      const preRatio = fairnessRatio(offerVal, candVal);
      if (preRatio > 1.9 || preRatio < 0.5) continue;

      const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter(
        (p) => p.id !== offerPlayer.id
      );
      const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter(
        (p) => p.id !== cand.id
      );

      const result = balancePackage(
        [offerPlayer],
        [cand],
        theirNeeds,
        myNeeds,
        baseline,
        extraGiveOptions,
        extraGetOptions
      );
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
        });
      }

      const twoResult = balanceTwoForTwo(
        offerPlayer,
        cand,
        theirNeeds,
        myNeeds,
        baseline,
        extraGiveOptions,
        extraGetOptions
      );
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
        });
      }
    }
  }
  return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
}

function fallbackSuggestions(
  myNeeds: ReturnType<typeof analyzeRosterNeeds>,
  needyPositions: Position[],
  leaguePlayers: LeaguePlayer[],
  leagueTeams: LeagueTeam[]
): TradeSuggestion[] {
  const found: TradeSuggestion[] = [];
  for (const pos of POSITIONS) {
    if (!isTradeablePos(pos, needyPositions)) continue;
    const myPlayersAtPos = myNeeds[pos].players;
    if (!myPlayersAtPos.length) continue;
    const candidateGive = myPlayersAtPos[myPlayersAtPos.length - 1];
    if (candidateGive.status === "Out") continue;
    const giveVal = playerValue(candidateGive);
    const pool = leaguePlayers.filter((p) => p.pos === pos && p.status !== "Out" && p.id !== candidateGive.id);
    if (!pool.length) continue;
    const closest = pool.reduce((best, p) =>
      Math.abs(playerValue(p) - giveVal) < Math.abs(playerValue(best) - giveVal) ? p : best
    );
    const theirTeam = leagueTeams.find((t) => t.id === closest.fantasyTeamId);
    if (!theirTeam) continue;
    const getVal = playerValue(closest);
    const ratio = fairnessRatio(giveVal, getVal);
    if (ratio < FAIR_RATIO_MIN || ratio > FAIR_RATIO_MAX) continue;
    if (!starGateOk([candidateGive], [closest])) continue;
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
    });
  }
  return found.sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
}

function twoForTwoFallbackSuggestions(
  myNeeds: ReturnType<typeof analyzeRosterNeeds>,
  needyPositions: Position[],
  baseline: PositionBaseline,
  leagueTeams: LeagueTeam[]
): TradeSuggestion[] {
  const found: TradeSuggestion[] = [];
  const myMovable = POSITIONS.filter((pos) => isTradeablePos(pos, needyPositions))
    .flatMap((pos) => myNeeds[pos].players.slice(1))
    .filter((p) => p.status !== "Out")
    .sort((a, b) => playerValue(b) - playerValue(a))
    .slice(0, 6);
  if (myMovable.length < 2) return found;

  const givePairs: Player[][] = [];
  for (let i = 0; i < myMovable.length; i++) {
    for (let j = i + 1; j < myMovable.length; j++) givePairs.push([myMovable[i], myMovable[j]]);
  }

  for (const team of leagueTeams) {
    const theirNeeds = analyzeRosterNeeds(team.roster);
    const theirActive = team.roster
      .filter((p) => p.status !== "Out" && isTradeablePos(p.pos, needyPositions))
      .sort((a, b) => playerValue(b) - playerValue(a))
      .slice(0, 12);
    if (theirActive.length < 2) continue;

    let best: { give: Player[]; get: Player[]; giveVal: number; getVal: number; ratio: number } | null = null;
    for (const give of givePairs) {
      const giveVal = needAdjustedPackageValue(give, theirNeeds, baseline);
      for (let i = 0; i < theirActive.length; i++) {
        for (let j = i + 1; j < theirActive.length; j++) {
          const get = [theirActive[i], theirActive[j]];
          const getVal = needAdjustedPackageValue(get, myNeeds, baseline);
          const ratio = getVal / giveVal;
          if (
            ratio >= FAIR_RATIO_MIN &&
            ratio <= FAIR_RATIO_MAX &&
            starGateOk(give, get) &&
            (!best || Math.abs(ratio - 1) < Math.abs(best.ratio - 1))
          ) {
            best = { give, get, giveVal, getVal, ratio };
          }
        }
      }
    }
    if (!best) continue;
    found.push({
      id: `2x2fb-${team.id}-${best.get.map((p) => p.id).join(",")}-${best.give.map((p) => p.id).join(",")}`,
      teamId: team.id,
      teamName: team.name,
      give: best.give,
      get: best.get,
      needPos: best.get[0].pos,
      overlapPos: best.give[0].pos,
      giveVal: best.giveVal,
      getVal: best.getVal,
      ratio: best.ratio,
      upgrade: best.getVal - best.giveVal,
      reason: "fallback",
    });
  }
  return found.sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
}

function mixSuggestions(
  needBased: TradeSuggestion[],
  general: TradeSuggestion[],
  fallback: TradeSuggestion[],
  twoForTwoFallback: TradeSuggestion[],
  max: number
): TradeSuggestion[] {
  const deduped = dedupeSuggestions([...needBased, ...general]);
  const priority = (s: TradeSuggestion) => (s.reason === "need" ? 1 : 0);
  const byRank = (a: TradeSuggestion, b: TradeSuggestion) => priority(b) - priority(a) || b.upgrade - a.upgrade;
  const is1x1 = (s: TradeSuggestion) => s.give.length === 1 && s.get.length === 1;
  const is2x2 = (s: TradeSuggestion) => s.give.length === 2 && s.get.length === 2;

  const oneForOne = [...deduped.filter(is1x1).sort(byRank), ...fallback.filter(is1x1)];
  const twoForTwo = [...deduped.filter(is2x2).sort(byRank), ...twoForTwoFallback];
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

  take(oneForOne, COACH_MIN_ONE_FOR_ONE);
  take(twoForTwo, COACH_MIN_TWO_FOR_TWO);
  take([...oneForOne, ...twoForTwo, ...other, ...fallback].sort(byRank), max);
  return combined;
}

/** Build the same mix of coach trade suggestions the AI Coach tab shows. */
export function suggestTrades(input: {
  myPlayers: Player[];
  leagueTeams: LeagueTeam[];
  max?: number;
}): {
  suggestions: TradeSuggestion[];
  needyPositions: Position[];
  strengthPositions: Position[];
  baseline: PositionBaseline;
} {
  const max = input.max ?? COACH_MAX_SUGGESTIONS;
  const opponents = input.leagueTeams;
  const myNeeds = analyzeRosterNeeds(input.myPlayers);
  const baseline = buildLeagueBaseline([...opponents.map((t) => t.roster), input.myPlayers]);
  const needyPositions = computeNeedy(myNeeds, baseline);
  const strengthPositions = computeStrength(myNeeds, baseline);

  const leaguePlayers: LeaguePlayer[] = opponents.flatMap((t) =>
    t.roster.map((p) => ({
      ...p,
      fantasyTeamId: t.id,
      fantasyTeamName: t.name,
    }))
  );

  const needBased = needBasedSuggestions(
    myNeeds,
    needyPositions,
    strengthPositions,
    baseline,
    leaguePlayers,
    opponents
  );
  const general = generalSuggestions(myNeeds, needyPositions, baseline, leaguePlayers, opponents);
  const fallback = fallbackSuggestions(myNeeds, needyPositions, leaguePlayers, opponents);
  const twoForTwo = twoForTwoFallbackSuggestions(myNeeds, needyPositions, baseline, opponents);

  return {
    suggestions: mixSuggestions(needBased, general, fallback, twoForTwo, max),
    needyPositions,
    strengthPositions,
    baseline,
  };
}
