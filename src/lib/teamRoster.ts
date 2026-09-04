// Turns a team's real ESPN roster (each player tagged with a lineup slot +
// starter flag) into the roster-builder's own slot-assignment shape. Used to
// seed the builder whenever you switch which team you're managing.
import { SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import type { LeagueTeam, RosterAssignments, RosterSlotId } from "../types";

// ESPN's slot label -> the builder slot(s) it can map onto, in priority order.
const ESPN_SLOT_TARGETS: Record<string, RosterSlotId[]> = {
  QB: ["QB"],
  RB: ["RB1", "RB2"],
  WR: ["WR1", "WR2"],
  TE: ["TE"],
  FLEX: ["FLEX"],
  "RB/WR/TE": ["FLEX"],
  DST: ["DST"],
  "D/ST": ["DST"],
  DEF: ["DST"],
  K: ["K"],
};

function assignFromSlots(
  team: LeagueTeam,
  slotOf: (playerId: number) => string | undefined
): { roster: RosterAssignments; bench: number[] } {
  const roster: RosterAssignments = {};
  const bench: number[] = [];

  team.roster.forEach((p) => {
    const slot = slotOf(p.id);
    const onBench = !slot || slot === "BE" || slot === "IR";
    if (onBench) {
      bench.push(p.id);
      return;
    }

    // Prefer the slot ESPN actually had them in; fall back to any open,
    // position-eligible slot so a starter is never silently dropped.
    const preferred = ESPN_SLOT_TARGETS[slot] ?? [];
    let target = preferred.find((s) => roster[s] == null && SLOT_ELIGIBILITY[s].includes(p.pos));
    if (!target) target = SLOTS.find((s) => roster[s] == null && SLOT_ELIGIBILITY[s].includes(p.pos));

    if (target) roster[target] = p.id;
    else bench.push(p.id);
  });

  return { roster, bench };
}

export function deriveAssignments(team: LeagueTeam): { roster: RosterAssignments; bench: number[] } {
  return assignFromSlots(team, (id) => {
    const p = team.roster.find((r) => r.id === id);
    return p && p.starter ? p.slot : undefined;
  });
}

/** Same slot-assignment logic as deriveAssignments, but driven by a live
 * espnTeamId -> playerId -> slot-label map (from lib/espn.ts) instead of the
 * bundled static roster snapshot -- used to pick up lineup changes made
 * directly in the ESPN app. */
export function deriveAssignmentsFromEspnSlots(
  team: LeagueTeam,
  slots: Record<number, string>
): { roster: RosterAssignments; bench: number[] } {
  return assignFromSlots(team, (id) => slots[id]);
}
