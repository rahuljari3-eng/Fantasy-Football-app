// Greedy weekly lineup fill shared by the Lineup page and Roster Sensei.
import { SLOTS } from "../config/league.js";
import type { Player, Position, RosterAssignments, RosterSlotId } from "../types.js";

export interface OptimizeLineupOptions {
  /** Exclude players whose NFL bye equals this week (when known). */
  byeWeek?: number;
  /** Exclude "Out" by default; set false only for diagnostics. */
  excludeOut?: boolean;
}

export interface OptimizeLineupResult {
  roster: RosterAssignments;
  starterIds: number[];
  projectedTotal: number;
  emptySlots: RosterSlotId[];
  excluded: { id: number; name: string; reason: string }[];
}

function eligible(pool: Player[], opts: OptimizeLineupOptions): Player[] {
  const excludeOut = opts.excludeOut !== false;
  return pool.filter((p) => {
    if (excludeOut && p.status === "Out") return false;
    if (opts.byeWeek != null && p.bye === opts.byeWeek) return false;
    return true;
  });
}

/** Fill standard slots by weekly projection (greedy). Does not mutate input. */
export function optimizeLineup(players: Player[], opts: OptimizeLineupOptions = {}): OptimizeLineupResult {
  const excluded: OptimizeLineupResult["excluded"] = [];
  for (const p of players) {
    if (opts.excludeOut !== false && p.status === "Out") {
      excluded.push({ id: p.id, name: p.name, reason: "Out" });
    } else if (opts.byeWeek != null && p.bye === opts.byeWeek) {
      excluded.push({ id: p.id, name: p.name, reason: `bye_week_${opts.byeWeek}` });
    }
  }

  const usable = eligible(players, opts);
  const chosen = new Set<number>();
  const newRoster: RosterAssignments = {};

  const byProj = (pos: Position) =>
    usable.filter((p) => p.pos === pos && !chosen.has(p.id)).sort((a, b) => b.proj - a.proj);

  const take = (slot: RosterSlotId, player: Player | undefined) => {
    if (!player) return;
    newRoster[slot] = player.id;
    chosen.add(player.id);
  };

  take("QB", byProj("QB")[0]);
  const rbs = byProj("RB");
  take("RB1", rbs[0]);
  take("RB2", rbs[1]);
  const wrs = byProj("WR");
  take("WR1", wrs[0]);
  take("WR2", wrs[1]);
  take("TE", byProj("TE")[0]);

  const flexPool = [...byProj("RB"), ...byProj("WR"), ...byProj("TE")].sort((a, b) => b.proj - a.proj);
  take("FLEX", flexPool[0]);
  take("DST", byProj("DST")[0]);
  take("K", byProj("K")[0]);

  const byId = new Map(usable.map((p) => [p.id, p]));
  let projectedTotal = 0;
  const emptySlots: RosterSlotId[] = [];
  for (const slot of SLOTS) {
    const id = newRoster[slot];
    if (id == null) {
      emptySlots.push(slot);
      continue;
    }
    projectedTotal += byId.get(id)?.proj ?? 0;
  }

  return {
    roster: newRoster,
    starterIds: [...chosen],
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    emptySlots,
    excluded,
  };
}
