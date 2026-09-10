import { useEffect } from "react";
import { Clock, RefreshCw, Swords } from "lucide-react";
import { PosBadge } from "../components/PosBadge";
import { PlayerNameLink } from "../components/PlayerNameLink";
import type { FantasyApp } from "../hooks/useFantasyApp";
import type { TeamMatchupSide } from "../lib/matchupCenter";
import type { Player } from "../types";

// Live score + lineup locks only change while games are being played, so
// this is polled while the tab is open -- same pattern as the League tab's
// standings poll.
const POLL_MS = 30_000;

function ScoreColumn({ side, isMe, winProbability }: { side: TeamMatchupSide; isMe: boolean; winProbability: number }) {
  return (
    <div className="flex-1 text-center">
      <div className={`text-xs uppercase tracking-wide ${isMe ? "text-[#C9A227]" : "text-[#98989D]"}`}>
        {isMe ? "You" : "Opponent"}
      </div>
      <div className="font-semibold truncate mt-0.5">{side.name}</div>
      <div className="text-xs text-[#98989D] truncate">{side.owner}</div>
      <div className="mono-font text-4xl font-semibold mt-3">{side.currentScore.toFixed(1)}</div>
      <div className="text-xs text-[#98989D] mt-1">projected {side.projectedTotal.toFixed(1)}</div>
      <div className={`mono-font text-lg font-semibold mt-2 ${isMe ? "text-[#C9A227]" : "text-[#98989D]"}`}>
        {winProbability.toFixed(0)}%
      </div>
      <div className="text-[11px] text-[#636366]">to win</div>
      <div className="text-[11px] text-[#636366] mt-2">
        {side.playedPlayers.length} locked in · {side.playersRemaining} yet to play
      </div>
    </div>
  );
}

function PlayerRow({
  pos,
  name,
  hasNews,
  onOpenNews,
  points,
}: {
  pos: Player["pos"];
  name: string;
  hasNews: boolean;
  onOpenNews: () => void;
  points: number;
}) {
  return (
    <div className="flex items-center justify-between bg-[#000000] rounded-lg px-2.5 py-1.5 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <PosBadge pos={pos} className="shrink-0" />
        <PlayerNameLink name={name} hasNews={hasNews} onOpen={onOpenNews} className="truncate" />
      </div>
      <span className="mono-font text-[#C9A227] shrink-0">{points}</span>
    </div>
  );
}

export function MatchupPage({ app }: { app: FantasyApp }) {
  const {
    headToHeadMatchup,
    refreshStandings,
    standingsRefreshing,
    standingsError,
    refreshLiveLineups,
    lineupsRefreshing,
    lineupsError,
    refreshMatchups,
    matchupsRefreshing,
    playerHasNews,
    openPlayerNews,
  } = app;

  useEffect(() => {
    refreshStandings();
    refreshLiveLineups();
    refreshMatchups();
    const interval = setInterval(() => {
      refreshStandings();
      refreshLiveLineups();
      refreshMatchups();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refreshStandings, refreshLiveLineups, refreshMatchups]);

  const refreshing = standingsRefreshing || lineupsRefreshing || matchupsRefreshing;
  const error = standingsError || lineupsError;

  if (!headToHeadMatchup) {
    return (
      <div className="space-y-4">
        <h2 className="display-font text-xl flex items-center gap-2">
          <Swords size={20} className="text-[#C9A227]" /> This week's matchup
        </h2>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div className="text-sm text-[#636366] italic">
          {refreshing ? "Pulling this week's matchup from ESPN…" : "No matchup found for this week yet."}
        </div>
      </div>
    );
  }

  const { me, opponent, winProbability, week, decided } = headToHeadMatchup;
  const meWinning = me.currentScore > opponent.currentScore;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="display-font text-xl flex items-center gap-2">
          <Swords size={20} className="text-[#C9A227]" /> Week {week} matchup
        </h2>
        <button
          onClick={() => {
            refreshStandings();
            refreshLiveLineups();
            refreshMatchups();
          }}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-[#98989D] hover:text-[#FFFFFF] disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-5">
        {decided ? (
          <div className="text-center text-xs text-[#98989D] mb-3 flex items-center justify-center gap-1.5">
            <Clock size={12} /> Final
          </div>
        ) : (
          <div className="text-center text-xs text-[#98989D] mb-3 flex items-center justify-center gap-1.5">
            <Clock size={12} /> In progress
          </div>
        )}
        <div className="flex items-stretch gap-4">
          <ScoreColumn side={me} isMe winProbability={winProbability} />
          <div className="flex flex-col items-center justify-center px-2">
            <span className="text-xs text-[#636366] mono-font">VS</span>
          </div>
          <ScoreColumn side={opponent} isMe={false} winProbability={100 - winProbability} />
        </div>

        <div className="mt-5 h-2 rounded-full bg-[#38383A]/60 overflow-hidden flex">
          <div
            className={`h-full ${meWinning ? "bg-[#C9A227]" : "bg-[#98989D]"}`}
            style={{ width: `${winProbability}%` }}
          />
        </div>
        <div className="mt-1.5 text-center text-[11px] text-[#636366]">Simulated win probability, based on remaining projections</div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {[
          { label: "Your", side: me },
          { label: `${opponent.name}'s`, side: opponent },
        ].map(({ label, side }) => (
          <div key={side.teamId} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4 space-y-4">
            <div>
              <div className="text-sm font-semibold mb-2">{label} players still to play</div>
              {side.remainingPlayers.length === 0 ? (
                <div className="text-xs text-[#636366] italic">Every starter has locked in for the week.</div>
              ) : (
                <div className="space-y-1.5">
                  {side.remainingPlayers
                    .slice()
                    .sort((a, b) => b.proj - a.proj)
                    .map((p) => (
                      <PlayerRow
                        key={p.id}
                        pos={p.pos}
                        name={p.name}
                        hasNews={playerHasNews(p.id)}
                        onOpenNews={() => openPlayerNews(p.id)}
                        points={p.proj}
                      />
                    ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">{label} players already played</div>
              {side.playedPlayers.length === 0 ? (
                <div className="text-xs text-[#636366] italic">No one has kicked off yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {side.playedPlayers.map(({ player, score }) => (
                    <PlayerRow
                      key={player.id}
                      pos={player.pos}
                      name={player.name}
                      hasNews={playerHasNews(player.id)}
                      onOpenNews={() => openPlayerNews(player.id)}
                      points={score}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
