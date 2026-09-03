// Tunables for the trade-fairness engine in lib/tradeEngine.ts.

/** Fairness band for every AI Coach suggestion: net value (what you get minus
 * what you give) must land between these two numbers -- a little in the other
 * side's favor is fine (down to MIN), and a little in your favor is fine (up
 * to MAX), but not absurdly lopsided either way. */
export const TRADE_BAND_MIN = -1.5;
export const TRADE_BAND_MAX = 3;

/** Consolidating several players into one (or vice versa) isn't just "add up
 * the points" -- whichever side sends MORE pieces is trading quantity for a
 * scarcer, harder-to-replicate asset, and real managers demand a premium for
 * that. Each extra piece on one side shifts the required fairness band this
 * many points against the side sending more pieces. */
export const CONSOLIDATION_PENALTY_PER_EXTRA_PIECE = 5;

/** How many suggestions the AI Coach shows at once, and the minimum before it
 * pads the list out with fair "fallback" swaps so the tab is never empty. */
export const COACH_MAX_SUGGESTIONS = 6;
export const COACH_MIN_BEFORE_FALLBACK = 4;
