import { scaleLinear } from "d3";

/** Petit graphique SVG rendu côté serveur (lignes, zones, barres, niveaux horizontaux, repère de l'opération). */
type S = (number | null)[];
export interface Line { values: S; color: string; width?: number; dash?: string; opacity?: number }
export interface HLine { y: number; color: string; dash?: string; label?: string; opacity?: number; labelDy?: number }
export interface Band { upper: S; lower: S; color: string; opacity?: number }
export interface Bars { values: S; colors: (v: number, i: number) => string; base?: number; zone?: [number, number] }

export const COL = { main: "#e8edf5", blue: "#7c8cff", amber: "#ffb547", green: "#22e584", red: "#ff5c5c", muted: "#55637a", grid: "#182131" };

const W = 360, H = 150, PL = 4, PR = 44, PT = 10, PB = 16;

export function MiniChart({ lines = [], hlines = [], bands = [], bars, refIndex, n, domain, periodStart, yZones = [], extraBottom }: {
  lines?: Line[]; hlines?: HLine[]; bands?: Band[]; bars?: Bars; refIndex: number; n: number;
  domain?: [number, number]; periodStart?: number; yZones?: { from: number; to: number; color: string }[];
  /** Graphique secondaire en bas (ex. volume) : fraction de hauteur. */ extraBottom?: { bars: Bars; height: number };
}) {
  const mainBottom = extraBottom ? H - PB - extraBottom.height * (H - PT - PB) - 4 : H - PB;
  const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range([PL, W - PR]);
  const vals = [...lines.flatMap((l) => l.values), ...bands.flatMap((b) => [...b.upper, ...b.lower]), ...hlines.map((h) => h.y), ...(bars?.values ?? [])]
    .filter((v): v is number => v != null && Number.isFinite(v));
  const [lo, hi] = domain ?? [Math.min(...vals), Math.max(...vals)];
  const pad = (hi - lo) * 0.06 || 1;
  const y = scaleLinear().domain(domain ?? [lo - pad, hi + pad]).range([mainBottom, PT]);
  const path = (s: S, sy = y) => {
    let d = "", pen = false;
    s.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${sy(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const area = (u: S, l: S) => {
    const pts = u.map((v, i) => (v != null && l[i] != null ? i : -1)).filter((i) => i >= 0);
    if (!pts.length) return "";
    return `M${pts.map((i) => `${x(i).toFixed(1)},${y(u[i]!).toFixed(1)}`).join("L")}L${[...pts].reverse().map((i) => `${x(i).toFixed(1)},${y(l[i]!).toFixed(1)}`).join("L")}Z`;
  };
  const barW = Math.max(1, (W - PL - PR) / n - 1);
  const drawBars = (b: Bars, sy: (v: number) => number, base: number) => b.values.map((v, i) => {
    if (v == null) return null;
    const y0 = sy(base), y1 = sy(v);
    return <rect key={i} x={x(i) - barW / 2} y={Math.min(y0, y1)} width={barW} height={Math.max(0.5, Math.abs(y1 - y0))} fill={b.colors(v, i)} />;
  });
  let bottom: React.ReactNode = null;
  if (extraBottom) {
    const bv = extraBottom.bars.values.filter((v): v is number => v != null);
    const by = scaleLinear().domain([0, Math.max(1, ...bv)]).range([H - PB, mainBottom + 6]);
    bottom = drawBars(extraBottom.bars, by, 0);
  }
  const rx = x(refIndex);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block" }}>
      {periodStart != null && <rect x={x(periodStart)} y={PT} width={Math.max(0, rx - x(periodStart))} height={H - PT - PB} fill={COL.amber} opacity={0.07} />}
      {yZones.map((z, k) => <rect key={k} x={PL} width={W - PL - PR} y={y(z.to)} height={Math.max(0, y(z.from) - y(z.to))} fill={z.color} opacity={0.12} />)}
      {bands.map((b, k) => <path key={k} d={area(b.upper, b.lower)} fill={b.color} opacity={b.opacity ?? 0.15} />)}
      {bars && drawBars(bars, y, bars.base ?? 0)}
      {hlines.map((h, k) => (
        <g key={k} opacity={h.opacity ?? 1}>
          <line x1={PL} x2={W - PR} y1={y(h.y)} y2={y(h.y)} stroke={h.color} strokeDasharray={h.dash} strokeWidth={1} />
          {h.label && <text x={W - PR + 3} y={y(h.y) + (h.labelDy ?? 0)} dy="0.35em" fontSize={8.5} fill={h.color}>{h.label}</text>}
        </g>
      ))}
      {lines.map((l, k) => <path key={k} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={l.width ?? 1.4} strokeDasharray={l.dash} opacity={l.opacity ?? 1} strokeLinejoin="round" />)}
      {bottom}
      <line x1={rx} x2={rx} y1={PT - 4} y2={H - PB} stroke={COL.amber} strokeDasharray="3 3" strokeWidth={1} />
      <text x={rx} y={H - 4} textAnchor={rx > W - PR - 30 ? "end" : rx < 40 ? "start" : "middle"} fontSize={8.5} fill={COL.amber}>opération</text>
    </svg>
  );
}
