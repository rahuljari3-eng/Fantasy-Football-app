// Live news/injury feed, pulled straight from ESPN's public site API
// (site.api.espn.com -- a different host than the fantasy league API in
// lib/espn.ts, but it sends a wildcard CORS header so it's just as directly
// callable from the browser). Filtered down to players who are actually
// rostered in your league or sitting in the free-agent pool, and tagged with
// each player's real ESPN id so an article can be matched back to a specific
// Player.id anywhere in the app.
import type { NewsItem } from "../types";

const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";
const INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";

interface EspnNewsCategory {
  type: string;
  athleteId?: number;
  description?: string;
}
interface EspnNewsArticle {
  headline: string;
  published: string;
  categories?: EspnNewsCategory[];
  links?: { web?: { href?: string } };
}
interface EspnNewsResponse {
  articles?: EspnNewsArticle[];
}

interface EspnAthleteLink {
  rel: string[];
  href: string;
}
interface EspnInjuryEntry {
  id: string;
  status: string;
  date: string;
  shortComment?: string;
  // ESPN's injuries endpoint doesn't expose the athlete's numeric id as its
  // own field -- it only shows up embedded in these link hrefs
  // (".../player/_/id/4870808/jeremiyah-love"), so extractAthleteId below
  // pulls it out of there instead.
  athlete?: { displayName?: string; links?: EspnAthleteLink[] };
}
interface EspnInjuryTeamGroup {
  injuries?: EspnInjuryEntry[];
}
interface EspnInjuryResponse {
  injuries?: EspnInjuryTeamGroup[];
}

async function fetchGeneralNews(relevantIds: Set<number>): Promise<NewsItem[]> {
  const res = await fetch(NEWS_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN news request failed (${res.status})`);
  const data = (await res.json()) as EspnNewsResponse;
  const items: NewsItem[] = [];

  (data.articles || []).forEach((a, i) => {
    const athleteCat = (a.categories || []).find((c) => c.type === "athlete" && c.athleteId != null);
    const playerId = athleteCat?.athleteId;
    const link = a.links?.web?.href;
    if (playerId == null || !relevantIds.has(playerId) || !link) return;
    items.push({
      id: `news-${playerId}-${i}`,
      type: "News",
      playerId,
      player: athleteCat?.description ?? "",
      headline: a.headline,
      time: formatNewsTime(a.published),
      publishedAt: a.published,
      link,
    });
  });

  return items;
}

/** Pulls the numeric athlete id out of an ESPN player-link href like
 * "https://www.espn.com/nfl/player/_/id/4870808/jeremiyah-love". */
function extractAthleteId(links: EspnAthleteLink[] | undefined): number | null {
  for (const l of links || []) {
    const match = l.href.match(/\/id\/(\d+)\//);
    if (match) return Number(match[1]);
  }
  return null;
}

async function fetchInjuryNews(relevantIds: Set<number>): Promise<NewsItem[]> {
  const res = await fetch(INJURIES_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN injuries request failed (${res.status})`);
  const data = (await res.json()) as EspnInjuryResponse;
  const items: NewsItem[] = [];

  (data.injuries || []).forEach((group) => {
    (group.injuries || []).forEach((entry) => {
      const playerId = extractAthleteId(entry.athlete?.links);
      if (playerId == null || !relevantIds.has(playerId)) return;
      const link =
        entry.athlete?.links?.find((l) => l.rel.includes("news"))?.href ??
        entry.athlete?.links?.find((l) => l.rel.includes("playercard"))?.href;
      if (!link) return;
      items.push({
        id: `injury-${entry.id}`,
        type: "Injury",
        playerId,
        player: entry.athlete?.displayName ?? "",
        headline: entry.shortComment || `Listed as ${entry.status}.`,
        time: formatNewsTime(entry.date),
        publishedAt: entry.date,
        link,
      });
    });
  });

  return items;
}

/** Every current news/injury item touching a player in `relevantIds` (your
 * league's rosters + free-agent pool), newest first. Either source failing
 * independently just means that half of the feed is thinner this refresh --
 * it doesn't block the other. */
export async function fetchLeagueNewsFeed(relevantIds: Set<number>): Promise<NewsItem[]> {
  const [news, injuries] = await Promise.all([
    fetchGeneralNews(relevantIds).catch(() => [] as NewsItem[]),
    fetchInjuryNews(relevantIds).catch(() => [] as NewsItem[]),
  ]);
  return [...injuries, ...news].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function formatNewsTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hoursAgo = (Date.now() - date.getTime()) / 3_600_000;
  if (hoursAgo < 1) return "Just now";
  if (hoursAgo < 24) return `${Math.floor(hoursAgo)}h ago`;
  if (hoursAgo < 24 * 7) return `${Math.floor(hoursAgo / 24)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
