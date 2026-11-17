"use client";
import { useState } from "react";

const SOURCES = ["13f", "trump", "congres", "ark", "prix", "societes", "calendrier", "news", "fondamentaux", "all"];

/** Boutons « collecter maintenant » de la page d'administration. */
export function CollecteButtons() {
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (s: string) => {
    const r = await fetch(`/api/admin/collecte?source=${s}`, { method: "POST" });
    const j = await r.json();
    setMsg(r.ok ? `Collecte « ${s} » lancée : rechargez la page dans une minute pour voir le résultat.` : j.erreur);
  };
  return (
    <div>
      <div className="controls">{SOURCES.map((s) => <button key={s} type="button" className="watch-btn" onClick={() => go(s)}>{s === "all" ? "Tout collecter" : s}</button>)}</div>
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}
