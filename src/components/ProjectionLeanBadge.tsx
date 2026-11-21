import PROJECTION_HISTORY from "../data/projectionHistory.json";
import { DISAGREEMENT_MIN_GAP, MIN_RELEVANT_PROJECTION, disagreementTrackRecord, type ProjectionHistory } from "../lib/projectionAccuracy";

// Graded once per load -- the history only changes with a new deploy.
const TRACK_RECORD = disagreementTrackRecord(PROJECTION_HISTORY as ProjectionHistory);

/** A small chip when the custom projection and ESPN's disagree by
 * DISAGREEMENT_MIN_GAP+ points this week AND, at this position, those calls
 * have been right often enough to act on (lib/projectionAccuracy.ts
 * disagreementTrackRecord) -- a start/sit lean, not just a second number.
 * Positions where Custom's big calls haven't earned it (QB so far) never
 * show one. */
export function ProjectionLeanBadge({ player }: { player: { pos: string; proj: number; espnProj?: number } }) {
  // Same games the track record was graded on: someone at least one source
  // expected to matter.
  if (player.espnProj == null || Math.max(player.proj, player.espnProj) < MIN_RELEVANT_PROJECTION) return null;
  const gap = player.proj - player.espnProj;
  if (Math.abs(gap) < DISAGREEMENT_MIN_GAP) return null;
  const record = TRACK_RECORD[player.pos];
  if (!record?.trusted) return null;
  const up = gap > 0;
  return (
    <span
      title={`Custom projects ${player.proj.toFixed(1)}, ESPN ${player.espnProj.toFixed(1)}. When Custom has been ${DISAGREEMENT_MIN_GAP}+ points off ESPN on a ${player.pos} this season, the actual score landed on Custom's side ${record.right} of ${record.calls} times (${Math.round(record.hitRate * 100)}%).`}
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-px rounded border leading-tight mono-font ${
        up ? "text-sky-300 border-sky-500/30 bg-sky-500/10" : "text-amber-300 border-amber-500/30 bg-amber-500/10"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(gap).toFixed(1)} vs ESPN · {Math.round(record.hitRate * 100)}%
    </span>
  );
}
