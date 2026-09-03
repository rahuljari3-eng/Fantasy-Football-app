import { Plus } from "lucide-react";
import { SLOTS, SLOT_ELIGIBILITY } from "../config/league";
import type { Player, RosterAssignments, RosterSlotId } from "../types";

/** The "add to starting slot" + "add to bench" button pair shown next to a
 * player in the roster pool, recommended pickups, and free-agent browse list. */
export function AddPlayerActions({
  player,
  roster,
  onAddToSlot,
  onAddToBench,
}: {
  player: Player;
  roster: RosterAssignments;
  onAddToSlot: (slot: RosterSlotId, player: Player) => void;
  onAddToBench: (player: Player) => void;
}) {
  const openEligibleSlot = SLOTS.find((s) => SLOT_ELIGIBILITY[s].includes(player.pos) && !roster[s]);
  return (
    <div className="flex gap-1">
      {openEligibleSlot && (
        <button
          onClick={() => onAddToSlot(openEligibleSlot, player)}
          className="text-[11px] bg-[#C9A227] text-[#000000] font-semibold px-2 py-1 rounded-md hover:bg-[#e0b82e]"
          title={`Add to ${openEligibleSlot}`}
        >
          {openEligibleSlot}
        </button>
      )}
      <button
        onClick={() => onAddToBench(player)}
        className="text-[#98989D] hover:text-[#FFFFFF] hover:border-[#98989D] border border-[#38383A] rounded-md p-1"
        title="Add to bench"
        aria-label={`Add ${player.name} to bench`}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
