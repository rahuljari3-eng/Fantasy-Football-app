import type { ReactNode } from "react";
import { AlertTriangle, ArrowRightLeft, Bookmark, BookmarkCheck, Copy, EyeOff, Repeat, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import { POSITIONS } from "../config/league";
import { suggestionKey } from "../lib/coachTrades";
import { LOPSIDED_RATIO_MIN, LOPSIDED_RATIO_MAX, FAIR_RATIO_MIN, FAIR_RATIO_MAX } from "../config/trade";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import { HowItWorks } from "../components/HowItWorks";
import { MarketCheckBadge } from "../components/MarketCheckBadge";
import { StatusIndicator } from "../components/StatusIndicator";
import type { FantasyApp } from "../hooks/useFantasyApp";
import type { TradeSuggestion } from "../types";

/** One line on why the other manager would (or wouldn't) take this -- straight
 * from evaluateTradeFit's before/after depth charts. */
function fitSummary(s: TradeSuggestion): { text: string; className: string } {
  const { theirNeedsHelped, theirGain, myNeedsHelped } = s.fit;
  const yours = myNeedsHelped.length ? `Upgrades your ${myNeedsHelped.join("/")}` : "Doesn't fill one of your needs";
  if (theirNeedsHelped.length) {
    const cost = theirGain < 0 ? " (at the cost of some depth elsewhere)" : "";
    return {
      text: `${yours}; fills ${s.teamName}'s ${theirNeedsHelped.join("/")} need too${cost}, so they have a real reason to say yes.`,
      className: "text-emerald-400",
    };
  }
  if (theirGain > 0) return { text: `${yours}; ${s.teamName}'s starting lineup also gets a bit better.`, className: "text-[#98989D]" };
  return { text: `${yours}, but it weakens ${s.teamName}'s starting lineup — a harder sell.`, className: "text-amber-400" };
}

/** Turn a get/give value ratio into a short verdict + a tailwind text color. */
function ratioVerdict(ratio: number): { label: string; className: string } {
  const pct = Math.round((ratio - 1) * 100);
  const magnitude = `${Math.abs(pct)}%`;
  if (ratio >= FAIR_RATIO_MIN && ratio <= FAIR_RATIO_MAX) return { label: "Fair both ways", className: "text-emerald-400" };
  if (ratio < LOPSIDED_RATIO_MIN) return { label: `Favors them ${magnitude} — context matters`, className: "text-amber-400" };
  if (ratio > LOPSIDED_RATIO_MAX) return { label: `Favors you ${magnitude} — context matters`, className: "text-amber-400" };
  return { label: pct >= 0 ? `Leans your way ${magnitude}` : `Leans their way ${magnitude}`, className: "text-[#98989D]" };
}

/** What each card badge means -- shown as its tooltip. */
const BADGE_HELP = {
  winWin: "Fills a position you need AND one the other team needs — the kind of trade they have a real reason to accept.",
  need: "Upgrades a position where your starters are well below the league-average starter.",
  value: "A fair swap that upgrades your lineup somewhere, though not at one of your weakest positions.",
  fallback: "An even value swap kept so the list always has options — not necessarily an upgrade for either side.",
  shape: "How many players each side sends (you give – you get).",
} as const;

function Badge({ className, help, children }: { className: string; help: string; children: ReactNode }) {
  return (
    <span title={help} className={`cursor-help text-[10px] font-semibold px-1.5 py-0.5 rounded border ${className}`}>
      {children}
    </span>
  );
}

function PlayerList({ label, players, app }: { label: string; players: TradeSuggestion["give"]; app: FantasyApp }) {
  return (
    <div className="bg-[#000000] rounded-lg p-2.5 min-w-0">
      <div className="text-[10px] text-[#98989D] mb-1">{label}</div>
      {players.map((p) => (
        <div key={p.id} className="mb-1 last:mb-0 min-w-0">
          <PlayerNameLink name={p.name} hasNews={app.playerHasNews(p.id)} onOpen={() => app.openPlayerNews(p.id)} className="text-sm font-medium truncate" />
          <div className="text-[11px] text-[#98989D]">
            {p.pos} · {p.team}
          </div>
        </div>
      ))}
    </div>
  );
}

function TradeCard({ s, app, savedAt }: { s: TradeSuggestion; app: FantasyApp; savedAt?: string }) {
  const verdict = ratioVerdict(s.ratio);
  // A value/fallback trade can still turn out to fill one of your needs once
  // both depth charts are re-run -- label it by that.
  const kind = s.reason === "need" || s.fit.myNeedsHelped.length ? "need" : s.reason;
  const fit = fitSummary(s);
  const saved = app.savedTradeKeys.has(suggestionKey(s));
  const iconButton = "text-[#98989D] hover:text-[#FFFFFF] border border-[#38383A] rounded-lg p-1.5 hover:bg-[#2C2C2E]";

  return (
    <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            help={BADGE_HELP[kind]}
            className={
              kind === "need"
                ? "bg-red-500/15 text-red-300 border-red-500/30"
                : kind === "value"
                  ? "bg-[#C9A227]/15 text-[#C9A227] border-[#C9A227]/30"
                  : "bg-[#2C2C2E] text-[#98989D] border-[#38383A]"
            }
          >
            {kind === "need" ? "Fills a need" : kind === "value" ? "Good value" : "Fair swap"}
          </Badge>
          <Badge help={BADGE_HELP.shape} className="bg-[#2C2C2E] text-[#98989D] border-[#38383A]">
            {s.give.length}-for-{s.get.length}
          </Badge>
          {s.fit.tier === 3 && (
            <Badge help={BADGE_HELP.winWin} className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
              Win-win
            </Badge>
          )}
        </div>
        <span className="text-sm font-medium text-right truncate">{s.teamName}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <PlayerList label="You give" players={s.give} app={app} />
        <PlayerList label="You get" players={s.get} app={app} />
      </div>
      <div className={`text-xs mb-3 ${fit.className}`}>{fit.text}</div>
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm mono-font text-[#C9A227]">
            {s.ratio.toFixed(2)}
            <span className="text-[10px] text-[#636366] ml-1">get ÷ give</span>
          </div>
          <div className={`text-[11px] ${verdict.className}`}>{verdict.label}</div>
          <div className="mt-1">
            <MarketCheckBadge give={s.give} get={s.get} />
          </div>
          {savedAt && <div className="text-[10px] text-[#636366] mt-1">Saved {new Date(savedAt).toLocaleDateString()}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => app.toggleSavedTrade(s)} title={saved ? "Remove from saved" : "Save for later"} aria-label={saved ? "Remove from saved" : "Save for later"} className={iconButton}>
            {saved ? <BookmarkCheck size={14} className="text-[#C9A227]" /> : <Bookmark size={14} />}
          </button>
          {!savedAt && (
            <button onClick={() => app.dismissTrade(s)} title="Not interested — never suggest this again" aria-label="Dismiss trade" className={iconButton}>
              <EyeOff size={14} />
            </button>
          )}
          <button onClick={() => app.copyTradeOffer(s)} title="Copy a ready-to-send offer message" aria-label="Copy offer message" className={iconButton}>
            <Copy size={14} />
          </button>
          <button onClick={() => app.proposeCoachTrade(s)} className="text-xs bg-[#C9A227] text-[#000000] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#e0b82e] flex items-center gap-1">
            <Repeat size={12} /> Analyze
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoachPage({ app }: { app: FantasyApp }) {
  const {
    myNeeds,
    needyPositions,
    strengthPositions,
    leagueBaseline,
    coachSuggestions,
    regenerateCoachSuggestions,
    hasFreshCoachSuggestions,
    tradeTargetsByNeed,
    searchMoreTradeTargets,
    openWhatWouldItTake,
    playerHasNews,
    openPlayerNews,
    effectiveLeagueTeams,
    coachTeamFilter,
    setCoachTeamFilter,
    savedTrades,
    dismissedTradeCount,
    clearDismissedTrades,
  } = app;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="display-font text-xl flex items-center gap-2">
          <Sparkles size={18} className="text-[#C9A227]" /> AI Coach
        </h2>
        <p className="text-sm text-[#98989D] max-w-2xl mt-1">Trade ideas and targets built around where your roster is thin.</p>
        <div className="mt-1">
          <HowItWorks summary="How the Coach values players">
            <p>
              Every player's season value blends two things: <span className="text-[#C9A227]">projections</span> (ESPN and Sleeper rest-of-season
              projections plus actual points so far, run through a value-over-replacement curve and a rank chart) and the{" "}
              <span className="text-[#C9A227]">trade market</span> (FantasyCalc values built from real redraft trades), which also sets how positions
              compare — a 1QB-league quarterback trades for less than an RB scoring the same points. Tap any player's name to see exactly how his value is
              built.
            </p>
            <p>Only position players (QB/RB/WR/TE) are traded — never kickers or defenses — and QBs only when you're genuinely thin there.</p>
          </HowItWorks>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-[#98989D] mb-2">Position-by-position outlook</h3>
        <HowItWorks summary="What these scores mean">
          <p>
            Score = the season value of your starters at the position, compared against the league-average starter there. A "Questionable"/"Out" tag
            this week barely dents it; real season-long injury risk does.
          </p>
        </HowItWorks>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
          {POSITIONS.map((pos) => {
            const n = myNeeds[pos];
            const isNeed = needyPositions.includes(pos);
            const isStrength = strengthPositions.includes(pos);
            const baseline = leagueBaseline[pos] || 0;
            const pctVsAvg = baseline ? ((n.starterScore - baseline) / baseline) * 100 : 0;
            return (
              <div key={pos} className={`rounded-xl border p-2.5 sm:p-3 ${isNeed ? "bg-red-500/10 border-red-500/30" : isStrength ? "bg-emerald-500/10 border-emerald-500/30" : "bg-[#1C1C1E] border-[#38383A]"}`}>
                <div className="flex items-center justify-between">
                  <PosBadge pos={pos} />
                  {isNeed && <AlertTriangle size={13} className="text-red-400" />}
                  {isStrength && <TrendingUp size={13} className="text-emerald-400" />}
                </div>
                <div className="text-base sm:text-lg font-semibold mono-font mt-1.5">{n.starterScore.toFixed(1)}</div>
                <div className={`text-[11px] ${isNeed ? "text-red-400" : isStrength ? "text-emerald-400" : "text-[#98989D]"}`}>
                  {baseline ? `${pctVsAvg > 0 ? "+" : ""}${pctVsAvg.toFixed(0)}% vs avg` : "—"}
                </div>
                <div className="text-[10px] text-[#636366] mt-0.5">{isNeed ? "Needs help" : isStrength ? "Tradeable depth" : "Balanced"}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h3 className="text-sm font-medium text-[#98989D]">Suggested trades</h3>
          <div className="flex items-center gap-2">
            <select
              value={coachTeamFilter ?? ""}
              onChange={(e) => setCoachTeamFilter(e.target.value ? Number(e.target.value) : null)}
              aria-label="Only show trades with one manager"
              className="max-w-[46vw] sm:max-w-[200px] bg-[#1C1C1E] border border-[#38383A] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#C9A227]"
            >
              <option value="">All teams</option>
              {effectiveLeagueTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {coachSuggestions.length > 0 && (
              <button
                onClick={regenerateCoachSuggestions}
                className="shrink-0 text-xs bg-[#2C2C2E] text-[#E5E5EA] font-medium px-3 py-1.5 rounded-lg hover:bg-[#38383A] flex items-center gap-1.5 border border-[#38383A]"
                title={hasFreshCoachSuggestions ? "Swap in a new batch of reasonable trades" : "You've seen every reasonable trade — start over from the top"}
              >
                <RefreshCw size={12} /> <span className="hidden sm:inline">Get new recommendations</span>
                <span className="sm:hidden">New batch</span>
              </button>
            )}
          </div>
        </div>
        <HowItWorks summary="How trades are picked">
          <p>
            Each card's <span className="text-[#C9A227]">ratio</span> is what you get ÷ what you give, after discounting extra pieces and adjusting
            for each team's needs. {FAIR_RATIO_MIN.toFixed(2)}–{FAIR_RATIO_MAX.toFixed(2)} is fair. The market badge shows what the trade market alone
            thinks — if it disagrees, the other manager may too.
          </p>
          <p>
            Trades that fill a need on both rosters (Win-win) come first, but the list always keeps a mix: other fair trades that help you, at least
            two 1-for-1s and two 2-for-2s, and any deal moving a star must bring a top player back. Save trades to come back to, or hide ones you'll
            never make.
          </p>
        </HowItWorks>
        {dismissedTradeCount > 0 && (
          <div className="text-[11px] text-[#636366] mb-2">
            {dismissedTradeCount} hidden trade{dismissedTradeCount === 1 ? "" : "s"}.{" "}
            <button onClick={clearDismissedTrades} className="text-[#C9A227] hover:underline">
              Show them again
            </button>
          </div>
        )}
        {coachSuggestions.length === 0 ? (
          <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-6 text-center">
            <div className="text-sm text-[#98989D]">
              {coachTeamFilter != null
                ? "No reasonable trades with this manager right now — try another team or All teams."
                : "No reasonable trades found across the league right now — your roster's depth chart doesn't leave much to move. Try the Trade Analyzer directly to explore more options."}
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {coachSuggestions.map((s) => (
              <TradeCard key={s.id} s={s} app={app} />
            ))}
          </div>
        )}
      </div>

      {savedTrades.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[#98989D] mb-2 flex items-center gap-1.5">
            <BookmarkCheck size={14} className="text-[#C9A227]" /> Saved trades
          </h3>
          <p className="text-xs text-[#636366] mb-3">Values as of when you saved them — open one in the analyzer to re-check it against today's numbers.</p>
          <div className="grid md:grid-cols-2 gap-3">
            {savedTrades.map((t) => (
              <TradeCard key={t.suggestion.id} s={t.suggestion} app={app} savedAt={t.savedAt} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-[#98989D] mb-2">Players to trade for</h3>
        <HowItWorks summary="How targets are chosen">
          <p>
            Realistic targets at each need position, not just whoever's best. Each candidate runs through the "What would it take?" solver and is only
            kept if some package from your roster clears their team's fairness bar; the cheapest one is shown — click through for the full list.
          </p>
        </HowItWorks>
        {tradeTargetsByNeed.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-4">
            {tradeTargetsByNeed.map((group) => (
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
                    // A div, not a <button>: the player's name inside is its own
                    // button (opens news), and buttons can't nest.
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openWhatWouldItTake(p.id)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          openWhatWouldItTake(p.id);
                        }
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 transition-colors duration-150 hover:bg-[#1C1C1E] text-left gap-2 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <PlayerNameLink
                          name={p.name}
                          hasNews={playerHasNews(p.id)}
                          onOpen={() => openPlayerNews(p.id)}
                          className="text-sm font-medium truncate"
                        />
                        <div className="text-[11px] text-[#98989D] flex items-center gap-1.5">
                          <span>
                            {p.team} · {p.fantasyTeamName}
                          </span>
                          <StatusIndicator status={p.status} onClick={playerHasNews(p.id) ? () => openPlayerNews(p.id) : undefined} />
                        </div>
                        <div className="text-[11px] text-emerald-400/90 mt-0.5 truncate">
                          Costs {p.cheapestOption.give.map((g) => g.name).join(" + ")}
                          {p.cheapestOption.fillsNeedFor.length > 0 && (
                            <span className="text-[#98989D]"> -- fills their {p.cheapestOption.fillsNeedFor.join("/")} need</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="mono-font text-sm text-[#C9A227] font-medium">{p.proj}</span>
                        <span className="text-[#98989D] hover:text-[#FFFFFF] border border-[#38383A] rounded-md p-1" title="What would it take?">
                          <ArrowRightLeft size={13} />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {group.hasMore && (
                  <button
                    onClick={() => searchMoreTradeTargets(group.pos)}
                    className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 border-t border-[#38383A]/60 text-xs font-medium text-[#98989D] hover:text-[#FFFFFF] hover:bg-[#1C1C1E] transition-colors duration-150"
                  >
                    <RefreshCw size={11} /> Search for more
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4 text-sm text-[#98989D]">
            No trade-worthy needs right now -- every needy position is either better served by a free-agent pickup above, or you're not thin enough
            anywhere to justify giving up real value.
          </div>
        )}
      </div>
    </div>
  );
}
