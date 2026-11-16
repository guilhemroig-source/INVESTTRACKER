"use client";
import { scaleBand, scaleLinear } from "d3";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtNum, fmtUsd } from "@/lib/format";

const GREEN = "#22e584";
const RED = "#ff5c5c";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Barre horizontale arrondie (4 px) du côté de la valeur, droite côté axe zéro. */
function hBar(x0: number, x1: number, y: number, h: number, r = 4) {
  const left = Math.min(x0, x1), right = Math.max(x0, x1), w = right - left;
  const rr = Math.min(r, w / 2, h / 2);
  if (x1 >= x0) return `M${left},${y}H${right - rr}Q${right},${y} ${right},${y + rr}V${y + h - rr}Q${right},${y + h} ${right - rr},${y + h}H${left}Z`;
  return `M${right},${y}H${left + rr}Q${left},${y} ${left},${y + rr}V${y + h - rr}Q${left},${y + h} ${left + rr},${y + h}H${right}Z`;
}
/** Segment vertical ; arrondi seulement en haut s'il est le segment supérieur. */
function vBar(x: number, y: number, w: number, h: number, roundTop: boolean, r = 4) {
  const rr = roundTop ? Math.min(r, w / 2, h) : 0;
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

interface Tip { x: number; y: number; content: ReactNode }

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), Math.max(0, width - 220));
  return <div className="tip" style={{ left, top: tip.y + 12 }}>{tip.content}</div>;
}

export interface NetRow { ticker: string; nom?: string | null; net: number; achats: number; ventes: number }

/** Achats nets par action : à droite ce qui est accumulé (vert), à gauche ce qui est allégé (rouge). */
export function DivergingBars({ rows, height = 420 }: { rows: NetRow[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const m = { top: 8, right: 64, bottom: 24, left: 64 };
  const innerW = Math.max(0, width - m.left - m.right);
  const y = scaleBand<string>().domain(rows.map((r) => r.ticker)).range([m.top, height - m.bottom]).paddingInner(0.28);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const x = scaleLinear().domain([-maxAbs, maxAbs]).range([m.left, m.left + innerW]).nice();
  const ticks = x.ticks(width < 480 ? 3 : 5);
  return (
    <div className="chart tall" ref={ref} onMouseLeave={() => { setTip(null); setHover(null); }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Achats nets d'ARK par action">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={m.top} y2={height - m.bottom} stroke={t === 0 ? "var(--cds-chart-reference)" : "var(--cds-chart-grid)"} />
              <text x={x(t)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--color-fg-muted)">{fmtUsd(t, { signed: true })}</text>
            </g>
          ))}
          {rows.map((r) => {
            const yy = y(r.ticker)!;
            const bh = y.bandwidth();
            const pos = r.net >= 0;
            const dim = hover && hover !== r.ticker;
            return (
              <g key={r.ticker} opacity={dim ? 0.45 : 1}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover(r.ticker);
                  setTip({
                    x: e.clientX - box.left, y: e.clientY - box.top,
                    content: (
                      <>
                        <div><b style={{ color: "var(--tk-amber)" }}>{r.ticker}</b> <span className="h">{r.nom ?? ""}</span></div>
                        <div>Net <b className={pos ? "buy" : "sell"}>{fmtUsd(r.net, { signed: true })}</b></div>
                        <div className="h">Achats {fmtUsd(r.achats)} · Ventes {fmtUsd(r.ventes)}</div>
                      </>
                    ),
                  });
                }}>
                {/* zone de survol plus large que la barre */}
                <rect x={m.left} y={yy - 2} width={innerW} height={bh + 4} fill="transparent" />
                <path d={hBar(x(0), x(r.net), yy, bh)} fill={pos ? GREEN : RED} />
                <text x={pos ? x(0) - 6 : x(0) + 6} y={yy + bh / 2} dy="0.35em" textAnchor={pos ? "end" : "start"} fontSize={11} fontWeight={700} fill="var(--tk-amber)">{r.ticker}</text>
                <text x={pos ? x(r.net) + 6 : x(r.net) - 6} y={yy + bh / 2} dy="0.35em" textAnchor={pos ? "start" : "end"} fontSize={10} fill="var(--color-fg)">{fmtUsd(r.net, { signed: true })}</text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

export interface StackRow { label: string; sub?: string; achats: number; ventes: number }

/** Barres empilées par déclaration : achats (vert, en bas) + ventes (rouge, au-dessus). */
export function StackedBars({ rows, height = 300 }: { rows: StackRow[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const m = { top: 20, right: 8, bottom: 40, left: 48 };
  const x = scaleBand<string>().domain(rows.map((r) => r.label)).range([m.left, width - m.right]).paddingInner(0.35).paddingOuter(0.2);
  const max = Math.max(1, ...rows.map((r) => r.achats + r.ventes));
  const y = scaleLinear().domain([0, max]).range([height - m.bottom, m.top]).nice();
  const bw = Math.min(56, x.bandwidth());
  return (
    <div className="chart" ref={ref} onMouseLeave={() => { setTip(null); setHover(null); }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Transactions par déclaration">
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--cds-chart-axis)" : "var(--cds-chart-grid)"} />
              <text x={m.left - 6} y={y(t)} dy="0.35em" textAnchor="end" fontSize={10} fill="var(--color-fg-muted)">{fmtNum(t)}</text>
            </g>
          ))}
          {rows.map((r) => {
            const cx = x(r.label)! + (x.bandwidth() - bw) / 2;
            const yA = y(r.achats), hA = y(0) - yA;
            const yV = y(r.achats + r.ventes), hV = Math.max(0, yA - yV - 2); // 2 px d'espace entre segments
            const dim = hover && hover !== r.label;
            return (
              <g key={r.label} opacity={dim ? 0.45 : 1}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover(r.label);
                  setTip({
                    x: e.clientX - box.left, y: e.clientY - box.top,
                    content: (
                      <>
                        <div><b>{r.label}</b> <span className="h">{r.sub}</span></div>
                        <div><span className="buy">▲ Achats</span> {fmtNum(r.achats)}</div>
                        <div><span className="sell">▼ Ventes</span> {fmtNum(r.ventes)}</div>
                        <div className="h">Total {fmtNum(r.achats + r.ventes)}</div>
                      </>
                    ),
                  });
                }}>
                <rect x={x(r.label)} y={m.top} width={x.bandwidth()} height={height - m.top - m.bottom} fill="transparent" />
                <path d={vBar(cx, yA, bw, hA, r.ventes === 0)} fill={GREEN} />
                {hV > 0 && <path d={vBar(cx, yV, bw, hV, true)} fill={RED} />}
                <text x={cx + bw / 2} y={yV - 6} textAnchor="middle" fontSize={10} fill="var(--color-fg)">{fmtNum(r.achats + r.ventes)}</text>
                <text x={x(r.label)! + x.bandwidth() / 2} y={height - m.bottom + 16} textAnchor="middle" fontSize={10} fill="var(--color-fg)">{r.label}</text>
                {r.sub && <text x={x(r.label)! + x.bandwidth() / 2} y={height - m.bottom + 30} textAnchor="middle" fontSize={9} fill="var(--color-fg-muted)">{r.sub}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}><span className="sw" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}
export const COLORS = { GREEN, RED };
