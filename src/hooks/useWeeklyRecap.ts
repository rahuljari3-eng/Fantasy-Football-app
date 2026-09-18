// Weekly team-recap generation + caching -- local to the League page's
// Recap sub-tab (its only consumer), so it isn't threaded through the
// already-large useFantasyApp. Generation calls a real (non-deterministic,
// billed) OpenAI request, so it only ever happens on an explicit user
// action; loading an already-generated week from localStorage is free and
// can happen automatically.
import { useCallback, useState } from "react";
import { getStoredValue, setStoredValue } from "../lib/storage";
import type { LeagueScheduleSnapshot } from "../lib/leagueSchedule";
import { fetchLeagueWeekScores } from "../lib/playerPerformance";
import type { LeagueTeam, NewsItem } from "../types";
import { buildWeeklyRecapInputs, type TeamWeekRecapInput } from "../lib/weeklyRecap";

export interface TeamWeekRecap extends TeamWeekRecapInput {
  blurb: string;
}

const CACHE_VERSION = "v1";
const cacheKey = (week: number) => `weeklyRecap:${CACHE_VERSION}:week:${week}`;

export function useWeeklyRecap(params: {
  leagueSchedule: LeagueScheduleSnapshot | null;
  allTeams: LeagueTeam[];
  newsFeed: NewsItem[];
}) {
  const { leagueSchedule, allTeams, newsFeed } = params;
  const [recaps, setRecaps] = useState<TeamWeekRecap[] | null>(null);
  const [recapWeek, setRecapWeek] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Peek at whether a week already has a cached recap, without loading it
   * or touching the network -- lets the UI decide "Generate" vs show a
   * cached result before the user does anything. */
  const checkCached = useCallback(async (week: number) => {
    const raw = await getStoredValue(cacheKey(week));
    return raw != null;
  }, []);

  const reset = useCallback(() => {
    setRecaps(null);
    setRecapWeek(null);
    setError(null);
  }, []);

  const generate = useCallback(
    async (week: number, opts?: { force?: boolean }) => {
      if (!leagueSchedule) return;
      setLoading(true);
      setError(null);
      try {
        if (!opts?.force) {
          const cached = await getStoredValue(cacheKey(week));
          if (cached) {
            setRecaps(JSON.parse(cached) as TeamWeekRecap[]);
            setRecapWeek(week);
            return;
          }
        }

        const { players } = await fetchLeagueWeekScores(week);
        const inputs = buildWeeklyRecapInputs({ week, leagueSchedule, leagueWeekScores: players, newsFeed, allTeams });
        if (inputs.length === 0) throw new Error(`No decided matchups found for week ${week}.`);

        const res = await fetch("/api/weekly-recap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week, teams: inputs }),
        });

        const rawBody = await res.text();
        let data: { recaps?: { teamId: number; blurb: string }[]; error?: string } = {};
        try {
          data = rawBody ? (JSON.parse(rawBody) as typeof data) : {};
        } catch {
          throw new Error(rawBody.trim().slice(0, 180) || `Request failed (${res.status}) — non-JSON response from API`);
        }
        if (!res.ok || !data.recaps) throw new Error(data.error || `Request failed (${res.status})`);

        const blurbById = new Map(data.recaps.map((r) => [r.teamId, r.blurb]));
        const merged: TeamWeekRecap[] = inputs.map((t) => ({ ...t, blurb: blurbById.get(t.teamId) ?? "" }));

        setRecaps(merged);
        setRecapWeek(week);
        await setStoredValue(cacheKey(week), JSON.stringify(merged));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate weekly recaps");
      } finally {
        setLoading(false);
      }
    },
    [leagueSchedule, newsFeed, allTeams]
  );

  return { recaps, recapWeek, loading, error, generate, checkCached, reset };
}

export type UseWeeklyRecap = ReturnType<typeof useWeeklyRecap>;
