import { AlertTriangle, ChevronRight, Repeat, Shield, Trophy, Users } from "lucide-react";
import { LEAGUE_CONFIG } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import { statusDot } from "../lib/format";
import type { FantasyApp } from "../hooks/useFantasyApp";
import type { RosterPlayer } from "../types";

export function LeaguePage({ app }: { app: FantasyApp }) {
  const { selectedLeagueTeam, setSelectedLeagueTeam, myTeamViewed, effectiveLeagueTeams, setTradeOpponentId, setTab } = app;

  if (!selectedLeagueTeam) {
    return (
      <div className="space-y-4">
        <h2 className="display-font text-xl">{LEAGUE_CONFIG.leagueName} — all 12 teams</h2>
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
              <div className="font-semibold text-[#C9A227]">{LEAGUE_CONFIG.myTeamName}</div>
              <Trophy size={16} className="text-[#C9A227]" />
            </div>
            <div className="text-xs text-[#98989D] mt-1">{LEAGUE_CONFIG.myOwnerName} (You)</div>
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
          <div className="font-medium truncate">{p.name}</div>
          <div className="text-[#98989D] text-xs">
            {p.team}
            {p.pos !== p.slot && p.slot ? ` · ${p.pos}` : ""}
          </div>
        </div>
      </div>
      {p.status !== "Healthy" && (
        <span className="flex items-center gap-1 text-xs text-amber-400 shrink-0 ml-2">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(p.status)}`} /> {p.status}
        </span>
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
