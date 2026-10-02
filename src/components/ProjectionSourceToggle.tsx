import { ChevronDown } from "lucide-react";
import type { AccuracySlice, ProjectionAccuracy } from "../lib/projectionAccuracy";
import { DEFAULT_PROJECTION_PARAMS, SCALED_POSITIONS, projectionModel, type ProjectionParams } from "../lib/projectionModel";
import type { ProjectionSource } from "../types";

const OPTIONS: { id: ProjectionSource; label: string; help: string }[] = [
  { id: "custom", label: "Custom", help: "The app's blend: ESPN + Sleeper projections, adjusted to DraftKings yardage props once they post -- retuned from results once a retune proves out." },
  { id: "espn", label: "ESPN", help: "ESPN's own weekly projection, exactly as the ESPN app shows it." },
];

const WIN = "text-emerald-400";
const DIM = "text-[#98989D]";

/** One row of the Custom vs ESPN breakdown: avg miss each, and who was
 * closer how often. */
function SliceRow({ label, s, divider }: { label: string; s: AccuracySlice; divider?: boolean }) {
  return (
    <tr className={divider ? "border-t border-[#38383A]" : "border-t border-[#38383A]/60"}>
      <td className="py-1 pr-3 text-[#98989D]">{label}</td>
      <td className="py-1 pr-3 text-right mono-font text-[#636366]">{s.games}</td>
      <td className={`py-1 pr-3 text-right mono-font ${s.customMae <= s.espnMae ? WIN : DIM}`}>{s.customMae.toFixed(2)}</td>
      <td className={`py-1 pr-3 text-right mono-font ${s.espnMae < s.customMae ? WIN : DIM}`}>{s.espnMae.toFixed(2)}</td>
      <td className="py-1 text-right mono-font text-[#98989D]">
        {s.customCloser}–{s.espnCloser}
      </td>
    </tr>
  );
}

function BreakdownTable({ accuracy }: { accuracy: ProjectionAccuracy }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-[#636366]">
          <th className="text-left font-normal pb-1 pr-3"></th>
          <th className="text-right font-normal pb-1 pr-3">Games</th>
          <th className="text-right font-normal pb-1 pr-3">Custom</th>
          <th className="text-right font-normal pb-1 pr-3">ESPN</th>
          <th className="text-right font-normal pb-1" title="Player-games where each projection was closer to the actual score">
            Closer
          </th>
        </tr>
      </thead>
      <tbody>
        {accuracy.byWeek.map((w) => (
          <SliceRow key={w.week} label={`Week ${w.week}`} s={w} />
        ))}
        {accuracy.byPos.map((p, i) => (
          <SliceRow key={p.pos} label={p.pos} s={p} divider={i === 0} />
        ))}
        <tr className="border-t border-[#38383A] font-medium">
          <td className="py-1 pr-3 text-[#E5E5EA]">Season</td>
          <td className="py-1 pr-3 text-right mono-font text-[#636366]">{accuracy.games}</td>
          <td className={`py-1 pr-3 text-right mono-font ${accuracy.customMae <= accuracy.espnMae ? WIN : DIM}`}>{accuracy.customMae.toFixed(2)}</td>
          <td className={`py-1 pr-3 text-right mono-font ${accuracy.espnMae < accuracy.customMae ? WIN : DIM}`}>{accuracy.espnMae.toFixed(2)}</td>
          <td className="py-1 text-right mono-font text-[#98989D]">
            {accuracy.customCloser}–{accuracy.espnCloser}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v > 1 ? "+" : "−"}${(Math.abs(v - 1) * 100).toFixed(1).replace(/\.0$/, "")}%`;

/** What the fitted blend changes from the hand-set one, in words. */
function paramChanges(fit: ProjectionParams): string[] {
  const d = DEFAULT_PROJECTION_PARAMS;
  const out: string[] = [];
  if (fit.sleeperShare !== d.sleeperShare) out.push(`Sleeper's share of the blend ${pct(d.sleeperShare)} → ${pct(fit.sleeperShare)}`);
  if (fit.propWeight !== d.propWeight) out.push(`Vegas prop adjustment at ${pct(fit.propWeight)} strength`);
  if (fit.propCap !== d.propCap) out.push(`Vegas props can move a projection up to ${pct(fit.propCap)} (was ${pct(d.propCap)})`);
  SCALED_POSITIONS.forEach((pos) => {
    if (fit.scale[pos] !== d.scale[pos]) out.push(`${pos} projections ${signedPct(fit.scale[pos])}`);
  });
  return out;
}

/** The self-tuning blend's status (lib/projectionModel.ts): whether the fit
 * is in use, how it backtests against the current blend and ESPN, and what
 * it changes. */
function LearningStatus() {
  const model = projectionModel();
  const bt = model.backtest;
  const changes = paramChanges(model.params);
  if (!bt || bt.games === 0) {
    return <p className="text-[#636366]">The blend starts retuning itself once two weeks are final.</p>;
  }
  const rows = [
    { label: model.adopted ? "Previous blend" : "Current blend", rmse: bt.defaultRmse, mae: bt.defaultMae },
    { label: model.adopted ? "Tuned blend (in use)" : "Tuned blend", rmse: bt.fittedRmse, mae: bt.fittedMae },
    { label: "ESPN", rmse: bt.espnRmse, mae: bt.espnMae },
  ];
  const best = Math.min(...rows.map((r) => r.rmse));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            model.adopted ? "bg-emerald-400/15 text-emerald-400" : "bg-[#38383A] text-[#98989D]"
          }`}
        >
          {model.adopted ? "Tuned blend in use" : "Still learning"}
        </span>
        <span className="text-[#636366]">
          {model.adopted
            ? "The retuned blend beat the hand-set one, so Custom now uses it."
            : "The retune hasn't beaten the hand-set blend yet, so Custom still uses that."}
        </span>
      </div>
      <div>
        <p className="text-[#636366] mb-1">
          Test: each of week{bt.weeks.length > 1 ? "s" : ""} {bt.weeks.join(", ")} projected using only the weeks before it ({bt.games}{" "}
          player-games). Ranked on the score, which weights big misses more, so lowballing everyone can't win it.
        </p>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[#636366]">
              <th className="text-left font-normal pb-1 pr-3"></th>
              <th className="text-right font-normal pb-1 pr-3" title="Root-mean-square error, points per player-game">
                Score
              </th>
              <th className="text-right font-normal pb-1">Avg miss</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-[#38383A]/60">
                <td className="py-1 pr-3 text-[#98989D]">{r.label}</td>
                <td className={`py-1 pr-3 text-right mono-font ${r.rmse === best ? WIN : DIM}`}>{r.rmse.toFixed(2)}</td>
                <td className="py-1 text-right mono-font text-[#98989D]">{r.mae.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {changes.length > 0 && (
        <div>
          <p className="text-[#636366] mb-0.5">{model.adopted ? "What the tuned blend changed:" : "What the tuned blend would change:"}</p>
          <ul className="list-disc pl-4 text-[#98989D] space-y-0.5">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {model.fittedAt && (
        <p className="text-[10px] text-[#636366]">
          Refit hourly from every finished week · last change {new Date(model.fittedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      )}
    </div>
  );
}

/** Custom vs ESPN weekly projections on the Build roster tab, how accurate
 * each has been so far (lib/projectionAccuracy.ts), and the self-tuning
 * blend's status (lib/projectionModel.ts). */
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
      <details className="group basis-full">
        <summary className="list-none cursor-pointer text-[11px] text-[#636366] hover:text-[#98989D] inline-flex items-center gap-1 select-none">
          <ChevronDown size={12} className="transition-transform group-open:rotate-180" /> Custom vs ESPN details
        </summary>
        <div className="mt-2 grid gap-4 md:grid-cols-2 text-[11px]">
          <div>
            <div className="text-xs font-medium text-[#E5E5EA] mb-1">Avg miss, points per player</div>
            {accuracy && accuracy.games > 0 ? (
              <BreakdownTable accuracy={accuracy} />
            ) : (
              <p className="text-[#636366]">Starts once this week's games are final.</p>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-[#E5E5EA] mb-1">Self-tuning blend</div>
            <LearningStatus />
          </div>
        </div>
      </details>
    </div>
  );
}
