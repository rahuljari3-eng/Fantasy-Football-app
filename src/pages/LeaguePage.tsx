import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Repeat, Shield, Trophy, Users } from "lucide-react";
import { LEAGUE_CONFIG } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import { StandingsPanel } from "../components/StandingsPanel";
import { PlayoffRacePanel } from "../components/PlayoffRacePanel";
import { statusDot } from "../lib/format";
import type { FantasyApp } from "../hooks/useFantasyApp";
import type { RosterPlayer } from "../types";

const SUB_TABS: { id: "teams" | "standings" | "playoffs"; label: string }[] = [
  { id: "teams", label: "Teams" },
  { id: "standings", label: "Standings" },
  { id: "playoffs", label: "Playoff race" },
];

// No push/webhook from ESPN, so this is what "updates live" means while a
// standings-backed sub-tab is open -- same idea as the Trade Analyzer's
// Completed Trades poll.
const STANDINGS_POLL_MS = 30_000;

export function LeaguePage({ app }: { app: FantasyApp }) {
  const {
    selectedLeagueTeam,
    setSelectedLeagueTeam,
    myTeamViewed,
    selectedTeam,
    selectedTeamId,
    allTeams,
    effectiveLeagueTeams,
    setTradeOpponentId,
    setTab,
    playerHasNews,
    openPlayerNews,
    leagueSchedule,
    standingsRefreshing,
    standingsError,
    refreshStandings,
    playoffOutlook,
  } = app;

  const [subTab, setSubTab] = useState<"teams" | "standings" | "playoffs">("teams");

  // Standings/schedule are only ever fetched once one of these sub-tabs is
  // actually open -- not on page load, not from the global "Refresh from
  // ESPN" button -- then polled while open so live scoring shows up here.
  useEffect(() => {
    if (subTab === "teams") return;
    refreshStandings();
    const interval = setInterval(refreshStandings, STANDINGS_POLL_MS);
    return () => clearInterval(interval);
  }, [subTab, refreshStandings]);

  const subTabBar = (
    <div className="inline-flex bg-[#1C1C1E] border border-[#38383A] rounded-lg p-1">
      {SUB_TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setSubTab(t.id)}
          className={`text-xs font-medium px-3 py-1.5 rounded-md ${subTab === t.id ? "bg-[#C9A227] text-[#000000]" : "text-[#98989D] hover:text-[#FFFFFF]"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (!selectedLeagueTeam && subTab !== "teams") {
    const outlookByTeam = new Map((playoffOutlook ?? []).map((o) => [o.teamId, o]));
    const teamsById = new Map(allTeams.map((t) => [t.id, t]));
    return (
      <div className="space-y-4">
        <h2 className="display-font text-xl">{LEAGUE_CONFIG.leagueName} {subTab === "standings" ? "— standings" : "— playoff race"}</h2>
        {subTabBar}
        {standingsError && <div className="text-xs text-red-400">{standingsError}</div>}
        {!leagueSchedule && standingsRefreshing && <div className="text-xs text-[#636366] italic">Pulling standings from ESPN…</div>}
        {leagueSchedule && (
          <>
            <p className="text-sm text-[#98989D] max-w-2xl">
              Week {Math.min(leagueSchedule.currentWeek, leagueSchedule.regularSeasonWeeks)} of {leagueSchedule.regularSeasonWeeks} regular-season weeks · top{" "}
              {leagueSchedule.playoffTeamCount} make the playoffs. Odds come from simulating the rest of the season thousands of times using each team's
              record so far and their projected weekly scoring.
            </p>
            {subTab === "standings" ? (
              <StandingsPanel
                standings={leagueSchedule.standings}
                outlookByTeam={outlookByTeam}
                myTeamId={selectedTeamId}
                playoffTeamCount={leagueSchedule.playoffTeamCount}
              />
            ) : (
              <PlayoffRacePanel outlooks={playoffOutlook ?? []} teamsById={teamsById} myTeamId={selectedTeamId} />
            )}
          </>
        )}
      </div>
    );
  }

  if (!selectedLeagueTeam) {
    return (
      <div className="space-y-4">
        <h2 className="display-font text-xl">{LEAGUE_CONFIG.leagueName} — all 12 teams</h2>
        {subTabBar}
        <p className="text-sm text-[#98989D] max-w-2xl">
          Real rosters pulled from your ESPN league (#{LEAGUE_CONFIG.espnLeagueId}). Tap a team to see their full roster — handy for scouting trade targets
          before you head to the Trade Analyzer.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            onClick={() => setSelectedLeagueTeam(myTeamViewed)}
            className="text-left bg-[#2C2C2E] border border-[#C9A227]/50 rounded-xl p-4 hover:border-[#C9A227] hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-[#C9A227]">{selectedTeam.name}</div>
              <Trophy size={16} className="text-[#C9A227]" />
            </div>
            <div className="text-xs text-[#98989D] mt-1">{selectedTeam.owner} (You)</div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
              <span className="text-xs text-[#98989D]">{myTeamViewed.roster.length} players</span>
              <ChevronRight size={14} className="text-[#C9A227]" />
            </div>
          </button>
          {effectiveLeagueTeams.map((t) => {
            const flagged = t.roster.filter((p) => p.status !== "Healthy").length;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedLeagueTeam(t)}
                className="text-left bg-[#1C1C1E] border border-white/10 rounded-xl p-4 hover:border-[#C9A227]/60 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
              >
                <div className="font-semibold truncate">{t.name}</div>
                <div className="text-xs text-[#98989D] mt-1 truncate">{t.owner}</div>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                  <span className="text-xs text-[#98989D]">
                    {t.roster.length} players{flagged > 0 && <span className="text-amber-400"> · {flagged} flagged</span>}
                  </span>
                  <ChevronRight size={14} className="text-[#98989D]" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const starters = selectedLeagueTeam.roster.filter((p) => p.starter);
  const bench = selectedLeagueTeam.roster.filter((p) => !p.starter && p.slot !== "IR");
  const ir = selectedLeagueTeam.roster.filter((p) => p.slot === "IR");

  const renderCard = (p: RosterPlayer) => (
    <div key={p.id} className="flex items-center justify-between bg-[#2C2C2E] border border-white/10 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <PosBadge pos={p.pos} label={p.slot || p.pos} className="shrink-0 w-11 text-center" />
        <div className="min-w-0">
          <PlayerNameLink name={p.name} hasNews={playerHasNews(p.id)} onOpen={() => openPlayerNews(p.id)} className="font-medium truncate" />
          <div className="text-[#98989D] text-xs">
            {p.team}
            {p.pos !== p.slot && p.slot ? ` · ${p.pos}` : ""}
          </div>
        </div>
      </div>
      {p.status !== "Healthy" && (
        playerHasNews(p.id) ? (
          <button
            type="button"
            onClick={() => openPlayerNews(p.id)}
            title="View related news"
            className="flex items-center gap-1 text-xs text-amber-400 shrink-0 ml-2 hover:underline decoration-dotted underline-offset-2"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} /> {p.status}
          </button>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400 shrink-0 ml-2">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} /> {p.status}
          </span>
        )
      )}
    </div>
  );

  return (
    <div>
      <button onClick={() => setSelectedLeagueTeam(null)} className="text-sm text-[#C9A227] hover:text-[#e0b82e] mb-3 flex items-center gap-1">
        <ChevronRight size={14} className="rotate-180" /> Back to all teams
      </button>
      <div className="bg-[#1C1C1E] border border-white/10 rounded-xl p-4 mb-4 flex items-center justify-between">
        <div>
          <div className="font-semibold text-lg">{selectedLeagueTeam.name}</div>
          <div className="text-sm text-[#98989D]">{selectedLeagueTeam.owner}</div>
        </div>
        <div className="text-xs text-[#98989D] mono-font hidden sm:block">{selectedLeagueTeam.roster.length} players</div>
      </div>
      <div className="space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-[#98989D] mb-2 flex items-center gap-1.5">
            <Shield size={12} /> Starters ({starters.length})
          </div>
          <div className="grid sm:grid-cols-2 gap-2">{starters.map(renderCard)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-[#98989D] mb-2 flex items-center gap-1.5">
            <Users size={12} /> Bench ({bench.length})
          </div>
          <div className="grid sm:grid-cols-2 gap-2">{bench.map(renderCard)}</div>
        </div>
        {ir.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-[#98989D] mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> IR ({ir.length})
            </div>
            <div className="grid sm:grid-cols-2 gap-2">{ir.map(renderCard)}</div>
          </div>
        )}
      </div>
      {selectedLeagueTeam.id !== "mine" && (
        <button
          onClick={() => {
            setTradeOpponentId(selectedLeagueTeam.id as number);
            setTab("trade");
          }}
          className="mt-4 bg-[#C9A227] text-[#000000] font-semibold rounded-lg px-4 py-2 text-sm hover:bg-[#e0b82e] flex items-center gap-1.5"
        >
          <Repeat size={14} /> Propose a trade with this team
        </button>
      )}
    </div>
  );
}
