import { AlertTriangle, RefreshCw, Trophy } from "lucide-react";
import { LEAGUE_CONFIG } from "../config/league";
import { NavTabs } from "./NavTabs";
import type { LeagueTeam, RefreshProgress, TabId } from "../types";

export function AppHeader({
  tab,
  onTabChange,
  rosterTotal,
  teams,
  selectedTeamId,
  onSelectTeam,
  refreshing,
  refreshProgress,
  refreshError,
  lastRefreshed,
  onRefresh,
  currentWeek,
  displayWeek,
  regularSeasonWeeks,
  onSelectWeek,
}: {
  tab: TabId;
  onTabChange: (id: TabId) => void;
  rosterTotal: number;
  teams: LeagueTeam[];
  selectedTeamId: number;
  onSelectTeam: (id: number) => void;
  refreshing: boolean;
  refreshProgress: RefreshProgress | null;
  refreshError: string | null;
  lastRefreshed: string | null;
  onRefresh: () => void;
  /** ESPN's current fantasy scoring period, once the schedule/standings have
   * loaded (see useStandings) -- null until then. */
  currentWeek: number | null;
  /** The week actually being shown right now -- currentWeek unless someone's
   * picked a different one to browse (see useFantasyApp's viewedWeek). */
  displayWeek: number | null;
  /** Last selectable week (regular season only) -- null until the schedule
   * has loaded, in which case this control just doesn't render yet. */
  regularSeasonWeeks: number | null;
  onSelectWeek: (week: number) => void;
}) {
  return (
    <div className="border-b border-[#C9A227]/25 bg-[#1C1C1E]/95 backdrop-blur sticky top-0 z-20 shadow-[0_2px_16px_rgba(0,0,0,0.25)]">
      <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#C9A227] to-[#8a6f1b] flex items-center justify-center shrink-0 shadow-[0_0_0_1px_rgba(201,162,39,0.3)]">
            <Trophy size={19} className="text-[#000000]" />
          </div>
          <div className="min-w-0">
            <div className="display-font text-lg font-semibold leading-none truncate">{LEAGUE_CONFIG.appName}</div>
            <div className="text-[11px] text-[#98989D] mono-font tracking-wide truncate">{LEAGUE_CONFIG.scoringFormatLabel}</div>
          </div>
          {displayWeek != null && regularSeasonWeeks != null && (
            <label
              className="hidden sm:flex items-center bg-[#C9A227]/10 border border-[#C9A227]/30 rounded-full pl-1 pr-2 py-1 shrink-0 focus-within:border-[#C9A227]/60 cursor-pointer"
              title="View a different week's projections (upcoming) or actual scores (past)"
            >
              <select
                value={displayWeek}
                onChange={(e) => onSelectWeek(Number(e.target.value))}
                className="bg-transparent text-[#C9A227] text-[11px] font-semibold mono-font tracking-wide focus:outline-none cursor-pointer"
              >
                {Array.from({ length: regularSeasonWeeks }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w} className="bg-[#1C1C1E] text-[#FFFFFF]">
                    WEEK {w}
                    {w === currentWeek ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 bg-[#000000] border border-[#38383A] rounded-full pl-3 pr-1 py-1 focus-within:border-[#C9A227]/60">
            <span className="hidden md:inline text-[10px] text-[#98989D] mono-font tracking-wide">TEAM</span>
            <select
              value={selectedTeamId}
              onChange={(e) => onSelectTeam(Number(e.target.value))}
              title="Choose which team you're managing"
              className="max-w-[42vw] sm:max-w-[200px] bg-transparent text-xs font-semibold text-[#C9A227] focus:outline-none cursor-pointer pr-1 py-0.5"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#1C1C1E] text-[#FFFFFF]">
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Fetch current projections, lineup, and news/injury feed directly from ESPN"
            className="hover-lift flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-[#38383A] text-[#98989D] hover:text-[#C9A227] hover:border-[#C9A227]/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">
              {refreshing ? (refreshProgress ? `Refreshing ${refreshProgress.done}/${refreshProgress.total}…` : "Refreshing…") : "Refresh from ESPN"}
            </span>
          </button>
          <div className="hidden sm:flex items-center gap-2.5 bg-[#000000] border border-[#38383A] rounded-full pl-4 pr-1.5 py-1.5">
            <span className="text-[11px] text-[#98989D] mono-font tracking-wide">STARTING LINEUP</span>
            <span className="mono-font text-base text-[#C9A227] font-semibold">{rosterTotal.toFixed(1)}</span>
            <span className="text-[10px] text-[#636366] mono-font pr-1.5">PTS</span>
          </div>
        </div>
      </div>
      {(lastRefreshed || refreshError || refreshProgress) && (
        <div className="animate-fade-in max-w-6xl mx-auto px-4 pb-1.5 -mt-1">
          {refreshProgress ? (
            <span className="text-[11px] text-[#98989D]">Pulling current projections from ESPN — step {refreshProgress.done}/{refreshProgress.total}…</span>
          ) : refreshError ? (
            <span className="text-[11px] text-red-400 flex items-center gap-1">
              <AlertTriangle size={11} /> {refreshError}
            </span>
          ) : (
            <span className="text-[11px] text-[#636366]">Projections last refreshed from ESPN {new Date(lastRefreshed!).toLocaleString()}</span>
          )}
        </div>
      )}
      <NavTabs active={tab} onChange={onTabChange} />
    </div>
  );
}
