"use client";
import { createContext, useContext, useState } from "react";
import type { ChartData, IndicatorId } from "@tracker/core";
import { fmtDate } from "@/lib/format";
import { type Win, panWin, zoomWin } from "@/lib/zoom";
import { IndicatorChart } from "./IndicatorCharts";

const Ctx = createContext<Win | undefined>(undefined);

/** Barre de zoom commune aux 8 graphiques d'indicateurs (mêmes séances pour tous). */
export function ZoomIndicateurs({ dates, refIndex, children }: { dates: string[]; refIndex: number; children: React.ReactNode }) {
  const n = dates.length;
  const [win, setWin] = useState<Win | null>(null);
  const w: Win = win ?? [0, n - 1];
  return (
    <Ctx.Provider value={win ?? undefined}>
      <div className="zoom-bar zoom-ind" role="group" aria-label="Zoom des graphiques d'indicateurs">
        <span className="zoom-lbl">Zoom des 8 graphiques</span>
        <button type="button" onClick={() => setWin(zoomWin(w, n, 0.5, refIndex >= w[0] && refIndex <= w[1] ? refIndex : undefined))} title="Rapprocher (autour de l'opération)" aria-label="Rapprocher">+</button>
        <button type="button" onClick={() => setWin(zoomWin(w, n, 2))} title="Éloigner" aria-label="Éloigner">−</button>
        <button type="button" onClick={() => setWin(panWin(w, n, -0.4))} disabled={w[0] === 0} aria-label="Plus ancien">←</button>
        <button type="button" onClick={() => setWin(panWin(w, n, 0.4))} disabled={w[1] === n - 1} aria-label="Plus récent">→</button>
        {win && <button type="button" className="zoom-reset" onClick={() => setWin(null)}>Annuler le zoom</button>}
        <span className="zoom-info">{fmtDate(dates[w[0]], false)} → {fmtDate(dates[w[1]], false)}</span>
      </div>
      {children}
    </Ctx.Provider>
  );
}

/** Graphique d'un indicateur, à la fenêtre de zoom commune. */
export function ZoomedIndicator({ id, c }: { id: IndicatorId; c: ChartData }) {
  return <IndicatorChart id={id} c={c} win={useContext(Ctx)} />;
}
