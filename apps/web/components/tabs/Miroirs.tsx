"use client";
import { scaleLinear, scaleTime } from "d3";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MirrorResult, MirrorSummary } from "@tracker/core";
import { actionHash, load } from "@/lib/snapshot";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { EmptyRow } from "../cells";
import { WatchButton } from "../WatchButton";

const SRC: Record<string, string> = { "13F": "Fonds", ARK: "ARK", FORM4: "Initié", TRUMP: "Trump", CONGRES: "Élu" };
const p = (x: number | null | undefined, d = 1) => (x == null ? "—" : fmtPct(x * 100, d));
const c = (x: number | null | undefined) => (x == null ? "" : x >= 0 ? "buy" : "sell");

function Courbe({ data }: { data: MirrorResult["courbe"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(ref.current); return () => ro.disconnect(); }, []);
  const H = 220, M = { t: 12, r: 48, b: 24, l: 6 };
  if (data.length < 2) return <p className="note">Courbe disponible quand les positions couvrent plusieurs semaines.</p>;
  const x = scaleTime().domain([new Date(data[0].date), new Date(data[data.length - 1].date)]).range([M.l, Math.max(M.l + 1, w - M.r)]);
  const vals = data.flatMap((d) => [d.miroir, d.spy ?? 0]);
  const y = scaleLinear().domain([Math.min(0, ...vals), Math.max(0, ...vals)]).range([H - M.b, M.t]).nice();
  const line = (k: "miroir" | "spy") => data.map((d, i) => `${i ? "L" : "M"}${x(new Date(d.date)).toFixed(1)},${y(d[k] ?? 0).toFixed(1)}`).join("");
  const last = data[data.length - 1];
  return (
    <div ref={ref} className="chart" style={{ minHeight: H }}>
      <div className="legend"><span><span className="sw" style={{ background: "#22e584" }} />Portefeuille miroir</span><span><span className="sw" style={{ background: "#7c8cff" }} />Mêmes montants sur le S&amp;P 500</span></div>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Performance du portefeuille miroir face au S&P 500">
          {y.ticks(4).map((t) => <g key={t}><line x1={M.l} x2={w - M.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--cds-chart-reference)" : "var(--cds-chart-grid)"} /><text x={w - M.r + 6} y={y(t)} dy="0.35em" fontSize={10} fill="var(--color-fg-muted)">{p(t, 0)}</text></g>)}
          {x.ticks(5).map((t) => <text key={+t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-fg-muted)">{fmtDate(t.toISOString().slice(0, 10), false)}</text>)}
          <path d={line("spy")} fill="none" stroke="#7c8cff" strokeWidth={1.6} />
          <path d={line("miroir")} fill="none" stroke="#22e584" strokeWidth={2} />
          <circle cx={x(new Date(last.date))} cy={y(last.miroir)} r={3.5} fill="#22e584" />
        </svg>
      )}
    </div>
  );
}

function Detail({ acteur }: { acteur: string }) {
  const [d, setD] = useState<MirrorResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { load<MirrorResult>(`/api/miroirs/${encodeURIComponent(acteur)}`, (s) => s.miroir?.(acteur)).then(setD, (e) => setErr(String(e.message))); }, [acteur]);
  if (err) return <p className="note sell">Détail indisponible ({err}).</p>;
  if (!d) return <p className="note">Calcul du portefeuille…</p>;
  return (
    <div>
      <div className="metrics" style={{ marginBottom: 12 }}>
        <div className="metric"><span className="lbl">Portefeuille miroir</span><b className={c(d.portefeuille?.gainPct)}>{p(d.portefeuille?.gainPct)}</b><small>{d.couverts} × 1 000 $ investis</small></div>
        <div className="metric"><span className="lbl">Même argent sur le S&amp;P 500</span><b className={c(d.portefeuille?.gainSpyPct)}>{p(d.portefeuille?.gainSpyPct)}</b></div>
        <div className="metric"><span className="lbl">Achats gagnants</span><b>{d.reussite != null ? `${Math.round(d.reussite * 100)} %` : "—"}</b></div>
        <div className="metric"><span className="lbl">Coût du délai de publication</span><b className={c(d.coutRetard == null ? null : -d.coutRetard)}>{p(d.coutRetard)}</b><small>gain perdu en attendant la publication</small></div>
      </div>
      <Courbe data={d.courbe} />
      <div className="scroll" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Action</th><th className="hide-sm">Opération</th><th>Entrée (après publication)</th><th>Sortie</th><th className="r">Gain</th><th className="r hide-sm">S&amp;P 500</th><th className="r hide-sm">Sans délai</th></tr></thead>
          <tbody>
            {d.trades.map((t, i) => (
              <tr key={i}>
                <td><a className="sym sym-link" href={actionHash(t.ticker)}>{t.ticker}</a><span className="co">{t.societe}</span></td>
                <td className="hide-sm">{t.operation}</td>
                <td className="nw">{fmtDate(t.entree.date)} · {fmtPrice(t.entree.prix)}<br /><small className="muted">publié le {fmtDate(t.datePublication, false)}</small></td>
                <td className="nw">{t.sortie.raison === "vente" ? "Vendu" : "En cours"} · {fmtDate(t.sortie.date, false)}<br /><small className="muted">{fmtPrice(t.sortie.prix)}</small></td>
                <td className={`r ${c(t.perf)}`}>{p(t.perf)}</td>
                <td className={`r hide-sm ${c(t.perfSpy)}`}>{p(t.perfSpy)}</td>
                <td className={`r hide-sm ${c(t.perfSansRetard)}`} title="Si l'on avait acheté le jour même de l'opération">{p(t.perfSansRetard)}</td>
              </tr>
            ))}
            {!d.trades.length && <EmptyRow cols={7} text="Aucune position calculable (cours pas encore téléchargés)." />}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}><WatchButton type="investisseur" valeur={acteur} label={acteur} /></div>
    </div>
  );
}

export function Miroirs() {
  const [rows, setRows] = useState<MirrorSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [min, setMin] = useState(2);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { load<MirrorSummary[]>("/api/miroirs", (s) => s.miroirs).then(setRows, (e) => setErr(String(e.message))); }, []);
  const shown = useMemo(() => (rows ?? []).filter((r) => r.couverts >= min), [rows, min]);
  return (
    <section>
      <div className="card">
        <h2>Portefeuilles miroirs : qui vaut la peine d&apos;être suivi ?</h2>
        <p className="note">
          Simulation d&apos;un suiveur qui copie chaque achat d&apos;un investisseur <b>au moment où il est publié</b> (clôture de la première séance après la
          publication : c&apos;est le plus tôt où vous pouvez le savoir), avec 1 000 $ par achat, et revend quand l&apos;investisseur publie sa vente (sinon la
          position est gardée jusqu&apos;au dernier cours). Comparaison avec les mêmes montants placés sur le S&amp;P 500 aux mêmes dates. « Coût du délai » :
          ce qu&apos;aurait rapporté en plus un achat au jour même de l&apos;opération. Ventes de rémunération exclues ; cours ajustés des dividendes.
        </p>
        <div className="controls">
          <select className="dash-select" aria-label="Nombre minimum de positions" value={min} onChange={(e) => setMin(Number(e.target.value))}>
            <option value={1}>Au moins 1 position</option><option value={2}>Au moins 2 positions</option><option value={5}>Au moins 5 positions</option>
          </select>
        </div>
        <div className="scroll tall">
          <table>
            <thead><tr><th>Investisseur</th><th className="r">Positions</th><th className="r">Miroir</th><th className="r">S&amp;P 500</th><th className="r hide-sm">Écart moyen</th><th className="r hide-sm">Gagnants</th><th className="r hide-sm">+60 séances</th><th className="r hide-sm">Coût du délai</th></tr></thead>
            <tbody>
              {err && <EmptyRow cols={8} text={`Indisponible (${err}).`} />}
              {!rows && !err && <EmptyRow cols={8} text="Calcul des portefeuilles…" />}
              {shown.map((r) => (
                <Fragment key={r.acteur}>
                  <tr className={`xrow-head ${open === r.acteur ? "open" : ""}`} tabIndex={0} onClick={() => setOpen(open === r.acteur ? null : r.acteur)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === r.acteur ? null : r.acteur); } }}>
                    <td><span className="src">{SRC[r.source] ?? r.source}</span> {r.acteur}</td>
                    <td className="r">{r.couverts}<small className="muted">/{r.signaux}</small></td>
                    <td className={`r ${c(r.portefeuille?.gainPct)}`}><b>{p(r.portefeuille?.gainPct)}</b></td>
                    <td className={`r ${c(r.portefeuille?.gainSpyPct)}`}>{p(r.portefeuille?.gainSpyPct)}</td>
                    <td className={`r hide-sm ${c(r.excedentMoyen)}`}>{p(r.excedentMoyen)}</td>
                    <td className="r hide-sm">{r.reussite != null ? `${Math.round(r.reussite * 100)} %` : "—"}</td>
                    <td className={`r hide-sm ${c(r.perf60)}`}>{p(r.perf60)}</td>
                    <td className="r hide-sm nw">{p(r.coutRetard)} <span className="chev">▾</span></td>
                  </tr>
                  {open === r.acteur && <tr className="xrow"><td colSpan={8}><div className="xpanel"><Detail acteur={r.acteur} /></div></td></tr>}
                </Fragment>
              ))}
              {rows && !shown.length && <EmptyRow cols={8} text="Aucun investisseur avec assez de positions calculables pour l'instant." />}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
          « Positions » : achats simulables / achats déclarés (il faut les cours de l&apos;action ; ils se complètent chaque heure). Les performances passées
          ne préjugent pas des performances futures.
        </p>
      </div>
    </section>
  );
}
