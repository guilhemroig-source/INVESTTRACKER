"use client";
import { scaleLinear } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum, fmtPrice } from "@/lib/format";
import { snap } from "@/lib/snapshot";
import { type Win, panWin, selectWin, zoomWin } from "@/lib/zoom";

interface Bougie { t: string; o: number; h: number; l: number; c: number; v: number }
const H = 340, M = { top: 18, right: 56, bottom: 46, left: 8 };
const JOUR = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short" });
const HEURE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const jourDe = (t: string) => JOUR.format(new Date(t));

/** Largeur du conteneur ; re-mesurée quand `dep` change (le graphique n'existe qu'une fois les cours arrivés). */
function useWidth<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(ref.current); return () => ro.disconnect(); }, [dep]);
  return [ref, w] as const;
}

/**
 * Cours intrajournaliers (5 min, 15 min, 1 h) : une bougie par point, sans trous la nuit ni le week-end,
 * séparateurs de séance, heures de Paris, zoom (sélection, pincement, boutons) et mon prix de revient.
 */
export function IntradayChart({ ticker, interval, prixRevientUsd }: { ticker: string; interval: string; prixRevientUsd?: number | null }) {
  const [data, setData] = useState<Bougie[] | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>(data);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const pinch = useRef<{ d0: number; w0: Win; c: number } | null>(null);

  useEffect(() => {
    if (snap()) { setErr("Les cours intrajournaliers sont disponibles dans la version hébergée (téléchargés à la demande)."); return; }
    setData(null); setErr(null); setWin(null);
    fetch(`/api/intraday/${encodeURIComponent(ticker)}?interval=${interval}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.erreur ?? `HTTP ${r.status}`); return j.bougies as Bougie[]; })
      .then(setData, (e) => setErr(String(e.message)));
  }, [ticker, interval]);

  const n = data?.length ?? 0;
  const w: Win = win ?? [0, Math.max(0, n - 1)];
  const b = useMemo(() => (data ?? []).slice(w[0], w[1] + 1), [data, w]);
  if (err) return <p className="note">{err}</p>;
  if (!data) return <div className="chart" style={{ minHeight: H }}><p className="note">Chargement des cours {interval === "1h" ? "horaires" : `en ${interval.replace("min", " minutes")}`}…</p></div>;
  if (!n) return <p className="note">Aucun cours intrajournalier pour {ticker}.</p>;

  const x = scaleLinear().domain([0, Math.max(1, b.length - 1)]).range([M.left, Math.max(M.left + 1, width - M.right)]);
  const lo0 = Math.min(...b.map((p) => p.l)), hi0 = Math.max(...b.map((p) => p.h));
  // Prix de revient dans l'échelle seulement s'il est proche des cours affichés (sinon : indication en marge)
  const pruVisible = prixRevientUsd != null && prixRevientUsd > lo0 * 0.85 && prixRevientUsd < hi0 * 1.15;
  const lo = Math.min(lo0, pruVisible ? prixRevientUsd! : lo0), hi = Math.max(hi0, pruVisible ? prixRevientUsd! : hi0);
  const y = scaleLinear().domain([lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08]).range([H - M.bottom, M.top]).nice();
  const path = b.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const area = `${path}L${x(b.length - 1).toFixed(1)},${H - M.bottom}L${x(0).toFixed(1)},${H - M.bottom}Z`;
  // Séparateurs de séance (heure de Paris) ; libellés espacés pour rester lisibles
  const seances = b.map((p, i) => ({ i, j: jourDe(p.t) })).filter((s, k, arr) => k === 0 || s.j !== arr[k - 1].j);
  // Libellés espacés d'au moins 80 px ; au-delà de 15 séances, seuls les jours libellés gardent leur trait
  const libelles = new Set<number>();
  let dernier = -Infinity;
  for (const se of seances) if (x(se.i) - dernier >= 80 && x(se.i) < width - M.right - 50) { libelles.add(se.i); dernier = x(se.i); }
  const hb = hover != null ? b[hover] : null;
  const idx = (el: Element, clientX: number) => Math.max(0, Math.min(b.length - 1, Math.round(x.invert(clientX - el.getBoundingClientRect().left))));
  const var0 = b[0].o, varFin = b[b.length - 1].c;

  return (
    <div>
      <div className="zoom-bar" role="group" aria-label="Zoom">
        <button type="button" onClick={() => setWin(zoomWin(w, n, 0.5))} aria-label="Rapprocher" title="Rapprocher">+</button>
        <button type="button" onClick={() => setWin(zoomWin(w, n, 2))} aria-label="Éloigner" title="Éloigner">−</button>
        <button type="button" onClick={() => setWin(panWin(w, n, -0.4))} disabled={w[0] === 0} aria-label="Plus ancien">←</button>
        <button type="button" onClick={() => setWin(panWin(w, n, 0.4))} disabled={w[1] === n - 1} aria-label="Plus récent">→</button>
        {win && <button type="button" className="zoom-reset" onClick={() => setWin(null)}>Annuler le zoom</button>}
        <span className="zoom-info">
          {jourDe(b[0].t)} {HEURE.format(new Date(b[0].t))} → {jourDe(b[b.length - 1].t)} {HEURE.format(new Date(b[b.length - 1].t))} (Paris) ·{" "}
          <b className={varFin >= var0 ? "buy" : "sell"}>{varFin >= var0 ? "+" : ""}{fmtNum((varFin / var0 - 1) * 100, 2)} %</b>
          {prixRevientUsd != null && !pruVisible && <> · mon prix de revient {fmtPrice(prixRevientUsd)} ({prixRevientUsd > hi0 ? "au-dessus" : "en dessous"})</>}
        </span>
      </div>
      <div className="chart" ref={ref} style={{ minHeight: H }} onMouseLeave={() => { setHover(null); setDrag(null); }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`Cours de ${ticker} en ${interval}`}
            style={{ touchAction: "pan-y", cursor: drag ? "ew-resize" : "crosshair", userSelect: "none" }}
            onMouseDown={(e) => { const k = idx(e.currentTarget, e.clientX); setDrag({ a: w[0] + k, b: w[0] + k }); }}
            onMouseUp={() => { if (drag && Math.abs(drag.b - drag.a) >= 3) setWin(selectWin(drag.a, drag.b, n)); setDrag(null); }}
            onDoubleClick={() => setWin(null)}
            onMouseMove={(e) => { const k = idx(e.currentTarget, e.clientX); if (drag) setDrag({ ...drag, b: w[0] + k }); setHover(k); }}
            onTouchStart={(e) => {
              if (e.touches.length !== 2) return;
              const [t1, t2] = [e.touches[0], e.touches[1]];
              pinch.current = { d0: Math.abs(t1.clientX - t2.clientX) || 1, w0: w, c: w[0] + idx(e.currentTarget, (t1.clientX + t2.clientX) / 2) };
            }}
            onTouchMove={(e) => { if (e.touches.length === 2 && pinch.current) setWin(zoomWin(pinch.current.w0, n, pinch.current.d0 / (Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1), pinch.current.c)); }}
            onTouchEnd={() => { pinch.current = null; }}>
            {y.ticks(5).map((t) => (
              <g key={t}><line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--cds-chart-grid)" />
                <text x={width - M.right + 6} y={y(t)} dy="0.35em" fontSize={10} fill="var(--color-fg-muted)">{fmtPrice(t)}</text></g>
            ))}
            {seances.map((se) => (
              <g key={se.i}>
                {se.i > 0 && (seances.length <= 15 || libelles.has(se.i)) && <line x1={x(se.i)} x2={x(se.i)} y1={M.top} y2={H - M.bottom} stroke="var(--cds-chart-axis)" strokeDasharray="2 4" />}
                {libelles.has(se.i) && <text x={x(se.i) + 3} y={H - M.bottom + 16} fontSize={10} fill="var(--color-fg-muted)">{se.j}</text>}
              </g>
            ))}
            <path d={area} fill="#7c8cff" opacity={0.08} />
            <path d={path} fill="none" stroke="#e8edf5" strokeWidth={1.5} strokeLinejoin="round" />
            {pruVisible && (
              <g>
                <line x1={M.left} x2={width - M.right} y1={y(prixRevientUsd!)} y2={y(prixRevientUsd!)} stroke="#ffb547" strokeWidth={1.4} strokeDasharray="6 4" />
                <text x={M.left + 6} y={y(prixRevientUsd!) - 6} fontSize={10} fontWeight={600} fill="#ffb547">Mon prix de revient {fmtPrice(prixRevientUsd!)}</text>
              </g>
            )}
            {drag && Math.abs(drag.b - drag.a) >= 1 && (() => {
              const a = Math.min(drag.a, drag.b) - w[0], c = Math.max(drag.a, drag.b) - w[0];
              return <rect x={x(a)} y={M.top} width={Math.max(1, x(c) - x(a))} height={H - M.top - M.bottom} fill="#ffb547" opacity={0.12} stroke="#ffb547" strokeOpacity={0.5} />;
            })()}
            {hb && <><line x1={x(hover!)} x2={x(hover!)} y1={M.top} y2={H - M.bottom} stroke="var(--tk-amber)" strokeDasharray="3 3" />
              <circle cx={x(hover!)} cy={y(hb.c)} r={3.5} fill="var(--tk-amber)" /></>}
          </svg>
        )}
        {hb && (
          <div className="tip" style={{ left: Math.min(Math.max(x(hover!) + 12, 0), Math.max(0, width - 250)), top: 8, whiteSpace: "normal", width: 230 }}>
            <div><b>{jourDe(hb.t)} · {HEURE.format(new Date(hb.t))}</b> <span className="h">(Paris)</span></div>
            <div><span className="h">ouv.</span> {fmtPrice(hb.o)} <span className="h">clôt.</span> {fmtPrice(hb.c)}</div>
            <div><span className="h">haut</span> {fmtPrice(hb.h)} <span className="h">bas</span> {fmtPrice(hb.l)}</div>
            {hb.v > 0 && <div><span className="h">volume</span> {fmtNum(hb.v)}</div>}
            {prixRevientUsd != null && <div className="h">Écart au prix de revient : <b className={hb.c >= prixRevientUsd ? "buy" : "sell"}>{fmtNum((hb.c / prixRevientUsd - 1) * 100, 1)} %</b></div>}
          </div>
        )}
      </div>
      <p className="note" style={{ marginBottom: 0 }}>Cours Twelve Data (gardés 5 minutes), heures de Paris ; nuits et week-ends retirés. Les repères des investisseurs restent sur la vue en jours.</p>
    </div>
  );
}
