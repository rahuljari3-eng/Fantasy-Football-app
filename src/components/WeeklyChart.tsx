import { useId, useMemo, useState } from "react";

// Week-by-week chart: one measured series as columns (e.g. actual points) and
// one reference series as a line with dots (e.g. projection, league average),
// on a single shared y-axis. Colors were validated for this app's dark
// surfaces (#000000 / #1C1C1E): both inside the dark lightness band, CVD
// Delta E 27, contrast >= 3:1. Values are always reachable without hovering
// via the table toggle.
const PRIMARY_COLOR = "#c98500";
const REFERENCE_COLOR = "#3987e5";
const SURFACE = "#1C1C1E";
const GRID = "#2C2C2E";
const AXIS_TEXT = "#98989D";

const HEIGHT = 150;
const PAD = { top: 14, right: 8, bottom: 20, left: 30 };
const MAX_BAR = 24;

export interface WeeklyChartPoint {
  week: number;
  primary: number | null;
  reference: number | null;
}

/** Axis top and tick step: clean round numbers, at most ~4 gridlines. */
function niceScale(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 10, step: 5 };
  const step = [5, 10, 20, 25, 50, 100].find((st) => Math.ceil(v / st) <= 4) ?? 100;
  return { max: Math.ceil(v / step) * step, step };
}

/** Column with a 4px rounded data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function WeeklyChart({
  title,
  points,
  primaryLabel,
  referenceLabel,
  unit = "pts",
}: {
  title: string;
  points: WeeklyChartPoint[];
  primaryLabel: string;
  referenceLabel: string;
  unit?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const width = 360;

  const layout = useMemo(() => {
    const { max, step } = niceScale(Math.max(0, ...points.flatMap((p) => [p.primary ?? 0, p.reference ?? 0])));
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const band = points.length ? plotW / points.length : plotW;
    const barW = Math.min(MAX_BAR, band * 0.6);
    const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / max) * plotH;
    const cx = (i: number) => PAD.left + band * i + band / 2;
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    return { max, plotH, band, barW, y, cx, ticks };
  }, [points]);

  if (!points.length) return null;
  const { band, barW, y, cx, ticks } = layout;
  const refPoints = points.map((p, i) => (p.reference != null ? { x: cx(i), y: y(p.reference) } : null));
  const refPath = refPoints.reduce((d, pt, i) => {
    if (!pt) return d;
    const prev = i > 0 ? refPoints[i - 1] : null;
    return `${d}${prev ? " L" : " M"}${pt.x},${pt.y}`;
  }, "");
  // Label selectively: only the latest measured column carries its value.
  const lastPrimary = points.findLastIndex((p) => p.primary != null);
  const activePoint = active != null ? points[active] : null;
  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));

  return (
    <figure className="m-0" aria-labelledby={titleId}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <figcaption id={titleId} className="text-xs font-medium text-[#98989D]">
          {title}
        </figcaption>
        <button onClick={() => setShowTable((s) => !s)} className="text-[11px] text-[#C9A227] hover:underline shrink-0">
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-[#98989D] mb-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: PRIMARY_COLOR }} />
          {primaryLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px] rounded" style={{ background: REFERENCE_COLOR }} />
          {referenceLabel}
        </span>
      </div>

      {showTable ? (
        <table className="w-full text-xs mono-font">
          <thead>
            <tr className="text-[#98989D] text-left">
              <th className="font-normal py-1">Week</th>
              <th className="font-normal py-1 text-right">{primaryLabel}</th>
              <th className="font-normal py-1 text-right">{referenceLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.week} className="border-t border-[#38383A]/60 text-[#E5E5EA]">
                <td className="py-1">{p.week}</td>
                <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.primary)}</td>
                <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(p.reference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="w-full h-auto block" role="img" aria-labelledby={titleId} onPointerLeave={() => setActive(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={PAD.left - 5} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS_TEXT} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(t)}
                </text>
              </g>
            ))}
            {active != null && <rect x={cx(active) - band / 2} y={PAD.top} width={band} height={layout.plotH} fill="#FFFFFF" opacity={0.04} />}
            {points.map((p, i) =>
              p.primary != null && p.primary > 0 ? (
                <path
                  key={p.week}
                  d={columnPath(cx(i) - barW / 2, y(p.primary), barW, y(0) - y(p.primary))}
                  fill={PRIMARY_COLOR}
                  opacity={active == null || active === i ? 1 : 0.55}
                />
              ) : null
            )}
            {refPath && <path d={refPath} fill="none" stroke={REFERENCE_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {refPoints.map((pt, i) => (pt ? <circle key={i} cx={pt.x} cy={pt.y} r={4} fill={REFERENCE_COLOR} stroke={SURFACE} strokeWidth={2} /> : null))}
            {lastPrimary >= 0 &&
              points[lastPrimary].primary != null &&
              (() => {
                // Value on the cap -- unless the reference dot sits right
                // there. Columns are too narrow to hold the number inside,
                // so it's left to the tooltip and table view instead.
                const top = y(points[lastPrimary].primary!);
                const ref = refPoints[lastPrimary];
                if (ref != null && Math.abs(ref.y - (top - 8)) < 12) return null;
                return (
                  <text x={cx(lastPrimary)} y={top - 5} textAnchor="middle" fontSize={9} fill="#E5E5EA">
                    {fmt(points[lastPrimary].primary)}
                  </text>
                );
              })()}
            {points.map((p, i) => (
              <text key={p.week} x={cx(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={9} fill={AXIS_TEXT}>
                {`W${p.week}`}
              </text>
            ))}
            {/* Hit targets: the whole week band, bigger than any mark. */}
            {points.map((p, i) => (
              <rect
                key={p.week}
                x={cx(i) - band / 2}
                y={PAD.top}
                width={band}
                height={layout.plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`Week ${p.week}: ${primaryLabel} ${fmt(p.primary)}, ${referenceLabel} ${fmt(p.reference)} ${unit}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="focus:outline-none"
              />
            ))}
          </svg>
          {activePoint && (
            <div
              className="pointer-events-none absolute top-0 bg-[#000000] border border-[#38383A] rounded-lg px-2.5 py-1.5 text-[11px] shadow-lg"
              style={{
                left: `${(cx(active!) / width) * 100}%`,
                transform: `translateX(${cx(active!) > width / 2 ? "calc(-100% - 10px)" : "10px"})`,
              }}
            >
              <div className="text-[#98989D] mb-0.5">Week {activePoint.week}</div>
              {[
                { label: primaryLabel, value: activePoint.primary, color: PRIMARY_COLOR },
                { label: referenceLabel, value: activePoint.reference, color: REFERENCE_COLOR },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block w-2.5 h-[2px] rounded" style={{ background: row.color }} />
                  <span className="font-semibold text-[#FFFFFF] mono-font">{fmt(row.value)}</span>
                  <span className="text-[#98989D]">{row.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
