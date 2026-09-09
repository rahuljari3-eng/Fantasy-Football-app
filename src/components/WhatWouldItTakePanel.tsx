import { useMemo, useState } from "react";
import { ChevronLeft, Repeat } from "lucide-react";
import { POSITIONS } from "../config/league";
import { PosBadge } from "./PosBadge";
import { PlayerNameLink } from "./PlayerNameLink";
import { StatusIndicator } from "./StatusIndicator";
import { SearchInput } from "./SearchInput";
import type { LeaguePlayer, Position } from "../types";
import type { WhatWouldItTakeOption } from "../lib/whatWouldItTake";

/** "What would it take?" -- the reverse of the interactive analyzer above.
 * Pick anyone on another team's roster and this searches your roster for the
 * smallest package that would actually clear their fairness bar, instead of
 * you guessing and checking combos by hand. */
export function WhatWouldItTakePanel({
  players,
  findWhatItWouldTake,
  playerHasNews,
  openPlayerNews,
  onLoadPackage,
}: {
  players: LeaguePlayer[];
  findWhatItWouldTake: (target: LeaguePlayer) => WhatWouldItTakeOption[] | null;
  playerHasNews: (id: number) => boolean;
  openPlayerNews: (id: number) => void;
  onLoadPackage: (target: LeaguePlayer, option: WhatWouldItTakeOption) => void;
}) {
  const [targetId, setTargetId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");

  const target = players.find((p) => p.id === targetId) ?? null;
  const options = useMemo(() => (target ? findWhatItWouldTake(target) : null), [target, findWhatItWouldTake]);

  const browsable = useMemo(
    () =>
      players
        .filter((p) => (posFilter === "ALL" ? true : p.pos === posFilter))
        .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => b.proj - a.proj),
    [players, posFilter, search]
  );

  if (target) {
    return (
      <div className="space-y-4">
        <button onClick={() => setTargetId(null)} className="text-sm text-[#C9A227] hover:text-[#e0b82e] flex items-center gap-1">
          <ChevronLeft size={14} /> Pick a different player
        </button>

        <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <PosBadge pos={target.pos} className="rounded" />
            <div>
              <PlayerNameLink
                name={target.name}
                hasNews={playerHasNews(target.id)}
                onOpen={() => openPlayerNews(target.id)}
                className="font-semibold"
              />
              <div className="text-xs text-[#98989D]">
                {target.team} · {target.fantasyTeamName}
              </div>
            </div>
          </div>
          <span className="mono-font text-[#C9A227] text-sm">{target.proj} proj</span>
        </div>

        {options ? (
          <div className="space-y-3">
            <p className="text-sm text-[#98989D] max-w-2xl">
              The smallest {options.length > 1 ? "packages" : "package"} from your roster that {options.length > 1 ? "clear" : "clears"}{" "}
              {target.fantasyTeamName}'s fairness bar for {target.name} -- same ratio window and star gate the analyzer and AI Coach already use, so
              anything shown here would also grade as "fair" if you built it yourself above.
            </p>
            {options.map((opt, i) => (
              <div key={i} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-sm font-medium">{opt.give.length === 1 ? "1-for-1" : `${opt.give.length}-piece package`}</div>
                  <span className="mono-font text-xs text-[#C9A227]">ratio {opt.ratio.toFixed(2)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {opt.give.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5 bg-[#000000] rounded-lg px-2 py-1 text-xs">
                      <PosBadge pos={p.pos} className="rounded" /> {p.name}
                    </span>
                  ))}
                </div>
                {opt.fillsNeedFor.length > 0 && (
                  <div className="text-[11px] text-emerald-400 mb-2">
                    Fills a real need for {target.fantasyTeamName} at {opt.fillsNeedFor.join(", ")} -- why this doesn't need to be bigger.
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-[#98989D] mono-font">
                    you send {opt.giveVal.toFixed(1)} val · they send {opt.getVal.toFixed(1)} val
                  </div>
                  <button
                    onClick={() => onLoadPackage(target, opt)}
                    className="text-xs bg-[#C9A227] text-[#000000] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#e0b82e] flex items-center gap-1"
                  >
                    <Repeat size={12} /> Load into builder
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4 text-sm text-[#98989D]">
            Even a 3-piece package from your realistic trade chips doesn't clear {target.fantasyTeamName}'s fairness bar for {target.name} right now --
            not realistically gettable at the moment.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#98989D] max-w-2xl">
        Pick anyone on another team's roster and this searches your roster for the smallest package that would actually clear their fairness bar -- the
        reverse of guessing and checking combos yourself.
      </p>
      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} className="flex-1" placeholder="Search any player in the league…" />
        <select
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value as typeof posFilter)}
          className="bg-[#1C1C1E] border border-[#38383A] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/20"
        >
          {["ALL", ...POSITIONS].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="border border-[#38383A] rounded-xl overflow-hidden max-h-[520px] overflow-y-auto">
        {browsable.map((p) => (
          <div
            key={p.id}
            onClick={() => setTargetId(p.id)}
            className="flex items-center justify-between px-3.5 py-2 border-b border-[#38383A]/60 last:border-0 hover:bg-[#1C1C1E] cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <PosBadge pos={p.pos} className="w-10 text-center shrink-0" />
              <div className="min-w-0">
                <PlayerNameLink
                  name={p.name}
                  hasNews={playerHasNews(p.id)}
                  onOpen={() => openPlayerNews(p.id)}
                  className="text-sm font-medium truncate"
                />
                <div className="text-[11px] text-[#98989D] flex items-center gap-1.5 truncate">
                  <span>
                    {p.team} · {p.fantasyTeamName}
                  </span>
                  <StatusIndicator status={p.status} onClick={playerHasNews(p.id) ? () => openPlayerNews(p.id) : undefined} />
                </div>
              </div>
            </div>
            <span className="mono-font text-sm text-[#C9A227] shrink-0">{p.proj}</span>
          </div>
        ))}
        {browsable.length === 0 && <div className="p-8 text-center text-sm text-[#98989D]">No players match "{search}"</div>}
      </div>
    </div>
  );
}
