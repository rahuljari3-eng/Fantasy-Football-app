// Players knocked out of a game by an injury, and how much of the offense's
// snaps each player was on -- so a game cut short by an injury isn't graded
// as a projection miss, or counted in his per-game averages, as if he'd
// played it all (lib/projectionAccuracy.ts isFullGame).
//
// Exits come from ESPN's play-by-play, which logs "CLV-M.Hall was injured
// during the play" and, when he comes back, "Injury Update: CLV-M.Hall has
// returned to the game". Snap shares come from Sleeper's weekly stats
// (off_snp / tm_off_snp), which post a day or two after the games -- they
// catch a return the play-by-play never logged.
import { nameKey } from "./consensus.js";

const ESPN_NFL_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SLEEPER_STATS_BASE = "https://api.sleeper.com/stats/nfl";
const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];

export interface GamePlayer {
  id: number;
  name: string;
  pos: string;
  /** ESPN pro team id (the same ids ESPN's scoreboard uses), now -- only a
   * fallback for a name the game's box score doesn't have. */
  teamId?: number;
}

/** An exit with at least this share of regulation left counts as cut short;
 * later than that he'd already played most of it. */
const EXIT_BY = 0.75;
/** Snaps at this share of his usual mean he came back after all. */
const RETURNED_SNAP_SHARE = 0.8;

/** Whether a game the play-by-play has him leaving hurt (`injuredAt`) really
 * cost him a meaningful part of it: hurt with a quarter or more to go, and
 * -- once snaps are in -- on well under his usual share of them (`usual`:
 * his snap shares in games he wasn't hurt). */
export function isInjuryExit(injuredAt: number | null | undefined, snapShare: number | null | undefined, usual: number[] | undefined): boolean {
  if (injuredAt == null || injuredAt > EXIT_BY) return false;
  if (snapShare == null || !usual?.length) return true;
  const median = [...usual].sort((a, b) => a - b)[Math.floor(usual.length / 2)];
  return snapShare < RETURNED_SNAP_SHARE * median;
}

type Play = { text?: string; period?: { number?: number }; clock?: { displayValue?: string } };

/** Share of regulation elapsed at a play, 0-1 (overtime is past 1). */
function elapsedAt(play: Play): number | null {
  const q = play.period?.number;
  const m = play.clock?.displayValue?.match(/^(\d+):(\d+)$/);
  if (!q || !m) return null;
  return ((q - 1) * 15 + (15 - Number(m[1]) - Number(m[2]) / 60)) / 60;
}

// Play-by-play names are "F.Last" (sometimes "Fi.Last" or "F. Last"),
// prefixed by a team code that doesn't always match the scoreboard's (CLV).
const INJURED = /\b[A-Z]{2,3}-([A-Z][a-z]?\.\s?[A-Za-z'.\- ]+?) was injured during the play/g;
const RETURNED = /\b[A-Z]{2,3}-([A-Z][a-z]?\.\s?[A-Za-z'.\- ]+?) has returned to the game/g;

const shortKey = (first: string, last: string) => `${first[0]?.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}`;

function playerShortKey(name: string): string {
  const parts = name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/, "").split(" ");
  return shortKey(parts[0] ?? "", parts.slice(1).join(""));
}

type BoxAthlete = { id?: string; firstName?: string; lastName?: string };
type Summary = {
  drives?: { previous?: { plays?: Play[] }[] };
  boxscore?: { players?: { statistics?: { athletes?: { athlete?: BoxAthlete }[] }[] }[] };
};

/** For each of `players` hurt in a finished `week` game who never returned:
 * the share of regulation that had elapsed when he went down. A note's name
 * is matched first against that game's box score -- everyone on either
 * side who recorded a stat, defenders included, on the team he was on that
 * week -- and only then against `players` by their current team. A name
 * that fits more than one player is skipped rather than guessed. */
export async function fetchInjuryExits(season: number, week: number, players: GamePlayer[]): Promise<Map<number, number>> {
  const wanted = new Set(players.map((p) => p.id));
  const byTeamKey = new Map<string, number[]>();
  players.forEach((p) => {
    if (p.teamId == null) return;
    const k = `${p.teamId}|${playerShortKey(p.name)}`;
    byTeamKey.set(k, [...(byTeamKey.get(k) ?? []), p.id]);
  });

  const res = await fetch(`${ESPN_NFL_SITE}/scoreboard?seasontype=2&week=${week}&dates=${season}`);
  if (!res.ok) throw new Error(`ESPN scoreboard for week ${week} failed (${res.status})`);
  type Event = { id: string; status: { type: { completed: boolean } }; competitions: { competitors: { team: { id: string } }[] }[] };
  const events = ((await res.json()) as { events?: Event[] }).events ?? [];

  const out = new Map<number, number>();
  for (const event of events) {
    if (!event.status.type.completed) continue;
    const teams = event.competitions[0]?.competitors.map((c) => Number(c.team.id)) ?? [];
    const summary = await fetch(`${ESPN_NFL_SITE}/summary?event=${event.id}`);
    if (!summary.ok) throw new Error(`ESPN game ${event.id} failed (${summary.status})`);
    const data = (await summary.json()) as Summary;
    const plays = (data.drives?.previous ?? []).flatMap((d) => d.plays ?? []);

    const inBox = new Map<string, Set<number>>();
    (data.boxscore?.players ?? []).forEach((side) =>
      (side.statistics ?? []).forEach((cat) =>
        (cat.athletes ?? []).forEach(({ athlete }) => {
          if (!athlete?.id || !athlete.firstName || !athlete.lastName) return;
          const k = shortKey(athlete.firstName, athlete.lastName);
          inBox.set(k, (inBox.get(k) ?? new Set()).add(Number(athlete.id)));
        })
      )
    );
    const resolve = (short: string): number | null => {
      const m = short.match(/^([A-Z])[a-z]?\.\s?(.+)$/);
      if (!m) return null;
      const k = shortKey(m[1], m[2]);
      const box = inBox.get(k);
      if (box?.size) return box.size === 1 && wanted.has([...box][0]) ? [...box][0] : null;
      const hits = teams.flatMap((t) => byTeamKey.get(`${t}|${k}`) ?? []);
      return hits.length === 1 ? hits[0] : null;
    };
    // Last word per player wins: hurt, back, hurt again ends as hurt.
    const hurtAt = new Map<number, number | null>();
    plays.forEach((play) => {
      const text = play.text ?? "";
      for (const m of text.matchAll(INJURED)) {
        const id = resolve(m[1]);
        if (id != null) hurtAt.set(id, elapsedAt(play));
      }
      for (const m of text.matchAll(RETURNED)) {
        const id = resolve(m[1]);
        if (id != null) hurtAt.set(id, null);
      }
    });
    hurtAt.forEach((at, id) => {
      if (at != null) out.set(id, Math.round(at * 100) / 100);
    });
  }
  return out;
}

/** Each of `players`' share of his team's offensive snaps in `week`, from
 * Sleeper's stats. `espnToSleeper` maps ids where known; the rest match on
 * name and position. Empty until Sleeper posts the week's snaps. */
export async function fetchSnapShares(
  season: number,
  week: number,
  players: Pick<GamePlayer, "id" | "name" | "pos">[],
  espnToSleeper: Map<number, string>
): Promise<Map<number, number>> {
  type Row = { player_id?: string; stats?: { off_snp?: number; tm_off_snp?: number }; player?: { first_name?: string; last_name?: string; position?: string } };
  const qs = SKILL_POSITIONS.map((p) => `position%5B%5D=${p}`).join("&");
  const res = await fetch(`${SLEEPER_STATS_BASE}/${season}/${week}?season_type=regular&${qs}`);
  if (!res.ok) throw new Error(`Sleeper stats for week ${week} failed (${res.status})`);
  const rows = (await res.json()) as Row[];

  const byId = new Map<string, number>();
  const byName = new Map<string, number[]>();
  rows.forEach((r) => {
    const team = r.stats?.tm_off_snp;
    if (!r.player_id || !team) return;
    const share = Math.round(((r.stats?.off_snp ?? 0) / team) * 100) / 100;
    byId.set(r.player_id, share);
    const key = nameKey(`${r.player?.first_name ?? ""} ${r.player?.last_name ?? ""}`, r.player?.position ?? "");
    byName.set(key, [...(byName.get(key) ?? []), share]);
  });

  const out = new Map<number, number>();
  players.forEach((p) => {
    const sleeperId = espnToSleeper.get(p.id);
    const named = byName.get(nameKey(p.name, p.pos));
    const share = (sleeperId != null ? byId.get(sleeperId) : undefined) ?? (named?.length === 1 ? named[0] : undefined);
    if (share != null) out.set(p.id, share);
  });
  return out;
}
