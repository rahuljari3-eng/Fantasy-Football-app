import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";
import { SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import { LEAGUE_CONFIG } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import { StatusIndicator } from "../components/StatusIndicator";
import { AddPlayerActions } from "../components/AddPlayerActions";
import type { FantasyApp } from "../hooks/useFantasyApp";

const POSITION_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "DST", "K"] as const;

export function RosterBuilderPage({ app }: { app: FantasyApp }) {
  const {
    roster,
    bench,
    playerById,
    dragOverTarget,
    handleDragStart,
    moveToBench,
    removeFromSlot,
    quickStart,
    removeFromBench,
    availablePlayers,
    posFilter,
    setPosFilter,
    search,
    setSearch,
    addToSlot,
    addToBench,
    filledCount,
    selectedTeam,
  } = app;

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-5 -mb-2 bg-[#C9A227]/10 border border-[#C9A227]/40 rounded-lg px-3 py-2.5 text-xs text-[#C9A227] flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>
          Managing <strong className="font-semibold">{selectedTeam.name}</strong> ({selectedTeam.owner}) — real roster from {LEAGUE_CONFIG.leagueName}, ESPN #
          {LEAGUE_CONFIG.espnLeagueId}. Switch teams from the picker in the header.
        </span>
      </div>

      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="display-font text-xl">Your roster</h2>
          <span className="text-xs mono-font text-[#98989D]">
            {filledCount}/{SLOTS.length} starters · {bench.length} bench
          </span>
        </div>

        <div className="space-y-1.5">
          {SLOTS.map((slot) => {
            const id = roster[slot];
            const p = id != null ? playerById(id) : null;
            const isDragOver = dragOverTarget === slot;
            return (
              <div
                key={slot}
                data-drop-slot={slot}
                className={`flex items-center gap-2 border rounded-xl pl-2.5 pr-3 py-2 ${
                  isDragOver
                    ? "bg-[#C9A227]/15 border-[#C9A227] border-dashed"
                    : p
                    ? "bg-[#1C1C1E] border-[#38383A]"
                    : "bg-[#1C1C1E]/40 border-[#38383A]/60 border-dashed"
                }`}
              >
                <div className="w-11 shrink-0 mono-font text-[11px] text-[#C9A227] font-semibold pointer-events-none">{slot}</div>
                {p ? (
                  <div className="flex-1 flex items-center justify-between min-w-0 gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                        <PosBadge pos={p.pos} className="rounded" />
                        <span>
                          {p.team} · bye {p.bye}
                        </span>
                        <StatusIndicator status={p.status} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                      <button onClick={() => moveToBench(p)} aria-label={`Move ${p.name} to bench`} title="Move to bench" className="text-[#636366] hover:text-[#C9A227] hover:bg-[#C9A227]/10 rounded p-0.5">
                        <ArrowDownToLine size={14} />
                      </button>
                      <button onClick={() => removeFromSlot(slot)} aria-label={`Remove ${p.name}`} className="text-[#636366] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 text-sm text-[#636366] italic">Drag a {SLOT_ELIGIBILITY[slot].join("/")} here</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-2">
          <div className="text-xs text-[#98989D] mb-1.5 mono-font">BENCH</div>
          <div
            data-drop-slot="bench"
            className={`space-y-1.5 rounded-lg p-1.5 border transition-colors ${
              dragOverTarget === "bench" ? "bg-[#C9A227]/15 border-[#C9A227] border-dashed" : "border-transparent"
            }`}
          >
            {bench.map((id) => {
              const p = playerById(id);
              if (!p) return null;
              return (
                <div
                  key={id}
                  onPointerDown={(e) => handleDragStart(e, p)}
                  className="flex items-center justify-between bg-[#1C1C1E]/60 border border-[#38383A]/60 rounded-lg px-3 py-1.5 cursor-grab active:cursor-grabbing touch-none"
                >
                  <div className="text-sm pointer-events-none">
                    {p.name} <PosBadge pos={p.pos} className="ml-1 rounded" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => quickStart(p)} aria-label={`Move ${p.name} to starting lineup`} title="Move to starting lineup" className="text-[#636366] hover:text-[#C9A227] hover:bg-[#C9A227]/10 rounded p-0.5">
                      <ArrowUpFromLine size={14} />
                    </button>
                    <button onClick={() => removeFromBench(id)} aria-label={`Remove ${p.name} from bench`} className="text-[#98989D] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {bench.length === 0 && <div className="text-sm text-[#636366] italic px-1.5 pointer-events-none">Drag players here for your bench</div>}
          </div>
        </div>
      </div>

      <div className="lg:col-span-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="display-font text-xl">Player pool</h2>
            <p className="text-xs text-[#98989D]">Drag a player onto a starting slot or the bench.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players…"
              className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-[#C9A227] placeholder:text-[#636366]"
            />
            <select
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value as typeof posFilter)}
              className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#C9A227]"
            >
              {POSITION_FILTERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="border border-[#38383A] rounded-xl overflow-hidden max-h-[560px] overflow-y-auto">
          {availablePlayers.map((p) => (
            <div
              key={p.id}
              onPointerDown={(e) => handleDragStart(e, p)}
              className="flex items-center justify-between px-3 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E] cursor-grab active:cursor-grabbing touch-none"
            >
              <div className="flex items-center gap-3 min-w-0 pointer-events-none">
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
          {availablePlayers.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-sm text-[#98989D]">No players match "{search || posFilter}"</div>
              <button
                onClick={() => {
                  setSearch("");
                  setPosFilter("ALL");
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
