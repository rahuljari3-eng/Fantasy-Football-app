import { Lock } from "lucide-react";

/** Shown next to a starter whose real-world game has already kicked off --
 * their lineup slot can't be edited for the rest of the week. */
export function LockBadge({ label = "Locked" }: { label?: string }) {
  return (
    <span
      title="Game has started -- locked in this slot for the rest of the week"
      className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-[#C9A227]/10 text-[#C9A227] border-[#C9A227]/40 shrink-0"
    >
      <Lock size={9} /> {label}
    </span>
  );
}
