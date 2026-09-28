import { NOTABLE_CHANCE_RATIO, typicalBoomBust, weeklyBoomBust } from "../lib/boomBust";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** This week's boom or bust chance (lib/boomBust.ts) as a small chip for
 * player lists -- only when one is well above what's typical, so the lists
 * flag the players with a real edge or real risk this week. */
export function BoomBustBadge({ player }: { player: { id: number; proj: number; seasonProj?: number | null } }) {
  const week = weeklyBoomBust(player.id, player.proj, player.seasonProj);
  if (!week) return null;
  const typical = typicalBoomBust();
  const boomEdge = week.boomChance / typical.boomChance;
  const bustEdge = week.bustChance / typical.bustChance;
  if (Math.max(boomEdge, bustEdge) < NOTABLE_CHANCE_RATIO) return null;
  const isBoom = boomEdge >= bustEdge;
  return (
    <span
      title={`This week: ${pct(week.boomChance)} to boom (${week.boomAt}+ pts), ${pct(week.bustChance)} to bust (${week.bustAt} or less). Typical: ${pct(typical.boomChance)} / ${pct(typical.bustChance)}.`}
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-px rounded border leading-tight mono-font ${
        isBoom ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-red-300 border-red-500/30 bg-red-500/10"
      }`}
    >
      {isBoom ? `Boom ${pct(week.boomChance)}` : `Bust ${pct(week.bustChance)}`}
    </span>
  );
}
