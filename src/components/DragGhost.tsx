import { PosBadge } from "./PosBadge";
import type { Player } from "../types";

/** Floating label that follows the pointer while a player is being dragged
 * from the pool/bench onto a roster slot. */
export function DragGhost({ player, pos }: { player: Player | null; pos: { x: number; y: number } }) {
  if (!player) return null;
  return (
    <div
      style={{ left: pos.x + 12, top: pos.y + 12 }}
      className="fixed z-50 pointer-events-none bg-[#C9A227] text-[#000000] text-sm font-semibold px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2"
    >
      <PosBadge pos={player.pos} />
      {player.name}
    </div>
  );
}
