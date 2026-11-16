"use client";
import { useEffect, useState } from "react";
import { snap } from "@/lib/snapshot";

/** Bouton « Suivre » : ajoute une action ou un investisseur à la liste de suivi (alertes SMS). */
export function WatchButton({ type, valeur, label }: { type: "action" | "investisseur"; valeur: string; label?: string }) {
  const [id, setId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const offline = !!snap();
  useEffect(() => {
    if (offline) return;
    fetch("/api/watchlist").then((r) => r.json()).then((d: { rules: { id: number; type: string; valeur: string }[] }) => {
      const r = d.rules.find((x) => x.type === type && x.valeur === valeur);
      setId(r?.id ?? null);
    }).catch(() => {});
  }, [type, valeur, offline]);
  if (offline) return <span className="watch-btn off" title="La liste de suivi fonctionne dans la version hébergée">☆ Suivre (version hébergée)</span>;
  const toggle = async () => {
    setBusy(true); setErr(null);
    try {
      if (id != null) { await fetch(`/api/watchlist/${id}`, { method: "DELETE" }); setId(null); }
      else {
        const r = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, valeur }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.erreur); setId(j.id);
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <button type="button" className={`watch-btn ${id != null ? "on" : ""}`} onClick={toggle} disabled={busy} aria-pressed={id != null}
      title={id != null ? "Retirer de la liste de suivi" : "Recevoir une alerte SMS quand il y a du nouveau"}>
      {id != null ? "★ Suivi" : `☆ Suivre${label ? ` ${label}` : ""}`}{err ? ` · ${err}` : ""}
    </button>
  );
}
