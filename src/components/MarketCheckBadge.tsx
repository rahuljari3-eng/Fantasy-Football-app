import { AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { marketCheck } from "../lib/tradeEngine";
import type { Player } from "../types";

const TONE = {
  fair: { Icon: CheckCircle2, className: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  you_overpay: { Icon: AlertTriangle, className: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  you_win: { Icon: TrendingUp, className: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
} as const;

/** What the trade market alone thinks of this package (lib/tradeEngine.ts
 * marketCheck), shown beside the app's own ratio. Renders nothing when the
 * market doesn't value anyone on one side. Pass `appRatio` (get÷give on the
 * app's pricer) so a disagreement with FantasyCalc is spelled out in the UI,
 * not only in a hover title. */
export function MarketCheckBadge({
  give,
  get,
  appRatio,
}: {
  give: Player[];
  get: Player[];
  appRatio?: number | null;
}) {
  const check = marketCheck(give, get);
  if (!check) return null;
  const { Icon, className } = TONE[check.tone];
  const disagrees =
    appRatio != null &&
    Number.isFinite(appRatio) &&
    ((check.tone === "you_overpay" && appRatio >= 1) || (check.tone === "you_win" && appRatio < 1));
  return (
    <div>
      <span
        title={`Priced only by FantasyCalc redraft values (real trades): ratio ${check.ratio.toFixed(2)}. Independent of the app's week/ROS package math.`}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${className}`}
      >
        <Icon size={11} /> {check.label}
      </span>
      {disagrees && (
        <div className="text-[11px] text-[#98989D] mt-1 leading-snug">
          App projections and FantasyCalc disagree — the other manager may see this deal differently.
        </div>
      )}
    </div>
  );
}
