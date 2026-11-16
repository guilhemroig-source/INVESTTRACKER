"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Analysis, Fiche, NewsAnalysis } from "@tracker/core";
import { AnalysisView } from "./AnalysisView";

type Payload = { sens: "achat" | "vente"; ticker: string; analysis: Analysis | null; news?: NewsAnalysis | null; fiche?: Fiche | null };
const cache = new Map<string, Promise<Payload>>();

/** Version publiée hors serveur (instantané) : l'analyse est calculée dans le navigateur. */
type Snapshot = { analyse: (cle: string) => Payload | null };
const snapshot = () => (globalThis as unknown as { __TRACKER_SNAPSHOT__?: Snapshot }).__TRACKER_SNAPSHOT__;

const load = (cle: string) => {
  const snap = snapshot();
  if (snap && !cache.has(cle)) {
    const p = snap.analyse(cle);
    cache.set(cle, p ? Promise.resolve(p) : Promise.reject(new Error("opération inconnue")));
  }
  if (!cache.has(cle)) cache.set(cle, fetch(`/api/analyse/${encodeURIComponent(cle)}`).then((r) => {
    if (!r.ok) { cache.delete(cle); throw new Error(`HTTP ${r.status}`); }
    return r.json() as Promise<Payload>;
  }));
  return cache.get(cle)!;
};

function Panel({ cle }: { cle: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { load(cle).then(setData, (e) => setErr(String(e.message ?? e))); }, [cle]);
  if (err) return <p className="note sell">Analyse indisponible ({err}).</p>;
  if (!data) return <p className="note">Calcul de l&apos;analyse…</p>;
  return (
    <>
      <AnalysisView analysis={data.analysis} news={data.news} fiche={data.fiche} sens={data.sens} ticker={data.ticker} />
      <p className="note" style={{ margin: "10px 0 0" }}>
        {!snapshot() && <><a href={`/analyse/${encodeURIComponent(cle)}`} target="_blank" rel="noreferrer">Ouvrir en pleine page ↗</a> · </>}Les indicateurs décrivent le
        contexte du cours, pas les intentions de l&apos;investisseur. Rien ici n&apos;est un conseil d&apos;investissement.
      </p>
    </>
  );
}

/** Ligne de tableau cliquable : l'explication technique de l'opération s'ouvre juste en dessous. */
export function ExpandableRow({ cle, cols, className, children }: { cle: string; cols: number; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  // Le panneau prend la largeur visible du tableau (pas sa largeur totale, plus grande sur mobile)
  const cellRef = useRef<HTMLTableCellElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const box = cellRef.current?.closest(".scroll") as HTMLElement | null;
    if (!box) return;
    const update = () => setWidth(box.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [open]);
  return (
    <>
      <tr
        className={`xrow-head ${open ? "open" : ""} ${className ?? ""}`}
        tabIndex={0}
        aria-expanded={open}
        title={open ? "Cliquer pour refermer" : "Cliquer pour voir l'explication du signal"}
        onClick={(e) => { if ((e.target as HTMLElement).closest("a, button, input, select")) return; toggle(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
      >
        {children}
      </tr>
      {open && (
        <tr className="xrow">
          <td colSpan={cols} ref={cellRef}><div className="xpanel" style={width ? { width } : undefined}><Panel cle={cle} /></div></td>
        </tr>
      )}
    </>
  );
}
