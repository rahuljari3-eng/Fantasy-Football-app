// The app's single source of truth: roster/bench state, trade analyzer state,
// and every derived value (roster needs, free-agent recommendations, AI Coach
// trade suggestions) computed from them. App.tsx calls this once and hands
// the result down to whichever page is active -- pages themselves hold no
// state of their own beyond simple local UI toggles.
import { useCallback, useMemo, useState } from "react";
import { FREE_AGENTS } from "../data/freeAgents";
import { ALL_TEAMS, DEFAULT_TEAM_ID } from "../data/allTeams";
import { POSITIONS, REQUIRED_STARTERS, SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import { COACH_MAX_SUGGESTIONS, COACH_MIN_ONE_FOR_ONE, COACH_MIN_TWO_FOR_TWO, FAIR_RATIO_MIN, FAIR_RATIO_MAX, EXTRA_PIECE_DISCOUNT } from "../config/trade";
import { VOR_BASELINE, ROS_WEEKS } from "../config/scoring";
import { DEFAULT_TAB } from "../config/pages";
import { playerValue, qualityScore, rosValue } from "../lib/scoring";
import { analyzeRosterNeeds } from "../lib/rosterNeeds";
import { deriveAssignments } from "../lib/teamRoster";
import { balancePackage, balanceTwoForTwo, fairnessRatio, needAdjustedPackageValue, starGateOk } from "../lib/tradeEngine";
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
  const applyOverrideRaw = useCallback(
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

  // Positional rank (1 = best projected at the position) across every player in
  // the league plus free agents, computed off post-override projections. Feeds
  // the rank-chart component of playerValue -- see lib/scoring.ts.
  const posRankOf = useMemo(() => {
    const pool = [...ALL_TEAMS.flatMap((t) => t.roster), ...FREE_AGENTS].map(applyOverrideRaw);
    const groups = new Map<Position, Player[]>();
    pool.forEach((p) => {
      const g = groups.get(p.pos) ?? [];
      g.push(p);
      groups.set(p.pos, g);
    });
    const ranks = new Map<number, number>();
    groups.forEach((list) => {
      list.sort((a, b) => b.proj - a.proj).forEach((p, i) => {
        if (!ranks.has(p.id)) ranks.set(p.id, i + 1);
      });
    });
    return (id: number) => ranks.get(id);
  }, [applyOverrideRaw]);

  // applyOverride now also stamps the positional rank, so every "effective*"
  // array carries it and playerValue can use the rank chart consistently.
  const applyOverride = useCallback(
    <P extends Player>(player: P): P => ({ ...applyOverrideRaw(player), posRank: posRankOf(player.id) }),
    [applyOverrideRaw, posRankOf]
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

  // Which positions are worth putting in a trade at all: position players only
  // (QB/RB/WR/TE). Kickers and defenses are never traded -- values are
  // near-identical across the pool and managers just stream them. QBs only when
  // QB is a genuine need, since a QB-for-QB swap between two set starters in a
  // 1QB league is a pointless lateral move.
  const isTradeablePos = useCallback(
    (pos: Position) => pos !== "K" && pos !== "DST" && (pos !== "QB" || needyPositions.includes("QB")),
    [needyPositions]
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
      if (needPos === "K" || needPos === "DST") return; // kickers and defenses aren't traded
      const myWeak = myNeeds[needPos].weakestStarter;
      const myWeakQ = myWeak ? myWeak.qScore : 0;
      // Candidates ranked by quality score, not raw proj, so an injured
      // "star" doesn't outrank a healthy, reliable upgrade.
      const candidates = effectiveAllLeaguePlayers
        .filter((p) => p.pos === needPos && p.status !== "Out")
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .filter((p) => p.qScore > myWeakQ * 1.1) // must be a clear upgrade, not a near-lateral move
        .sort((a, b) => b.qScore - a.qScore)
        .slice(0, 10);

      candidates.forEach((cand) => {
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
        if (!theirTeam) return;
        const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
        // Find one of your strength positions where they're genuinely light.
        const overlapPos = strengthPositions.filter((sp) => sp !== "K" && sp !== "DST" && sp !== "QB").find((sp) => {
          const tn = theirNeeds[sp];
          if (!tn.hasEnoughBodies) return true;
          if (!leagueBaseline[sp]) return false;
          return tn.starterScore < leagueBaseline[sp] * 0.85;
        });
        if (!overlapPos) return;

        const candVal = playerValue(cand);
        const depthOptions = myNeeds[overlapPos].tradeableDepth;
        if (!depthOptions.length) return;
        const offerPlayer = depthOptions.reduce((best, p) => (Math.abs(playerValue(p) - candVal) < Math.abs(playerValue(best) - candVal) ? p : best));
        const offerVal = playerValue(offerPlayer);
        // Coarse pre-filter -- balancePackage does the real ratio check.
        const preRatio = fairnessRatio(offerVal, candVal);
        if (preRatio > 1.9 || preRatio < 0.5) return;

        const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

        const result = balancePackage([offerPlayer], [cand], theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions);
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

        // Also offer a genuine 2-for-2 built around the same core.
        const twoResult = balanceTwoForTwo(offerPlayer, cand, theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions);
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
      });
    });

    return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
  }, [needyPositions, strengthPositions, myNeeds, leagueBaseline, effectiveAllLeaguePlayers, effectiveLeagueTeams]);

  // General value-based suggestions: run regardless of whether you have a
  // clear need, so there's always something reasonable on the table.
  const generalSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    // Anything beyond your single best player at a TRADEABLE position is "movable".
    const movable: Player[] = [];
    POSITIONS.forEach((pos) => {
      if (!isTradeablePos(pos)) return;
      myNeeds[pos].players.slice(1).forEach((p) => {
        if (p.status !== "Out") movable.push(p);
      });
    });

    movable.forEach((offerPlayer) => {
      const offerVal = playerValue(offerPlayer);
      const candidates = effectiveAllLeaguePlayers
        .filter((p) => p.status !== "Out" && p.fantasyTeamId && isTradeablePos(p.pos))
        .map((p) => ({ ...p, qScore: qualityScore(p) }))
        .filter((p) => {
          const myWorstAtPos = myNeeds[p.pos] ? myNeeds[p.pos].weakestStarter : null;
          const myWorstQ = myWorstAtPos ? myWorstAtPos.qScore : -Infinity;
          return p.qScore > myWorstQ * 1.06; // must actually be an upgrade somewhere on your roster
        })
        .sort((a, b) => playerValue(b) - playerValue(a))
        .slice(0, 6);

      candidates.forEach((cand) => {
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
        if (!theirTeam) return;
        const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
        const candVal = playerValue(cand);
        const preRatio = fairnessRatio(offerVal, candVal);
        if (preRatio > 1.9 || preRatio < 0.5) return;

        const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

        const result = balancePackage([offerPlayer], [cand], theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions);
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

        const twoResult = balanceTwoForTwo(offerPlayer, cand, theirNeeds, myNeeds, leagueBaseline, extraGiveOptions, extraGetOptions);
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
      });
    });

    return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
  }, [myNeeds, leagueBaseline, effectiveAllLeaguePlayers, effectiveLeagueTeams, isTradeablePos]);

  // Guaranteed tier: simple, fair, same-position swaps so the AI Coach always
  // has something on the table even when nothing clears the bar above.
  const fallbackSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    POSITIONS.forEach((pos) => {
      if (!isTradeablePos(pos)) return;
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
      const getVal = playerValue(closest);
      const ratio = fairnessRatio(giveVal, getVal);
      if (ratio < FAIR_RATIO_MIN || ratio > FAIR_RATIO_MAX) return;
      if (!starGateOk([candidateGive], [closest])) return;
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
    });
    return found.sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
  }, [myNeeds, effectiveAllLeaguePlayers, effectiveLeagueTeams, isTradeablePos]);

  // Guaranteed 2-for-2 tier: pair two of your movable pieces with two of an
  // opponent's, priced the same way, so the recommender always has real
  // two-for-two options and never devolves into all 1-for-1s (or all 2-for-1s).
  const twoForTwoFallbackSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    const myMovable = POSITIONS.filter(isTradeablePos)
      .flatMap((pos) => myNeeds[pos].players.slice(1))
      .filter((p) => p.status !== "Out")
      .sort((a, b) => playerValue(b) - playerValue(a))
      .slice(0, 6);
    if (myMovable.length < 2) return found;

    const givePairs: Player[][] = [];
    for (let i = 0; i < myMovable.length; i++) {
      for (let j = i + 1; j < myMovable.length; j++) givePairs.push([myMovable[i], myMovable[j]]);
    }

    effectiveLeagueTeams.forEach((team) => {
      const theirNeeds = analyzeRosterNeeds(team.roster);
      const theirActive = team.roster
        .filter((p) => p.status !== "Out" && isTradeablePos(p.pos))
        .sort((a, b) => playerValue(b) - playerValue(a))
        .slice(0, 12);
      if (theirActive.length < 2) return;

      let best: { give: Player[]; get: Player[]; giveVal: number; getVal: number; ratio: number } | null = null;
      givePairs.forEach((give) => {
        const giveVal = needAdjustedPackageValue(give, theirNeeds, leagueBaseline);
        for (let i = 0; i < theirActive.length; i++) {
          for (let j = i + 1; j < theirActive.length; j++) {
            const get = [theirActive[i], theirActive[j]];
            const getVal = needAdjustedPackageValue(get, myNeeds, leagueBaseline);
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
      });
      if (!best) return;
      const b = best as { give: Player[]; get: Player[]; giveVal: number; getVal: number; ratio: number };
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
      });
    });
    return found.sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
  }, [myNeeds, leagueBaseline, effectiveLeagueTeams, isTradeablePos]);

  const coachSuggestions = useMemo(() => {
    const deduped = dedupeSuggestions([...needBasedSuggestions, ...generalSuggestions]);
    const priority = (s: TradeSuggestion) => (s.reason === "need" ? 1 : 0);
    const byRank = (a: TradeSuggestion, b: TradeSuggestion) => priority(b) - priority(a) || b.upgrade - a.upgrade;

    const is1x1 = (s: TradeSuggestion) => s.give.length === 1 && s.get.length === 1;
    const is2x2 = (s: TradeSuggestion) => s.give.length === 2 && s.get.length === 2;

    // Smart pools by shape, then the guaranteed fallback pools to top them up.
    const oneForOne = [...deduped.filter(is1x1).sort(byRank), ...fallbackSuggestions.filter(is1x1)];
    const twoForTwo = [...deduped.filter(is2x2).sort(byRank), ...twoForTwoFallbackSuggestions];
    const other = deduped.filter((s) => !is1x1(s) && !is2x2(s)).sort(byRank);

    const combined: TradeSuggestion[] = [];
    const usedKeys = new Set<string>();
    const take = (list: TradeSuggestion[], limit: number) => {
      for (const s of list) {
        if (combined.length >= COACH_MAX_SUGGESTIONS || limit <= 0) return;
        const key = suggestionKey(s);
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        combined.push(s);
        limit--;
      }
    };

    // Always lead with the required mix: >=2 one-for-ones and >=2 two-for-twos.
    take(oneForOne, COACH_MIN_ONE_FOR_ONE);
    take(twoForTwo, COACH_MIN_TWO_FOR_TWO);
    // Fill the rest with the best of everything left, keeping shape variety.
    take([...oneForOne, ...twoForTwo, ...other, ...fallbackSuggestions].sort(byRank), COACH_MAX_SUGGESTIONS);

    return combined;
  }, [needBasedSuggestions, generalSuggestions, fallbackSuggestions, twoForTwoFallbackSuggestions]);

  function proposeCoachTrade(s: TradeSuggestion) {
    setTradeOpponentId(s.teamId);
    setTradeGive(s.give.map((p) => p.id));
    setTradeGet(s.get.map((p) => p.id));
    setTab("trade");
  }

  // ---------- Trade analyzer ----------
  // Same curved value-over-replacement the AI Coach uses. Week mode prices a
  // single week; Season mode projects it across the remaining schedule.
  const tradeValueOf = useCallback(
    (p: Player): number => (tradeHorizon === "season" ? rosValue(p) : playerValue(p)),
    [tradeHorizon]
  );

  // A whole side's value: best piece in full, every EXTRA piece only its
  // above-replacement portion, steeply discounted -- so stacking bench bodies
  // on one side can't inflate it toward a stud's value.
  const tradeValue = useCallback(
    (list: number[]): number => {
      const floor = tradeHorizon === "season" ? VOR_BASELINE * ROS_WEEKS : VOR_BASELINE;
      const vals = list
        .map((id) => playerById(id))
        .filter((p): p is Player => !!p)
        .map(tradeValueOf)
        .sort((a, b) => b - a);
      if (!vals.length) return 0;
      return vals.reduce((sum, v, i) => sum + (i === 0 ? v : Math.max(0, v - floor) * Math.pow(EXTRA_PIECE_DISCOUNT, i)), 0);
    },
    [playerById, tradeValueOf, tradeHorizon]
  );

  const giveVal = tradeValue(tradeGive);
  const getVal = tradeValue(tradeGet);
  const diff = getVal - giveVal;
  const diffPct = giveVal + getVal > 0 ? (diff / ((giveVal + getVal) / 2)) * 100 : 0;
  // Fairness ratio: what you get / what you give. 1.0 = dead even.
  const tradeRatio = giveVal > 0 && getVal > 0 ? getVal / giveVal : null;
  // Star gate: a Tier-1 player on one side with no Tier-1/2 coming back is
  // "likely unfair" no matter what the value ratio says.
  const tradeStarGateViolation =
    (tradeGive.length > 0 || tradeGet.length > 0) &&
    !starGateOk(
      tradeGive.map((id) => playerById(id)).filter((p): p is Player => !!p),
      tradeGet.map((id) => playerById(id)).filter((p): p is Player => !!p)
    );

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
    tradeRatio,
    tradeStarGateViolation,
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
