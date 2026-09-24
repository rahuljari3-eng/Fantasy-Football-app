// The app's single source of truth: roster/bench state, trade analyzer state,
// and every derived value (roster needs, free-agent recommendations, AI Coach
// trade suggestions) computed from them. App.tsx calls this once and hands
// the result down to whichever page is active -- pages themselves hold no
// state of their own beyond simple local UI toggles.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FREE_AGENTS } from "../data/freeAgents";
import { ALL_TEAMS, DEFAULT_TEAM_ID } from "../data/allTeams";
import { POSITIONS, REQUIRED_STARTERS, SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import { DEFAULT_TAB } from "../config/pages";
import { playerValue, qualityScore, rosValue } from "../lib/scoring";
import { analyzeRosterNeeds } from "../lib/rosterNeeds";
import { applyPropLines, rankPlayerPool } from "../lib/consensus";
import { getStoredValue, setStoredValue } from "../lib/storage";
import { buildTradeOffer } from "../lib/tradeOffer";
import {
  allPoolSuggestions,
  buildCoachContext,
  buildCoachPools,
  buildLeagueBaseline,
  filterPools,
  computeMovablePlayers,
  computeNeedyPositions,
  computeStrengthPositions,
  isTradeablePosition,
  mixCoachSuggestions,
  suggestionKey,
} from "../lib/coachTrades";
import { deriveAssignments, deriveAssignmentsFromEspnSlots } from "../lib/teamRoster";
import { fetchEspnCompletedTrades, fetchEspnLineups, type CompletedTrade } from "../lib/espn";
import { fetchLiveFreeAgents } from "../lib/espnLeague";
import {
  starGateOk,
  SEASON_PRICER,
  WEEK_PRICER,
  ROS_PRICER,
  packageValue,
  needAdjustedPackageValue,
  rosPackageFloor,
  fairnessRatio,
} from "../lib/tradeEngine";
import { setRosHorizon } from "../lib/rosHorizon";
import { applyScheduleEase } from "../lib/scheduleEase";
import { getNflSchedule, type NflScheduleSnapshot } from "../lib/nflSchedule";
import type { VegasHistory } from "../lib/bettingValue";
import vegasHistoryJson from "../data/vegasHistory.json" with { type: "json" };
import { findWhatItWouldTake as solveWhatItWouldTake, type WhatWouldItTakeOption } from "../lib/whatWouldItTake";
import { optimizeLineup } from "../lib/optimizeLineup";
import { useProjectionRefresh } from "./useProjectionRefresh";
import { useTradeShortlist } from "./useTradeShortlist";
import { useNewsFeed } from "./useNewsFeed";
import { useMatchups } from "./useMatchups";
import { useStandings } from "./useStandings";
import { useToasts } from "./useToasts";
import { useDragAndDrop } from "./useDragAndDrop";
import { useMatchupCenter } from "./useMatchupCenter";
import { gradeMatchup } from "../lib/matchup";
import { fetchPlayerPerformance, fetchLeagueWeekScores, type PlayerPerformanceResult, type LeagueWeekScoreRow } from "../lib/playerPerformance";
import { computePlayoffOutlook } from "../lib/playoffOdds";
import { buildHeadToHeadMatchup, type MatchupSideInput } from "../lib/matchupCenter";
import type {
  BenchSuggestion,
  LeaguePlayer,
  LeagueTeam,
  NewsItem,
  Player,
  Position,
  RosterAssignments,
  RosterPlayer,
  RosterSlotId,
  ProjectionSource,
  TabId,
  TradeHorizon,
  TradeSuggestion,
  ViewedTeam,
} from "../types";

const MATCHUP_GRADE_RANK: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
// Rough fantasy-point swing a matchup grade is worth, layered on top of the
// raw projection to get a single "matchup-adjusted" number for comparing a
// bench player against a starter -- see benchUpgradeSuggestions. Deliberately
// modest: the projection itself already accounts for most of a matchup (it's
// player- and opponent-specific), this is just the extra nudge from the
// week's Vegas-implied scoring environment on top of that.
const MATCHUP_GRADE_POINTS: Record<string, number> = { A: 2, B: 0.75, C: 0, D: -0.75, F: -2 };
const MIN_ADJUSTED_EDGE = 1.5;
// Display order for a browsed week's historical starters -- see
// weekTeamRoster. LeagueWeekScoreRow.slot collapses RB1/RB2 (etc.) down to
// one label per position, same as ESPN_LINEUP_SLOT_LABEL.
const WEEK_STARTER_SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "DST", "K"];

function adjustedProjection(p: Player, matchup: { grade: string | null }): number {
  return p.proj + (matchup.grade ? MATCHUP_GRADE_POINTS[matchup.grade] : 0);
}

// Every player id in your league -- rostered on any team, or sitting in the
// free-agent pool -- so the live news feed can be filtered down to only
// what's actually relevant instead of the entire NFL. Computed once; these
// lists are static bundled data, not derived from any hook state.
const RELEVANT_PLAYER_IDS = new Set<number>([
  ...ALL_TEAMS.flatMap((t) => t.roster.map((p) => p.id)),
  ...FREE_AGENTS.map((p) => p.id),
]);

const VEGAS_HISTORY = vegasHistoryJson as VegasHistory;

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

  // Roster-builder assignments. Seeded from whatever was last saved locally
  // for this team (a prior edit made right here in the roster builder), or
  // the bundled ESPN snapshot if nothing's been saved yet. `selectTeam`
  // re-seeds them the same way when you switch teams, and every change here
  // is written straight back to localStorage (see the persistence effect
  // below) so closing the tab never loses an edit.
  const seed = useMemo(() => deriveAssignments(selectedTeam), [selectedTeam]);
  const storedSeed = useMemo(() => readStoredRoster(selectedTeamId), [selectedTeamId]);
  const [roster, setRoster] = useState<RosterAssignments>(storedSeed?.roster ?? seed.roster);
  const [bench, setBench] = useState<number[]>(storedSeed?.bench ?? seed.bench);

  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const [tradeGive, setTradeGive] = useState<number[]>([]);
  const [tradeGet, setTradeGet] = useState<number[]>([]);
  const [tradeHorizon, setTradeHorizon] = useState<TradeHorizon>("week");
  const [tradeOpponentId, setTradeOpponentId] = useState<number | null>(null);
  /** When true (season mode), package values use needAdjustedPackageValue like Coach/Sensei. */
  const [tradeNeedAdjust, setTradeNeedAdjust] = useState(false);
  const [nflScheduleSnap, setNflScheduleSnap] = useState<NflScheduleSnapshot | null>(null);

  // Completed (accepted) trades league-wide, reconstructed from public ESPN
  // data -- see fetchEspnCompletedTrades. Not scoped to whichever team you're
  // managing; every team's completed trades show up here.
  const [completedEspnTrades, setCompletedEspnTrades] = useState<CompletedTrade[]>([]);

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
    const next = readStoredRoster(team.id) ?? deriveAssignments(team);
    setRoster(next.roster);
    setBench(next.bench);
    setTradeGive([]);
    setTradeGet([]);
    setTradeOpponentId(null);
    setSelectedLeagueTeam(null);
  }, []);

  // Persist every roster-builder edit for the team you're managing, so
  // closing the tab (or switching teams and back) never loses it. This is
  // the local half of "last edit wins" -- the ESPN half is
  // syncRosterFromEspn below.
  useEffect(() => {
    writeStoredRoster(selectedTeamId, roster, bench);
  }, [selectedTeamId, roster, bench]);

  // Reconcile against the live ESPN lineup: if the team's real ESPN lineup
  // has changed since the last time we checked (i.e. a change was made in
  // the ESPN app, not here), adopt it as the new roster -- overwriting
  // whatever was locally saved. If ESPN hasn't changed, local edits made
  // here since the last check stay authoritative. Runs once on load and
  // again whenever "Refresh from ESPN" is pressed.
  const selectedTeamIdRef = useRef(selectedTeamId);
  selectedTeamIdRef.current = selectedTeamId;
  const selectedTeamRef = useRef(selectedTeam);
  selectedTeamRef.current = selectedTeam;
  // Read inside syncRosterFromEspn to detect a player local state has never
  // heard of (see "newly known" below) without putting roster/bench in that
  // callback's deps -- this only needs their value at sync time, not a
  // reactive subscription.
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const benchRef = useRef(bench);
  benchRef.current = bench;

  const syncRosterFromEspn = useCallback(async () => {
    try {
      const lineups = await fetchEspnLineups();
      const teamId = selectedTeamIdRef.current;
      const liveSlots = lineups[teamId];
      if (!liveSlots) return;

      const priorSlots = readStoredEspnSnapshot(teamId);
      const espnChanged = !priorSlots || !slotsEqual(priorSlots, liveSlots);

      // Even when ESPN's lineup itself hasn't moved since our last check,
      // make sure every player ESPN has on the roster is at least somewhere
      // in local state (starting or benched). If one isn't, local state
      // learned about them for the first time just now -- e.g. our bundled
      // player data didn't include a recent waiver add yet -- so there's no
      // "last edit" of ours to protect and they'd otherwise sit missing
      // forever, since nothing about ESPN's own lineup would ever look
      // "changed" again to trigger a recompute.
      const knownIds = new Set<number>([
        ...Object.values(rosterRef.current).filter((id): id is number => id != null),
        ...benchRef.current,
      ]);
      const hasUnknownPlayer = Object.keys(liveSlots).some((id) => !knownIds.has(Number(id)));

      if (espnChanged || hasUnknownPlayer) {
        const next = deriveAssignmentsFromEspnSlots(selectedTeamRef.current, liveSlots);
        setRoster(next.roster);
        setBench(next.bench);
      }
      writeStoredEspnSnapshot(teamId, liveSlots);
    } catch {
      // Best-effort -- lineup sync failing shouldn't disturb whatever's
      // already saved locally.
    }
  }, []);

  // The Free Agents tab's real player pool: every player ESPN currently has
  // as FREEAGENT/WAIVERS in this league, fetched live. Replaces the bundled
  // FREE_AGENTS snapshot (data/freeAgents.ts) whenever a live fetch has
  // succeeded -- that snapshot is a point-in-time export and goes stale the
  // moment anyone in the league makes a waiver move, so it's kept only as an
  // offline/error fallback. Null until the first successful sync.
  const [liveFreeAgents, setLiveFreeAgents] = useState<Player[] | null>(null);

  const syncFreeAgentsFromEspn = useCallback(async () => {
    try {
      const agents = await fetchLiveFreeAgents(FREE_AGENTS);
      setLiveFreeAgents(agents);
    } catch {
      // Best-effort -- same as syncRosterFromEspn; keep whatever we already
      // had (the bundled snapshot on first load, or the last successful pull).
    }
  }, []);

  const newsFeedState = useNewsFeed(RELEVANT_PLAYER_IDS);
  const { newsFeed, refreshNews } = newsFeedState;

  const matchupsState = useMatchups();
  const { matchupData, refreshMatchups } = matchupsState;

  const standingsState = useStandings();
  const { leagueSchedule, refreshStandings } = standingsState;

  useEffect(() => {
    const week = leagueSchedule?.currentWeek;
    if (week != null && week > 0) setRosHorizon(week);
  }, [leagueSchedule?.currentWeek]);

  useEffect(() => {
    let cancelled = false;
    getNflSchedule()
      .then((snap) => {
        if (!cancelled) {
          setNflScheduleSnap(snap);
          if (leagueSchedule?.currentWeek) setRosHorizon(leagueSchedule.currentWeek, snap.maxWeek);
        }
      })
      .catch(() => {
        /* best-effort — schedule ease stays neutral */
      });
    return () => {
      cancelled = true;
    };
  }, [leagueSchedule?.currentWeek]);

  const matchupCenterState = useMatchupCenter();
  const { liveLineups, refreshLiveLineups } = matchupCenterState;

  const { toasts, notify, dismissToast } = useToasts();

  // Deliberately NOT fetched on load or by the general "Refresh from ESPN"
  // button -- completed trades only get pulled once someone actually opens
  // the Trade Analyzer's "Completed trades" sub-tab (see TradeAnalyzerPage),
  // which then also polls this on an interval for live updates while open.
  const syncCompletedTradesFromEspn = useCallback(async () => {
    try {
      setCompletedEspnTrades(await fetchEspnCompletedTrades());
    } catch {
      // Best-effort -- same as syncRosterFromEspn.
    }
  }, []);

  useEffect(() => {
    syncRosterFromEspn();
    syncFreeAgentsFromEspn();
    refreshNews();
    refreshMatchups();
    refreshLiveLineups();
    // Only ever runs once, on load -- switching teams doesn't re-fetch;
    // the "Refresh from ESPN" button covers checking again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectionRefresh = useProjectionRefresh();
  const { projectionOverrides } = projectionRefresh;

  // Projections and the league schedule (which carries the current week)
  // used to only refresh when someone pressed "Refresh from ESPN" -- so once
  // an NFL week finished, projections/matchups/the header's "Week N" stayed
  // pinned to whatever was last manually pulled until someone clicked again,
  // even though ESPN itself had already rolled over to the next week's
  // numbers (Tuesday, after Monday Night Football). Pulling both on load
  // means the moment you actually open the app after that rollover, you get
  // the new week for free -- same "only runs once, on load" pattern as the
  // syncRosterFromEspn effect above.
  useEffect(() => {
    projectionRefresh.refreshProjections();
    refreshStandings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the league schedule above loads, compare its current week against
  // the last one this browser saw. A live app has no way to run something on
  // an actual Tuesday-morning schedule -- there's no server process backing
  // this SPA -- so "the week rolled over" can only ever be detected the next
  // time someone opens the app after it happens, which the refresh above
  // already handles data-wise. This just makes that transition visible
  // instead of silent, so a new week's numbers don't look like an
  // unexplained jump.
  useEffect(() => {
    if (!leagueSchedule) return;
    const key = "gridiron.lastSeenWeek";
    let lastSeen: number | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      lastSeen = raw ? Number(raw) : null;
    } catch {
      // Non-fatal -- just skip the "new week" notification this time.
    }
    if (lastSeen != null && lastSeen !== leagueSchedule.currentWeek) {
      notify(`Week ${leagueSchedule.currentWeek} is here — projections, matchups, and lineups are refreshed.`, "info");
    }
    try {
      window.localStorage.setItem(key, String(leagueSchedule.currentWeek));
    } catch {
      // Non-fatal.
    }
  }, [leagueSchedule, notify]);

  // ---------- Week browsing (the header's "WEEK N" control) ----------
  // null = "whatever ESPN currently has as the live week" -- the lineup page
  // keeps behaving exactly as it always has (live scores, lock state, the
  // rest) in that case. Only set to an explicit number when someone actually
  // picks a different week to look at. setViewedWeek snaps picking the real
  // current week back to null instead of pinning that literal number, so it
  // keeps tracking "current" automatically as the season moves on rather
  // than silently going stale itself.
  const [viewedWeek, setViewedWeekRaw] = useState<number | null>(null);
  const setViewedWeek = useCallback(
    (week: number | null) => {
      setViewedWeekRaw(week != null && leagueSchedule && week === leagueSchedule.currentWeek ? null : week);
    },
    [leagueSchedule]
  );
  const displayWeek = viewedWeek ?? leagueSchedule?.currentWeek ?? null;
  const isViewingCurrentWeek = viewedWeek == null;

  // Every rostered player's real actual/projected line for whichever week is
  // being browsed -- only fetched when actually browsing a non-current week
  // (the current week already has its own live pipeline: effectivePoints,
  // isPlayerLocked, etc., unaffected by any of this). ESPN only carries a
  // real per-player projection for the CURRENT week -- ask for anything
  // further out and every projectedPoints comes back null, which the lineup
  // page has to say plainly rather than showing a misleading blank/zero.
  const [weekPlayerScores, setWeekPlayerScores] = useState<LeagueWeekScoreRow[] | null>(null);
  const [weekScoresLoading, setWeekScoresLoading] = useState(false);
  useEffect(() => {
    if (viewedWeek == null) {
      setWeekPlayerScores(null);
      return;
    }
    let cancelled = false;
    setWeekScoresLoading(true);
    fetchLeagueWeekScores(viewedWeek)
      .then((result) => {
        if (!cancelled) setWeekPlayerScores(result.players);
      })
      .catch(() => {
        if (!cancelled) setWeekPlayerScores(null);
      })
      .finally(() => {
        if (!cancelled) setWeekScoresLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewedWeek]);

  const weekPlayerPointsById = useMemo(() => {
    if (!weekPlayerScores) return null;
    return new Map(weekPlayerScores.map((row) => [row.playerId, row]));
  }, [weekPlayerScores]);

  // The team's REAL historical lineup for the browsed week -- who was
  // actually started vs. benched THEN, from ESPN's own scoringPeriodId-
  // scoped roster snapshot (see fetchLeagueWeekScores), not today's roster
  // structure with old scores swapped in. A team's current lineup can be
  // completely different from what it was that week (players started who
  // are now benched or gone, and vice versa), so this can't be reconstructed
  // from the live `roster`/`bench` state at all -- it has to come from the
  // week-scoped data directly.
  const weekTeamRoster = useMemo(() => {
    if (!weekPlayerScores) return null;
    const mine = weekPlayerScores.filter((row) => row.fantasyTeamId === selectedTeamId);
    const starters = mine
      .filter((row) => row.isStarter)
      .sort((a, b) => WEEK_STARTER_SLOT_ORDER.indexOf(a.slot) - WEEK_STARTER_SLOT_ORDER.indexOf(b.slot));
    const bench = mine
      .filter((row) => !row.isStarter)
      .sort((a, b) => (b.actualPoints ?? b.projectedPoints ?? -1) - (a.actualPoints ?? a.projectedPoints ?? -1));
    return { starters, bench };
  }, [weekPlayerScores, selectedTeamId]);

  const refreshFromEspn = useCallback(async () => {
    await Promise.all([
      projectionRefresh.refreshProjections(),
      refreshStandings(),
      syncRosterFromEspn(),
      syncFreeAgentsFromEspn(),
      refreshNews(),
      refreshMatchups(),
      refreshLiveLineups(),
    ]);
    notify("Synced projections, lineup, free agents, and news/matchups from ESPN.", "success");
  }, [projectionRefresh, refreshStandings, syncRosterFromEspn, syncFreeAgentsFromEspn, refreshNews, refreshMatchups, refreshLiveLineups, notify]);

  // A player's opponent + Vegas-graded matchup quality for the current week --
  // see lib/matchup.ts. DST is graded off the opponent's implied total
  // instead of its own.
  const matchupForPlayer = useCallback((p: Player) => gradeMatchup(p, matchupData), [matchupData]);

  // Once a starter's real NFL game has kicked off (live or final), their
  // lineup slot locks for the rest of the week -- they can't be benched,
  // removed, or swapped out, and a benched player whose own game has already
  // started can't be moved into a starting slot either. See moveToSlot,
  // moveToBench, removeFromSlot, and quickStart below.
  const isPlayerLocked = useCallback(
    (p: Player) => {
      const state = matchupForPlayer(p).gameState;
      return state === "in" || state === "post";
    },
    [matchupForPlayer]
  );

  // A locked-in player's real live score for the team you're currently
  // managing (this week's own actual/projected line -- see
  // lib/espn.ts's fetchEspnLiveLineups). Null if the live-lineup fetch
  // hasn't loaded yet or this player isn't on the managed team's roster;
  // callers should fall back to the player's static projection in that case.
  const liveScoreForPlayer = useCallback(
    (id: number): number | null => {
      const entry = liveLineups?.[selectedTeamId]?.[id];
      return entry ? entry.liveScore : null;
    },
    [liveLineups, selectedTeamId]
  );

  // The number actually worth showing for a player right now: their real
  // live score once their game has started, their static projection before
  // that.
  // Which weekly projection the Build roster tab (and the header's lineup
  // total) shows: the app's custom consensus (`proj`) or ESPN's own number
  // (`espnProj`). Remembered per browser. Every other calculation -- lineup
  // suggestions, trade values -- keeps using the custom projection.
  const [projectionSource, setProjectionSourceState] = useState<ProjectionSource>("custom");
  useEffect(() => {
    getStoredValue("projection-source").then((v) => {
      if (v === "espn" || v === "custom") setProjectionSourceState(v);
    });
  }, []);
  const setProjectionSource = useCallback((src: ProjectionSource) => {
    setProjectionSourceState(src);
    void setStoredValue("projection-source", src);
  }, []);
  const projFor = useCallback((p: Player): number => (projectionSource === "espn" ? p.espnProj ?? p.proj : p.proj), [projectionSource]);

  const effectivePoints = useCallback(
    (p: Player): number => (isPlayerLocked(p) ? liveScoreForPlayer(p.id) ?? projFor(p) : projFor(p)),
    [isPlayerLocked, liveScoreForPlayer, projFor]
  );

  // ---------- Live news/injury feed: player linkage + the popover state
  // that lets a click on a player's name or status surface their articles ----------
  const newsByPlayer = useMemo(() => {
    const map = new Map<number, NewsItem[]>();
    newsFeed.forEach((n) => {
      const list = map.get(n.playerId);
      if (list) list.push(n);
      else map.set(n.playerId, [n]);
    });
    return map;
  }, [newsFeed]);

  const playerHasNews = useCallback((id: number) => (newsByPlayer.get(id)?.length ?? 0) > 0, [newsByPlayer]);
  const newsForPlayer = useCallback((id: number) => newsByPlayer.get(id) ?? [], [newsByPlayer]);

  const [playerNewsOpenId, setPlayerNewsOpenId] = useState<number | null>(null);
  // This week's live/final line plus a recent game log, fetched live from
  // ESPN's actuals (statSourceId 0, as opposed to the projections --
  // statSourceId 1 -- the rest of the app reads) the moment someone opens a
  // player's card. Previously unused by any page despite already being fully
  // built (see lib/playerPerformance.ts, written for the Sensei chat tool) --
  // this is what makes "click a player, see how they actually did last week"
  // possible alongside their news/injury feed instead of needing to ask chat.
  const [playerPerformance, setPlayerPerformance] = useState<PlayerPerformanceResult | null>(null);
  const [playerPerformanceLoading, setPlayerPerformanceLoading] = useState(false);
  const openPlayerNews = useCallback((id: number) => {
    setPlayerNewsOpenId(id);
    setPlayerPerformance(null);
    setPlayerPerformanceLoading(true);
    fetchPlayerPerformance(id)
      .then((result) => setPlayerPerformance(result))
      .catch(() => setPlayerPerformance(null))
      .finally(() => setPlayerPerformanceLoading(false));
  }, []);
  const closePlayerNews = useCallback(() => setPlayerNewsOpenId(null), []);

  // ---------- Effective data: base data with live overrides applied ----------
  // projectionOverrides maps a player's real ESPN id -> { proj, status }. Every
  // place that reads player data reads from these "effective*" arrays, so a
  // refresh updates rosters, trade values, and the AI Coach everywhere at once.
  const applyOverrideRaw = useCallback(
    <P extends Player>(player: P): P => {
      const ov = projectionOverrides[player.id];
      if (!ov) return player;
      const proj = ov.proj ?? player.proj;
      return {
        ...player,
        // Consensus weekly projection, then -- once this week's sportsbook
        // yardage props have posted -- the market's yardage swapped in for the
        // projections' (lib/consensus.ts applyPropLines).
        proj: applyPropLines(proj, matchupData.playerProps[player.id], ov.modelYards),
        ...(ov.espnProj != null ? { espnProj: ov.espnProj } : {}),
        status: ov.status || player.status,
        // Falls back to the live weekly proj (not the static bundled one)
        // when there's no season projection for this player, so it's never
        // less current than proj itself -- just insulated from a single
        // bad/injured week the way proj isn't.
        seasonProj: ov.seasonProj ?? player.seasonProj,
        ...(ov.marketPosRank != null ? { marketPosRank: ov.marketPosRank, marketValue: ov.marketValue } : {}),
        ...(ov.modelYards ? { modelYards: ov.modelYards } : {}),
        ...(ov.valueSources ? { valueSources: ov.valueSources } : {}),
      };
    },
    [projectionOverrides, matchupData]
  );

  // Pool-relative valuation fields across every player in the league plus
  // free agents, off post-override projections: posRank by THIS WEEK's
  // projection (playerValue's rank chart), seasonPosRank by season projection
  // (qualityScore/rosValue) -- so a player who's Out this week (proj
  // collapsed toward 0) doesn't also collapse to the bottom of his season
  // rank chart -- and marketQuality, the trade market's value blended into
  // qualityScore. Same function Roster Sensei uses (lib/consensus.ts
  // rankPlayerPool).
  const ranksById = useMemo(() => {
    const pool = [...ALL_TEAMS.flatMap((t) => t.roster), ...(liveFreeAgents ?? FREE_AGENTS)].map(applyOverrideRaw);
    const ranked = rankPlayerPool(pool);
    const week = leagueSchedule?.currentWeek ?? 1;
    const eased = applyScheduleEase(ranked, {
      schedule: nflScheduleSnap,
      currentWeek: week,
      history: VEGAS_HISTORY,
    });
    return new Map(eased.map((p) => [p.id, p]));
  }, [applyOverrideRaw, liveFreeAgents, leagueSchedule?.currentWeek, nflScheduleSnap]);

  // applyOverride also stamps the pool-relative fields above, so every
  // "effective*" array carries them and playerValue/qualityScore price
  // consistently everywhere.
  const applyOverride = useCallback(
    <P extends Player>(player: P): P => ({
      ...applyOverrideRaw(player),
      posRank: ranksById.get(player.id)?.posRank,
      seasonPosRank: ranksById.get(player.id)?.seasonPosRank,
      marketQuality: ranksById.get(player.id)?.marketQuality,
      positionScale: ranksById.get(player.id)?.positionScale,
      vegasQuality: ranksById.get(player.id)?.vegasQuality,
      vegasProj: ranksById.get(player.id)?.vegasProj,
      vegasWeeks: ranksById.get(player.id)?.vegasWeeks,
      fantasyCalcQuality: ranksById.get(player.id)?.fantasyCalcQuality,
      scheduleEase: ranksById.get(player.id)?.scheduleEase,
    }),
    [applyOverrideRaw, ranksById]
  );

  // Every team's optimal-lineup weekly point total, off current (override-
  // applied) projections -- used as the playoff simulator's "true talent"
  // baseline for teams with few or no games played yet. See lib/playoffOdds.
  const projectedTeamStrength = useMemo(() => {
    const map: Record<number, number> = {};
    ALL_TEAMS.forEach((t) => {
      map[t.id] = optimizeLineup(t.roster.map(applyOverride)).projectedTotal;
    });
    return map;
  }, [applyOverride]);

  // Playoff race: who's clinched/eliminated/alive, playoff odds via
  // simulation, and -- for everyone still alive -- exactly what needs to
  // happen. Null until the League tab's Standings/Playoff Race sub-tab has
  // been opened at least once (see useStandings).
  const playoffOutlook = useMemo(() => {
    if (!leagueSchedule) return null;
    return computePlayoffOutlook(leagueSchedule.standings, leagueSchedule.schedule, leagueSchedule.playoffTeamCount, projectedTeamStrength);
  }, [leagueSchedule, projectedTeamStrength]);

  // Your player pool = the team you're managing plus every free agent. Switch
  // teams and this whole pipeline (needs, coach, trade values) re-centers.
  const effectivePlayers: Player[] = useMemo(
    () => [...selectedTeam.roster, ...(liveFreeAgents ?? FREE_AGENTS)].map(applyOverride),
    [applyOverride, selectedTeam, liveFreeAgents]
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

  // This week's head-to-head fantasy matchup: who you're playing, the live
  // score, remaining projected points, and a simulated win probability -- see
  // lib/matchupCenter.ts. Null until the Matchup tab has been opened at least
  // once (standings + live lineups are both fetched on demand there, same
  // pattern as the League tab). "Me" is built from your real, locally-managed
  // starting lineup (`roster`) rather than the live ESPN sync, since that's
  // the lineup you're actually setting in this app; the opponent is built
  // from their real live ESPN lineup (`liveLineups`), falling back to the
  // bundled snapshot's starter flags if that hasn't loaded yet. Each side's
  // live per-player scores come from that same `liveLineups` fetch -- NOT
  // from the schedule's own totalPoints, which ESPN leaves at a flat 0 for
  // every matchup in the league until the whole scoring period closes out.
  const headToHeadMatchup = useMemo(() => {
    if (!leagueSchedule) return null;
    const week = leagueSchedule.currentWeek;
    const m = leagueSchedule.schedule.find(
      (s) => s.week === week && (s.homeId === selectedTeamId || s.awayId === selectedTeamId)
    );
    if (!m) return null;
    const isHome = m.homeId === selectedTeamId;
    const oppId = isHome ? m.awayId : m.homeId;
    const oppTeam = ALL_TEAMS.find((t) => t.id === oppId);
    if (!oppTeam) return null;

    const myStarters = SLOTS.map((s) => roster[s])
      .filter((id): id is number => id != null)
      .map(playerById)
      .filter((p): p is Player => !!p);

    const oppLiveEntries = liveLineups?.[oppId];
    const oppStarters = oppTeam.roster
      .filter((p) => {
        const slot = oppLiveEntries ? oppLiveEntries[p.id]?.slot : p.starter ? p.slot : "BE";
        return slot != null && slot !== "BE" && slot !== "IR";
      })
      .map((p) => playerById(p.id) ?? applyOverride(p));

    const liveScoresFor = (teamId: number): Record<number, number> => {
      const entries = liveLineups?.[teamId];
      if (!entries) return {};
      const scores: Record<number, number> = {};
      Object.entries(entries).forEach(([playerId, entry]) => {
        scores[Number(playerId)] = entry.liveScore;
      });
      return scores;
    };

    const meInput: MatchupSideInput = {
      teamId: selectedTeamId,
      name: selectedTeam.name,
      owner: selectedTeam.owner,
      starters: myStarters,
      liveScoreByPlayerId: liveScoresFor(selectedTeamId),
    };
    const oppInput: MatchupSideInput = {
      teamId: oppId,
      name: oppTeam.name,
      owner: oppTeam.owner,
      starters: oppStarters,
      liveScoreByPlayerId: liveScoresFor(oppId),
    };

    return buildHeadToHeadMatchup(week, m.decided, meInput, oppInput, matchupData);
  }, [leagueSchedule, selectedTeamId, selectedTeam, roster, playerById, liveLineups, matchupData, applyOverride]);

  // "Should I start this bench guy instead?" -- for each bench player,
  // compares them against the weakest current starter they're eligible to
  // replace (same slot-eligibility logic as quickStart). The comparison is
  // done on a matchup-adjusted projection (raw projection + a small bump/cut
  // from that week's matchup grade -- see adjustedProjection above) rather
  // than treating "higher projection" and "better matchup" as two separate
  // either/or triggers. That single number is what avoids calling a real gap
  // (e.g. 10 vs 13 points) a "similar projection" just because the matchup
  // grades differ -- a matchup edge only justifies the swap if it's big
  // enough to actually close the real point gap.
  const benchUpgradeSuggestions: BenchSuggestion[] = useMemo(() => {
    const suggestions: BenchSuggestion[] = [];

    bench.forEach((id) => {
      const p = playerById(id);
      if (!p) return;
      if (isPlayerLocked(p)) return; // can't be started -- their game already began
      const eligibleSlots = SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(p.pos));

      let weakestSlot: RosterSlotId | null = null;
      let weakest: Player | null = null;
      // A plain for-of (not .forEach) so TS can narrow `weakest` below --
      // narrowing a `let` doesn't survive reassignment inside a callback.
      for (const s of eligibleSlots) {
        const occId = roster[s];
        const occ = occId != null ? playerById(occId) : null;
        if (occ && !isPlayerLocked(occ) && (!weakest || occ.proj < weakest.proj)) {
          weakest = occ;
          weakestSlot = s;
        }
      }
      if (!weakest || !weakestSlot) return;

      const benchMatchup = matchupForPlayer(p);
      const starterMatchup = matchupForPlayer(weakest);
      const starterOnBye = starterMatchup.isBye;

      const adjustedEdge = adjustedProjection(p, benchMatchup) - adjustedProjection(weakest, starterMatchup);
      if (!starterOnBye && adjustedEdge < MIN_ADJUSTED_EDGE) return;

      const rawDelta = p.proj - weakest.proj;
      const benchRank = benchMatchup.grade ? MATCHUP_GRADE_RANK[benchMatchup.grade] : null;
      const starterRank = starterMatchup.grade ? MATCHUP_GRADE_RANK[starterMatchup.grade] : null;
      const matchupFavorsBench = benchRank != null && starterRank != null && benchRank > starterRank;

      let reason: string;
      if (starterOnBye) {
        reason = `${weakest.name} is on a bye this week -- ${p.name} is a healthy fill-in${
          benchMatchup.grade ? ` with a ${benchMatchup.grade}-grade matchup (${benchMatchup.label})` : ""
        }.`;
      } else if (rawDelta >= MIN_ADJUSTED_EDGE) {
        // The raw projection alone already justifies it; matchup is a bonus, not the reason.
        reason = `${p.name} is projected for more points this week (${p.proj} vs ${weakest.proj})${
          matchupFavorsBench ? ` and has the better matchup (${benchMatchup.grade} vs ${starterMatchup.grade}).` : "."
        }`;
      } else {
        // The matchup swing is what's actually doing the work here -- call
        // out the real raw-projection gap it's overcoming instead of
        // pretending the two projections are close.
        reason = `${p.name}'s matchup this week (${benchMatchup.grade} -- ${benchMatchup.label}) is enough of an edge over ${weakest.name}'s (${starterMatchup.grade} -- ${starterMatchup.label}) to be worth it despite ${
          rawDelta < 0 ? `a ${Math.abs(rawDelta).toFixed(1)}-point lower raw projection (${p.proj} vs ${weakest.proj})` : `a similar raw projection (${p.proj} vs ${weakest.proj})`
        }.`;
      }

      suggestions.push({ benchPlayer: p, starter: weakest, slot: weakestSlot, reason });
    });

    return suggestions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bench, roster, playerById, matchupForPlayer, isPlayerLocked]);

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

      if (isPlayerLocked(player)) {
        notify(`${player.name}'s game has already started -- they're locked in for the rest of the week.`, "error");
        return;
      }
      const occupant = occupantId != null ? playerById(occupantId) : null;
      if (occupant && isPlayerLocked(occupant)) {
        notify(`${occupant.name}'s game has already started -- that slot is locked for the rest of the week.`, "error");
        return;
      }

      const sourceSlot = locateSlot(player.id);
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
    [roster, playerById, isPlayerLocked, notify]
  );

  /** Moves a player to the bench, clearing whatever starting slot they were in. */
  const moveToBench = useCallback(
    (player: Player) => {
      if (bench.includes(player.id)) return;
      if (isPlayerLocked(player)) {
        notify(`${player.name}'s game has already started -- they're locked in for the rest of the week.`, "error");
        return;
      }
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
    [bench, roster, isPlayerLocked, notify]
  );

  /** Bench player -> starting lineup, one click: fills an empty eligible slot
   * if one exists, otherwise swaps into the eligible slot with the weakest
   * current starter (skipping any slot whose occupant is already locked in). */
  function quickStart(player: Player) {
    if (isPlayerLocked(player)) {
      notify(`${player.name}'s game has already started -- they can't be started now.`, "error");
      return;
    }
    const eligibleSlots = SLOTS.filter((s) => SLOT_ELIGIBILITY[s].includes(player.pos));
    const emptySlot = eligibleSlots.find((s) => !roster[s]);
    if (emptySlot) {
      moveToSlot(emptySlot, player);
      notify(`${player.name} moved into your starting ${emptySlot} slot.`, "success");
      return;
    }
    let worstSlot: RosterSlotId | null = null;
    let worstProj = Infinity;
    eligibleSlots.forEach((s) => {
      const occId = roster[s];
      const occ = occId != null ? playerById(occId) : null;
      if (occ && !isPlayerLocked(occ) && occ.proj < worstProj) {
        worstProj = occ.proj;
        worstSlot = s;
      }
    });
    if (worstSlot) {
      const replaced = roster[worstSlot] != null ? playerById(roster[worstSlot]!) : null;
      moveToSlot(worstSlot, player);
      notify(replaced ? `Started ${player.name} over ${replaced.name}.` : `Started ${player.name}.`, "success");
    } else {
      notify(`No open slot -- every eligible starter has already locked in for the week.`, "error");
    }
  }

  function addToSlot(slot: RosterSlotId, player: Player) {
    if (!SLOT_ELIGIBILITY[slot].includes(player.pos)) return;
    const occupantId = roster[slot];
    const occupant = occupantId != null ? playerById(occupantId) : null;
    if (occupant && isPlayerLocked(occupant)) {
      notify(`${occupant.name}'s game has already started -- that slot is locked for the rest of the week.`, "error");
      return;
    }
    setRoster((r) => ({ ...r, [slot]: player.id }));
  }

  function addToBench(player: Player) {
    setBench((b) => [...b, player.id]);
  }

  function removeFromSlot(slot: RosterSlotId) {
    const occupantId = roster[slot];
    const occupant = occupantId != null ? playerById(occupantId) : null;
    if (occupant && isPlayerLocked(occupant)) {
      notify(`${occupant.name}'s game has already started -- they can't be removed from your lineup this week.`, "error");
      return;
    }
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
    // Locked starters (their game already started) are pinned in place, and
    // any locked bench player is excluded from the pool entirely so they
    // can't get pulled into a starting slot after kickoff.
    const lockedAssignments: RosterAssignments = {};
    SLOTS.forEach((slot) => {
      const id = roster[slot];
      const p = id != null ? playerById(id) : null;
      if (p && isPlayerLocked(p)) lockedAssignments[slot] = id!;
    });
    const lockedBenchIds = new Set(bench.filter((id) => {
      const p = playerById(id);
      return p ? isPlayerLocked(p) : false;
    }));
    const pool = effectivePlayers.filter((p) => !lockedBenchIds.has(p.id));

    const result = optimizeLineup(pool, { excludeOut: true, lockedAssignments });
    setRoster(result.roster);
    setBench((b) => b.filter((id) => !result.starterIds.includes(id)));
    if (Object.keys(lockedAssignments).length > 0) {
      notify("Kept your already-started players locked in place while optimizing the rest.", "info");
    }
  }

  const usedIds = useMemo(() => {
    const s = new Set<number>(Object.values(roster).filter((id): id is number => id != null));
    bench.forEach((id) => s.add(id));
    return s;
  }, [roster, bench]);

  // Player lists hide "inactive" players (no projection this week OR for the
  // season -- retired, unsigned, long-term out) unless you ask for them or
  // search by name, so ~1,000 zero-point free agents don't bury the ~100
  // that matter. Shared by the Build roster pool and the Free Agents browser.
  const [showInactivePlayers, setShowInactivePlayers] = useState(false);
  const splitInactive = useCallback(
    <P extends Player>(list: P[], query: string): { shown: P[]; hiddenCount: number } => {
      if (showInactivePlayers || query.trim()) return { shown: list, hiddenCount: 0 };
      const shown = list.filter((p) => p.proj > 0 || (p.seasonProj ?? 0) > 0);
      return { shown, hiddenCount: list.length - shown.length };
    },
    [showInactivePlayers]
  );

  const { shown: availablePlayers, hiddenCount: hiddenPoolCount } = useMemo(() => {
    const list = effectivePlayers
      .filter((p) => !usedIds.has(p.id))
      .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => projFor(b) - projFor(a));
    return splitInactive(list, search);
  }, [usedIds, posFilter, search, effectivePlayers, splitInactive, projFor]);

  // Blends real live scores for anyone already locked in with static
  // projections for anyone who hasn't played yet, so this number (and every
  // header/page that displays it) stays accurate once games kick off instead
  // of quietly under- or over-counting a starter who's already on the board.
  const rosterTotal = useMemo(() => {
    return SLOTS.reduce((sum, slot) => {
      const id = roster[slot];
      const p = id != null ? playerById(id) : null;
      return sum + (p ? effectivePoints(p) : 0);
    }, 0);
  }, [roster, playerById, effectivePoints]);

  // ---------- AI Coach: your current needs ----------
  const myPlayers = useMemo(() => Array.from(usedIds).map(playerById).filter((p): p is Player => !!p), [usedIds, playerById]);

  // League baseline = the average starter quality score at each position
  // across every team in the league (all opponents + you), so "need" and
  // "strength" are judged relative to what a typical starter actually looks
  // like this season.
  const leagueBaseline = useMemo(
    () => buildLeagueBaseline([...effectiveLeagueTeams.map((t) => t.roster), myPlayers]),
    [myPlayers, effectiveLeagueTeams]
  );

  const myNeeds = useMemo(() => analyzeRosterNeeds(myPlayers), [myPlayers]);

  // A position is a "need" if you're missing a starter outright, or your
  // starter quality score sits meaningfully (15%+) below the league-average
  // starter there.
  const needyPositions = useMemo(() => computeNeedyPositions(myNeeds, leagueBaseline), [myNeeds, leagueBaseline]);

  // A position is a "strength" you can trade from if your starter score is
  // well above league average AND you actually have quality bench depth
  // sitting behind those starters.
  const strengthPositions = useMemo(() => computeStrengthPositions(myNeeds, leagueBaseline), [myNeeds, leagueBaseline]);

  // Which positions are worth putting in a trade at all: position players only
  // (QB/RB/WR/TE). Kickers and defenses are never traded -- values are
  // near-identical across the pool and managers just stream them. QBs only when
  // QB is a genuine need, since a QB-for-QB swap between two set starters in a
  // 1QB league is a pointless lateral move.
  const isTradeablePos = useCallback((pos: Position) => isTradeablePosition(pos, needyPositions), [needyPositions]);

  // The give-side pool every trade-suggestion generator below draws from:
  // everyone at a tradeable position EXCEPT your single best player there
  // (keep your studs, trade from the rest), and not currently Out. Shared by
  // generalSuggestions, twoForTwoFallbackSuggestions, and the "what would it
  // take?" solver so none of them can suggest parting with a player the
  // others would consider untouchable.
  const myMovablePlayers = useMemo(() => computeMovablePlayers(myNeeds, isTradeablePos), [myNeeds, isTradeablePos]);

  // Genuine bench-caliber spare depth (tier 1-2 bench, not a starter) --
  // the only pool the "what would it take?" solver is allowed to draw
  // ADDITIONAL package pieces from beyond its single core piece, so a
  // multi-piece package can never mean "three of your actual starters" --
  // see the comment on buildCandidatePackages in lib/whatWouldItTake.ts.
  const myTradeableDepth = useMemo(() => {
    const depth: Player[] = [];
    POSITIONS.forEach((pos) => {
      if (!isTradeablePos(pos)) return;
      depth.push(...myNeeds[pos].tradeableDepth);
    });
    return depth;
  }, [myNeeds, isTradeablePos]);

  // ---------- "What would it take?" solver ----------
  // Reverse of the analyzer: pick anyone on someone else's roster and find the
  // smallest, cheapest package from YOUR roster that clears the exact same
  // fairness bar the analyzer/coach use -- see lib/whatWouldItTake.ts. Draws
  // its core piece from the same myMovablePlayers pool as the rest of the
  // trade engine, so it never offers up a player you actually need to keep,
  // and any additional pieces from myTradeableDepth only. Always priced
  // season-long (SEASON_PRICER) -- this has no week/season toggle of its own
  // (unlike Build a trade), and both its callers (this panel and the AI
  // Coach's "players to trade for") are asking a long-term "what's this
  // realistically cost me" question, not a this-week one.
  const findWhatItWouldTake = useCallback(
    (target: LeaguePlayer): WhatWouldItTakeOption[] | null => {
      const theirTeam = effectiveLeagueTeams.find((t) => t.id === target.fantasyTeamId);
      if (!theirTeam) return null;
      const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
      return solveWhatItWouldTake(target, myMovablePlayers, myTradeableDepth, myPlayers, theirNeeds, leagueBaseline, SEASON_PRICER);
    },
    [effectiveLeagueTeams, myMovablePlayers, myTradeableDepth, myPlayers, leagueBaseline]
  );

  // Which player id (if any) the "What would it take?" panel should open
  // straight to a result for, instead of its default search-and-pick screen.
  // Set by clicking a player elsewhere in the app (currently: the AI Coach's
  // "Players to trade for" list) via openWhatWouldItTake below, consumed by
  // TradeAnalyzerPage/WhatWouldItTakePanel, then cleared once they've picked
  // it up so navigating back to the tab manually still starts at the picker.
  const [wwitTargetId, setWwitTargetId] = useState<number | null>(null);

  const openWhatWouldItTake = useCallback((playerId: number) => {
    setWwitTargetId(playerId);
    setTab("trade");
  }, []);

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

  // Same idea as recommendedPickups, but for players you'd have to trade
  // for: everyone rostered by someone else in the league (never a free
  // agent, since those already have their own "just add them" path above).
  // Kickers/defenses and non-need QBs are excluded -- see isTradeablePos --
  // since nobody trades for those.
  //
  // A raw best-available-by-quality list here is nearly useless -- it's just
  // every league's top overall player at the position, i.e. exactly the
  // "superstar nobody's giving up" case. So instead of ranking the whole
  // position and taking the top 3, this runs the top candidates through the
  // same "What would it take?" solver the WWIT tab uses and KEEPS ONLY the
  // ones where some package up to 3 pieces from your actual movable players
  // clears the standard fairness bar (star gate included) -- i.e. someone
  // realistically gettable, not a name that just tops the position. That bar
  // already encodes "their team needs what I have": a team with no real hole
  // where your surplus lives will price their guy higher than a cheap package
  // can clear, so a mutual-fit target naturally survives while a poor-fit one
  // (even a merely-good player) doesn't. Survivors are ranked by quality
  // among themselves, so the best REALISTIC upgrade leads -- not the
  // cheapest, and not the best unconditionally. Each candidate carries its
  // cheapest clearing package so the UI can show what it'd actually cost
  // before the user ever opens the solver, and is still meant to be clicked
  // straight into "What would it take?" for the full option list.
  // Every candidate that clears the bar, not just the top 3 -- "search for
  // more" (below) reveals further batches from this same pool instead of
  // re-solving, so clicking it can't surface a worse-fit player than what's
  // already showing.
  //
  // Unlike the general-purpose findWhatItWouldTake wrapper, this does NOT
  // let the solver offer up a player at the SAME position as the need it's
  // trying to fill. Giving away your worst RB to get a better RB, when RB is
  // your declared need, is a zero-sum swap of bodies at your thin spot --
  // your roster construction problem is exactly as unsolved after that trade
  // as before it, even if the swap is a real quality upgrade. needBasedSuggestions
  // above already avoids this (it explicitly looks for a strength position to
  // trade FROM); this is the same idea applied to the solver-backed list.
  const tradeTargetsByNeedAll = useMemo(() => {
    return needyPositionsRanked
      .filter((pos) => isTradeablePos(pos))
      .map((pos) => {
        const corePool = myMovablePlayers.filter((p) => p.pos !== pos);
        const depthPool = myTradeableDepth.filter((p) => p.pos !== pos);
        const candidates = effectiveAllLeaguePlayers
          .filter((p) => p.pos === pos && p.status !== "Out")
          .map((p) => ({ ...p, qScore: qualityScore(p) }))
          .sort((a, b) => b.qScore - a.qScore)
          // Cap how many go through the solver -- combinatorial search per
          // candidate. Wide enough to have real depth behind the top 3 for
          // "search for more" to reveal.
          .slice(0, 24)
          .map((p) => {
            const theirTeam = effectiveLeagueTeams.find((t) => t.id === p.fantasyTeamId);
            if (!theirTeam) return null;
            const theirNeeds = analyzeRosterNeeds(theirTeam.roster);
            const options = solveWhatItWouldTake(p, corePool, depthPool, myPlayers, theirNeeds, leagueBaseline, SEASON_PRICER);
            return options && options.length > 0 ? { ...p, cheapestOption: options[0] } : null;
          })
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .sort((a, b) => b.qScore - a.qScore);
        return { pos, reason: needReason(pos), candidates };
      })
      .filter((group) => group.candidates.length > 0);
  }, [
    needyPositionsRanked,
    effectiveAllLeaguePlayers,
    effectiveLeagueTeams,
    needReason,
    isTradeablePos,
    myMovablePlayers,
    myTradeableDepth,
    myPlayers,
    myNeeds,
    leagueBaseline,
  ]);

  // Keys of "players to trade for" candidates already shown, per position --
  // "search for more" pushes the currently-visible batch in here so the next
  // click reveals the next-best ones from tradeTargetsByNeedAll instead of
  // repeating itself. Keyed by position too (not just player id) since the
  // same player could theoretically appear as a FLEX-eligible fit at two
  // positions.
  const [excludedTradeTargetKeys, setExcludedTradeTargetKeys] = useState<Set<string>>(() => new Set());

  const tradeTargetsByNeed = useMemo(() => {
    return tradeTargetsByNeedAll
      .map((group) => {
        const remaining = group.candidates.filter((p) => !excludedTradeTargetKeys.has(`${group.pos}:${p.id}`));
        return { ...group, candidates: remaining.slice(0, 3), hasMore: remaining.length > 3 };
      })
      .filter((group) => group.candidates.length > 0);
  }, [tradeTargetsByNeedAll, excludedTradeTargetKeys]);

  function searchMoreTradeTargets(pos: Position) {
    setExcludedTradeTargetKeys((prev) => {
      const group = tradeTargetsByNeed.find((g) => g.pos === pos);
      if (!group) return prev;
      const next = new Set(prev);
      group.candidates.forEach((p) => next.add(`${pos}:${p.id}`));
      return next;
    });
  }

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

  const { shown: browsableFreeAgents, hiddenCount: hiddenFreeAgentCount } = useMemo(() => {
    const list = freeAgentPool
      .filter((p) => (faPosFilter === "ALL" ? true : p.pos === faPosFilter))
      .filter((p) => p.name.toLowerCase().includes(faSearch.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
    return splitInactive(list, faSearch);
  }, [freeAgentPool, faPosFilter, faSearch, splitInactive]);

  // ---------- AI Coach: trade suggestion engine ----------
  // Keys of suggestions the user has already seen via "Get new recommendations",
  // so a regenerate swaps in the next-best batch instead of repeating itself.
  const [excludedCoachKeys, setExcludedCoachKeys] = useState<Set<string>>(() => new Set());

  // Every generator's candidate pool -- see lib/coachTrades.ts, which Roster
  // Sensei's suggest_trades tool runs too.
  const coachPools = useMemo(
    () =>
      buildCoachPools(
        buildCoachContext({ myPlayers, leagueTeams: effectiveLeagueTeams, myNeeds, leagueBaseline })
      ),
    [myPlayers, effectiveLeagueTeams, myNeeds, leagueBaseline]
  );

  // Union of every suggestion this pipeline is capable of producing right now,
  // regardless of which ones happen to make the top-N cut. Lets "get new
  // recommendations" know whether a fresh batch actually exists.
  // Saved/dismissed trades for the managed team, and an optional "only this
  // manager" filter. Both apply BEFORE the mix (filterPools), so the list is
  // still a proper mix of whatever's left.
  const tradeShortlist = useTradeShortlist(selectedTeamId);
  const [coachTeamFilter, setCoachTeamFilter] = useState<number | null>(null);
  useEffect(() => setCoachTeamFilter(null), [selectedTeamId]);
  const visibleCoachPools = useMemo(
    () =>
      filterPools(
        coachPools,
        (s) => (coachTeamFilter == null || s.teamId === coachTeamFilter) && !tradeShortlist.dismissedKeys.has(suggestionKey(s))
      ),
    [coachPools, coachTeamFilter, tradeShortlist.dismissedKeys]
  );

  const copyTradeOffer = useCallback(
    async (s: TradeSuggestion) => {
      try {
        await navigator.clipboard.writeText(buildTradeOffer(s));
        notify(`Copied a trade offer for ${s.teamName} — paste it into ESPN chat or a text.`, "success");
      } catch {
        notify("Couldn't copy to the clipboard in this browser.", "error");
      }
    },
    [notify]
  );

  const allCoachCandidateKeys = useMemo(() => new Set(allPoolSuggestions(visibleCoachPools).map(suggestionKey)), [visibleCoachPools]);

  const hasFreshCoachSuggestions = useMemo(
    () => Array.from(allCoachCandidateKeys).some((k) => !excludedCoachKeys.has(k)),
    [allCoachCandidateKeys, excludedCoachKeys]
  );

  const coachSuggestions = useMemo(() => mixCoachSuggestions(visibleCoachPools, excludedCoachKeys), [visibleCoachPools, excludedCoachKeys]);

  // Swap the current batch out for the next-best one. Once every reasonable
  // trade has been cycled through, it loops back to the top rather than
  // getting stuck repeating the same leftovers.
  function regenerateCoachSuggestions() {
    setExcludedCoachKeys((prev) => {
      if (!hasFreshCoachSuggestions) return new Set();
      const next = new Set(prev);
      coachSuggestions.forEach((s) => next.add(suggestionKey(s)));
      return next;
    });
  }

  function proposeCoachTrade(s: TradeSuggestion) {
    setTradeOpponentId(s.teamId);
    setTradeGive(s.give.map((p) => p.id));
    setTradeGet(s.get.map((p) => p.id));
    setTradeHorizon("season");
    setTradeNeedAdjust(true);
    setTab("trade");
  }

  // ---------- Trade analyzer ----------
  // Same curved value-over-replacement the AI Coach uses. Week mode prices a
  // single week; Season mode projects quality across remaining weeks (rosValue).
  const tradeValueOf = useCallback(
    (p: Player): number => (tradeHorizon === "season" ? rosValue(p) : playerValue(p)),
    [tradeHorizon]
  );

  const tradePlayers = useCallback(
    (list: number[]) => list.map((id) => playerById(id)).filter((p): p is Player => !!p),
    [playerById]
  );

  // Package value via shared tradeEngine helpers (no duplicated discount math).
  // Optional need-adjust (season mode) matches Coach / Sensei evaluate_trade.
  const tradeValue = useCallback(
    (list: number[], side: "give" | "get"): number => {
      const players = tradePlayers(list);
      if (!players.length) return 0;
      if (tradeHorizon === "week") return packageValue(players, WEEK_PRICER);
      if (tradeNeedAdjust && tradeOpponentId != null) {
        const myNeeds = analyzeRosterNeeds(effectiveMyTeamPlayers);
        const oppTeam = ALL_TEAMS.find((t) => t.id === tradeOpponentId);
        const theirNeeds = analyzeRosterNeeds((oppTeam?.roster ?? []).map(applyOverride));
        // Give side is valued for the opponent's needs; get side for yours.
        const needs = side === "give" ? theirNeeds : myNeeds;
        return needAdjustedPackageValue(players, needs, leagueBaseline, ROS_PRICER, rosPackageFloor());
      }
      return packageValue(players, ROS_PRICER, rosPackageFloor());
    },
    [
      tradePlayers,
      tradeHorizon,
      tradeNeedAdjust,
      tradeOpponentId,
      effectiveMyTeamPlayers,
      applyOverride,
      leagueBaseline,
    ]
  );

  const giveVal = tradeValue(tradeGive, "give");
  const getVal = tradeValue(tradeGet, "get");
  const diff = getVal - giveVal;
  const diffPct = giveVal + getVal > 0 ? (diff / ((giveVal + getVal) / 2)) * 100 : 0;
  // Fairness ratio: what you get / what you give. 1.0 = dead even.
  const tradeRatio = giveVal > 0 && getVal > 0 ? fairnessRatio(giveVal, getVal) : null;

  /** Raw package value for arbitrary id lists (completed trades) — never need-adjusted. */
  const tradeSideValue = useCallback(
    (list: number[]): number => {
      const players = tradePlayers(list);
      if (!players.length) return 0;
      if (tradeHorizon === "week") return packageValue(players, WEEK_PRICER);
      return packageValue(players, ROS_PRICER, rosPackageFloor());
    },
    [tradePlayers, tradeHorizon]
  );
  // Star gate: a top positional-rank stud on one side without Tier-1/2 (and
  // enough top-piece value) coming back is "likely unfair" no matter what the
  // value ratio says. Priced by whichever horizon is active, same as
  // giveVal/getVal above -- a stud who's merely Questionable this week
  // shouldn't lose his "star" status (and the protection that comes with it)
  // in Week mode.
  const tradeStarGateViolation =
    (tradeGive.length > 0 || tradeGet.length > 0) &&
    !starGateOk(
      tradeGive.map((id) => playerById(id)).filter((p): p is Player => !!p),
      tradeGet.map((id) => playerById(id)).filter((p): p is Player => !!p),
      tradeHorizon === "season" ? SEASON_PRICER : WEEK_PRICER
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
    projectionSource,
    setProjectionSource,
    projFor,
    hiddenPoolCount,
    showInactivePlayers,
    setShowInactivePlayers,
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
    benchUpgradeSuggestions,
    isPlayerLocked,
    liveScoreForPlayer,
    effectivePoints,
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
    hiddenFreeAgentCount,

    // AI coach
    myNeeds,
    leagueBaseline,
    needyPositions,
    strengthPositions,
    coachSuggestions,
    coachTeamFilter,
    setCoachTeamFilter,
    savedTrades: tradeShortlist.savedTrades,
    savedTradeKeys: tradeShortlist.savedKeys,
    toggleSavedTrade: tradeShortlist.toggleSaved,
    dismissTrade: tradeShortlist.dismiss,
    dismissedTradeCount: tradeShortlist.dismissedKeys.size,
    clearDismissedTrades: tradeShortlist.clearDismissed,
    copyTradeOffer,
    proposeCoachTrade,
    regenerateCoachSuggestions,
    hasFreshCoachSuggestions,
    tradeTargetsByNeed,
    searchMoreTradeTargets,
    openWhatWouldItTake,

    // trade analyzer
    tradeGive,
    setTradeGive,
    tradeGet,
    setTradeGet,
    tradeHorizon,
    setTradeHorizon,
    tradeNeedAdjust,
    setTradeNeedAdjust,
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
    // Value of an arbitrary package of player ids -- same curve as
    // giveVal/getVal above (without need-adjust), usable for completed trades.
    tradeSideValue,
    completedEspnTrades,
    refreshCompletedTrades: syncCompletedTradesFromEspn,
    findWhatItWouldTake,
    wwitTargetId,
    setWwitTargetId,

    // league
    selectedLeagueTeam,
    setSelectedLeagueTeam,

    // standings + playoff race
    ...standingsState,
    playoffOutlook,

    // week browsing (the header's "WEEK N" control)
    viewedWeek,
    setViewedWeek,
    displayWeek,
    isViewingCurrentWeek,
    weekPlayerPointsById,
    weekScoresLoading,
    weekTeamRoster,

    // live news/injury feed, and the click-a-player's-name-or-status popover
    ...newsFeedState,
    playerHasNews,
    newsForPlayer,
    playerNewsOpenId,
    openPlayerNews,
    closePlayerNews,
    playerPerformance,
    playerPerformanceLoading,

    // weekly matchups (opponent + Vegas-graded matchup quality)
    ...matchupsState,
    matchupForPlayer,

    // this week's head-to-head fantasy matchup (opponent, live score,
    // projected points, win probability)
    ...matchupCenterState,
    headToHeadMatchup,

    // toast notifications
    toasts,
    notify,
    dismissToast,

    // live projection refresh (and lineup sync + news refresh --
    // refreshFromEspn also reconciles the roster and news against ESPN)
    ...projectionRefresh,
    refreshProjections: refreshFromEspn,
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

const rosterKey = (teamId: number) => `gridiron.roster.${teamId}`;
const espnSnapshotKey = (teamId: number) => `gridiron.espnLineupSnapshot.${teamId}`;

/** A previously-saved roster-builder edit for this team, if any. */
function readStoredRoster(teamId: number): { roster: RosterAssignments; bench: number[] } | null {
  try {
    const raw = window.localStorage.getItem(rosterKey(teamId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { roster?: RosterAssignments; bench?: number[] };
    if (parsed && typeof parsed === "object" && parsed.roster && Array.isArray(parsed.bench)) {
      return { roster: parsed.roster, bench: parsed.bench };
    }
  } catch {
    // Corrupted/old-format value -- ignore and fall back to the ESPN seed.
  }
  return null;
}

function writeStoredRoster(teamId: number, roster: RosterAssignments, bench: number[]): void {
  try {
    window.localStorage.setItem(rosterKey(teamId), JSON.stringify({ roster, bench }));
  } catch {
    // Non-fatal: the edit just won't survive a reload.
  }
}

/** The team's live ESPN lineup (playerId -> slot label) as of the last time
 * we checked, so a later check can tell whether it changed in the ESPN app. */
function readStoredEspnSnapshot(teamId: number): Record<number, string> | null {
  try {
    const raw = window.localStorage.getItem(espnSnapshotKey(teamId));
    return raw ? (JSON.parse(raw) as Record<number, string>) : null;
  } catch {
    return null;
  }
}

function writeStoredEspnSnapshot(teamId: number, slots: Record<number, string>): void {
  try {
    window.localStorage.setItem(espnSnapshotKey(teamId), JSON.stringify(slots));
  } catch {
    // Non-fatal.
  }
}

function slotsEqual(a: Record<number, string>, b: Record<number, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[Number(k)] === b[Number(k)]);
}

export type FantasyApp = ReturnType<typeof useFantasyApp>;
