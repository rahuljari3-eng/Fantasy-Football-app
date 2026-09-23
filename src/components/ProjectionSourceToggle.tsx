import type { ProjectionAccuracy } from "../lib/projectionAccuracy";
import type { ProjectionSource } from "../types";

const OPTIONS: { id: ProjectionSource; label: string; help: string }[] = [
  { id: "custom", label: "Custom", help: "The app's blend: ESPN + Sleeper projections, adjusted to DraftKings yardage props once they post." },
  { id: "espn", label: "ESPN", help: "ESPN's own weekly projection, exactly as the ESPN app shows it." },
];

/** Custom vs ESPN weekly projections on the Build roster tab, plus how
 * accurate each has been so far (lib/projectionAccuracy.ts). */
export function ProjectionSourceToggle({
  source,
  onChange,
  accuracy,
}: {
  source: ProjectionSource;
  onChange: (source: ProjectionSource) => void;
  accuracy: ProjectionAccuracy | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap bg-[#1C1C1E] border border-[#38383A] rounded-xl px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#98989D]">Projections</span>
        <div role="radiogroup" aria-label="Projection source" className="flex bg-[#000000] border border-[#38383A] rounded-lg p-0.5">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={source === o.id}
              title={o.help}
              onClick={() => onChange(o.id)}
              className={`text-xs font-medium px-2.5 py-1 rounded-md ${source === o.id ? "bg-[#C9A227] text-[#000000]" : "text-[#98989D] hover:text-[#FFFFFF]"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-[#636366]">
        {accuracy && accuracy.games > 0 ? (
          <>
            Avg miss so far ({accuracy.games} player-games, week{accuracy.weeks.length > 1 ? "s" : ""} {accuracy.weeks.join(", ")}):{" "}
            <span className={accuracy.customMae <= accuracy.espnMae ? "text-emerald-400" : "text-[#98989D]"}>Custom {accuracy.customMae.toFixed(2)}</span> ·{" "}
            <span className={accuracy.espnMae < accuracy.customMae ? "text-emerald-400" : "text-[#98989D]"}>ESPN {accuracy.espnMae.toFixed(2)}</span> pts
          </>
        ) : (
          "Accuracy comparison starts once this week's games are final."
        )}
      </div>
    </div>
  );
}
