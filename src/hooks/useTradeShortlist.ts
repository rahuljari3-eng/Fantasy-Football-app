// AI Coach trade shortlist: trades you've saved to come back to, and trades
// you've dismissed so "Get new recommendations" never brings them back.
// Persisted per managed team (switching teams shows that team's list), keyed
// the same way the Coach dedupes suggestions (lib/coachTrades.ts
// suggestionKey).
import { useCallback, useEffect, useMemo, useState } from "react";
import { suggestionKey } from "../lib/coachTrades";
import { getStoredValue, setStoredValue } from "../lib/storage";
import type { TradeSuggestion } from "../types";

interface SavedTrade {
  suggestion: TradeSuggestion;
  savedAt: string;
}

interface ShortlistState {
  saved: SavedTrade[];
  dismissed: string[];
}

const EMPTY: ShortlistState = { saved: [], dismissed: [] };
const storageKey = (teamId: number) => `trade-shortlist-${teamId}`;

export function useTradeShortlist(teamId: number) {
  const [state, setState] = useState<ShortlistState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    setState(EMPTY);
    (async () => {
      const stored = await getStoredValue(storageKey(teamId));
      if (cancelled || !stored) return;
      try {
        const parsed = JSON.parse(stored) as ShortlistState;
        setState({ saved: parsed.saved ?? [], dismissed: parsed.dismissed ?? [] });
      } catch {
        // Corrupted value -- start fresh.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const update = useCallback(
    (fn: (prev: ShortlistState) => ShortlistState) => {
      setState((prev) => {
        const next = fn(prev);
        void setStoredValue(storageKey(teamId), JSON.stringify(next));
        return next;
      });
    },
    [teamId]
  );

  const savedKeys = useMemo(() => new Set(state.saved.map((t) => suggestionKey(t.suggestion))), [state.saved]);
  const dismissedKeys = useMemo(() => new Set(state.dismissed), [state.dismissed]);

  const toggleSaved = useCallback(
    (s: TradeSuggestion) =>
      update((prev) => {
        const key = suggestionKey(s);
        return prev.saved.some((t) => suggestionKey(t.suggestion) === key)
          ? { ...prev, saved: prev.saved.filter((t) => suggestionKey(t.suggestion) !== key) }
          : { ...prev, saved: [{ suggestion: s, savedAt: new Date().toISOString() }, ...prev.saved] };
      }),
    [update]
  );

  const dismiss = useCallback(
    (s: TradeSuggestion) =>
      update((prev) => {
        const key = suggestionKey(s);
        return {
          saved: prev.saved.filter((t) => suggestionKey(t.suggestion) !== key),
          dismissed: prev.dismissed.includes(key) ? prev.dismissed : [...prev.dismissed, key],
        };
      }),
    [update]
  );

  const clearDismissed = useCallback(() => update((prev) => ({ ...prev, dismissed: [] })), [update]);

  return { savedTrades: state.saved, savedKeys, dismissedKeys, toggleSaved, dismiss, clearDismissed };
}
