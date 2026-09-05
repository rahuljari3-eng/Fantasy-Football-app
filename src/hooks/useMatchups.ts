// Live weekly matchup data (opponent + Vegas-graded matchup quality) pulled
// directly from ESPN. Self-contained -- it only produces a WeeklyMatchups
// lookup, and doesn't know anything about rosters. Persisted so the feed
// still shows something on a fresh load before the first refresh completes.
import { useCallback, useEffect, useState } from "react";
import { EMPTY_MATCHUPS, fetchWeeklyMatchups } from "../lib/matchup";
import type { WeeklyMatchups } from "../lib/matchup";
import { getStoredValue, setStoredValue } from "../lib/storage";

const MATCHUPS_KEY = "weekly-matchups";

export function useMatchups() {
  const [matchupData, setMatchupData] = useState<WeeklyMatchups>(EMPTY_MATCHUPS);
  const [matchupsRefreshing, setMatchupsRefreshing] = useState(false);
  const [matchupsError, setMatchupsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await getStoredValue(MATCHUPS_KEY);
      if (stored) {
        try {
          setMatchupData(JSON.parse(stored));
        } catch {
          // Corrupted/old-format value -- ignore and start fresh.
        }
      }
    })();
  }, []);

  const refreshMatchups = useCallback(async () => {
    setMatchupsRefreshing(true);
    setMatchupsError(null);
    try {
      const fresh = await fetchWeeklyMatchups();
      setMatchupData(fresh);
      await setStoredValue(MATCHUPS_KEY, JSON.stringify(fresh));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMatchupsError(`Couldn't reach ESPN for matchups (${message}).`);
    } finally {
      setMatchupsRefreshing(false);
    }
  }, []);

  return { matchupData, matchupsRefreshing, matchupsError, refreshMatchups };
}
