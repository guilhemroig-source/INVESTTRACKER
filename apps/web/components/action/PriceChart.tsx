"use client";
import { scaleLinear, scaleTime } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDate, fmtPrice, fmtRange, fmtUsd } from "@/lib/format";
import { type Win, panWin, selectWin, zoomWin } from "@/lib/zoom";
import { IntradayChart } from "./IntradayChart";

export interface ChartOp { date: string; sens: "achat" | "vente"; source: string; qui: string; operation: string; montantUsd: number | null; fourchette: string | null }
export interface ChartNews { date: string; titre: string; resume?: string | null }
/** Mes achats et ventes (prix en dollars au taux du jour) et mon prix de revient en dollars */
export interface ChartMoi { transactions: { date: string; type: "achat" | "vente"; quantite: number; prix: number; devise: string; prixUsd: number | null }[]; prixRevientUsd: number | null; prixRevient: number | null; devise: string }
const SYM: Record<string, string> = { EUR: "€", USD: "$" };

const SRC: Record<string, { lettre: string; label: string }> = {
  "13F": { lettre: "F", label: "Fonds (13F)" }, ARK: { lettre: "A", label: "ARK" }, FORM4: { lettre: "I", label: "Initiés" },
  TRUMP: { lettre: "T", label: "Trump" }, CONGRES: { lettre: "C", label: "Élus" },
};
const INTRA = [{ id: "1h", label: "1H" }, { id: "15min", label: "15M" }, { id: "5min", label: "5M" }] as const;
const RANGES = [{ id: "3m", label: "3 mois", d: 92 }, { id: "6m", label: "6 mois", d: 183 }, { id: "1a", label: "1 an", d: 366 }, { id: "tout", label: "Tout", d: 99999 }] as const;
const H = 340, M = { top: 18, right: 56, bottom: 46, left: 8 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(ref.current); return () => ro.disconnect(); }, []);
  return [ref, w] as const;
}

/** Cours de l'action, avec les achats (▲) et ventes (▼) des investisseurs suivis et les annonces officielles (◆). */
export function PriceChart({ bars, ops, news, moi, ticker }: { bars: { date: string; close: number }[]; ops: ChartOp[]; news: ChartNews[]; moi?: ChartMoi | null; ticker?: string }) {
  const [intra, setIntra] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1a");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  // Zoom : fenêtre [début, fin] en indices de séances ; null = période choisie par les boutons (3 mois… Tout)
  const [win, setWin] = useState<Win | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const pinch = useRef<{ d0: number; w0: Win; c: number } | null>(null);
  const sources = [...new Set(ops.map((o) => o.source))];
  const n = bars.length;

  const rangeWin = useMemo((): Win => {
    if (!n) return [0, 0];
    const last = bars[n - 1].date;
    const days = RANGES.find((r) => r.id === range)!.d;
    const from = new Date(Date.parse(last) - days * 86400_000).toISOString().slice(0, 10);
    const i = bars.findIndex((x) => x.date >= from);
    return [Math.max(0, i), n - 1];
  }, [bars, n, range]);
  const intraButtons = ticker ? (
    <div className="subtabs" role="tablist" aria-label="Intrajournalier">
      {INTRA.map((r) => <button key={r.id} type="button" className="subtab" aria-selected={intra === r.id} onClick={() => setIntra(r.id)}>{r.label}</button>)}
    </div>
  ) : null;
  if (intra && ticker) return (
    <div>
      <div className="chart-bar">
        <div className="subtabs" role="tablist" aria-label="Période">
          {RANGES.map((r) => <button key={r.id} type="button" className="subtab" aria-selected={false} onClick={() => { setIntra(null); setRange(r.id); setWin(null); }}>{r.label}</button>)}
        </div>
        {intraButtons}
      </div>
      <IntradayChart ticker={ticker} interval={intra} prixRevientUsd={moi?.prixRevientUsd ?? null} />
    </div>
  );
  if (!n) return <div>{intraButtons}<p className="note">Cours journaliers pas encore téléchargés pour cette action (collecteur « prix », par lots horaires). Les vues 1H, 15M et 5M sont disponibles.</p></div>;
  const w = win ?? rangeWin;
  const b = bars.slice(w[0], w[1] + 1);
  const from = b[0].date, last = b[b.length - 1].date;
  const x = scaleTime().domain([new Date(b[0].date), new Date(last)]).range([M.left, Math.max(M.left + 1, width - M.right)]);
  const mesTx = (moi?.transactions ?? []).filter((t) => t.prixUsd != null && t.date >= from && t.date <= last);
  const pruUsd = moi?.prixRevientUsd ?? null;
  // L'échelle englobe mes prix d'achat et mon prix de revient pour qu'ils restent visibles
  const vals = [...b.map((p) => p.close), ...mesTx.map((t) => t.prixUsd!), ...(pruUsd ? [pruUsd] : [])];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  /** Indice (dans la fenêtre affichée) de la séance sous une abscisse écran. */
  const idx = (el: Element, clientX: number) => {
    const d = x.invert(clientX - el.getBoundingClientRect().left).toISOString().slice(0, 10);
    let k = 0; for (let i = 0; i < b.length; i++) { if (b[i].date <= d) k = i; else break; }
    return k;
  };
  const y = scaleLinear().domain([lo - (hi - lo) * 0.12, hi + (hi - lo) * 0.12]).range([H - M.bottom, M.top]).nice();
  const priceAt = (d: string) => { let r = b[0]; for (const p of b) { if (p.date > d) break; r = p; } return r; };
  const vis = ops.filter((o) => !hidden.has(o.source) && o.date >= from && o.date <= last);
  // Regroupe les opérations d'un même jour et d'un même sens en un seul repère
  const groups = new Map<string, ChartOp[]>();
  for (const o of vis) { const k = `${o.date}|${o.sens}`; groups.set(k, [...(groups.get(k) ?? []), o]); }
  const off = news.filter((n) => n.date >= from && n.date <= last);
  const path = b.map((p, i) => `${i ? "L" : "M"}${x(new Date(p.date)).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
  const area = `${path}L${x(new Date(b[b.length - 1].date)).toFixed(1)},${H - M.bottom}L${x(new Date(b[0].date)).toFixed(1)},${H - M.bottom}Z`;
  const ticks = x.ticks(width < 500 ? 4 : 7);
  const hb = hover != null ? b[hover] : null;
  const hOps = hb ? ops.filter((o) => !hidden.has(o.source) && Math.abs(Date.parse(o.date) - Date.parse(hb.date)) <= 2 * 86400_000) : [];
  const hNews = hb ? news.filter((n) => Math.abs(Date.parse(n.date) - Date.parse(hb.date)) <= 2 * 86400_000) : [];

  return (
    <div>
      <div className="chart-bar">
        <div className="subtabs" role="tablist" aria-label="Période">
          {RANGES.map((r) => <button key={r.id} type="button" className="subtab" aria-selected={!win && range === r.id} onClick={() => { setRange(r.id); setWin(null); }}>{r.label}</button>)}
        </div>
        {intraButtons}
        <div className="zoom-bar" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setWin(zoomWin(w, n, 0.5))} title="Rapprocher" aria-label="Rapprocher">+</button>
          <button type="button" onClick={() => setWin(zoomWin(w, n, 2))} title="Éloigner" aria-label="Éloigner">−</button>
          <button type="button" onClick={() => setWin(panWin(w, n, -0.4))} disabled={w[0] === 0} title="Plus ancien" aria-label="Plus ancien">←</button>
          <button type="button" onClick={() => setWin(panWin(w, n, 0.4))} disabled={w[1] === n - 1} title="Plus récent" aria-label="Plus récent">→</button>
          {win && <button type="button" className="zoom-reset" onClick={() => setWin(null)}>Annuler le zoom</button>}
          <span className="zoom-info">{fmtDate(from, true)} → {fmtDate(last, true)}</span>
        </div>
        <div className="legend chart-filters">
          {moi && <span><span className="moi-pt">●</span>Mes achats · <span className="moi-pru">┄</span> Mon prix de revient</span>}
          <span><span className="tri up">▲</span>Achat</span><span><span className="tri dn">▼</span>Vente</span><span><span className="dia">◆</span>Annonce officielle</span>
          {sources.map((s) => (
            <label key={s} className="src-toggle"><input type="checkbox" checked={!hidden.has(s)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(s) ? n.delete(s) : n.add(s); return n; })} /> {SRC[s]?.lettre ?? s} = {SRC[s]?.label ?? s}</label>
          ))}
        </div>
      </div>
      <div className="chart" ref={ref} style={{ minHeight: H }} onMouseLeave={() => { setHover(null); setDrag(null); }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="Cours de l'action avec les opérations des investisseurs"
            style={{ touchAction: "pan-y", cursor: drag ? "ew-resize" : "crosshair", userSelect: "none" }}
            onMouseDown={(e) => { const k = idx(e.currentTarget, e.clientX); setDrag({ a: w[0] + k, b: w[0] + k }); }}
            onMouseUp={() => { if (drag && Math.abs(drag.b - drag.a) >= 3) setWin(selectWin(drag.a, drag.b, n)); setDrag(null); }}
            onDoubleClick={() => setWin(null)}
            onTouchStart={(e) => {
              if (e.touches.length !== 2) return;
              const [t1, t2] = [e.touches[0], e.touches[1]];
              pinch.current = { d0: Math.abs(t1.clientX - t2.clientX) || 1, w0: w, c: w[0] + idx(e.currentTarget, (t1.clientX + t2.clientX) / 2) };
            }}
            onTouchMove={(e) => {
              if (e.touches.length !== 2 || !pinch.current) return;
              const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1;
              setWin(zoomWin(pinch.current.w0, n, pinch.current.d0 / d, pinch.current.c));
            }}
            onTouchEnd={() => { pinch.current = null; }}
            onMouseMove={(e) => {
              const k = idx(e.currentTarget, e.clientX);
              if (drag) setDrag({ ...drag, b: w[0] + k });
              setHover(k);
            }}>
            {y.ticks(5).map((t) => (
              <g key={t}><line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--cds-chart-grid)" />
                <text x={width - M.right + 6} y={y(t)} dy="0.35em" fontSize={10} fill="var(--color-fg-muted)">{fmtPrice(t)}</text></g>
            ))}
            {ticks.map((t) => <text key={+t} x={x(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize={10} fill="var(--color-fg-muted)">{fmtDate(t.toISOString().slice(0, 10), b.length > 300)}</text>)}
            <path d={area} fill="#7c8cff" opacity={0.08} />
            <path d={path} fill="none" stroke="#e8edf5" strokeWidth={1.6} strokeLinejoin="round" />
            {off.map((n, i) => <text key={i} x={x(new Date(n.date))} y={H - M.bottom - 4} textAnchor="middle" fontSize={10} fill="#9db1ff">◆</text>)}
            {[...groups.entries()].map(([k, g]) => {
              const [d, sens] = k.split("|");
              const p = priceAt(d), cx = x(new Date(d)), cy = y(p.close);
              const up = sens === "achat", yy = up ? cy + 14 : cy - 14;
              const letters = [...new Set(g.map((o) => SRC[o.source]?.lettre ?? "?"))].join("");
              return (
                <g key={k}>
                  <path d={up ? `M${cx},${yy - 7}L${cx - 6},${yy + 4}L${cx + 6},${yy + 4}Z` : `M${cx},${yy + 7}L${cx - 6},${yy - 4}L${cx + 6},${yy - 4}Z`} fill={up ? "#22e584" : "#ff5c5c"} stroke="#05080d" strokeWidth={1} />
                  <text x={cx} y={up ? yy + 16 : yy - 9} textAnchor="middle" fontSize={9} fontWeight={700} fill={up ? "#22e584" : "#ff5c5c"}>{letters}{g.length > 1 ? `×${g.length}` : ""}</text>
                </g>
              );
            })}
            {pruUsd != null && (
              <g>
                <line x1={M.left} x2={width - M.right} y1={y(pruUsd)} y2={y(pruUsd)} stroke="#ffb547" strokeWidth={1.4} strokeDasharray="6 4" />
                <rect x={M.left + 2} y={y(pruUsd) - 17} width={196} height={14} rx={3} fill="#05080d" opacity={0.85} />
                <text x={M.left + 6} y={y(pruUsd) - 7} fontSize={10} fontWeight={600} fill="#ffb547">Mon prix de revient {fmtPrice(pruUsd)}{moi?.devise === "EUR" && moi.prixRevient ? ` (${moi.prixRevient.toFixed(2).replace(".", ",")} €)` : ""}</text>
              </g>
            )}
            {mesTx.map((t, i) => {
              const cx = x(new Date(t.date)), cy = y(t.prixUsd!);
              return (
                <g key={`moi${i}`}>
                  <circle cx={cx} cy={cy} r={6.5} fill={t.type === "achat" ? "#ffb547" : "#05080d"} stroke="#ffb547" strokeWidth={2} />
                  <text x={cx > width - M.right - 24 ? cx - 9 : cx} y={cy - 10} textAnchor={cx > width - M.right - 24 ? "end" : "middle"} fontSize={9} fontWeight={700} fill="#ffb547">{t.type === "achat" ? "Mon achat" : "Ma vente"}</text>
                </g>
              );
            })}
            {drag && Math.abs(drag.b - drag.a) >= 1 && (() => {
              const xa = x(new Date(bars[Math.min(drag.a, drag.b)].date)), xb = x(new Date(bars[Math.max(drag.a, drag.b)].date));
              return <rect x={xa} y={M.top} width={Math.max(1, xb - xa)} height={H - M.top - M.bottom} fill="#ffb547" opacity={0.12} stroke="#ffb547" strokeOpacity={0.5} />;
            })()}
            {hb && <><line x1={x(new Date(hb.date))} x2={x(new Date(hb.date))} y1={M.top} y2={H - M.bottom} stroke="var(--tk-amber)" strokeDasharray="3 3" />
              <circle cx={x(new Date(hb.date))} cy={y(hb.close)} r={3.5} fill="var(--tk-amber)" /></>}
          </svg>
        )}
        {hb && (
          <div className="tip" style={{ left: Math.min(Math.max(x(new Date(hb.date)) + 12, 0), Math.max(0, width - 300)), top: 8, whiteSpace: "normal", width: 280 }}>
            <div><b>{fmtDate(hb.date)}</b> · <span className="h">clôture</span> {fmtPrice(hb.close)}</div>
            {hOps.slice(0, 6).map((o, i) => (
              <div key={i} className={o.sens === "achat" ? "buy" : "sell"}>{o.sens === "achat" ? "▲" : "▼"} {o.qui.replace(/\s*\(.*\)$/, "")} · {o.operation}{o.montantUsd ? ` · ${fmtUsd(o.montantUsd)}` : o.fourchette ? ` · ${fmtRange(o.fourchette)}` : ""}</div>
            ))}
            {hOps.length > 6 && <div className="h">+ {hOps.length - 6} autre(s)</div>}
            {moi?.transactions.filter((t) => Math.abs(Date.parse(t.date) - Date.parse(hb.date)) <= 2 * 86400_000).map((t, i) => (
              <div key={`m${i}`} style={{ color: "#ffb547" }}>● Mon {t.type} : {t.quantite.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} à {t.prix.toFixed(2).replace(".", ",")} {SYM[t.devise] ?? t.devise}{t.devise !== "USD" && t.prixUsd ? ` (${fmtPrice(t.prixUsd)})` : ""}</div>
            ))}
            {pruUsd != null && <div className="h">Écart au prix de revient : <b className={hb.close >= pruUsd ? "buy" : "sell"}>{((hb.close / pruUsd - 1) * 100).toFixed(1).replace(".", ",")} %</b></div>}
            {hNews.slice(0, 2).map((n, i) => <div key={`n${i}`} style={{ color: "#9db1ff" }}>◆ {n.resume ?? n.titre}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
