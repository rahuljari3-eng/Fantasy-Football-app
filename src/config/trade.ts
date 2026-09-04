// Tunables for the AI Coach's trade-evaluation engine in lib/tradeEngine.ts.

/** PACKAGE VALUE: a side of a trade is NOT the sum of its players. The single
 * best player counts in full; every ADDITIONAL player contributes only its
 * ABOVE-REPLACEMENT portion (value minus VOR_BASELINE), and that portion is
 * discounted compounding by EXTRA_PIECE_DISCOUNT per step (2nd piece x d, 3rd
 * piece x d**2, ...). Consequences: bundling replacement-level bodies adds
 * almost nothing, and you can't out-total one stud by stacking role players --
 * which is exactly how real fantasy trades work. Lower d = harsher on
 * quantity; ~0.3-0.5 is sane. */
export const EXTRA_PIECE_DISCOUNT = 0.4;

/** FAIRNESS RATIO window: a trade's fairness is (value you get) / (value you
 * give), after the package discount and team-need adjustment. The Coach only
 * surfaces trades whose ratio lands in this window, but the exact ratio is
 * always shown -- trades near the edges are where team context should tip the
 * call. */
export const FAIR_RATIO_MIN = 0.92;
export const FAIR_RATIO_MAX = 1.12;

/** Wider band used only to LABEL a trade in the UI. Inside LOPSIDED_* but
 * outside FAIR_* reads as "slightly favors X"; outside LOPSIDED_* reads as
 * "lopsided -- context matters". */
export const LOPSIDED_RATIO_MIN = 0.9;
export const LOPSIDED_RATIO_MAX = 1.1;

/** STAR GATE: if either side of a trade sends a Tier-1 player (a genuine
 * difference-maker), the other side must send back BOTH (a) at least one
 * Tier-1 or Tier-2 player, AND (b) a single player worth at least
 * STAR_RETURN_MIN_TOP_FRACTION of the star's value. A stud for "a good starter
 * plus filler" is flagged "likely unfair" no matter what the computed value
 * gap says -- scarcity at the top isn't captured by any points model, and it
 * can't be reconstituted from role players. */
export const REQUIRE_STAR_RETURN = true;
export const STAR_RETURN_MIN_TOP_FRACTION = 0.8;

/** TEAM-NEED MULTIPLIER: a side's incoming value is scaled UP when a player
 * fills a genuine hole for the team receiving him, and DOWN when that team is
 * already stacked at the position -- so the same trade can grade differently
 * for two different teams. */
export const NEED_MULTIPLIER_FILL = 1.15;
export const NEED_MULTIPLIER_STACKED = 0.85;
export const NEED_MULTIPLIER_NEUTRAL = 1;

/** How many suggestions the AI Coach shows at once. */
export const COACH_MAX_SUGGESTIONS = 6;

/** The list is always a MIX of package shapes, never all one kind: at least
 * this many straight 1-for-1 swaps and this many 2-for-2 swaps are guaranteed
 * (topped up from the fallback tiers if the need/value generators come up
 * short). The remaining slots are filled with the best of anything left. */
export const COACH_MIN_ONE_FOR_ONE = 2;
export const COACH_MIN_TWO_FOR_TWO = 2;
