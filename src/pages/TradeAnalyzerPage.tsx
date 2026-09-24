import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, ShieldAlert, TrendingDown, TrendingUp, X } from "lucide-react";
import { HowItWorks } from "../components/HowItWorks";
import { MarketCheckBadge } from "../components/MarketCheckBadge";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import { SearchInput } from "../components/SearchInput";
import { CompletedTradesPanel } from "../components/CompletedTradesPanel";
import { WhatWouldItTakePanel } from "../components/WhatWouldItTakePanel";
import {
  describeStarGateFailure,
  diagnoseStarGate,
  packageValue,
  ratioLeanAside,
  ratioVerdictLabel,
  SEASON_PRICER,
  WEEK_PRICER,
} from "../lib/tradeEngine";
import { LOPSIDED_RATIO_MIN, LOPSIDED_RATIO_MAX } from "../config/trade";
import type { FantasyApp } from "../hooks/useFantasyApp";
import type { LeaguePlayer, Player, TradeHorizon } from "../types";
import type { WhatWouldItTakeOption } from "../lib/whatWouldItTake";

const HORIZONS: { id: TradeHorizon; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "season", label: "Rest of season" },
];

const SUB_TABS: { id: "build" | "wwit" | "completed"; label: string }[] = [
  { id: "build", label: "Build a trade" },
  { id: "wwit", label: "What would it take?" },
  { id: "completed", label: "Completed trades" },
];

// How often to re-check ESPN for newly completed trades while the
// "Completed trades" sub-tab is actually open -- no push/webhook from ESPN,
// so this is what "updates live" means in practice.
const COMPLETED_TRADES_POLL_MS = 20_000;

function TradeSidePanel({
  label,
  list,
  val,
  pool,
  playerById,
  tradeValueOf,
  toggleTradeList,
  setList,
  playerHasNews,
  openPlayerNews,
  searchPlaceholder,
}: {
  label: string;
  list: number[];
  val: number;
  pool: Player[];
  playerById: (id: number) => Player | undefined;
  tradeValueOf: (p: Player) => number;
  toggleTradeList: (setter: (fn: (prev: number[]) => number[]) => void, id: number) => void;
  setList: (fn: (prev: number[]) => number[]) => void;
  playerHasNews: (id: number) => boolean;
  openPlayerNews: (id: number) => void;
  searchPlaceholder: string;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const available = useMemo(() => {
    return pool
      .filter((p) => !list.includes(p.id))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q) ||
          p.pos.toLowerCase() === q
      )
      .sort((a, b) => b.proj - a.proj);
  }, [pool, list, q]);

  return (
    <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">{label}</h3>
        <span className="mono-font text-[#C9A227]">{val.toFixed(1)} val</span>
      </div>
      <div className="space-y-1.5 mb-3 min-h-[40px]">
        {list.map((id) => {
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
                <button
                  onClick={() => toggleTradeList(setList, id)}
                  aria-label={`Remove ${p.name}`}
                  className="text-[#98989D] hover:text-red-400 hover:bg-red-500/10 rounded p-0.5"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="text-xs text-[#636366] italic py-1">
            {pool.length === 0 ? "Pick a team above to see their roster" : "No players selected yet"}
          </div>
        )}
      </div>
      <details className="text-sm group">
        <summary className="cursor-pointer text-[#C9A227] hover:text-[#e0b82e] font-medium flex items-center gap-1 select-none">
          <Plus size={14} className="group-open:rotate-45 transition-transform" /> Add a player
        </summary>
        <div className="mt-2 space-y-2">
          <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} />
          <div className="max-h-48 overflow-y-auto border border-[#38383A] rounded-lg">
            {available.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  toggleTradeList(setList, p.id);
                  setSearch("");
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[#000000] text-left border-b border-[#38383A]/50 last:border-0"
              >
                <span className="text-sm">
                  {p.name}{" "}
                  <span className="text-[11px] text-[#98989D]">
                    ({p.pos}
                    {p.team ? `, ${p.team}` : ""})
                  </span>
                </span>
                <span className="mono-font text-xs text-[#C9A227]">{tradeValueOf(p).toFixed(1)}</span>
              </button>
            ))}
            {available.length === 0 && (
              <div className="px-2.5 py-3 text-xs text-[#636366] text-center">
                {pool.filter((p) => !list.includes(p.id)).length === 0
                  ? "No more players to add"
                  : q
                    ? `No players match "${search.trim()}"`
                    : "No more players to add"}
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

export function TradeAnalyzerPage({ app }: { app: FantasyApp }) {
  const {
    tradeHorizon,
    setTradeHorizon,
    tradeNeedAdjust,
    setTradeNeedAdjust,
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
    playerById,
    tradeValueOf,
    toggleTradeList,
    effectivePlayers,
    effectiveAllLeaguePlayers,
    playerHasNews,
    openPlayerNews,
    completedEspnTrades,
    refreshCompletedTrades,
    allTeams,
    findWhatItWouldTake,
    wwitTargetId,
    setWwitTargetId,
  } = app;

  // Defaults to the "What would it take?" sub-tab, already on the right
  // player, when we got here via openWhatWouldItTake (e.g. clicking a player
  // in the AI Coach's "Players to trade for" list) -- this page fully
  // remounts on every tab switch (see the `key={app.tab}` in App.tsx), so a
  // plain initializer is enough; no effect needed to catch a later change.
  const [subTab, setSubTab] = useState<"build" | "wwit" | "completed">(wwitTargetId != null ? "wwit" : "build");
  const [loadingCompleted, setLoadingCompleted] = useState(false);

  // Completed trades are only ever fetched once this sub-tab is actually
  // open -- not on page load, not from the global "Refresh from ESPN"
  // button. While it's open, poll so a trade completed elsewhere shows up
  // here without the user having to do anything.
  useEffect(() => {
    if (subTab !== "completed") return;
    let cancelled = false;
    const run = async () => {
      setLoadingCompleted(true);
      await refreshCompletedTrades();
      if (!cancelled) setLoadingCompleted(false);
    };
    run();
    const interval = setInterval(run, COMPLETED_TRADES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [subTab, refreshCompletedTrades]);

  const opponent = effectiveLeagueTeams.find((t) => t.id === tradeOpponentId);

  const loadWwitPackage = (target: LeaguePlayer, option: WhatWouldItTakeOption) => {
    setTradeOpponentId(target.fantasyTeamId);
    setTradeGive(option.give.map((p) => p.id));
    setTradeGet([target.id]);
    setTradeHorizon("season");
    setTradeNeedAdjust(true);
    setSubTab("build");
  };

  const completedSideValue = (ids: number[]) => {
    const players = ids.map(playerById).filter((p): p is Player => !!p);
    return packageValue(players, SEASON_PRICER);
  };

  return (
    <div className="space-y-4">
      <h2 className="display-font text-xl">Trade analyzer</h2>

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

      {subTab === "completed" ? (
        <div key="completed" className="space-y-2.5 animate-fade-slide-up">
          <p className="text-sm text-[#98989D] max-w-2xl">
            Every trade completed in the league so far, graded for both sides -- regardless of who made it. Graded on rest-of-season quality (same basis as
            Sensei / AI Coach), reconstructed from public ESPN data, and re-checked while this tab is open.
          </p>
          {loadingCompleted && completedEspnTrades.length === 0 && <div className="text-xs text-[#636366] italic">Checking ESPN for completed trades…</div>}
          {!loadingCompleted && completedEspnTrades.length === 0 && (
            <div className="text-xs text-[#636366] italic">No completed trades found yet.</div>
          )}
          <CompletedTradesPanel
            trades={completedEspnTrades}
            allTeams={allTeams}
            playerById={playerById}
            tradeSideValue={completedSideValue}
            pricer={SEASON_PRICER}
          />
        </div>
      ) : subTab === "wwit" ? (
        <div key="wwit" className="animate-fade-slide-up">
          <WhatWouldItTakePanel
            players={effectiveAllLeaguePlayers}
            findWhatItWouldTake={findWhatItWouldTake}
            playerHasNews={playerHasNews}
            openPlayerNews={openPlayerNews}
            onLoadPackage={loadWwitPackage}
            targetId={wwitTargetId}
            setTargetId={setWwitTargetId}
          />
        </div>
      ) : (
        <div key="build" className="space-y-4 animate-fade-slide-up">
        <div>
          <p className="text-sm text-[#98989D] max-w-2xl">Pick the players you'd send and receive to see who comes out ahead.</p>
          <div className="mt-1">
            <HowItWorks summary="How trades are valued">
              <p>
                {tradeHorizon === "season"
                  ? "Rest of season: each player's season quality (ESPN + Sleeper ROS PPG, actuals, FantasyCalc/Vegas market) × remaining games (bye excluded), with a small schedule-ease nudge. Optional need-adjusted mode matches the AI Coach."
                  : "This week: each player's value for this week only, from consensus projections (ESPN, Sleeper, and DraftKings yardage props when posted)."}{" "}
                Elite players are worth more than their raw points suggest, and each extra player in a package is discounted — you can't out-total a stud
                with role players. Side totals therefore often won't equal the sum of the chips.
              </p>
              <p>
                The market badge is FantasyCalc alone (real redraft trades). It can disagree with the app's ratio — that's intentional; managers often see the
                deal differently. The star gate is separate from the points ratio: sending a top-rank stud without a Tier-1/2 (and enough top-piece value)
                back fails even if the package math says you "win."
              </p>
            </HowItWorks>
          </div>
        </div>

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

        {tradeHorizon === "season" && (
          <label className="flex items-center gap-2 text-xs text-[#98989D] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={tradeNeedAdjust}
              onChange={(e) => setTradeNeedAdjust(e.target.checked)}
              disabled={tradeOpponentId == null}
              className="rounded border-[#38383A]"
            />
            Need-adjusted values
            {tradeOpponentId == null ? (
              <span className="text-[#636366]">(pick an opponent first)</span>
            ) : (
              <span className="text-[#636366]">— same as AI Coach / Sensei</span>
            )}
          </label>
        )}

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
          <TradeSidePanel
            label="You give up"
            list={tradeGive}
            setList={setTradeGive}
            val={giveVal}
            pool={effectivePlayers}
            playerById={playerById}
            tradeValueOf={tradeValueOf}
            toggleTradeList={toggleTradeList}
            playerHasNews={playerHasNews}
            openPlayerNews={openPlayerNews}
            searchPlaceholder="Search your roster…"
          />
          <TradeSidePanel
            key={tradeOpponentId ?? "all"}
            label={opponent ? `You receive (from ${opponent.name})` : "You receive"}
            list={tradeGet}
            setList={setTradeGet}
            val={getVal}
            pool={opponent ? opponent.roster : effectiveAllLeaguePlayers}
            playerById={playerById}
            tradeValueOf={tradeValueOf}
            toggleTradeList={toggleTradeList}
            playerHasNews={playerHasNews}
            openPlayerNews={openPlayerNews}
            searchPlaceholder={opponent ? `Search ${opponent.name}'s roster…` : "Search league players…"}
          />
        </div>

        {(tradeGive.length > 0 || tradeGet.length > 0) && (() => {
          const givePlayers = tradeGive.map(playerById).filter((p): p is Player => !!p);
          const getPlayers = tradeGet.map(playerById).filter((p): p is Player => !!p);
          const pricer = tradeHorizon === "season" ? SEASON_PRICER : WEEK_PRICER;
          const gate = diagnoseStarGate(givePlayers, getPlayers, pricer);
          const valueVerdict = tradeRatio != null ? ratioVerdictLabel(tradeRatio) : null;
          const favorsYou = gate.ok && tradeRatio != null && tradeRatio > LOPSIDED_RATIO_MAX;
          const favorsThem = gate.ok && tradeRatio != null && tradeRatio < LOPSIDED_RATIO_MIN;
          const cardClass = !gate.ok
            ? "bg-amber-500/10 border-amber-500/30"
            : favorsYou
              ? "bg-emerald-500/10 border-emerald-500/30"
              : favorsThem
                ? "bg-red-500/10 border-red-500/30"
                : "bg-[#1C1C1E] border-[#38383A]";
          const Icon = !gate.ok ? ShieldAlert : favorsYou ? TrendingUp : favorsThem ? TrendingDown : ChevronRight;
          const iconClass = !gate.ok
            ? "text-amber-400"
            : favorsYou
              ? "text-emerald-400"
              : favorsThem
                ? "text-red-400"
                : "text-[#C9A227]";
          return (
          <div className={`rounded-xl p-4 border ${cardClass}`}>
            <div className="flex items-center gap-3">
              <Icon className={`${iconClass} shrink-0`} size={20} />
              <div className="min-w-0">
                <div className="font-medium">
                  {!gate.ok ? "Likely unfair — star gate" : valueVerdict?.label ?? "—"}
                  {tradeRatio != null && <span className="mono-font text-[#C9A227] ml-2">ratio {tradeRatio.toFixed(2)}</span>}
                </div>
                <div className="mt-1">
                  <MarketCheckBadge give={givePlayers} get={getPlayers} appRatio={tradeRatio} />
                </div>
                <div className="text-sm text-[#98989D] space-y-1 mt-1">
                  {!gate.ok &&
                    gate.failures.map((f, i) => (
                      <p key={i} className="text-amber-400">
                        {describeStarGateFailure(f)}
                      </p>
                    ))}
                  {!gate.ok && tradeRatio != null && (
                    <p>
                      Gate fails independently of the points math — {ratioLeanAside(tradeRatio)}.
                    </p>
                  )}
                  {gate.ok && (
                    <p>
                      Net value {diff > 0 ? "+" : ""}
                      {diff.toFixed(1)} {tradeHorizon === "season" ? "rest-of-season pts" : "this week"} in your favor
                      {tradeRatio != null && ` (${Math.abs(Math.round((tradeRatio - 1) * 100))}% ${tradeRatio >= 1 ? "your way" : "their way"})`}.
                    </p>
                  )}
                  {(givePlayers.length > 1 || getPlayers.length > 1) && (
                    <p className="text-[11px] text-[#636366]">
                      Package totals discount extra pieces (best counts full) — chip values won't sum to the side total.
                    </p>
                  )}
                  {tradeGet.some((id) => playerById(id)?.status !== "Healthy") && (
                    <p>Heads up: someone you'd receive has an injury flag — factor that into the ask.</p>
                  )}
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
      )}
    </div>
  );
}
