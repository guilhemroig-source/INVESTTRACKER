"use client";
import { useCallback, useEffect, useState } from "react";
import type { WatchRule } from "@tracker/core";
import { snap } from "@/lib/snapshot";
import { fmtDate, fmtRange, fmtUsd, sensClass } from "@/lib/format";
import { EmptyRow, OpCell, SignalCell, Sym, Who, type AnalysisMap } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

type Op = { id: number; cleUnique: string; datePublication: string; dateOperation: string | null; qui: string; ticker: string; societe: string | null; operation: string; sens: string; montantUsd: number | null; fourchette: string | null };
const TYPE: Record<string, string> = { action: "Action", investisseur: "Investisseur", score: "Score ≥" };

/** Ma liste : actions et investisseurs suivis, seuil de score, et leurs opérations. Alertes SMS après chaque collecte. */
export function MaListe({ acteurs, analyses, tickers }: { acteurs: string[]; analyses: AnalysisMap; tickers: Record<string, string> }) {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [feed, setFeed] = useState<Op[]>([]);
  const [type, setType] = useState<"action" | "investisseur" | "score">("action");
  const [valeur, setValeur] = useState("");
  const [sens, setSens] = useState<"tous" | "achat" | "vente">("tous");
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(() => fetch("/api/watchlist").then((r) => r.json()).then((d) => { setRules(d.rules); setFeed(d.feed); }).catch((e) => setErr(String(e.message))), []);
  useEffect(() => { if (!snap()) refresh(); }, [refresh]);
  if (snap()) return <section><div className="card"><h2>Ma liste</h2><p className="note" style={{ marginBottom: 0 }}>La liste de suivi et ses alertes SMS fonctionnent dans la version hébergée de l&apos;appli (elles ont besoin du serveur pour enregistrer vos choix et envoyer les SMS).</p></div></section>;
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, valeur, sens }) });
    const j = await r.json(); if (!r.ok) { setErr(j.erreur); return; }
    setValeur(""); refresh();
  };
  const del = async (id: number) => { await fetch(`/api/watchlist/${id}`, { method: "DELETE" }); refresh(); };
  return (
    <section>
      <div className="grid">
        <div className="card">
          <h2>Suivre une action, un investisseur ou un score</h2>
          <p className="note">À chaque collecte, les nouvelles opérations qui correspondent à votre liste partent par SMS (un seul message groupé), et le SMS de 7h47 en fait le compte.</p>
          <form className="controls watch-form" onSubmit={add}>
            <select id="watch-type" className="dash-select" aria-label="Type" value={type} onChange={(e) => { setType(e.target.value as typeof type); setValeur(""); }}>
              <option value="action">Une action</option><option value="investisseur">Un investisseur</option><option value="score">Un score smart money</option>
            </select>
            {type === "investisseur" ? (
              <select id="watch-valeur" className="dash-select" aria-label="Investisseur" value={valeur} onChange={(e) => setValeur(e.target.value)} required>
                <option value="">Choisir…</option>{acteurs.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            ) : (
              <input id="watch-valeur" className="search" required value={valeur} onChange={(e) => setValeur(e.target.value)}
                placeholder={type === "action" ? "Symbole, ex. NVDA" : "Seuil, ex. 40"} inputMode={type === "score" ? "numeric" : "text"} aria-label="Valeur" />
            )}
            {type !== "score" && (
              <select id="watch-sens" className="dash-select" aria-label="Sens" value={sens} onChange={(e) => setSens(e.target.value as typeof sens)}>
                <option value="tous">Achats et ventes</option><option value="achat">Achats seulement</option><option value="vente">Ventes seulement</option>
              </select>
            )}
            <button type="submit" className="watch-btn on">Ajouter</button>
          </form>
          {err && <p className="note sell">{err}</p>}
        </div>
        <div className="card">
          <h2>Ma liste · {rules.length}</h2>
          <ul className="plain watch-list">
            {rules.map((r) => (
              <li key={r.id}>
                <span className="src">{TYPE[r.type]}</span> <b>{r.type === "action" ? `${r.valeur}${tickers[r.valeur] ? ` · ${tickers[r.valeur]}` : ""}` : r.valeur}</b>
                {r.sens !== "tous" && <small> ({r.sens === "achat" ? "achats" : "ventes"})</small>}
                <button type="button" className="watch-del" onClick={() => del(r.id)} aria-label={`Retirer ${r.valeur}`}>Retirer</button>
              </li>
            ))}
            {!rules.length && <li className="muted">Votre liste est vide. Ajoutez une action ou un investisseur, ou utilisez le bouton « Suivre » sur une page action.</li>}
          </ul>
        </div>
      </div>
      <div className="card">
        <h2>Les opérations de ma liste</h2>
        <div className="scroll tall">
          <table>
            <thead><tr><th>Publié</th><th>Qui</th><th>Action</th><th>Opération</th><th className="r">Montant</th><th className="r">Analyse</th></tr></thead>
            <tbody>
              {feed.map((o) => (
                <ExpandableRow key={o.id} cle={o.cleUnique} cols={6}>
                  <td className="nw">{fmtDate(o.datePublication)}</td>
                  <td><Who qui={o.qui} /></td>
                  <td><Sym t={o.ticker} name={o.societe ?? tickers[o.ticker]} /></td>
                  <OpCell op={o.operation} sens={o.sens} />
                  <td className={`r ${sensClass(o.sens)}`}>{o.montantUsd != null ? fmtUsd(o.montantUsd) : o.fourchette ? fmtRange(o.fourchette) : <span className="muted">—</span>}</td>
                  <SignalCell cle={o.cleUnique} analyses={analyses} />
                </ExpandableRow>
              ))}
              {!feed.length && <EmptyRow cols={6} text="Aucune opération pour l'instant sur votre liste." />}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
