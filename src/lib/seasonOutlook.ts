// Where the managed team stands in the season, turned into how trade and
// waiver advice should lean: a near-lock contender builds for the fantasy
// playoffs, a bubble team needs this week's points, a long shot needs to win
// out. Driven by the playoff simulator (lib/playoffOdds.ts) and the league's
// trade deadline (ESPN settings), so it moves on its own as the season does.
import { FANTASY_PLAYOFF_START_WEEK } from "../config/scoring.js";
import type { TradeUrgency } from "./coachTrades.js";
import type { PlayoffOutlook } from "./playoffOdds.js";

export type SeasonMode = "contender" | "bubble" | "longshot" | "eliminated" | "playoffs";

/** Playoff odds at or above this read as a contender; below LONGSHOT, a long shot. */
const CONTENDER_ODDS = 80;
const LONGSHOT_ODDS = 20;
/** Days before the deadline the countdown turns urgent. */
const DEADLINE_URGENT_DAYS = 3;
const DAY_MS = 86_400_000;

export interface TradeDeadlineInfo {
  at: number;
  daysLeft: number;
  passed: boolean;
  urgent: boolean;
}

export interface SeasonOutlook {
  mode: SeasonMode;
  /** How trade suggestions get re-ranked (lib/coachTrades.ts
   * rankSuggestionsForSituation) -- order only, never fairness. */
  urgency: TradeUrgency;
  makeOdds: number | null;
  headline: string;
  advice: string;
  deadline: TradeDeadlineInfo | null;
}

export function tradeDeadlineInfo(deadline: number | null | undefined, now = Date.now()): TradeDeadlineInfo | null {
  if (!deadline) return null;
  const msLeft = deadline - now;
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
  return { at: deadline, daysLeft, passed: msLeft <= 0, urgent: msLeft > 0 && msLeft <= DEADLINE_URGENT_DAYS * DAY_MS };
}

export function computeSeasonOutlook(opts: {
  outlook: PlayoffOutlook | null | undefined;
  currentWeek: number | null | undefined;
  regularSeasonWeeks: number | null | undefined;
  tradeDeadline: number | null | undefined;
  now?: number;
}): SeasonOutlook | null {
  const deadline = tradeDeadlineInfo(opts.tradeDeadline, opts.now);
  const week = opts.currentWeek ?? null;
  const regWeeks = opts.regularSeasonWeeks ?? FANTASY_PLAYOFF_START_WEEK - 1;
  const playoffWeeks = `weeks ${regWeeks + 1}–${regWeeks + 3}`;

  if (week != null && week > regWeeks) {
    return {
      mode: "playoffs",
      urgency: "must_win",
      makeOdds: opts.outlook?.makeOdds ?? null,
      headline: "Fantasy playoffs",
      advice: "Win-or-go-home: start the best projection this week and pick up players for this week's matchup, not later ones.",
      deadline,
    };
  }
  const o = opts.outlook;
  if (!o) return deadline ? { mode: "bubble", urgency: "neutral", makeOdds: null, headline: "Season outlook loading", advice: "", deadline } : null;

  const odds = Math.round(o.makeOdds);
  if (o.status === "eliminated") {
    return {
      mode: "eliminated",
      urgency: "neutral",
      makeOdds: 0,
      headline: "Eliminated from playoff contention",
      advice: "Nothing left to chase this season, so the suggestions here just rank trades and pickups by overall value.",
      deadline,
    };
  }
  if (o.status === "clinched" || odds >= CONTENDER_ODDS) {
    return {
      mode: "contender",
      urgency: "playoff_push",
      makeOdds: odds,
      headline: o.status === "clinched" ? "Playoff spot clinched" : `${odds >= 100 ? "99%+" : `${odds}%`} to make the playoffs`,
      advice: `Build for the fantasy playoffs (${playoffWeeks}): trade suggestions lean toward rest-of-season value, and each player's season value already counts his playoff-week schedule double. A rough week before then costs you less than a weak playoff lineup.`,
      deadline,
    };
  }
  if (odds >= LONGSHOT_ODDS) {
    return {
      mode: "bubble",
      urgency: "must_win",
      makeOdds: odds,
      headline: `On the bubble — ${odds}% to make the playoffs`,
      advice: `Every remaining regular-season game counts${o.gamesBackOfCutoff > 0 ? ` (${o.gamesBackOfCutoff} game${o.gamesBackOfCutoff === 1 ? "" : "s"} back of the cutoff)` : ""}: trade suggestions lean toward points this week. Playoff schedules only help once you're in.`,
      deadline,
    };
  }
  return {
    mode: "longshot",
    urgency: "must_win",
    makeOdds: odds,
    headline: `Long shot — ${odds}% to make the playoffs`,
    advice: "You likely need to win out, so trade suggestions lean toward points this week. Take upside over safety.",
    deadline,
  };
}
