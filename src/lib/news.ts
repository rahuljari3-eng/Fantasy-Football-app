// Live news/injury feed, pulled straight from ESPN's public site API
// (site.api.espn.com -- a different host than the fantasy league API in
// lib/espn.ts, but it sends a wildcard CORS header so it's just as directly
// callable from the browser). Filtered down to players who are actually
// rostered in your league or sitting in the free-agent pool, and tagged with
// each player's real ESPN id so an article can be matched back to a specific
// Player.id anywhere in the app.
import type { InjurySeverity, NewsItem } from "../types";

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

// ESPN's own injury designation is the strongest signal we have for severity
// -- "Out"/"Doubtful"/IR-type statuses mean real, likely multi-week impact,
// while "Questionable" is a coin flip and "Active" (ESPN's injuries feed
// surfaces plenty of these -- depth-chart notes, contract signings, preseason
// box-score lines) usually isn't describing an actual injury at all. Keyword
// cues in the report's own shortComment then refine that baseline. We
// deliberately don't scan ESPN's longComment for keywords -- it often
// digresses into an unrelated teammate's injury ("...while Carson Beck
// (ribs) observed from the sidelines") which would otherwise misgrade a
// healthy player's stat line.
const SEVERE_STATUSES = new Set(["out", "doubtful", "injured reserve", "ir", "pup", "suspended", "suspension"]);
const MODERATE_STATUSES = new Set(["questionable"]);
const MINOR_STATUSES = new Set(["probable", "day-to-day", "day to day"]);

const SEVERE_KEYWORDS = [
  "torn acl", "acl tear", "tore his acl", "torn achilles", "achilles tear", "ruptured",
  "surgery", "surgically", "season-ending", "season ending", "out for the season",
  "ruled out for the season", "placed on injured reserve", "designation to return",
  "fracture", "fractured", "broken", "out indefinitely", "multiple weeks", "several weeks",
];
// Wording that signals genuine, live doubt about availability -- these push a
// named injury up to "moderate" even when the underlying status is "Active"
// (ESPN's structured status field lags this kind of write-up fairly often).
const CONCERN_KEYWORDS = [
  "strain", "sprain", "did not practice", "limited in practice", "game-time decision",
  "questionable to return", "sidelined", "injury", "aggravated", "reinjured", "setback", "flared up",
];
// Just naming a body part with no concern language attached -- a real injury,
// but nothing here suggests it's actually costing the player time (e.g. "caught
// three passes ... during Friday's win" with a parenthetical "(concussion)" tag
// on a guy who clearly played). Grading this "info" would drop a genuine injury
// from the feed entirely; grading it "moderate" would overstate a no-consequence
// one. "minor" is the honest answer either way.
const BODY_PART_KEYWORDS = [
  "concussion", "hamstring", "groin", "ankle", "knee", "shoulder", "quad", "calf",
  "achilles", "foot", "wrist", "elbow", "oblique", "toe", "ribs", "forearm", "hip", "back",
];

function hasKeyword(text: string, keyword: string): boolean {
  // Multi-word phrases are specific enough to substring-match safely; single
  // words use a boundary match so e.g. "hip" doesn't fire on "championship".
  return keyword.includes(" ") ? text.includes(keyword) : new RegExp(`\\b${keyword}\\b`).test(text);
}

// "info" is an internal-only grade -- a report that doesn't actually
// describe an injury. It's never exposed as an InjurySeverity; callers use it
// to decide whether the item should be reclassified as type "News" instead.
type InjuryGrade = InjurySeverity | "info";

const GRADE_RANK: Record<InjuryGrade, number> = { info: 0, minor: 1, moderate: 2, severe: 3 };

function maxGrade(a: InjuryGrade, b: InjuryGrade): InjuryGrade {
  return GRADE_RANK[b] > GRADE_RANK[a] ? b : a;
}

/** Grades how serious an injury report actually looks, from ESPN's own status
 * field plus keyword cues in the report's own shortComment -- see the comment
 * above. Returns "info" only when nothing here actually describes an injury;
 * any genuine injury -- even a no-consequence one -- gets at least "minor",
 * never falls through ungraded. */
export function gradeInjury(status: string, shortComment: string): InjuryGrade {
  const s = status.trim().toLowerCase();
  let grade: InjuryGrade = "info";
  if (SEVERE_STATUSES.has(s)) grade = "severe";
  else if (MODERATE_STATUSES.has(s)) grade = "moderate";
  else if (MINOR_STATUSES.has(s)) grade = "minor";

  const text = shortComment.toLowerCase();
  if (SEVERE_KEYWORDS.some((k) => hasKeyword(text, k))) {
    grade = maxGrade(grade, "severe");
  } else if (CONCERN_KEYWORDS.some((k) => hasKeyword(text, k))) {
    grade = maxGrade(grade, "moderate");
  } else if (BODY_PART_KEYWORDS.some((k) => hasKeyword(text, k))) {
    grade = maxGrade(grade, "minor");
  }

  return grade;
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
      const severity = gradeInjury(entry.status, entry.shortComment ?? "");
      // A "graded non-injury" is a contradiction -- if the write-up doesn't
      // actually describe an injury (ESPN's injuries feed also carries
      // depth-chart notes, signings, and preseason box-score lines), it
      // belongs in the general News bucket, not tagged "Injury".
      if (severity === "info") {
        items.push({
          id: `injury-${entry.id}`,
          type: "News",
          playerId,
          player: entry.athlete?.displayName ?? "",
          headline: entry.shortComment || `Listed as ${entry.status}.`,
          time: formatNewsTime(entry.date),
          publishedAt: entry.date,
          link,
        });
        return;
      }
      items.push({
        id: `injury-${entry.id}`,
        type: "Injury",
        playerId,
        player: entry.athlete?.displayName ?? "",
        headline: entry.shortComment || `Listed as ${entry.status}.`,
        time: formatNewsTime(entry.date),
        publishedAt: entry.date,
        link,
        severity,
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
