import { BOOM_BUST_PROFILE_LABEL, boomBustFor, leagueBoomBustRates } from "../lib/boomBust";

const TONE = {
  boom: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  bust: "text-red-300 border-red-500/30 bg-red-500/10",
  volatile: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  steady: "text-sky-300 border-sky-500/30 bg-sky-500/10",
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A player's boom/bust profile (lib/boomBust.ts) as a small chip for player
 * lists. Renders nothing for players who don't stand out either way, or who
 * have too few games to judge. */
export function BoomBustBadge({ playerId }: { playerId: number }) {
  const stats = boomBustFor(playerId);
  if (!stats || stats.profile === "neutral") return null;
  const league = leagueBoomBustRates();
  return (
    <span
      title={`Boom ${pct(stats.boomRate)} · Bust ${pct(stats.bustRate)} over ${stats.games} games (league: ${pct(league.boomRate)} / ${pct(league.bustRate)}). Boom/bust = beat or missed his own projection by more than a typical week's swing.`}
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-px rounded border leading-tight ${TONE[stats.profile]}`}
    >
      {BOOM_BUST_PROFILE_LABEL[stats.profile]}
    </span>
  );
}
