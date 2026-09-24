// Rest-of-season calendar helpers for rosValue. Tunables / fallback length live
// in config/scoring.ts; this module only counts remaining games.
import {
  ROS_HORIZON_THROUGH_WEEK,
  ROS_WEEKS,
} from "../config/scoring.js";

/** Module-level scoring week used when callers don't pass one (Sensei tools,
 * Trade Analyzer after the app sets it from ESPN). */
let _currentWeek: number | null = null;
let _throughWeek: number = ROS_HORIZON_THROUGH_WEEK;

/** Tell valuation what "now" and "season end" are. Safe to call on every
 * projection / roster sync. */
export function setRosHorizon(currentWeek: number, throughWeek: number = ROS_HORIZON_THROUGH_WEEK): void {
  if (Number.isFinite(currentWeek) && currentWeek > 0) _currentWeek = Math.floor(currentWeek);
  if (Number.isFinite(throughWeek) && throughWeek > 0) _throughWeek = Math.floor(throughWeek);
}

export function getRosCurrentWeek(): number | null {
  return _currentWeek;
}

export function getRosThroughWeek(): number {
  return _throughWeek;
}

/** Count of game weeks still ahead for ROS pricing: from currentWeek through
 * throughWeek, excluding a remaining bye. Floored at 1 so end-season / bye
 * week never zeros every player out. When current week is unknown, falls back
 * to ROS_WEEKS (early-season full-season estimate). */
export function remainingRosWeeks(opts?: {
  currentWeek?: number | null;
  bye?: number | null;
  throughWeek?: number | null;
}): number {
  const current = opts?.currentWeek ?? _currentWeek;
  const through = opts?.throughWeek ?? _throughWeek;
  if (current == null || !Number.isFinite(current) || current <= 0) return ROS_WEEKS;

  const start = Math.floor(current);
  const end = Math.max(start, Math.floor(through));
  let weeks = end - start + 1;
  const bye = opts?.bye;
  if (typeof bye === "number" && bye >= start && bye <= end) weeks -= 1;
  return Math.max(1, weeks);
}
