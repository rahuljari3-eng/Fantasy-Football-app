// The app's single source of truth: roster/bench state, trade analyzer state,
// and every derived value (roster needs, free-agent recommendations, AI Coach
// trade suggestions) computed from them. App.tsx calls this once and hands
// the result down to whichever page is active -- pages themselves hold no
// state of their own beyond simple local UI toggles.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FREE_AGENTS } from "../data/freeAgents";
import { ALL_TEAMS, DEFAULT_TEAM_ID } from "../data/allTeams";
import { POSITIONS, REQUIRED_STARTERS, SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import { COACH_MAX_SUGGESTIONS, COACH_MIN_ONE_FOR_ONE, COACH_MIN_TWO_FOR_TWO, FAIR_RATIO_MIN, FAIR_RATIO_MAX, EXTRA_PIECE_DISCOUNT } from "../config/trade";
import { VOR_BASELINE, ROS_WEEKS } from "../config/scoring";
import { DEFAULT_TAB } from "../config/pages";
import { playerValue, qualityScore, rosValue } from "../lib/scoring";
import { analyzeRosterNeeds } from "../lib/rosterNeeds";
import { deriveAssignments, deriveAssignmentsFromEspnSlots } from "../lib/teamRoster";
import { fetchEspnCompletedTrades, fetchEspnLineups, type CompletedTrade } from "../lib/espn";
import { fetchLiveFreeAgents } from "../lib/espnLeague";
import { balancePackage, balanceTwoForTwo, fairnessRatio, needAdjustedPackageValue, starGateOk, SEASON_PRICER, WEEK_PRICER } from "../lib/tradeEngine";
import { findWhatItWouldTake as solveWhatItWouldTake, type WhatWouldItTakeOption } from "../lib/whatWouldItTake";
import { optimizeLineup } from "../lib/optimizeLineup";
import { useProjectionRefresh } from "./useProjectionRefresh";
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
  ScoredPlayer,
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
  const effectivePoints = useCallback(
    (p: Player): number => (isPlayerLocked(p) ? liveScoreForPlayer(p.id) ?? p.proj : p.proj),
    [isPlayerLocked, liveScoreForPlayer]
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
      return {
        ...player,
        proj: ov.proj ?? player.proj,
        status: ov.status || player.status,
        // Falls back to the live weekly proj (not the static bundled one)
        // when ESPN didn't send a season projection for this player, so it's
        // never less current than proj itself -- just insulated from a
        // single bad/injured week the way proj isn't.
        seasonProj: ov.seasonProj ?? player.seasonProj ?? ov.proj ?? player.proj,
      };
    },
    [projectionOverrides]
  );

  // Positional rank (1 = best projected at the position) across every player in
  // the league plus free agents, computed off post-override projections. Feeds
  // the rank-chart component of playerValue -- see lib/scoring.ts. THIS WEEK's
  // projection only -- see seasonPosRankOf below for the season-stable version
  // qualityScore/rosValue use instead.
  const posRankOf = useMemo(() => {
    const pool = [...ALL_TEAMS.flatMap((t) => t.roster), ...(liveFreeAgents ?? FREE_AGENTS)].map(applyOverrideRaw);
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
  }, [applyOverrideRaw, liveFreeAgents]);

  // Same idea as posRankOf, but ranked by seasonProj instead of this week's
  // proj -- so a player who's Questionable/Doubtful/Out this week (proj
  // collapsed toward 0) doesn't also collapse to the bottom of his position's
  // rank chart, which is what was crushing an actually-elite player's
  // AI-Coach quality score and trade value over a one- or two-week absence.
  const seasonPosRankOf = useMemo(() => {
    const pool = [...ALL_TEAMS.flatMap((t) => t.roster), ...(liveFreeAgents ?? FREE_AGENTS)].map(applyOverrideRaw);
    const groups = new Map<Position, Player[]>();
    pool.forEach((p) => {
      const g = groups.get(p.pos) ?? [];
      g.push(p);
      groups.set(p.pos, g);
    });
    const ranks = new Map<number, number>();
    groups.forEach((list) => {
      list.sort((a, b) => (b.seasonProj ?? b.proj) - (a.seasonProj ?? a.proj)).forEach((p, i) => {
        if (!ranks.has(p.id)) ranks.set(p.id, i + 1);
      });
    });
    return (id: number) => ranks.get(id);
  }, [applyOverrideRaw, liveFreeAgents]);

  // applyOverride now also stamps both positional ranks, so every
  // "effective*" array carries them and playerValue/qualityScore can use the
  // rank chart consistently.
  const applyOverride = useCallback(
    <P extends Player>(player: P): P => ({
      ...applyOverrideRaw(player),
      posRank: posRankOf(player.id),
      seasonPosRank: seasonPosRankOf(player.id),
    }),
    [applyOverrideRaw, posRankOf, seasonPosRankOf]
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

  const availablePlayers = useMemo(() => {
    return effectivePlayers
      .filter((p) => !usedIds.has(p.id))
      .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
  }, [usedIds, posFilter, search, effectivePlayers]);

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

  // The give-side pool every trade-suggestion generator below draws from:
  // everyone at a tradeable position EXCEPT your single best player there
  // (keep your studs, trade from the rest), and not currently Out. Shared by
  // generalSuggestions, twoForTwoFallbackSuggestions, and the "what would it
  // take?" solver so none of them can suggest parting with a player the
  // others would consider untouchable.
  const myMovablePlayers = useMemo(() => {
    const movable: Player[] = [];
    POSITIONS.forEach((pos) => {
      if (!isTradeablePos(pos)) return;
      myNeeds[pos].players.slice(1).forEach((p) => {
        if (p.status !== "Out") movable.push(p);
      });
    });
    return movable;
  }, [myNeeds, isTradeablePos]);

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
      return solveWhatItWouldTake(target, myMovablePlayers, myTradeableDepth, theirNeeds, myNeeds, leagueBaseline, SEASON_PRICER);
    },
    [effectiveLeagueTeams, myMovablePlayers, myTradeableDepth, myNeeds, leagueBaseline]
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
            const options = solveWhatItWouldTake(p, corePool, depthPool, theirNeeds, myNeeds, leagueBaseline, SEASON_PRICER);
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

  const browsableFreeAgents = useMemo(() => {
    return freeAgentPool
      .filter((p) => (faPosFilter === "ALL" ? true : p.pos === faPosFilter))
      .filter((p) => p.name.toLowerCase().includes(faSearch.toLowerCase()))
      .sort((a, b) => b.proj - a.proj);
  }, [freeAgentPool, faPosFilter, faSearch]);

  // ---------- AI Coach: trade suggestion engine ----------
  // Keys of suggestions the user has already seen via "Get new recommendations",
  // so a regenerate swaps in the next-best batch instead of repeating itself.
  const [excludedCoachKeys, setExcludedCoachKeys] = useState<Set<string>>(() => new Set());

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

        const candVal = SEASON_PRICER.value(cand);
        const depthOptions = myNeeds[overlapPos].tradeableDepth;
        if (!depthOptions.length) return;
        const offerPlayer = depthOptions.reduce((best, p) =>
          Math.abs(SEASON_PRICER.value(p) - candVal) < Math.abs(SEASON_PRICER.value(best) - candVal) ? p : best
        );
        const offerVal = SEASON_PRICER.value(offerPlayer);
        // Coarse pre-filter -- balancePackage does the real ratio check.
        const preRatio = fairnessRatio(offerVal, candVal);
        if (preRatio > 1.9 || preRatio < 0.5) return;

        const extraGiveOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => myNeeds[pos].tradeableDepth).filter((p) => p.id !== offerPlayer.id);
        const extraGetOptions: ScoredPlayer[] = POSITIONS.flatMap((pos) => theirNeeds[pos].tradeableDepth).filter((p) => p.id !== cand.id);

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
    const movable = myMovablePlayers;

    movable.forEach((offerPlayer) => {
      const offerVal = SEASON_PRICER.value(offerPlayer);
      const candidates = effectiveAllLeaguePlayers
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
        const theirTeam = effectiveLeagueTeams.find((t) => t.id === cand.fantasyTeamId);
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
          });
        }
      });
    });

    return dedupeSuggestions(found.sort((a, b) => b.upgrade - a.upgrade));
  }, [myNeeds, leagueBaseline, effectiveAllLeaguePlayers, effectiveLeagueTeams, isTradeablePos, myMovablePlayers]);

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
      const giveVal = SEASON_PRICER.value(candidateGive);
      const pool = effectiveAllLeaguePlayers.filter((p) => p.pos === pos && p.status !== "Out" && p.id !== candidateGive.id);
      if (!pool.length) return;
      const closest = pool.reduce((best, p) =>
        Math.abs(SEASON_PRICER.value(p) - giveVal) < Math.abs(SEASON_PRICER.value(best) - giveVal) ? p : best
      );
      const theirTeam = effectiveLeagueTeams.find((t) => t.id === closest.fantasyTeamId);
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
      });
    });
    return found.sort((a, b) => Math.abs(a.ratio - 1) - Math.abs(b.ratio - 1));
  }, [myNeeds, effectiveAllLeaguePlayers, effectiveLeagueTeams, isTradeablePos]);

  // Guaranteed 2-for-2 tier: pair two of your movable pieces with two of an
  // opponent's, priced the same way, so the recommender always has real
  // two-for-two options and never devolves into all 1-for-1s (or all 2-for-1s).
  const twoForTwoFallbackSuggestions = useMemo(() => {
    const found: TradeSuggestion[] = [];
    const myMovable = [...myMovablePlayers].sort((a, b) => SEASON_PRICER.value(b) - SEASON_PRICER.value(a)).slice(0, 6);
    if (myMovable.length < 2) return found;

    const givePairs: Player[][] = [];
    for (let i = 0; i < myMovable.length; i++) {
      for (let j = i + 1; j < myMovable.length; j++) givePairs.push([myMovable[i], myMovable[j]]);
    }

    effectiveLeagueTeams.forEach((team) => {
      const theirNeeds = analyzeRosterNeeds(team.roster);
      const theirActive = team.roster
        .filter((p) => p.status !== "Out" && isTradeablePos(p.pos))
        .sort((a, b) => SEASON_PRICER.value(b) - SEASON_PRICER.value(a))
        .slice(0, 12);
      if (theirActive.length < 2) return;

      let best: { give: Player[]; get: Player[]; giveVal: number; getVal: number; ratio: number } | null = null;
      givePairs.forEach((give) => {
        const giveVal = needAdjustedPackageValue(give, theirNeeds, leagueBaseline, SEASON_PRICER);
        for (let i = 0; i < theirActive.length; i++) {
          for (let j = i + 1; j < theirActive.length; j++) {
            const get = [theirActive[i], theirActive[j]];
            const getVal = needAdjustedPackageValue(get, myNeeds, leagueBaseline, SEASON_PRICER);
            const ratio = getVal / giveVal;
            if (
              ratio >= FAIR_RATIO_MIN &&
              ratio <= FAIR_RATIO_MAX &&
              starGateOk(give, get, SEASON_PRICER) &&
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
  }, [myNeeds, leagueBaseline, effectiveLeagueTeams, isTradeablePos, myMovablePlayers]);

  // Union of every suggestion this pipeline is capable of producing right now,
  // regardless of which ones happen to make the top-N cut. Lets "get new
  // recommendations" know whether a fresh batch actually exists.
  const allCoachCandidateKeys = useMemo(() => {
    const keys = new Set<string>();
    [...needBasedSuggestions, ...generalSuggestions, ...fallbackSuggestions, ...twoForTwoFallbackSuggestions].forEach((s) => keys.add(suggestionKey(s)));
    return keys;
  }, [needBasedSuggestions, generalSuggestions, fallbackSuggestions, twoForTwoFallbackSuggestions]);

  const hasFreshCoachSuggestions = useMemo(
    () => Array.from(allCoachCandidateKeys).some((k) => !excludedCoachKeys.has(k)),
    [allCoachCandidateKeys, excludedCoachKeys]
  );

  const coachSuggestions = useMemo(() => {
    const notExcluded = (s: TradeSuggestion) => !excludedCoachKeys.has(suggestionKey(s));
    const deduped = dedupeSuggestions([...needBasedSuggestions, ...generalSuggestions].filter(notExcluded));
    const priority = (s: TradeSuggestion) => (s.reason === "need" ? 1 : 0);
    const byRank = (a: TradeSuggestion, b: TradeSuggestion) => priority(b) - priority(a) || b.upgrade - a.upgrade;

    const is1x1 = (s: TradeSuggestion) => s.give.length === 1 && s.get.length === 1;
    const is2x2 = (s: TradeSuggestion) => s.give.length === 2 && s.get.length === 2;

    const freshFallback = fallbackSuggestions.filter(notExcluded);
    const freshTwoForTwoFallback = twoForTwoFallbackSuggestions.filter(notExcluded);

    // Smart pools by shape, then the guaranteed fallback pools to top them up.
    const oneForOne = [...deduped.filter(is1x1).sort(byRank), ...freshFallback.filter(is1x1)];
    const twoForTwo = [...deduped.filter(is2x2).sort(byRank), ...freshTwoForTwoFallback];
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
    take([...oneForOne, ...twoForTwo, ...other, ...freshFallback].sort(byRank), COACH_MAX_SUGGESTIONS);

    // If excluding already-seen suggestions leaves the list short, top it off
    // with the best previously-seen ones rather than showing an empty tab --
    // still good, reasonable trades, just not brand new.
    if (combined.length < COACH_MAX_SUGGESTIONS) {
      const everything = [
        ...needBasedSuggestions,
        ...generalSuggestions,
        ...fallbackSuggestions,
        ...twoForTwoFallbackSuggestions,
      ].sort(byRank);
      for (const s of everything) {
        if (combined.length >= COACH_MAX_SUGGESTIONS) break;
        const key = suggestionKey(s);
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        combined.push(s);
      }
    }

    return combined;
  }, [needBasedSuggestions, generalSuggestions, fallbackSuggestions, twoForTwoFallbackSuggestions, excludedCoachKeys]);

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
  // "likely unfair" no matter what the value ratio says. Priced by whichever
  // horizon is active, same as giveVal/getVal above -- a stud who's merely
  // Questionable this week shouldn't lose his "star" status (and the
  // protection that comes with it) in Week mode.
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

    // AI coach
    myNeeds,
    leagueBaseline,
    needyPositions,
    strengthPositions,
    coachSuggestions,
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
    // giveVal/getVal above, usable for any list (e.g. a completed trade's
    // side), not just the interactive tradeGive/tradeGet state.
    tradeSideValue: tradeValue,
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
