import { ChevronRight, Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import { LOPSIDED_RATIO_MIN, LOPSIDED_RATIO_MAX } from "../config/trade";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import type { FantasyApp } from "../hooks/useFantasyApp";
import type { Player, TradeHorizon } from "../types";

const HORIZONS: { id: TradeHorizon; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "season", label: "Rest of season" },
];

export function TradeAnalyzerPage({ app }: { app: FantasyApp }) {
  const {
    tradeHorizon,
    setTradeHorizon,
    effectiveLeagueTeams,
    tradeOpponentId,
    setTradeOpponentId,
    tradeGive,
    setTradeGive,
    tradeGet,
    setTradeGet,
    giveVal,
    getVal,
    diff,
    tradeRatio,
    tradeStarGateViolation,
    playerById,
    tradeValueOf,
    toggleTradeList,
    effectivePlayers,
    effectiveAllLeaguePlayers,
    playerHasNews,
    openPlayerNews,
  } = app;

  const opponent = effectiveLeagueTeams.find((t) => t.id === tradeOpponentId);

  const sides = [
    { label: "You give up", list: tradeGive, setList: setTradeGive, val: giveVal, pool: effectivePlayers },
    {
      label: opponent ? `You receive (from ${opponent.name})` : "You receive",
      list: tradeGet,
      setList: setTradeGet,
      val: getVal,
      pool: opponent ? opponent.roster : effectiveAllLeaguePlayers,
    },
  ] as const;

  return (
    <div className="space-y-4">
      <h2 className="display-font text-xl">Trade analyzer</h2>
      <p className="text-sm text-[#98989D] max-w-2xl">
        Pick the players you'd send and receive. Value is <span className="text-[#C9A227]">points over replacement</span>, run through a convex curve so
        elite tiers outweigh their raw points, and each extra player in a package is discounted.{" "}
        {tradeHorizon === "season"
          ? "Season mode projects it across the remaining 16 games, adjusted for tier trajectory and injury risk."
          : "Week mode prices a single week."}
      </p>

      <div className="inline-flex bg-[#1C1C1E] border border-[#38383A] rounded-lg p-1">
        {HORIZONS.map((h) => (
          <button
            key={h.id}
            onClick={() => setTradeHorizon(h.id)}
            className={`text-xs font-medium px-3 py-1.5 rounded-md ${tradeHorizon === h.id ? "bg-[#C9A227] text-[#000000]" : "text-[#98989D] hover:text-[#FFFFFF]"}`}
          >
            {h.label}
          </button>
        ))}
      </div>

      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
        <div className="text-sm font-medium mb-2.5">Who are you trading with?</div>
        <div className="flex flex-wrap gap-2">
          {effectiveLeagueTeams.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTradeOpponentId(t.id);
                setTradeGet([]);
              }}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                tradeOpponentId === t.id ? "bg-[#C9A227] text-[#000000] border-[#C9A227]" : "border-[#38383A] text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D]"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        {opponent && (
          <div className="text-xs text-[#C9A227]/80 mt-2.5 flex items-center gap-1">
            <ChevronRight size={12} /> "You receive" now pulls from {opponent.name}'s actual roster.
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {sides.map((side) => (
          <div key={side.label} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">{side.label}</h3>
              <span className="mono-font text-[#C9A227]">{side.val.toFixed(1)} val</span>
            </div>
            <div className="space-y-1.5 mb-3 min-h-[40px]">
              {side.list.map((id) => {
                const p = playerById(id);
                if (!p) return null;
                return (
                  <div key={id} className="flex items-center justify-between bg-[#000000] rounded-lg px-2.5 py-1.5">
                    <span className="text-sm flex items-center gap-1">
                      <PlayerNameLink name={p.name} hasNews={playerHasNews(p.id)} onOpen={() => openPlayerNews(p.id)} />
                      <PosBadge pos={p.pos} className="rounded" />
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="mono-font text-xs text-[#C9A227]">{tradeValueOf(p).toFixed(1)}</span>
                      <button onClick={() => toggleTradeList(side.setList, id)} aria-label={`Remove ${p.name}`} className="text-[#98989D] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {side.list.length === 0 && (
                <div className="text-xs text-[#636366] italic py-1">{side.pool.length === 0 ? "Pick a team above to see their roster" : "No players selected yet"}</div>
              )}
            </div>
            <details className="text-sm group">
              <summary className="cursor-pointer text-[#C9A227] hover:text-[#e0b82e] font-medium flex items-center gap-1 select-none">
                <Plus size={14} className="group-open:rotate-45 transition-transform" /> Add a player
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto border border-[#38383A] rounded-lg">
                {(side.pool as Player[])
                  .filter((p) => !side.list.includes(p.id))
                  .sort((a, b) => b.proj - a.proj)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => toggleTradeList(side.setList, p.id)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[#000000] text-left border-b border-[#38383A]/50 last:border-0"
                    >
                      <span className="text-sm">
                        {p.name} <span className="text-[11px] text-[#98989D]">({p.pos}{p.team ? `, ${p.team}` : ""})</span>
                      </span>
                      <span className="mono-font text-xs text-[#C9A227]">{tradeValueOf(p).toFixed(1)}</span>
                    </button>
                  ))}
                {side.pool.filter((p) => !side.list.includes(p.id)).length === 0 && <div className="px-2.5 py-3 text-xs text-[#636366] text-center">No more players to add</div>}
              </div>
            </details>
          </div>
        ))}
      </div>

      {(tradeGive.length > 0 || tradeGet.length > 0) && (() => {
        const favorsYou = !tradeStarGateViolation && tradeRatio != null && tradeRatio > LOPSIDED_RATIO_MAX;
        const favorsThem = tradeStarGateViolation || (tradeRatio != null && tradeRatio < LOPSIDED_RATIO_MIN);
        return (
        <div className={`rounded-xl p-4 border ${favorsYou ? "bg-emerald-500/10 border-emerald-500/30" : favorsThem ? "bg-red-500/10 border-red-500/30" : "bg-[#1C1C1E] border-[#38383A]"}`}>
          <div className="flex items-center gap-3">
            {favorsYou ? <TrendingUp className="text-emerald-400 shrink-0" size={20} /> : favorsThem ? <TrendingDown className="text-red-400 shrink-0" size={20} /> : <ChevronRight className="text-[#C9A227] shrink-0" size={20} />}
            <div>
              <div className="font-medium">
                {tradeStarGateViolation
                  ? "Likely unfair — no star coming back"
                  : favorsYou
                  ? "This trade favors you"
                  : favorsThem
                  ? "This trade favors the other side"
                  : "This trade is roughly even"}
                {tradeRatio != null && <span className="mono-font text-[#C9A227] ml-2">ratio {tradeRatio.toFixed(2)}</span>}
              </div>
              <div className="text-sm text-[#98989D]">
                {tradeStarGateViolation && (
                  <span className="text-amber-400">
                    You're moving a Tier-1 player without getting a Tier-1 or Tier-2 player back — scarcity at the top rarely trades even for role players.{" "}
                  </span>
                )}
                Net value {diff > 0 ? "+" : ""}
                {diff.toFixed(1)} {tradeHorizon === "season" ? "rest-of-season pts" : "this week"} in your favor
                {tradeRatio != null && ` (${Math.abs(Math.round((tradeRatio - 1) * 100))}% ${tradeRatio >= 1 ? "your way" : "their way"})`}.{" "}
                {tradeGet.some((id) => playerById(id)?.status !== "Healthy") && "Heads up: someone you'd receive has an injury flag — factor that into the ask."}
              </div>
            </div>
          </div>
          {(giveVal > 0 || getVal > 0) && (
            <div className="mt-3">
              <div className="flex h-2.5 rounded-full overflow-hidden bg-[#000000]">
                <div className="bg-[#98989D]/70 h-full" style={{ width: `${(giveVal / (giveVal + getVal || 1)) * 100}%` }} />
                <div className="bg-[#C9A227] h-full" style={{ width: `${(getVal / (giveVal + getVal || 1)) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-[#98989D] mt-1 mono-font">
                <span>You give {giveVal.toFixed(1)}</span>
                <span>You get {getVal.toFixed(1)}</span>
              </div>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}
