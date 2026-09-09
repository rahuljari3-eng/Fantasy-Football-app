// Live league standings + full-season schedule, fetched from ESPN on demand
// (only once the League tab's Standings/Playoff Race sub-tab is actually
// opened -- see LeaguePage) rather than on every app load.
import { useCallback, useState } from "react";
import { fetchLeagueScheduleSnapshot, type LeagueScheduleSnapshot } from "../lib/leagueSchedule";

export function useStandings() {
  const [leagueSchedule, setLeagueSchedule] = useState<LeagueScheduleSnapshot | null>(null);
  const [standingsRefreshing, setStandingsRefreshing] = useState(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);

  const refreshStandings = useCallback(async () => {
    setStandingsRefreshing(true);
    setStandingsError(null);
    try {
      setLeagueSchedule(await fetchLeagueScheduleSnapshot());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStandingsError(`Couldn't reach ESPN for standings (${message}).`);
    } finally {
      setStandingsRefreshing(false);
    }
  }, []);

  return { leagueSchedule, standingsRefreshing, standingsError, refreshStandings };
}
