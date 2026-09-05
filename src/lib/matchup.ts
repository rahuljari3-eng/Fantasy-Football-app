// Weekly matchup data, pulled from ESPN's public scoreboard + odds APIs (no
// auth needed -- both hosts send permissive CORS). Two signals feed the
// grade for each player:
//
//  1. The game's overall Vegas-implied scoring environment (team total) --
//     how good the game script looks for scoring in general.
//  2. For QB/RB/WR/TE, that specific player's own posted yardage prop line
//     (passing/rushing/receiving) -- how big a role Vegas actually expects
//     for THIS player, which the team total alone can't tell you (a plus
//     game script doesn't help a WR3 whose own line is modest).
//
// Both come from the betting market rather than defense-vs-position stats:
// in the season's early weeks there isn't enough of a sample for "yards
// allowed to RBs" to mean anything, whereas the market already prices in
// opponent strength, injuries, and expected usage for this specific week.
import type { MatchupGrade, Player, PlayerMatchup, Position } from "../types";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const CORE_API_BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
// DraftKings -- same provider id used for the team-total odds on the
// scoreboard, so the two signals are at least internally consistent.
const ODDS_PROVIDER_ID = "100";

interface EspnOdds {
  spread?: number;
  overUnder?: number;
}
interface EspnCompetitor {
  team?: { abbreviation?: string };
  homeAway?: "home" | "away";
}
interface EspnCompetition {
  competitors?: EspnCompetitor[];
  odds?: EspnOdds[];
  date?: string;
}
interface EspnEvent {
  id?: string;
  competitions?: EspnCompetition[];
}
interface EspnScoreboardResponse {
  week?: { number?: number };
  events?: EspnEvent[];
}

export interface TeamMatchup {
  opponent: string;
  homeAway: "home" | "away";
  /** This team's own implied point total for the game, from Vegas' spread +
   * total. Null if no line has posted yet. */
  impliedTeamTotal: number | null;
  /** The opponent's implied point total -- what a DST is actually graded on. */
  opponentImpliedTotal: number | null;
  kickoff: string | null;
}

/** A player's own posted yardage prop lines for the week, whichever the
 * sportsbook has listed for them. Keyed by ESPN athlete id (same id space as
 * Player.id) in WeeklyMatchups.playerProps. */
export interface PlayerPropLines {
  passYards?: number;
  rushYards?: number;
  recYards?: number;
  /** "Rush + receiving yards" -- offered mainly for pass-catching RBs; a
   * better PPR-relevant volume signal than rushing yards alone when present. */
  rushRecYards?: number;
}

export interface WeeklyMatchups {
  week: number | null;
  /** Keyed by NFL team abbreviation (e.g. "SEA", "GB"). A team absent here is
   * on a bye. */
  teams: Record<string, TeamMatchup>;
  /** Keyed by ESPN athlete id. A player absent here has no posted prop line
   * (backup-caliber player, or lines haven't gone up yet) -- gradeMatchup
   * falls back to the team-environment grade alone in that case. */
  playerProps: Record<number, PlayerPropLines>;
}

export const EMPTY_MATCHUPS: WeeklyMatchups = { week: null, teams: {}, playerProps: {} };

interface EspnPropBetItem {
  athlete?: { $ref?: string };
  type?: { id?: string };
  current?: { target?: { value?: number } };
  open?: { target?: { value?: number } };
}
interface EspnPropBetsResponse {
  items?: EspnPropBetItem[];
}

const PROP_TYPE_ID = { pass: "8", rush: "12", rec: "13", rushRec: "20" } as const;

function extractAthleteId(ref: string | undefined): number | null {
  const match = ref?.match(/\/athletes\/(\d+)/);
  return match ? Number(match[1]) : null;
}

/** One game's full prop-bet board, filtered down to the yardage props we
 * care about and keyed by athlete id. Best-effort -- a game whose props
 * haven't posted, or that 404s, just contributes nothing. */
async function fetchGamePropLines(eventId: string): Promise<Record<number, PlayerPropLines>> {
  const url = `${CORE_API_BASE}/events/${eventId}/competitions/${eventId}/odds/${ODDS_PROVIDER_ID}/propBets?lang=en&region=us&limit=500`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN prop odds request failed (${res.status})`);
  const data = (await res.json()) as EspnPropBetsResponse;
  const props: Record<number, PlayerPropLines> = {};

  (data.items || []).forEach((item) => {
    const typeId = item.type?.id;
    if (!typeId || !Object.values(PROP_TYPE_ID).includes(typeId as (typeof PROP_TYPE_ID)[keyof typeof PROP_TYPE_ID])) return;
    const athleteId = extractAthleteId(item.athlete?.$ref);
    const value = item.current?.target?.value ?? item.open?.target?.value;
    if (athleteId == null || value == null) return;

    const entry = props[athleteId] ?? {};
    if (typeId === PROP_TYPE_ID.pass) entry.passYards = value;
    else if (typeId === PROP_TYPE_ID.rush) entry.rushYards = value;
    else if (typeId === PROP_TYPE_ID.rec) entry.recYards = value;
    else if (typeId === PROP_TYPE_ID.rushRec) entry.rushRecYards = value;
    props[athleteId] = entry;
  });

  return props;
}

async function fetchAllPlayerPropLines(eventIds: string[]): Promise<Record<number, PlayerPropLines>> {
  const results = await Promise.allSettled(eventIds.map(fetchGamePropLines));
  const merged: Record<number, PlayerPropLines> = {};
  // Each game's athletes are disjoint from every other game's, so a plain
  // merge can't clobber one game's data with another's.
  results.forEach((r) => {
    if (r.status === "fulfilled") Object.assign(merged, r.value);
  });
  return merged;
}

/** Pulls this week's full NFL schedule + lines (team totals AND every
 * player's own yardage prop) and turns it into the lookup gradeMatchup uses.
 * ESPN's scoreboard defaults to "this week" based on today's date, so no
 * week number needs to be computed here. */
export async function fetchWeeklyMatchups(): Promise<WeeklyMatchups> {
  const res = await fetch(SCOREBOARD_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN scoreboard request failed (${res.status})`);
  const data = (await res.json()) as EspnScoreboardResponse;
  const teams: Record<string, TeamMatchup> = {};
  const eventIds: string[] = [];

  (data.events || []).forEach((ev) => {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    const homeAbbr = home?.team?.abbreviation;
    const awayAbbr = away?.team?.abbreviation;
    if (!comp || !homeAbbr || !awayAbbr) return;
    if (ev.id) eventIds.push(ev.id);

    // ESPN's spread is relative to the home team (negative = home favored).
    const odds = comp.odds?.[0];
    let homeImplied: number | null = null;
    let awayImplied: number | null = null;
    if (odds?.overUnder != null && odds?.spread != null) {
      homeImplied = Math.round((odds.overUnder / 2 - odds.spread / 2) * 10) / 10;
      awayImplied = Math.round((odds.overUnder / 2 + odds.spread / 2) * 10) / 10;
    }

    teams[homeAbbr] = {
      opponent: awayAbbr,
      homeAway: "home",
      impliedTeamTotal: homeImplied,
      opponentImpliedTotal: awayImplied,
      kickoff: comp.date ?? null,
    };
    teams[awayAbbr] = {
      opponent: homeAbbr,
      homeAway: "away",
      impliedTeamTotal: awayImplied,
      opponentImpliedTotal: homeImplied,
      kickoff: comp.date ?? null,
    };
  });

  // Best-effort: if the prop-odds fetch fails entirely, every player just
  // falls back to a team-environment-only grade instead of blocking the
  // whole matchup refresh.
  const playerProps = await fetchAllPlayerPropLines(eventIds).catch(() => ({}) as Record<number, PlayerPropLines>);

  return { week: data.week?.number ?? null, teams, playerProps };
}

// Points on a common scale so a team-environment grade and a player-prop
// grade can be summed into one combined grade below.
const GRADE_POINTS: Record<MatchupGrade, number> = { A: 2, B: 1, C: 0, D: -1, F: -2 };

function gradeFromPoints(points: number): MatchupGrade {
  if (points >= 3) return "A";
  if (points >= 1) return "B";
  if (points >= -1) return "C";
  if (points >= -3) return "D";
  return "F";
}

// Team-environment thresholds, tuned around a league-average implied team
// total of ~22-23 points. Checked high-to-low; whatever clears first wins.
const OFFENSE_GRADE_THRESHOLDS: [number, MatchupGrade][] = [
  [27, "A"],
  [23.5, "B"],
  [20, "C"],
  [17, "D"],
];

function gradeOffenseImplied(value: number): MatchupGrade {
  for (const [min, grade] of OFFENSE_GRADE_THRESHOLDS) {
    if (value >= min) return grade;
  }
  return "F";
}

// For DST, a *lower* opponent implied total is the better matchup.
const DEFENSE_GRADE_THRESHOLDS: [number, MatchupGrade][] = [
  [17, "A"],
  [20, "B"],
  [23.5, "C"],
  [27, "D"],
];

function gradeDefenseImplied(opponentValue: number): MatchupGrade {
  for (const [max, grade] of DEFENSE_GRADE_THRESHOLDS) {
    if (opponentValue <= max) return grade;
  }
  return "F";
}

function gradeFromThresholds(value: number, thresholds: [number, MatchupGrade][]): MatchupGrade {
  for (const [min, grade] of thresholds) {
    if (value >= min) return grade;
  }
  return "F";
}

// Player-volume thresholds per stat, from that week's own posted line. Not
// position-average-tuned in the abstract -- tuned to what a plus/tough
// fantasy-relevant workload actually looks like for that stat.
const PASS_YARDS_THRESHOLDS: [number, MatchupGrade][] = [
  [280, "A"],
  [250, "B"],
  [220, "C"],
  [190, "D"],
];
const RUSH_REC_YARDS_THRESHOLDS: [number, MatchupGrade][] = [
  [110, "A"],
  [85, "B"],
  [65, "C"],
  [45, "D"],
];
const RUSH_YARDS_THRESHOLDS: [number, MatchupGrade][] = [
  [90, "A"],
  [70, "B"],
  [50, "C"],
  [35, "D"],
];
const REC_YARDS_THRESHOLDS: [number, MatchupGrade][] = [
  [75, "A"],
  [60, "B"],
  [45, "C"],
  [30, "D"],
];

/** This player's own yardage prop, graded on its own -- null for K/DST
 * (no relevant prop exists) or if the book hasn't posted a line for them. */
function gradePlayerProp(pos: Position, playerId: number, matchups: WeeklyMatchups): { grade: MatchupGrade; label: string } | null {
  const props = matchups.playerProps[playerId];
  if (!props) return null;

  if (pos === "QB" && props.passYards != null) {
    return { grade: gradeFromThresholds(props.passYards, PASS_YARDS_THRESHOLDS), label: `${props.passYards} proj. pass yds` };
  }
  if (pos === "RB") {
    // Prefer the combined rush+rec line when the book offers one -- it's the
    // more accurate PPR volume signal for a pass-catching back.
    if (props.rushRecYards != null) {
      return { grade: gradeFromThresholds(props.rushRecYards, RUSH_REC_YARDS_THRESHOLDS), label: `${props.rushRecYards} proj. rush+rec yds` };
    }
    if (props.rushYards != null) {
      return { grade: gradeFromThresholds(props.rushYards, RUSH_YARDS_THRESHOLDS), label: `${props.rushYards} proj. rush yds` };
    }
  }
  if ((pos === "WR" || pos === "TE") && props.recYards != null) {
    return { grade: gradeFromThresholds(props.recYards, REC_YARDS_THRESHOLDS), label: `${props.recYards} proj. rec yds` };
  }
  return null;
}

/** This player's matchup for the current week -- their team's opponent, home/
 * away, and a grade blending the game's team-environment grade with (for
 * QB/RB/WR/TE) their own posted yardage prop. Falls back to the team-
 * environment grade alone for K/DST or when no prop line has posted yet, so
 * those cases behave exactly as if the player-prop signal didn't exist. */
export function gradeMatchup(player: Pick<Player, "id" | "pos" | "team">, matchups: WeeklyMatchups): PlayerMatchup {
  const t = matchups.teams[player.team];
  if (!t) {
    return { opponent: null, homeAway: null, isBye: true, grade: null, impliedTotal: null, propLine: null, label: "Bye week" };
  }

  const oppLabel = t.homeAway === "home" ? `vs ${t.opponent}` : `@ ${t.opponent}`;
  const relevant = player.pos === "DST" ? t.opponentImpliedTotal : t.impliedTeamTotal;
  if (relevant == null) {
    return { opponent: t.opponent, homeAway: t.homeAway, isBye: false, grade: null, impliedTotal: null, propLine: null, label: oppLabel };
  }

  const teamGrade = player.pos === "DST" ? gradeDefenseImplied(relevant) : gradeOffenseImplied(relevant);
  const teamLabel = player.pos === "DST" ? `opponent implied ${relevant} pts` : `implied ${relevant} pts`;

  const prop = gradePlayerProp(player.pos, player.id, matchups);
  const grade = prop ? gradeFromPoints(GRADE_POINTS[teamGrade] + GRADE_POINTS[prop.grade]) : teamGrade;
  const label = prop ? `${oppLabel} — ${teamLabel}, ${prop.label}` : `${oppLabel} — ${teamLabel}`;

  return {
    opponent: t.opponent,
    homeAway: t.homeAway,
    isBye: false,
    grade,
    impliedTotal: relevant,
    propLine: prop ? { label: prop.label, grade: prop.grade } : null,
    label,
  };
}
