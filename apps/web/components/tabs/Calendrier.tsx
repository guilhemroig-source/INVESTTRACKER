"use client";
import { useEffect, useMemo, useState } from "react";
import type { Calendrier as Data, EvenementVue } from "@tracker/core";
import { load } from "@/lib/snapshot";
import { fmtJour, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { Sym } from "../cells";

const HEURE: Record<string, string> = { bmo: "Avant l'ouverture", amc: "Après la clôture", dmh: "Pendant la séance" };
const noms = (l: string[], n = 2) => l.slice(0, n).join(", ") + (l.length > n ? ` +${l.length - n}` : "");
type Portee = "tout" | "miens" | "investisseurs";
type Genre = "resultats" | "nouvelle" | "marche";

/** Une ligne de résultats : attentes avant la publication, écart à l'attendu après. */
export function ResultatsDetail({ d }: { d: Record<string, unknown> | null }) {
  if (!d) return null;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  const bE = n("bpaEstime"), bR = n("bpaReel"), cE = n("caEstime"), cR = n("caReel");
  const ecart = (r: number | null, e: number | null) => (r != null && e != null && e !== 0 ? (r - e) / Math.abs(e) : null);
  const eb = ecart(bR, bE), ec = ecart(cR, cE);
  return (
    <span className="cal-chiffres">
      {bR != null ? <>BPA <b>{fmtNum(bR, 2)} $</b>{eb != null && <span className={eb >= 0 ? "buy" : "sell"}> ({fmtPct(eb * 100, 0)} vs attendu)</span>}</> : bE != null ? <>BPA attendu {fmtNum(bE, 2)} $</> : null}
      {(cR ?? cE) != null && <> · {cR != null ? <>CA <b>{fmtUsd(cR)}</b>{ec != null && <span className={ec >= 0 ? "buy" : "sell"}> ({fmtPct(ec * 100, 0)})</span>}</> : <>CA attendu {fmtUsd(cE)}</>}</>}
    </span>
  );
}

function Ligne({ e }: { e: EvenementVue }) {
  const quand = e.type === "resultats" ? (e.heure ? HEURE[e.heure] ?? "" : "Heure non communiquée") : e.type === "nouvelle" ? (e.heure ? `${e.heure} UTC` : "") : e.heure ? `${e.heure} (Paris)` : "";
  return (
    <li className={`cal-ev cal-${e.type} ${e.mien ? "cal-mien" : ""}`}>
      <span className="cal-quand">{quand}</span>
      <div className="cal-corps">
        <div className="cal-titre">
          {e.ticker && <Sym t={e.ticker} name={e.societe} />}
          {e.mien && <span className="cal-tag">{e.detenu ? "Mon portefeuille" : "Ma liste"}</span>}
          {e.type === "nouvelle" ? (e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="cal-lien">{e.titre} ↗</a> : <span>{e.titre}</span>) : <span className="cal-nom">{e.titre}</span>}
          {e.type === "nouvelle" && <span className="muted"> · {e.source}</span>}
        </div>
        {e.type === "resultats" && <ResultatsDetail d={e.details} />}
        {(e.type === "macro" || e.type === "echeance") && e.details?.texte ? <span className="cal-chiffres">{String(e.details.texte)}{e.url && <> · <a href={e.url} target="_blank" rel="noopener noreferrer">source ↗</a></>}</span> : null}
        {(e.acheteurs.length > 0 || e.vendeurs.length > 0) && (
          <span className="cal-inv">
            {e.acheteurs.length > 0 && <span className="buy" title={e.acheteurs.join(", ")}>▲ {noms(e.acheteurs)}</span>}
            {e.acheteurs.length > 0 && e.vendeurs.length > 0 && " · "}
            {e.vendeurs.length > 0 && <span className="sell" title={e.vendeurs.join(", ")}>▼ {noms(e.vendeurs)}</span>}
          </span>
        )}
      </div>
    </li>
  );
}

/** Calendrier : ce qui peut faire bouger mes actions et celles des investisseurs suivis. */
export function Calendrier() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [portee, setPortee] = useState<Portee>("tout");
  const [genres, setGenres] = useState<Set<Genre>>(new Set(["resultats", "nouvelle", "marche"]));
  useEffect(() => { load<Data>("/api/calendrier", (s) => (s as { calendrier?: Data }).calendrier).then(setD, (e) => setErr(String(e.message))); }, []);
  const filtres = useMemo(() => (d?.evenements ?? []).filter((e) => {
    const g: Genre = e.type === "resultats" ? "resultats" : e.type === "nouvelle" ? "nouvelle" : "marche";
    if (!genres.has(g)) return false;
    if (g === "marche") return true;
    return portee === "tout" || (portee === "miens" ? e.mien : e.acheteurs.length + e.vendeurs.length > 0);
  }), [d, portee, genres]);
  const parJour = (l: EvenementVue[]) => [...l.reduce((m, e) => m.set(e.date, [...(m.get(e.date) ?? []), e]), new Map<string, EvenementVue[]>())];
  const avenir = parJour(filtres.filter((e) => !e.passe));
  const passes = parJour(filtres.filter((e) => e.passe)).reverse();
  const toggle = (g: Genre) => setGenres((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });

  if (err) return <section><div className="card"><p className="note sell">Calendrier indisponible ({err}).</p></div></section>;
  if (!d) return <section><div className="card"><p className="note">Chargement du calendrier…</p></div></section>;
  const jour = ([date, l]: [string, EvenementVue[]]) => (
    <div key={date} className="cal-jour">
      <h3>{fmtJour(date, d.aujourdhui)}</h3>
      <ul>{l.map((e, i) => <Ligne key={`${e.type}${e.ticker}${i}`} e={e} />)}</ul>
    </div>
  );
  return (
    <section>
      <div className="card">
        <h2>Calendrier</h2>
        <p className="note">Publications de résultats, nouvelles des sociétés, décisions de la Fed et échéances des 13F, du {fmtJour(d.du)} au {fmtJour(d.au).replace(/\.$/, "")}. Seules figurent vos actions (portefeuille et liste) et celles traitées par les investisseurs suivis ces 90 derniers jours (▲ acheteurs, ▼ vendeurs). Sources : Finnhub, Réserve fédérale, SEC.</p>
        <div className="controls">
          <div className="seg" role="group" aria-label="Actions">
            {([["tout", "Toutes"], ["miens", "Mes actions"], ["investisseurs", "Actions des investisseurs"]] as const).map(([k, l]) => (
              <button key={k} className="tab" aria-pressed={portee === k} onClick={() => setPortee(k)}>{l}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Types">
            {([["resultats", "Résultats"], ["nouvelle", "Nouvelles"], ["marche", "Fed et échéances"]] as const).map(([k, l]) => (
              <button key={k} className="tab" aria-pressed={genres.has(k)} onClick={() => toggle(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!d.resultatsCollectes && <p className="note warn-note">Dates de résultats pas encore collectées : ajoutez la variable FINNHUB_API_KEY (clé gratuite sur finnhub.io), elles arrivent à la collecte suivante.</p>}
      </div>
      <div className="card">
        <h2>À venir</h2>
        {avenir.length ? avenir.map(jour) : <p className="note">Rien à venir avec ces filtres.</p>}
      </div>
      {passes.length > 0 && (
        <div className="card">
          <h2>Les 7 derniers jours</h2>
          {passes.map(jour)}
        </div>
      )}
    </section>
  );
}
