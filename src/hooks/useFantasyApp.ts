// The app's single source of truth: roster/bench state, trade analyzer state,
// and every derived value (roster needs, free-agent recommendations, AI Coach
// trade suggestions) computed from them. App.tsx calls this once and hands
// the result down to whichever page is active -- pages themselves hold no
// state of their own beyond simple local UI toggles.
import { useCallback, useMemo, useState } from "react";
import { FREE_AGENTS } from "../data/freeAgents";
import { ALL_TEAMS, DEFAULT_TEAM_ID } from "../data/allTeams";
import { POSITIONS, REQUIRED_STARTERS, SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import { COACH_MAX_SUGGESTIONS, COACH_MIN_BEFORE_FALLBACK } from "../config/trade";
import { DEFAULT_TAB } from "../config/pages";
import { playerValue, qualityScore, isPlayerStarter, starterAdjustedValue, starterPremium, rosValue } from "../lib/scoring";
import { analyzeRosterNeeds } from "../lib/rosterNeeds";
import { deriveAssignments } from "../lib/teamRoster";
import { balancePackage } from "../lib/tradeEngine";
import { useProjectionRefresh } from "./useProjectionRefresh";
import { useDragAndDrop } from "./useDragAndDrop";
import type {
  LeaguePlayer,
  LeagueTeam,
  Player,
  Position,
  RosterAssignments,
  RosterPlayer,
  RosterSlotId,
  ScoredPlayer,
  TabId,
  TradeHorizon,
  TradeSuggestion,
  ViewedTeam,
} from "../types";

export function useFantasyApp() {
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);

  // Which team you're managing. Any team in the league can be selected; the
  // roster builder, AI Coach, free agents, and trade analyzer all re-center on
  // it. Persisted so a reload keeps you on the same team.
  const [selectedTeamId, setSelectedTeamId] = useState<number>(readStoredTeamId);
  const selectedTeam: LeagueTeam = useMemo(
    () => ALL_TEAMS.find((t) => t.id === selectedTeamId) ?? ALL_TEAMS[0],
    [selectedTeamId]
  );

  // Roster-builder assignments, seeded from the selected team's real ESPN
  // lineup. `selectTeam` re-seeds them when you switch teams.
  const seed = useMemo(() => deriveAssignments(selectedTeam), [selectedTeam]);
  const [roster, setRoster] = useState<RosterAssignments>(seed.roster);
  const [bench, setBench] = useState<number[]>(seed.bench);

  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const [tradeGive, setTradeGive] = useState<number[]>([]);
  const [tradeGet, setTradeGet] = useState<number[]>([]);
  const [tradeHorizon, setTradeHorizon] = useState<TradeHorizon>("week");
  const [tradeOpponentId, setTradeOpponentId] = useState<number | null>(null);

  const [selectedLeagueTeam, setSelectedLeagueTeam] = useState<ViewedTeam | null>(null);

  const [faPosFilter, setFaPosFilter] = useState<Position | "ALL">("ALL");
  const [faSearch, setFaSearch] = useState("");

  // Switch which team you're managing: re-seed the roster builder from that
  // team's real lineup and clear any in-progress trade / league drill-down so
  // nothing points at the team you just left.
  const selectTeam = useCallback((id: number) => {
    const team = ALL_TEAMS.find((t) => t.id === id) ?? ALL_TEAMS[0];
    setSelectedTeamId(team.id);
    writeStoredTeamId(team.id);
    const next = deriveAssignments(team);
    setRoster(next.roster);
    setBench(next.bench);
    setTradeGive([]);
    setTradeGet([]);
    setTradeOpponentId(null);
    setSelectedLeagueTeam(null);
  }, []);

  const projectionRefresh = useProjectionRefresh();
  const { projectionOverrides } = projectionRefresh;

  // ---------- Effective data: base data with live overrides applied ----------
  // projectionOverrides maps a player's real ESPN id -> { proj, status }. Every
  // place that reads player data reads from these "effective*" arrays, so a
  // refresh updates rosters, trade values, and the AI Coach everywhere at once.
  const applyOverride = useCallback(
    <P extends Player>(player: P): P => {
      const ov = projectionOverrides[player.id];
      if (!ov) return player;
      return {
        ...player,
        proj: ov.proj ?? player.proj,
        status: ov.status || player.status,
      };
    },
    [projectionOverrides]
  );

  // Your player pool = the team you're managing plus every free agent. Switch
  // teams and this whole pipeline (needs, coach, trade values) re-centers.
  const effectivePlayers: Player[] = useMemo(
    () => [...selectedTeam.roster, ...FREE_AGENTS].map(applyOverride),
    [applyOverride, selectedTeam]
  );
  // Every OTHER team is an opponent -- including your own default team when
  // you're currently managing someone else's.
  const effectiveLeagueTeams: LeagueTeam[] = useMemo(
    () => ALL_TEAMS.filter((t) => t.id !== selectedTeamId).map((t) => ({ ...t, roster: t.roster.map(applyOverride) })),
    [applyOverride, selectedTeamId]
  );
  const effectiveAllLeaguePlayers: LeaguePlayer[] = useMemo(
    () => effectiveLeagueTeams.flatMap((t) => t.roster.map((p) => ({ ...p, fantasyTeamId: t.id, fantasyTeamName: t.name }))),
    [effectiveLeagueTeams]
  );
  const effectiveMyTeamPlayers = useMemo(() => selectedTeam.roster.map(applyOverride), [applyOverride, selectedTeam]);

  const playerById = useCallback(
    (id: number): Player | undefined =>
      effectivePlayers.find((p) => p.id === id) || effectiveAllLeaguePlayers.find((p) => p.id === id),
    [effectivePlayers, effectiveAllLeaguePlayers]
  );

  // ---------- Roster builder: slot assignment ----------
  function locateSlot(id: number): RosterSlotId | null {
    const found = (Object.entries(roster) as [RosterSlotId, number | undefined][]).find(([, pid]) => pid === id);
    return found ? found[0] : null;
  }

  /** Moves a player into a starting slot. If that slot is already occupied,
   * the occupant is swapped out -- sent back to the incoming player's old
   * slot if they're eligible there, otherwise sent to the bench. */
  const moveToSlot = useCallback(
    (targetSlot: RosterSlotId, player: Player) => {
      if (!SLOT_ELIGIBILITY[targetSlot].includes(player.pos)) return;
      const occupantId = roster[targetSlot];
      if (occupantId === player.id) return;

      const sourceSlot = locateSlot(player.id);
      const occupant = occupantId != null ? playerById(occupantId) : null;
      const occupantGoesToSlot = !!(occupant && sourceSlot && SLOT_ELIGIBILITY[sourceSlot].includes(occupant.pos));

      setRoster((r) => {
        const copy = { ...r };
        if (sourceSlot) delete copy[sourceSlot];
        delete copy[targetSlot];
        if (occupantGoesToSlot && sourceSlot) copy[sourceSlot] = occupantId!;
        copy[targetSlot] = player.id;
        return copy;
      });

      setBench((b) => {
        let next = b.filter((id) => id !== player.id);
        if (occupant && !occupantGoesToSlot && occupantId != null && !next.includes(occupantId)) next = [...next, occupantId];
        return next;
      });
    },
    [roster, playerById]
  );

  /** Moves a player to the bench, clearing whatever starting slot they were in. */
  const moveToBench = useCallback(
    (player: Player) => {
      if (bench.includes(player.id)) return;
      const sourceSlot = locateSlot(player.id);
      if (sourceSlot) {
        setRoster((r) => {
          const copy = { ...r };
          delete copy[sourceSlot];
          return copy;
        });
      }
      setBench((b) => (b.includes(player.id) ? b : [...b, player.id]));
    },
    [bench, roster]
  );

  /** Bench player -> starting lineup, one click: fills an empty eligible slot
   * if one exists, otherwise swaps into the eligible slot with the weakest
   * current starter. */
  function quickStart(player: Player) {
    const eligibleSlots = SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(player.pos));
    const emptySlot = eligibleSlots.find((s) => !roster[s]);
    if (emptySlot) {
      moveToSlot(emptySlot, player);
      return;
    }
    let worstSlot: RosterSlotId | null = null;
    let worstProj = Infinity;
    eligibleSlots.forEach((s) => {
      const occId = roster[s];
      const occ = occId != null ? playerById(occId) : null;
      if (occ && occ.proj < worstProj) {
        worstProj = occ.proj;
        worstSlot = s;
      }
    });
    if (worstSlot) moveToSlot(worstSlot, player);
  }

  function addToSlot(slot: RosterSlotId, player: Player) {
    if (!SLOT_ELIGIBILITY[slot].includes(player.pos)) return;
    setRoster((r) => ({ ...r, [slot]: player.id }));
  }

  function addToBench(player: Player) {
    setBench((b) => [...b, player.id]);
  }

  function removeFromSlot(slot: RosterSlotId) {
    setRoster((r) => {
      const copy = { ...r };
      delete copy[slot];
      return copy;
    });
  }

  function removeFromBench(id: number) {
    setBench((b) => b.filter((x) => x !== id));
  }

  const dragAndDrop = useDragAndDrop((target, player) => {
    if (target === "bench") {
      moveToBench(player);
    } else if ((SLOTS as string[]).includes(target)) {
      moveToSlot(target as RosterSlotId, player);
    }
  });

  function autoOptimize() {
    const chosen = new Set<number>();
    const newRoster: RosterAssignments = {};
    const byProj = (pos: Position) => effectivePlayers.filter((p) => p.pos === pos && p.status !== "Out").sort((a, b) => b.proj - a.proj);

    const qb = byProj("QB").find((p) => !chosen.has(p.id));
    if (qb) {
      newRoster.QB = qb.id;
      chosen.add(qb.id);
    }

    const rbs = byProj("RB").filter((p) => !chosen.has(p.id));
    if (rbs[0]) {
      newRoster.RB1 = rbs[0].id;
      chosen.add(rbs[0].id);
    }
    if (rbs[1]) {
      newRoster.RB2 = rbs[1].id;
      chosen.add(rbs[1].id);
    }

    const wrs = byProj("WR").filter((p) => !chosen.has(p.id));
    if (wrs[0]) {
      newRoster.WR1 = wrs[0].id;
      chosen.add(wrs[0].id);
    }
    if (wrs[1]) {
      newRoster.WR2 = wrs[1].id;
      chosen.add(wrs[1].id);
    }

    const te = byProj("TE").find((p) => !chosen.has(p.id));
    if (te) {
      newRoster.TE = te.id;
      chosen.add(te.id);
    }

    const flexPool = [...byProj("RB"), ...byProj("WR"), ...byProj("TE")].filter((p) => !chosen.has(p.id)).sort((a, b) => b.proj - a.proj);
    if (flexPool[0]) {
      newRoster.FLEX = flexPool[0].id;
      chosen.add(flexPool[0].id);
    }

    const dst = byProj("DST").find((p) => !chosen.has(p.id));
    if (dst) {
      newRoster.DST = dst.id;
      chosen.add(dst.id);
    }

    const k = byProj("K").find((p) => !chosen.has(p.id));
    if (k) {
      newRoster.K = k.id;
      chosen.add(k.id);
    }

    setRoster(newRoster);
    setBench((b) => b.filter((id) => !chosen.has(id)));
  }

  const usedIds = useMemo(() => {
    const s = new Set<number>(Object.values(roster).filter((id): id is number => id != null));
    bench.forEach((id) => s.add(id));
    return s;
  }, [roster, bench]);

  const availablePlayers = useMemo(() => {
    return effectivePlayers
      .filter((p) => !usedIds.has(p.id))
      .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
  }, [usedIds, posFilter, search, effectivePlayers]);

  const rosterTotal = useMemo(() => {
    return SLOTS.reduce((sum, slot) => {
      const id = roster[slot];
      const p = id != null ? playerById(id) : null;
      return sum + (p ? p.proj : 0);
    }, 0);
  }, [roster, playerById]);

  // ---------- AI Coach: your current needs ----------
  const myPlayers = useMemo(() => Array.from(usedIds).map(playerById).filter((p): p is Player => !!p), [usedIds, playerById]);

  // League baseline = the average starter quality score at each position
  // across every team in the league (all opponents + you), so "need" and
  // "strength" are judged relative to what a typical starter actually looks
  // like this season.
  const leagueBaseline = useMemo(() => {
    const baseline = {} as Record<Position, number>;
    const allRosters = [...effectiveLeagueTeams.map((t) => t.roster), myPlayers];
    POSITIONS.forEach((pos) => {
      const scores = allRosters.map((r) => analyzeRosterNeeds(r)[pos].starterScore).filter((s) => s > 0);
      baseline[pos] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    });
    return baseline;
  }, [myPlayers, effectiveLeagueTeams]);

  const myNeeds = useMemo(() => analyzeRosterNeeds(myPlayers), [myPlayers]);

  // A position is a "need" if you're missing a starter outright, or your
  // starter quality score sits meaningfully (15%+) below the league-average
  // starter there.
  const needyPositions = useMemo(() => {
    return POSITIONS.filter((pos) => {
      const n = myNeeds[pos];
      if (!n.hasEnoughBodies) return true;
      if (!leagueBaseline[pos]) return false;
      return n.starterScore < leagueBaseline[pos] * 0.85;
    });
  }, [myNeeds, leagueBaseline]);

  // A position is a "strength" you can trade from if your starter score is
  // well above league average AND you actually have quality bench depth
  // sitting behind those starters.
  const strengthPositions = useMemo(
    () =>
      POSITIONS.filter((pos) => {
        const n = myNeeds[pos];
        if (!leagueBaseline[pos]) return false;
        return n.starterScore > leagueBaseline[pos] * 1.1 && n.tradeableDepth.length > 0;
      }),
    [myNeeds, leagueBaseline]
  );

  // Whether a player is a locked-in starter on WHICHEVER team currently
  // rosters them -- your own team if it's one of your players, or the
  // specific opponent's team if it's a league player. Needed so the manual
  // Trade Analyzer prices starters the same way the AI Coach's suggestions do.
  const isStartingForOwner = useCallback(
    (p: Player | LeaguePlayer): boolean => {
      const fantasyTeamId = "fantasyTeamId" in p ? p.fantasyTeamId : undefined;
      if (fantasyTeamId == null) return isPlayerStarter(p, myNeeds);
      const theirTeam = effectiveLeagueTeams.find((t) => t.id === fantasyTeamId);
      if (!theirTeam) return false;
      return isPlayerStarter(p, analyzeRosterNeeds(theirTeam.roster));
    },
    [myNeeds, effectiveLeagueTeams]
  );

  // ---------- Free agents tab ----------
  // Every player who isn't rostered by you or anyone else in the league --
  // unfiltered, so recommendations always see the full pool regardless of
  // whatever the browse list is currently filtered/searched to.
  const freeAgentPool = useMemo(() => effectivePlayers.filter((p) => !usedIds.has(p.id)), [effectivePlayers, usedIds]);

  // Needy positions ranked worst-relative-to-league-average first, so the top
  // of the recommendations panel is always your single biggest hole.
  const needyPositionsRanked = useMemo(() => {
    return [...needyPositions].sort((a, b) => {
      const relA = leagueBaseline[a] ? myNeeds[a].starterScore / leagueBaseline[a] : 0;
      const relB = leagueBaseline[b] ? myNeeds[b].starterScore / leagueBaseline[b] : 0;
      return relA - relB;
    });
  }, [needyPositions, myNeeds, leagueBaseline]);

  const needReason = useCallback(
    (pos: Position): string => {
      const n = myNeeds[pos];
      if (!n.hasEnoughBodies) {
        return `You don't have enough ${pos}s to fill your required starting slot${REQUIRED_STARTERS[pos] > 1 ? "s" : ""}.`;
      }
      const base = leagueBaseline[pos];
      if (base) {
        const pctBelow = Math.round((1 - n.starterScore / base) * 100);
        return `Your starting ${pos} production is ~${Math.max(pctBelow, 1)}% below the league-average starter there.`;
      }
      return `${pos} is a relative weak spot on your roster.`;
    },
    [myNeeds, leagueBaseline]
  );

  // Top 3 available free agents at each needy position, best qualityScore
  // first -- qualityScore already folds in tier and current injury status.
  const recommendedPickups = useMemo(() => {
    return needyPositionsRanked
      .map((pos) => ({
        pos,
        reason: needReason(pos),
        candidates: freeAgentPool
          .filter((p) => p.pos === pos)
          .map((p) => ({ ...p, qScore: qualityScore(p) }))
          .sort((a, b) => b.qScore - a.qScore)
          .slice(0, 3),
      }))
      .filter((group) => group.candidates.length > 0);
  }, [needyPositionsRanked, freeAgentPool, needReason]);

  // Fallback when nothing qualifies as a "need": just surface the best
  // overall available players so the tab is never empty.
  const bestAvailableOverall = useMemo(
    () =>
      [...freeAgentPool]
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .sort((a, b) => b.qScore - a.qScore)
        .slice(0, 6),
    [freeAgentPool]
  );

  const browsableFreeAgents = useMemo(() => {
    return freeAgentPool
      .filter((p) => (faPosFilter === "ALL" ? true : p.pos === faPosFilter))
      .filter((p) => p.name.toLowerCase().includes(faSearch.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
  }, [freeAgentPool, faPosFilter, faSearch]);

  // ---------- AI Coach: trade suggestion engine ----------
  // Need-based suggestions: your real weakness matched to their real weakness.
  const needBasedSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    needyPositions.forEach((needPos) => {
      const myWeak = myNeeds[needPos].weakestStarter;
      const myWeakQ = myWeak ? myWeak.qScore : 0;
      // Candidates ranked by quality score, not raw proj, so an injured
      // "star" doesn't outrank a healthy, reliable upgrade.
      const candidates = effectiveAllLeaguePlayers
        .filter((p) => p.pos === needPos && p.status !== "Out")
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .filter((p) => p.qScore > myWeakQ + 1.5)
        .sort((a, b) => b.qScore - a.qScore)
        .slice(0, 10);

      candidates.forEach((cand) => {
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
        if (!theirTeam) return;
        const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
        // Find one of your strength positions where they're genuinely light.
        const overlapPos = strengthPositions.find((sp) => {
          const tn = theirNeeds[sp];
          if (!tn.hasEnoughBodies) return true;
          if (!leagueBaseline[sp]) return false;
          return tn.starterScore < leagueBaseline[sp] * 0.85;
        });
        if (!overlapPos) return;

        const candVal = starterAdjustedValue(cand, isPlayerStarter(cand, theirNeeds));
        const depthOptions = myNeeds[overlapPos].tradeableDepth;
        if (!depthOptions.length) return;
        const offerPlayer = depthOptions.reduce((best, p) => (Math.abs(playerValue(p) - candVal) < Math.abs(playerValue(best) - candVal) ? p : best));
        const offerVal = playerValue(offerPlayer);
        if (Math.abs(candVal - offerVal) > 12) return;

        const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

        const result = balancePackage([offerPlayer], [cand], offerVal, candVal, extraGiveOptions, extraGetOptions);
        if (!result) return;

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
          upgrade: cand.qScore - myWeakQ,
          reason: "need",
        });
      });
    });

    return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
  }, [needyPositions, strengthPositions, myNeeds, leagueBaseline, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  // General value-based suggestions: run regardless of whether you have a
  // clear need, so there's always something reasonable on the table.
  const generalSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    // Anything beyond your single best player at each position is "movable".
    const movable: Player[] = [];
    POSITIONS.forEach((pos) => {
      myNeeds[pos].players.slice(1).forEach((p) => {
        if (p.status !== "Out") movable.push(p);
      });
    });

    movable.forEach((offerPlayer) => {
      const offerIsStarter = isPlayerStarter(offerPlayer, myNeeds);
      const offerVal = starterAdjustedValue(offerPlayer, offerIsStarter);
      const candidates = effectiveAllLeaguePlayers
        .filter((p) => p.status !== "Out" && p.fantasyTeamId)
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .filter((p) => {
          const myWorstAtPos = myNeeds[p.pos] ? myNeeds[p.pos].weakestStarter : null;
          const myWorstQ = myWorstAtPos ? myWorstAtPos.qScore : -Infinity;
          return p.qScore > myWorstQ + 1; // must actually be an upgrade somewhere on your roster
        })
        .sort((a, b) => playerValue(b) - playerValue(a))
        .slice(0, 6);

      candidates.forEach((cand) => {
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
        if (!theirTeam) return;
        const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
        const candVal = starterAdjustedValue(cand, isPlayerStarter(cand, theirNeeds));
        if (Math.abs(candVal - offerVal) > 12) return;

        const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

        const result = balancePackage([offerPlayer], [cand], offerVal, candVal, extraGiveOptions, extraGetOptions);
        if (!result) return;

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
          upgrade: result.getVal - result.giveVal,
          reason: "value",
        });
      });
    });

    return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
  }, [myNeeds, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  // Guaranteed tier: simple, fair, same-position swaps so the AI Coach always
  // has something on the table even when nothing clears the bar above.
  const fallbackSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    POSITIONS.forEach((pos) => {
      const myPlayersAtPos = myNeeds[pos].players;
      if (!myPlayersAtPos.length) return;
      const candidateGive = myPlayersAtPos[myPlayersAtPos.length - 1];
      if (candidateGive.status === "Out") return;
      const giveVal = playerValue(candidateGive);
      const pool = effectiveAllLeaguePlayers.filter((p) => p.pos === pos && p.status !== "Out" && p.id !== candidateGive.id);
      if (!pool.length) return;
      const closest = pool.reduce((best, p) => (Math.abs(playerValue(p) - giveVal) < Math.abs(playerValue(best) - giveVal) ? p : best));
      const theirTeam = effectiveLeagueTeams.find((t) => t.id === closest.fantasyTeamId);
      if (!theirTeam) return;
      const diff = playerValue(closest) - giveVal;
      if (diff < -3 || diff > 3) return;
      found.push({
        id: `fallback-${theirTeam.id}-${closest.id}-${candidateGive.id}`,
        teamId: theirTeam.id,
        teamName: theirTeam.name,
        give: [candidateGive],
        get: [closest],
        needPos: pos,
        overlapPos: pos,
        giveVal,
        getVal: playerValue(closest),
        upgrade: diff,
        reason: "fallback",
      });
    });
    return found.sort((a, b) => b.upgrade - a.upgrade);
  }, [myNeeds, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  const coachSuggestions = useMemo(() => {
    const deduped = dedupeSuggestions([...needBasedSuggestions, ...generalSuggestions]);

    // Split by package shape so we can guarantee a mix rather than letting
    // whichever shape happens to rank higher crowd out the other.
    const priority = (s: TradeSuggestion) => (s.reason === "need" ? 1 : 0);
    const oneForOne = deduped.filter((s) => s.give.length === 1 && s.get.length === 1).sort((a, b) => priority(b) - priority(a) || b.upgrade - a.upgrade);
    const multiPlayer = deduped.filter((s) => s.give.length > 1 || s.get.length > 1).sort((a, b) => priority(b) - priority(a) || b.upgrade - a.upgrade);

    // Interleave: 1-for-1, 2-for-1, 1-for-1, 2-for-1... so both shapes always
    // show up together rather than one type dominating the list.
    const combined: TradeSuggestion[] = [];
    const maxLen = Math.max(oneForOne.length, multiPlayer.length);
    for (let i = 0; i < maxLen && combined.length < COACH_MAX_SUGGESTIONS; i++) {
      if (oneForOne[i]) combined.push(oneForOne[i]);
      if (combined.length < COACH_MAX_SUGGESTIONS && multiPlayer[i]) combined.push(multiPlayer[i]);
    }

    if (combined.length < COACH_MIN_BEFORE_FALLBACK) {
      const usedKeys = new Set(combined.map(suggestionKey));
      fallbackSuggestions.forEach((s) => {
        if (combined.length >= COACH_MAX_SUGGESTIONS) return;
        const key = suggestionKey(s);
        if (usedKeys.has(key)) return;
        usedKeys.add(key);
        combined.push(s);
      });
    }

    return combined;
  }, [needBasedSuggestions, generalSuggestions, fallbackSuggestions]);

  function proposeCoachTrade(s: TradeSuggestion) {
    setTradeOpponentId(s.teamId);
    setTradeGive(s.give.map((p) => p.id));
    setTradeGet(s.get.map((p) => p.id));
    setTab("trade");
  }

  // ---------- Trade analyzer ----------
  // Same value functions the AI Coach's suggestions use -- a locked-in
  // starter is priced with the starter premium, not treated as equivalent to
  // a bench piece with the same raw projection, in both Week and Season modes.
  const tradeValueOf = useCallback(
    (p: Player): number => {
      const starting = isStartingForOwner(p);
      if (tradeHorizon === "season") {
        return rosValue(p) + (starting ? starterPremium(p.tier) : 0);
      }
      return starterAdjustedValue(p, starting);
    },
    [isStartingForOwner, tradeHorizon]
  );

  const tradeValue = useCallback(
    (list: number[]): number =>
      list.reduce((sum, id) => {
        const p = playerById(id);
        return p ? sum + tradeValueOf(p) : sum;
      }, 0),
    [playerById, tradeValueOf]
  );

  const giveVal = tradeValue(tradeGive);
  const getVal = tradeValue(tradeGet);
  const diff = getVal - giveVal;
  const diffPct = giveVal + getVal > 0 ? (diff / ((giveVal + getVal) / 2)) * 100 : 0;

  function toggleTradeList(setList: (updater: (cur: number[]) => number[]) => void, id: number) {
    setList((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const filledCount = SLOTS.filter((s) => roster[s]).length;

  // "Your team" as a ViewedTeam, for the League tab's own-team card.
  const myTeamViewed: ViewedTeam = useMemo(
    () => ({
      id: "mine",
      name: `${selectedTeam.name} (You)`,
      owner: selectedTeam.owner,
      roster: effectiveMyTeamPlayers.map(
        (p): RosterPlayer => ({
          ...p,
          starter: Object.values(roster).includes(p.id),
          slot: (Object.entries(roster).find(([, id]) => id === p.id)?.[0] as RosterSlotId | undefined) ?? "BE",
        })
      ),
    }),
    [effectiveMyTeamPlayers, roster, selectedTeam]
  );

  return {
    tab,
    setTab,

    // team selection
    allTeams: ALL_TEAMS,
    selectedTeamId,
    selectedTeam,
    selectTeam,

    // roster builder
    roster,
    bench,
    posFilter,
    setPosFilter,
    search,
    setSearch,
    availablePlayers,
    filledCount,
    rosterTotal,
    moveToSlot,
    moveToBench,
    quickStart,
    addToSlot,
    addToBench,
    removeFromSlot,
    removeFromBench,
    autoOptimize,
    ...dragAndDrop,

    // shared data lookups
    playerById,
    effectivePlayers,
    effectiveLeagueTeams,
    effectiveAllLeaguePlayers,
    effectiveMyTeamPlayers,
    myTeamViewed,

    // free agents
    faPosFilter,
    setFaPosFilter,
    faSearch,
    setFaSearch,
    freeAgentPool,
    recommendedPickups,
    bestAvailableOverall,
    browsableFreeAgents,

    // AI coach
    myNeeds,
    leagueBaseline,
    needyPositions,
    strengthPositions,
    coachSuggestions,
    proposeCoachTrade,

    // trade analyzer
    tradeGive,
    setTradeGive,
    tradeGet,
    setTradeGet,
    tradeHorizon,
    setTradeHorizon,
    tradeOpponentId,
    setTradeOpponentId,
    tradeValueOf,
    giveVal,
    getVal,
    diff,
    diffPct,
    toggleTradeList,

    // league
    selectedLeagueTeam,
    setSelectedLeagueTeam,

    // live projection refresh
    ...projectionRefresh,
  };
}

const SELECTED_TEAM_KEY = "gridiron.selectedTeamId";

/** The team id persisted from a previous visit, or the default if none/invalid. */
function readStoredTeamId(): number {
  try {
    const raw = window.localStorage.getItem(SELECTED_TEAM_KEY);
    if (raw != null) {
      const id = Number(raw);
      if (Number.isFinite(id) && ALL_TEAMS.some((t) => t.id === id)) return id;
    }
  } catch {
    // Storage unavailable (private mode, etc.) -- fall back to the default.
  }
  return DEFAULT_TEAM_ID;
}

function writeStoredTeamId(id: number): void {
  try {
    window.localStorage.setItem(SELECTED_TEAM_KEY, String(id));
  } catch {
    // Non-fatal: the selection just won't persist across reloads.
  }
}

function suggestionKey(s: TradeSuggestion): string {
  return `${s.teamId}-${s.get.map((p) => p.id).sort().join(",")}`;
}

function dedupeSuggestions(suggestions: TradeSuggestion[]): TradeSuggestion[] {
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

export type FantasyApp = ReturnType<typeof useFantasyApp>;
