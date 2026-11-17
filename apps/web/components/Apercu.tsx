"use client";
import { useEffect, useState } from "react";
import type { Apercu as Data, ApercuItem } from "@tracker/core";
import { actionHash, load } from "@/lib/snapshot";
import { fmtDate, fmtJour, fmtMoney, fmtPct, fmtPrice } from "@/lib/format";
import { ResultatsDetail } from "./tabs/Calendrier";

const p = (x: number | null | undefined, d = 1) => (x == null ? "—" : fmtPct(x * 100, d));
const c = (x: number | null | undefined) => (x == null ? "muted" : x >= 0 ? "buy" : "sell");
const noms = (l: string[] = [], n = 2) => l.slice(0, n).join(", ") + (l.length > n ? ` +${l.length - n}` : "");

/** Mini-courbe des 3 derniers mois (couleur selon la tendance de la période). */
function Spark({ v, pru }: { v: number[]; pru?: number | null }) {
  if (v.length < 2) return <span className="ap-spark ap-spark-vide" aria-hidden />;
  const w = 72, h = 22, all = pru ? [...v, pru] : v, lo = Math.min(...all), hi = Math.max(...all), r = hi - lo || 1;
  const yy = (x: number) => (h - 2 - ((x - lo) / r) * (h - 4)).toFixed(1);
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${yy(x)}`).join(" ");
  return (
    <svg className={`ap-spark ${v[v.length - 1] >= v[0] ? "up" : "dn"}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      {pru ? <line className="ap-pru" x1={0} x2={w} y1={yy(pru)} y2={yy(pru)} strokeDasharray="3 2" /> : null}
      <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Row({ it, meta }: { it: ApercuItem; meta: React.ReactNode }) {
  return (
    <li>
      <a className="ap-row" href={actionHash(it.ticker)} title={it.activite ? `${it.activite}\n\nOuvrir la page ${it.ticker}` : `Ouvrir la page ${it.ticker}`}>
        <span className="ap-id"><b>{it.ticker}</b><span className="co">{it.societe ?? ""}</span></span>
        <Spark v={it.cot.spark} pru={it.pruCourbe} />
        <span className="ap-px">
          <span>{it.cot.cours != null ? fmtPrice(it.cot.cours, it.cot.devise) : "—"}</span>
          <span className={c(it.cot.var1m)} title="Variation sur un mois">{it.cot.var1m != null ? `${p(it.cot.var1m)} 1m` : it.cot.cours != null ? "cours saisi" : "pas de cours"}</span>
        </span>
        <span className="ap-meta">{meta}</span>
      </a>
    </li>
  );
}

const pill = (s = 0) => <span className={`score-pill s${s >= 40 ? 3 : s >= 20 ? 2 : s > 0 ? 1 : 0}`} title="Score smart money (0–100)">{s}</span>;

/** Bandeau d'aperçu en haut du tableau de bord. */
export function Apercu() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem("apercu-ferme") === "1") setOpen(false); } catch { /* stockage indisponible */ }
    load<Data>("/api/apercu", (s) => (s as { apercu?: Data }).apercu).then(setD, (e) => setErr(String(e.message)));
  }, []);
  const toggle = () => setOpen((o) => { try { localStorage.setItem("apercu-ferme", o ? "1" : "0"); } catch { /* idem */ } return !o; });

  return (
    <section className="apercu" aria-label="Aperçu">
      <div className="ap-head">
        <h2>Aperçu{d ? <span className="muted"> · au {fmtDate(d.date)}</span> : null}</h2>
        <button className="btn-link" onClick={toggle} aria-expanded={open}>{open ? "Réduire ▴" : "Afficher ▾"}</button>
      </div>
      {open && (err ? <p className="note sell">Aperçu indisponible ({err}).</p> : !d ? <p className="note">Calcul de l’aperçu…</p> : (
        <div className="ap-grid">
          <div className="card ap-card">
            <h3 className="buy">▲ À suivre</h3>
            <p className="ap-sub">Achats convergents des investisseurs suivis (90 j), plus d’acheteurs que de vendeurs.</p>
            {d.aSuivre.length ? <ul>{d.aSuivre.map((it) => (
              <Row key={it.ticker} it={it} meta={<>{pill(it.score)} <span title={it.acheteurs?.join(", ")}>{noms(it.acheteurs)}</span></>} />
            ))}</ul> : <p className="note">Aucun achat convergent en ce moment.</p>}
          </div>

          <div className="card ap-card">
            <h3 className="sell">▼ Sous pression vendeuse</h3>
            <p className="ap-sub">Au moins deux vendeurs distincts, plus nombreux que les acheteurs.</p>
            {d.pression.length ? <ul>{d.pression.map((it) => (
              <Row key={it.ticker} it={it} meta={<><span className="sell">{it.vendeurs?.length} vendeurs</span> <span title={it.vendeurs?.join(", ")}>{noms(it.vendeurs)}</span></>} />
            ))}</ul> : <p className="note">Pas de vente groupée en ce moment.</p>}
          </div>

          <div className="card ap-card">
            <h3>{d.actifs.source === "liste" ? "◆ Ma liste" : "◆ Mes actifs"}</h3>
            {d.actifs.total ? (
              <p className="ap-sub">
                {fmtMoney(d.actifs.total.valeur, d.actifs.total.devise)} · <span className={c(d.actifs.total.gainTotalPct)}>{p(d.actifs.total.gainTotalPct)}</span>
                {d.actifs.total.reference ? <> · {d.actifs.total.reference} <span className={c(d.actifs.total.referencePct)}>{p(d.actifs.total.referencePct)}</span></> : null} · <span className="ap-legende">┄ prix de revient</span>
              </p>
            ) : <p className="ap-sub">{d.actifs.source === "liste" ? "Actions de votre liste de suivi." : "Vos positions et actions suivies."}</p>}
            {d.actifs.items.length ? <ul>{d.actifs.items.map((it) => (
              <Row key={it.ticker} it={it} meta={it.gainPct !== undefined ? <>
                <span className={c(it.gainPct)}>{p(it.gainPct)} latent</span>
                {it.poids != null ? <span className="muted"> · {p(it.poids, 0).replace("+", "")} du total</span> : null}
                {it.alertes?.length ? <span className="ap-alert" title={it.alertes.join("\n")}> ⚠ {it.alertes.length}</span> : null}
              </> : <span className={c(it.cot.var1j)}>{it.cot.var1j != null ? `${p(it.cot.var1j)} sur 1 jour` : ""}</span>} />
            ))}</ul> : (
              <p className="note">Rien pour l’instant : ajoutez vos positions dans <a href="#portefeuille">Mon portefeuille</a> ou des actions dans <a href="#liste">Ma liste</a>.</p>
            )}
          </div>

          <div className="card ap-card">
            <h3>▦ À venir</h3>
            <p className="ap-sub">Résultats de vos actions et de celles des investisseurs, Fed, 13F (3 semaines).</p>
            {d.agenda.length ? <ul className="ap-agenda">{d.agenda.map((e, i) => (
              <li key={i}>
                <span className="ap-date">{fmtJour(e.date, d.date).replace(/ · .*/, "").replace(/^(\p{L}+) (\d+) .*/u, "$1 $2")}</span>
                <span className="ap-ev">
                  {e.ticker ? <a className="sym-link" href={actionHash(e.ticker)}><b>{e.ticker}</b></a> : null} {e.ticker ? (e.mien ? <span className="cal-tag">{e.detenu ? "à moi" : "ma liste"}</span> : <span className="muted">{e.acheteurs.length ? `▲${e.acheteurs.length}` : ""}{e.vendeurs.length ? ` ▼${e.vendeurs.length}` : ""}</span>) : <span>{e.titre}</span>}
                  {e.type === "resultats" ? <><span className="muted"> résultats{e.heure === "amc" ? " après clôture" : e.heure === "bmo" ? " avant ouverture" : ""}</span><br /><ResultatsDetail d={e.details} /></> : null}
                </span>
              </li>
            ))}</ul> : <p className="note">Rien de prévu (dates de résultats : clé Finnhub requise).</p>}
            <p className="ap-sub" style={{ margin: "8px 0 0" }}><a href="#calendrier">Tout le calendrier →</a></p>
          </div>

          <div className="card ap-card">
            <h3>◷ Les 7 derniers jours</h3>
            <p className="ap-sub">Dernière déclaration publiée : {fmtDate(d.semaine.dernierePublication)}</p>
            <dl className="ap-stats">
              <div><dt>Achats déclarés</dt><dd className="buy">{d.semaine.achats}</dd></div>
              <div><dt>Ventes déclarées</dt><dd className="sell">{d.semaine.ventes}</dd></div>
              <div><dt>Investisseurs actifs</dt><dd>{d.semaine.acteurs}</dd></div>
              <div><dt>Plus achetée</dt><dd>{d.semaine.plusAchetee ? <a className="sym-link" href={actionHash(d.semaine.plusAchetee.ticker)}>{d.semaine.plusAchetee.ticker}</a> : "—"}</dd></div>
              <div><dt>Plus vendue</dt><dd>{d.semaine.plusVendue ? <a className="sym-link" href={actionHash(d.semaine.plusVendue.ticker)}>{d.semaine.plusVendue.ticker}</a> : "—"}</dd></div>
              <div><dt>À faire</dt><dd className={d.semaine.aRevoir + d.semaine.alertesPortefeuille ? "warn" : "muted"}>
                {d.semaine.aRevoir + d.semaine.alertesPortefeuille ? <>
                  {d.semaine.aRevoir ? <a href="#journal">{d.semaine.aRevoir} revue{d.semaine.aRevoir > 1 ? "s" : ""}</a> : null}
                  {d.semaine.aRevoir && d.semaine.alertesPortefeuille ? " · " : null}
                  {d.semaine.alertesPortefeuille ? <a href="#portefeuille">{d.semaine.alertesPortefeuille} alerte{d.semaine.alertesPortefeuille > 1 ? "s" : ""}</a> : null}
                </> : "rien"}
              </dd></div>
            </dl>
          </div>
        </div>
      ))}
    </section>
  );
}
