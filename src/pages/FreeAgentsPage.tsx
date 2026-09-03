import { Plus } from "lucide-react";
import { POSITIONS } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import { StatusIndicator } from "../components/StatusIndicator";
import { AddPlayerActions } from "../components/AddPlayerActions";
import type { FantasyApp } from "../hooks/useFantasyApp";

export function FreeAgentsPage({ app }: { app: FantasyApp }) {
  const {
    recommendedPickups,
    bestAvailableOverall,
    freeAgentPool,
    faSearch,
    setFaSearch,
    faPosFilter,
    setFaPosFilter,
    browsableFreeAgents,
    roster,
    addToSlot,
    addToBench,
  } = app;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Recommended pickups</h2>
        <p className="text-xs text-[#98989D]">
          Ranked against your actual roster needs vs. the league-average starter at each position — not just a raw projection list.
        </p>
      </div>

      {recommendedPickups.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-4">
          {recommendedPickups.map((group) => (
            <div key={group.pos} className="border border-[#38383A] rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 bg-[#C9A227]/10 border-b border-[#C9A227]/30">
                <div className="flex items-center gap-2">
                  <PosBadge pos={group.pos} />
                  <span className="text-sm font-medium">Need at {group.pos}</span>
                </div>
                <div className="text-[11px] text-[#98989D] mt-1">{group.reason}</div>
              </div>
              <div>
                {group.candidates.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E]">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                        <span>
                          {p.team} · bye {p.bye}
                        </span>
                        <StatusIndicator status={p.status} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                      <AddPlayerActions player={p} roster={roster} onAddToSlot={addToSlot} onAddToBench={addToBench} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-[#38383A] rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[#1C1C1E] border-b border-[#38383A]">
            <div className="text-sm font-medium">No glaring needs right now — here's the best available overall</div>
            <div className="text-[11px] text-[#98989D] mt-0.5">
              Every starting position is at or above the league-average starter, so these are just the strongest free agents on the wire.
            </div>
          </div>
          {bestAvailableOverall.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E]">
              <div className="flex items-center gap-3 min-w-0">
                <PosBadge pos={p.pos} className="w-10 text-center shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-[#98989D]">
                    {p.team} · bye {p.bye}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                <button
                  onClick={() => addToBench(p)}
                  className="text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D] border border-[#38383A] rounded-md p-1"
                  title="Add to bench"
                  aria-label={`Add ${p.name} to bench`}
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-1">Browse all free agents</h2>
        <p className="text-xs text-[#98989D] mb-3">Every player currently on no roster in your league — {freeAgentPool.length} available.</p>
        <div className="flex items-center gap-2 mb-3">
          <input
            value={faSearch}
            onChange={(e) => setFaSearch(e.target.value)}
            placeholder="Search players…"
            className="flex-1 bg-[#1C1C1E] border border-[#38383A] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#C9A227]/60"
          />
          <select
            value={faPosFilter}
            onChange={(e) => setFaPosFilter(e.target.value as typeof faPosFilter)}
            className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#C9A227]/60"
          >
            {["ALL", ...POSITIONS].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="border border-[#38383A] rounded-xl overflow-hidden max-h-[480px] overflow-y-auto">
          {browsableFreeAgents.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E]">
              <div className="flex items-center gap-3 min-w-0">
                <PosBadge pos={p.pos} className="w-10 text-center shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                    <span>
                      {p.team} · bye {p.bye}
                    </span>
                    <StatusIndicator status={p.status} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                <AddPlayerActions player={p} roster={roster} onAddToSlot={addToSlot} onAddToBench={addToBench} />
              </div>
            </div>
          ))}
          {browsableFreeAgents.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-sm text-[#98989D]">No free agents match "{faSearch || faPosFilter}"</div>
              <button
                onClick={() => {
                  setFaSearch("");
                  setFaPosFilter("ALL");
                }}
                className="mt-2 text-xs text-[#C9A227] hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
