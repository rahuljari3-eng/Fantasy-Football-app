// Live projection refresh: pulls current Week-N projections and injury status
// from ESPN, blended with Sleeper's projections, actual production so far,
// and FantasyCalc trade-market values (lib/consensus.ts). Self-contained -- it only produces an id-keyed
// overrides map, and doesn't know anything about rosters, trades, etc.
import { useCallback, useEffect, useState } from "react";
import { LEAGUE_CONFIG } from "../config/league";
import { applyConsensusToOverrides, fetchConsensusSources } from "../lib/consensus";
import { fetchEspnRosteredProjections, fetchEspnFreeAgentProjections } from "../lib/espn";
import { getStoredValue, setStoredValue } from "../lib/storage";
import type { ProjectionOverrides, RefreshProgress } from "../types";

const OVERRIDES_KEY = "projection-overrides";
const OVERRIDES_META_KEY = "projection-overrides-meta";

export function useProjectionRefresh() {
  const [projectionOverrides, setProjectionOverrides] = useState<ProjectionOverrides>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  // { done, total } while a multi-step refresh runs.
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await getStoredValue(OVERRIDES_KEY);
      if (stored) {
        try {
          setProjectionOverrides(JSON.parse(stored));
        } catch {
          // Corrupted/old-format value -- ignore and start fresh.
        }
      }
      const meta = await getStoredValue(OVERRIDES_META_KEY);
      if (meta) {
        try {
          setLastRefreshed(JSON.parse(meta).lastRefreshed ?? null);
        } catch {
          // ignore
        }
      }
    })();
  }, []);

  const refreshProjections = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshProgress({ done: 0, total: 2 });

    let fresh: ProjectionOverrides = {};

    try {
      const rostered = await fetchEspnRosteredProjections();
      fresh = { ...fresh, ...rostered.fresh };
      let snapshots = rostered.snapshots;
      setRefreshProgress({ done: 1, total: 2 });

      // The other projection/market sources only need the scoring period, so
      // they load alongside the free-agent pull rather than after it.
      const [freeAgents, sources] = await Promise.all([
        // Free-agent refresh failing shouldn't block the more important
        // rostered-player update.
        fetchEspnFreeAgentProjections(rostered.period).catch(() => null),
        fetchConsensusSources(LEAGUE_CONFIG.espnSeason, rostered.period),
      ]);
      if (freeAgents) {
        fresh = { ...fresh, ...freeAgents.fresh };
        snapshots = [...snapshots, ...freeAgents.snapshots];
      }
      // ESPN alone was the only input here before; blend in Sleeper's
      // projections, actual production, and the trade market -- see
      // lib/consensus.ts.
      fresh = applyConsensusToOverrides(fresh, snapshots, sources);
      setRefreshProgress({ done: 2, total: 2 });
    } catch (espnErr) {
      setRefreshing(false);
      setRefreshProgress(null);
      const message = espnErr instanceof Error ? espnErr.message : String(espnErr);
      setRefreshError(`Couldn't reach ESPN (${message}). Try again in a moment.`);
      return;
    }

    const merged = { ...projectionOverrides, ...fresh };
    setProjectionOverrides(merged);
    const nowIso = new Date().toISOString();
    setLastRefreshed(nowIso);
    await setStoredValue(OVERRIDES_KEY, JSON.stringify(merged));
    await setStoredValue(
      OVERRIDES_META_KEY,
      JSON.stringify({ lastRefreshed: nowIso, count: Object.keys(fresh).length })
    );

    if (Object.keys(fresh).length === 0) {
      setRefreshError("ESPN returned no projection data — try again in a moment.");
    }

    setRefreshing(false);
    setRefreshProgress(null);
  }, [projectionOverrides]);

  return { projectionOverrides, refreshing, refreshError, lastRefreshed, refreshProgress, refreshProjections };
}
