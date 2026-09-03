import { statusColor, statusDot } from "../lib/format";
import type { PlayerStatus } from "../types";

/** A colored dot + status label (e.g. "Questionable"). By default renders
 * nothing for a healthy player, since most rows only want to call out a flag. */
export function StatusIndicator({ status, alwaysShow = false }: { status: PlayerStatus; alwaysShow?: boolean }) {
  if (!alwaysShow && status === "Healthy") return null;
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${statusDot(status)}`} />
      <span className={statusColor(status)}>{status}</span>
    </span>
  );
}
