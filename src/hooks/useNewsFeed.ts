// Live news/injury feed: pulls current headlines and injury notes for every
// player in your league (rostered or free agent) directly from ESPN.
// Self-contained -- it only produces a NewsItem[], and doesn't know anything
// about rosters, trades, etc. Persisted so the feed still shows something on
// a fresh load before the first refresh completes.
import { useCallback, useState } from "react";
import { fetchLeagueNewsFeed } from "../lib/news";
import { setStoredValue } from "../lib/storage";
import type { NewsItem } from "../types";

const NEWS_KEY = "news-feed";
const NEWS_META_KEY = "news-feed-meta";

export function useNewsFeed(relevantPlayerIds: Set<number>) {
  const [newsFeed, setNewsFeed] = useState<NewsItem[]>(() => {
    try {
      const raw = window.localStorage.getItem(NEWS_KEY);
      return raw ? (JSON.parse(raw) as NewsItem[]) : [];
    } catch {
      return [];
    }
  });
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsLastRefreshed, setNewsLastRefreshed] = useState<string | null>(() => {
    try {
      const raw = window.localStorage.getItem(NEWS_META_KEY);
      return raw ? (JSON.parse(raw).lastRefreshed ?? null) : null;
    } catch {
      return null;
    }
  });

  const refreshNews = useCallback(async () => {
    setNewsRefreshing(true);
    setNewsError(null);
    try {
      const fresh = await fetchLeagueNewsFeed(relevantPlayerIds);
      setNewsFeed(fresh);
      const nowIso = new Date().toISOString();
      setNewsLastRefreshed(nowIso);
      await setStoredValue(NEWS_KEY, JSON.stringify(fresh));
      await setStoredValue(NEWS_META_KEY, JSON.stringify({ lastRefreshed: nowIso }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNewsError(`Couldn't reach ESPN for news (${message}).`);
    } finally {
      setNewsRefreshing(false);
    }
  }, [relevantPlayerIds]);

  return { newsFeed, newsRefreshing, newsError, newsLastRefreshed, refreshNews };
}
