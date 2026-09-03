import { AlertTriangle, Repeat, Sparkles, TrendingUp } from "lucide-react";
import { POSITIONS } from "../config/league";
import { PosBadge } from "../components/PosBadge";
import type { FantasyApp } from "../hooks/useFantasyApp";

export function CoachPage({ app }: { app: FantasyApp }) {
  const { myNeeds, needyPositions, strengthPositions, leagueBaseline, coachSuggestions, proposeCoachTrade } = app;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="display-font text-xl flex items-center gap-2">
          <Sparkles size={18} className="text-[#C9A227]" /> AI Coach
        </h2>
        <p className="text-sm text-[#98989D] max-w-2xl mt-1">
          Scores each position by the quality of players there — projection, tier scarcity, and a discount for current injury status — compared against the
          league-average starter, not just how many bodies you have. Then it scans every other team's roster for a trade where their real need overlaps with
          your real surplus. Heuristic on your actual league data, not a live model call — a strong starting point, not gospel.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-[#98989D] mb-2">Position-by-position outlook</h3>
        <p className="text-xs text-[#636366] mb-3 max-w-2xl">
          Quality score = projection + tier premium, discounted for current injury status — not just headcount. Compared against the league-average starter
          at each position.
        </p>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {POSITIONS.map((pos) => {
            const n = myNeeds[pos];
            const isNeed = needyPositions.includes(pos);
            const isStrength = strengthPositions.includes(pos);
            const baseline = leagueBaseline[pos] || 0;
            const pctVsAvg = baseline ? ((n.starterScore - baseline) / baseline) * 100 : 0;
            return (
              <div key={pos} className={`rounded-xl border p-3 ${isNeed ? "bg-red-500/10 border-red-500/30" : isStrength ? "bg-emerald-500/10 border-emerald-500/30" : "bg-[#1C1C1E] border-[#38383A]"}`}>
                <div className="flex items-center justify-between">
                  <PosBadge pos={pos} />
                  {isNeed && <AlertTriangle size={13} className="text-red-400" />}
                  {isStrength && <TrendingUp size={13} className="text-emerald-400" />}
                </div>
                <div className="text-lg font-semibold mono-font mt-1.5">{n.starterScore.toFixed(1)}</div>
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
        <h3 className="text-sm font-medium text-[#98989D] mb-2">Suggested trades</h3>
        <p className="text-xs text-[#636366] mb-3 max-w-2xl">
          Need-fill trades are prioritized when you have a real weakness; otherwise these are value trades worth considering even without one — you'll
          always see some options here. The list deliberately mixes straight player-for-player swaps with 2-for-1 packages. Value accounts for whether a
          player is a locked-in starter or a bench piece, not just projection, and every suggestion is kept within a fair net-value band.
        </p>
        {coachSuggestions.length === 0 ? (
          <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-6 text-center">
            <div className="text-sm text-[#98989D]">
              No reasonable trades found across the league right now — your roster's depth chart doesn't leave much to move. Try the Trade Analyzer directly
              to explore more options.
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {coachSuggestions.map((s) => {
              const diff = s.getVal - s.giveVal;
              return (
                <div key={s.id} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                          s.reason === "need" ? "bg-red-500/15 text-red-300 border-red-500/30" : s.reason === "value" ? "bg-[#C9A227]/15 text-[#C9A227] border-[#C9A227]/30" : "bg-[#2C2C2E] text-[#98989D] border-[#38383A]"
                        }`}
                      >
                        {s.reason === "need" ? "Fills a need" : s.reason === "value" ? "Good value" : "Fair swap"}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-[#2C2C2E] text-[#98989D] border-[#38383A]">
                        {s.give.length}-for-{s.get.length}
                      </span>
                    </div>
                    <span className="text-sm font-medium">{s.teamName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-[#000000] rounded-lg p-2.5">
                      <div className="text-[10px] text-[#98989D] mb-1">You give</div>
                      {s.give.map((p) => (
                        <div key={p.id} className="mb-1 last:mb-0">
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-[11px] text-[#98989D]">
                            {p.pos} · {p.team}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-[#000000] rounded-lg p-2.5">
                      <div className="text-[10px] text-[#98989D] mb-1">You get</div>
                      {s.get.map((p) => (
                        <div key={p.id} className="mb-1 last:mb-0">
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-[11px] text-[#98989D]">
                            {p.pos} · {p.team}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs text-[#98989D] mb-3">
                    {s.reason === "need" ? (
                      <>
                        Shores up your {s.needPos} (+{s.upgrade.toFixed(1)} quality-score upgrade — factoring proj, tier, and injury risk) by moving from
                        your {s.overlapPos} depth, which {s.teamName} is genuinely light at.
                      </>
                    ) : s.reason === "value" ? (
                      <>
                        A roughly even-to-favorable value swap: upgrades your {s.needPos} spot by {s.upgrade.toFixed(1)} in value while moving a{" "}
                        {s.overlapPos} piece that isn't your top guy there.
                      </>
                    ) : (
                      <>A same-position, roughly even value swap with {s.teamName} — not necessarily an upgrade, but a fair baseline option worth having on the table.</>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs mono-font ${diff >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                      Net value {diff >= 0 ? "+" : ""}
                      {diff.toFixed(1)}
                    </span>
                    <button onClick={() => proposeCoachTrade(s)} className="text-xs bg-[#C9A227] text-[#000000] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#e0b82e] flex items-center gap-1">
                      <Repeat size={12} /> Open in analyzer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
