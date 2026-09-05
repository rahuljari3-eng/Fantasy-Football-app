import type { Position, RosterSlotId } from "../types.js";

// Everything specific to *your* real league lives here. Point this at a
// different ESPN league (or a different season) by editing this one file --
// nothing under src/lib or src/pages hardcodes any of it.
export const LEAGUE_CONFIG = {
  appName: "GRIDIRON HQ",
  leagueName: "Ten Idiots League",
  espnLeagueId: "973201555",
  espnSeason: 2026,
  scoringFormatLabel: "PPR · 1QB/2RB/2WR/1TE/1FLEX/1DST/1K",
  myTeamName: "Tush Pushers",
  myOwnerName: "Rahul Jariwala",
};

// ESPN's read host reflects the request's Origin in its CORS headers for this
// league, so the app can call it directly from the browser for a live refresh --
// see src/lib/espn.ts.
export const ESPN_LEAGUE_BASE_URL =
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${LEAGUE_CONFIG.espnSeason}/segments/0/leagues/${LEAGUE_CONFIG.espnLeagueId}`;

/** Your starting-lineup slots, in display order. */
export const SLOTS: RosterSlotId[] = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "DST", "K"];

/** Which real positions are eligible to fill each starting slot. */
export const SLOT_ELIGIBILITY: Record<RosterSlotId, Position[]> = {
  QB: ["QB"],
  RB1: ["RB"],
  RB2: ["RB"],
  WR1: ["WR"],
  WR2: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  DST: ["DST"],
  K: ["K"],
};

/** Every roster-able position, used for iterating needs/values position-by-position. */
export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "DST", "K"];

/** How many starters are required at each position (drives the AI Coach's needs analysis). */
export const REQUIRED_STARTERS: Record<Position, number> = { QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1 };

/** Tailwind classes for each position's badge color. */
export const POS_COLORS: Record<Position, string> = {
  QB: "bg-red-500/20 text-red-300 border-red-500/40",
  RB: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  WR: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  TE: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  DST: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  K: "bg-pink-500/20 text-pink-300 border-pink-500/40",
};
