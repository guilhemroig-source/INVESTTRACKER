"use client";
import { useState, type ReactNode } from "react";

/** Onglets dans l'explication d'une opération : Nouvelles · Fiche action · Analyse technique. */
export function AnalysisTabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
  const [cur, setCur] = useState(tabs[0]?.id);
  return (
    <div>
      <div className="subtabs" role="tablist">
        {tabs.map((t) => <button key={t.id} type="button" role="tab" className="subtab" aria-selected={cur === t.id} onClick={() => setCur(t.id)}>{t.label}</button>)}
      </div>
      {tabs.map((t) => <div key={t.id} role="tabpanel" hidden={cur !== t.id}>{t.content}</div>)}
    </div>
  );
}
