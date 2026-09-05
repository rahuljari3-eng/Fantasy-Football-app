import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { newsTypeColor, newsTypeIcon, severityColor, severityLabel } from "../lib/format";
import { PlayerNameLink } from "../components/PlayerNameLink";
import type { FantasyApp } from "../hooks/useFantasyApp";

type NewsScope = "league" | "team";

export function NewsPage({ app }: { app: FantasyApp }) {
  const { newsFeed, newsRefreshing, newsError, newsLastRefreshed, refreshNews, openPlayerNews, selectedTeam, effectiveMyTeamPlayers } = app;
  const [scope, setScope] = useState<NewsScope>("league");

  const myPlayerIds = useMemo(() => new Set(effectiveMyTeamPlayers.map((p) => p.id)), [effectiveMyTeamPlayers]);
  const visibleFeed = useMemo(
    () => (scope === "team" ? newsFeed.filter((n) => myPlayerIds.has(n.playerId)) : newsFeed),
    [newsFeed, scope, myPlayerIds]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="display-font text-xl">News & injury feed</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 bg-[#000000] border border-[#38383A] rounded-full pl-3 pr-1 py-1 focus-within:border-[#C9A227]/60">
            <span className="hidden md:inline text-[10px] text-[#98989D] mono-font tracking-wide">SHOW</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as NewsScope)}
              title="Show news for the whole league or just your team"
              className="bg-transparent text-xs font-semibold text-[#C9A227] focus:outline-none cursor-pointer pr-1 py-0.5"
            >
              <option value="league" className="bg-[#1C1C1E] text-[#FFFFFF]">Whole league</option>
              <option value="team" className="bg-[#1C1C1E] text-[#FFFFFF]">{selectedTeam.name} only</option>
            </select>
          </label>
          <button
            onClick={refreshNews}
            disabled={newsRefreshing}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-[#38383A] text-[#98989D] hover:text-[#C9A227] hover:border-[#C9A227]/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={newsRefreshing ? "animate-spin" : ""} />
            {newsRefreshing ? "Refreshing…" : "Refresh feed"}
          </button>
        </div>
      </div>
      <p className="text-sm text-[#98989D] max-w-2xl">
        Live from ESPN, filtered to players rostered in {app.selectedTeam ? "your league" : "the league"} or sitting in the
        free-agent pool. Injury items are graded by severity from ESPN's own designation and report wording, from minor
        to severe -- a report that doesn't actually describe an injury (a preseason snap-count note on a healthy
        player, say) shows up as News instead. Click a headline to read the full article, or a player's name/status
        anywhere in the app to see everything tagged to them.
      </p>
      {newsError && (
        <div className="text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} /> {newsError}
        </div>
      )}
      {newsLastRefreshed && !newsError && (
        <div className="text-[11px] text-[#636366]">News last refreshed {new Date(newsLastRefreshed).toLocaleString()}</div>
      )}

      <div className="space-y-2">
        {visibleFeed.map((n) => {
          const Icon = newsTypeIcon(n.type);
          return (
            <div key={n.id} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-3.5 flex gap-3 hover:border-[#48484A]">
              <span className={`flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 ${newsTypeColor(n.type)}`}>
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <PlayerNameLink
                    name={n.player}
                    hasNews={n.playerId != null}
                    onOpen={() => openPlayerNews(n.playerId)}
                    className="text-sm font-medium"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    {n.type === "Injury" && n.severity && (
                      <span
                        title={severityLabel(n.severity)}
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${severityColor(n.severity)}`}
                      >
                        {severityLabel(n.severity)}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${newsTypeColor(n.type)}`}>{n.type}</span>
                  </div>
                </div>
                <a
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#E5E5EA] mt-0.5 flex items-start gap-1 hover:text-[#C9A227] hover:underline"
                >
                  <span>{n.headline}</span>
                  <ExternalLink size={11} className="shrink-0 mt-0.5" />
                </a>
                <div className="text-[11px] text-[#636366] mt-1.5 mono-font">{n.time}</div>
              </div>
            </div>
          );
        })}
        {visibleFeed.length === 0 && !newsRefreshing && (
          <div className="text-sm text-[#98989D] italic">
            {newsFeed.length === 0
              ? 'No news yet -- hit "Refresh feed" to pull the latest from ESPN.'
              : `No ${scope === "team" ? selectedTeam.name + " " : ""}news right now.`}
          </div>
        )}
      </div>
    </div>
  );
}
