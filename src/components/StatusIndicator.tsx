import { statusColor, statusDot } from "../lib/format";
import type { PlayerStatus } from "../types";

/** A colored dot + status label (e.g. "Questionable"). By default renders
 * nothing for a healthy player, since most rows only want to call out a flag.
 * Pass `onClick` (e.g. to open that player's news) to render it as a button
 * instead of static text. */
export function StatusIndicator({
  status,
  alwaysShow = false,
  onClick,
}: {
  status: PlayerStatus;
  alwaysShow?: boolean;
  onClick?: () => void;
}) {
  if (!alwaysShow && status === "Healthy") return null;
  const content = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full ${statusDot(status)}`} />
      <span className={statusColor(status)}>{status}</span>
    </>
  );
  if (!onClick) return <span className="flex items-center gap-1">{content}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="View related news"
      className="flex items-center gap-1 hover:underline decoration-dotted underline-offset-2"
    >
      {content}
    </button>
  );
}
