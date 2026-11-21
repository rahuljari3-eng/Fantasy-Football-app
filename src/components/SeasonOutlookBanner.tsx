import { CalendarClock, Target } from "lucide-react";
import type { SeasonOutlook } from "../lib/seasonOutlook";

const MODE_STYLE: Record<SeasonOutlook["mode"], string> = {
  contender: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  bubble: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  longshot: "border-red-500/40 bg-red-500/10 text-red-300",
  eliminated: "border-[#38383A] bg-[#1C1C1E] text-[#98989D]",
  playoffs: "border-[#C9A227]/40 bg-[#C9A227]/10 text-[#C9A227]",
};

function deadlineText(d: NonNullable<SeasonOutlook["deadline"]>): string {
  const when = new Date(d.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (d.passed) return `Trade deadline passed (${when}) — trades are closed; waivers are the only way to improve.`;
  if (d.daysLeft <= 1) return `Trade deadline is today/tomorrow — ${when}. Last chance to send offers.`;
  return `Trade deadline in ${d.daysLeft} days — ${when}.${d.urgent ? " Offers need time to be accepted; send them now." : ""}`;
}

/** The managed team's season situation -- playoff odds, how advice leans
 * because of them, and the trade-deadline countdown (lib/seasonOutlook.ts).
 * `showDeadline` is off on pages where trades don't apply. */
export function SeasonOutlookBanner({ outlook, showDeadline = true }: { outlook: SeasonOutlook | null; showDeadline?: boolean }) {
  if (!outlook) return null;
  const d = showDeadline ? outlook.deadline : null;
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${MODE_STYLE[outlook.mode]}`}>
      <div className="flex items-start gap-2">
        <Target size={14} className="shrink-0 mt-0.5" />
        <span>
          <strong className="font-semibold">{outlook.headline}.</strong> {outlook.advice}
        </span>
      </div>
      {d && (
        <div className={`flex items-start gap-2 ${d.urgent || d.daysLeft <= 1 ? "text-red-300 font-medium" : d.passed ? "text-[#98989D]" : ""}`}>
          <CalendarClock size={14} className="shrink-0 mt-0.5" />
          <span>{deadlineText(d)}</span>
        </div>
      )}
    </div>
  );
}
