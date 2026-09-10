// Live ESPN lineup slots + per-player live scores for every team in the
// league (not just the one you're managing) -- the input the Matchup tab
// needs to know exactly who your opponent is actually starting this week and
// how many points their locked-in starters have actually put up. Self-
// contained, fetched only once the Matchup tab is opened and polled while it
// stays open, same on-demand pattern as useStandings for the League tab.
import { useCallback, useState } from "react";
import { fetchEspnLiveLineups, type EspnLiveLineupEntry } from "../lib/espn";

export function useMatchupCenter() {
  const [liveLineups, setLiveLineups] = useState<Record<number, Record<number, EspnLiveLineupEntry>> | null>(null);
  const [lineupsRefreshing, setLineupsRefreshing] = useState(false);
  const [lineupsError, setLineupsError] = useState<string | null>(null);

  const refreshLiveLineups = useCallback(async () => {
    setLineupsRefreshing(true);
    setLineupsError(null);
    try {
      setLiveLineups(await fetchEspnLiveLineups());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLineupsError(`Couldn't reach ESPN for live lineups (${message}).`);
    } finally {
      setLineupsRefreshing(false);
    }
  }, []);

  return { liveLineups, lineupsRefreshing, lineupsError, refreshLiveLineups };
}
