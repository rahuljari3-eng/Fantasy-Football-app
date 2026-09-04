import { Activity, AlertTriangle } from "lucide-react";
import { SLOTS } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import { statusColor } from "../lib/format";
import type { FantasyApp } from "../hooks/useFantasyApp";

export function LineupPage({ app }: { app: FantasyApp }) {
  const { roster, playerById, rosterTotal, autoOptimize, playerHasNews, openPlayerNews } = app;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="display-font text-xl">Optimal starting lineup</h2>
          <p className="text-sm text-[#98989D]">Best available lineup by projected points, auto-benching anyone ruled Out.</p>
        </div>
        <button
          onClick={autoOptimize}
          className="flex items-center gap-2 bg-[#C9A227] text-[#000000] font-semibold px-4 py-2 rounded-lg hover:bg-[#e0b82e] text-sm"
        >
          <Activity size={15} /> Auto-optimize from full pool
        </button>
      </div>

      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#38383A]">
          <span className="text-sm text-[#98989D]">Projected total</span>
          <span className="mono-font text-2xl text-[#C9A227] font-semibold">{rosterTotal.toFixed(1)} pts</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {SLOTS.map((slot) => {
            const id = roster[slot];
            const p = id != null ? playerById(id) : null;
            return (
              <div key={slot} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${p ? "bg-[#000000] border-[#38383A]/60" : "bg-[#000000]/40 border-[#38383A]/40 border-dashed"}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="mono-font text-[11px] text-[#C9A227] w-9 shrink-0">{slot}</span>
                  {p ? (
                    <>
                      <PosBadge pos={p.pos} className="shrink-0" />
                      <div className="min-w-0">
                        <PlayerNameLink
                          name={p.name}
                          hasNews={playerHasNews(p.id)}
                          onOpen={() => openPlayerNews(p.id)}
                          className="text-sm truncate"
                        />
                        {p.status !== "Healthy" && (
                          playerHasNews(p.id) ? (
                            <button
                              type="button"
                              onClick={() => openPlayerNews(p.id)}
                              title="View related news"
                              className={`text-[11px] flex items-center gap-1 hover:underline decoration-dotted underline-offset-2 ${statusColor(p.status)}`}
                            >
                              <AlertTriangle size={10} /> {p.status}
                            </button>
                          ) : (
                            <div className={`text-[11px] flex items-center gap-1 ${statusColor(p.status)}`}>
                              <AlertTriangle size={10} /> {p.status}
                            </div>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-sm text-[#636366] italic">Empty</span>
                  )}
                </div>
                {p && <span className="mono-font text-sm text-[#C9A227] font-medium shrink-0">{p.proj}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-[#636366]">
        Note: "Auto-optimize" pulls the best players from the entire pool by projection — use it to see the theoretical ceiling, then build toward it from waivers and trades. It doesn't require your saved roster.
      </p>
    </div>
  );
}
