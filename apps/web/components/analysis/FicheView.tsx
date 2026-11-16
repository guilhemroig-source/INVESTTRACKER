import type { Fiche } from "@tracker/core";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";

/** Fiche action : qui achète et vend, conviction des fonds, retard du suiveur, historique, finances, risque. */

const SRC: Record<string, string> = { "13F": "Fonds (13F)", ARK: "ARK", FORM4: "Initié", TRUMP: "Trump", CONGRES: "Élu" };
const p = (x: number | null | undefined, d = 1) => (x == null ? "—" : fmtPct(x * 100, d));
const c = (x: number | null | undefined, invert = false) => (x == null ? "" : (x >= 0) !== invert ? "buy" : "sell");

function Metric({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="metric">
      <span className="lbl">{label}</span>
      <b className={cls}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function FicheView({ fiche }: { fiche: Fiche }) {
  const { smart: s, risque: r, finances: f } = fiche;
  return (
    <div className="fiche">
      <div className="card fiche-score">
        <div className="score-big"><b>{s.score}</b><span>/100</span></div>
        <div>
          <h2>Score « smart money »</h2>
          <p className="note" style={{ margin: "4px 0 6px" }}>Synthèse des signaux des investisseurs suivis sur 90 jours. Règles :</p>
          <ul className="score-rules">{s.scoreDetail.length ? s.scoreDetail.map((d) => <li key={d}>{d}</li>) : <li>Aucun signal sur la période.</li>}</ul>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Qui achète, qui vend (90 jours)</h2>
          <p className="note">Depuis le {fmtDate(s.depuis)}. Les ventes liées à la rémunération (exercices d&apos;options, impôts) sont comptées à part : {s.ventesTechniques}.</p>
          <div className="who-cols">
            <div><span className="lbl buy">Acheteurs · {s.acheteurs.length}</span>
              <ul>{s.acheteurs.map((a) => <li key={a.acteur}><span className="src">{SRC[a.source] ?? a.source}</span> {a.acteur} <small>{fmtDate(a.date, false)}</small></li>)}{!s.acheteurs.length && <li className="muted">aucun</li>}</ul></div>
            <div><span className="lbl sell">Vendeurs · {s.vendeurs.length}</span>
              <ul>{s.vendeurs.map((a) => <li key={a.acteur}><span className="src">{SRC[a.source] ?? a.source}</span> {a.acteur} <small>{fmtDate(a.date, false)}</small></li>)}{!s.vendeurs.length && <li className="muted">aucun</li>}</ul></div>
          </div>
          <p className="note" style={{ marginBottom: 0 }}>
            <b>Achats d&apos;initiés sur le marché (6 mois)</b> : {s.achatsInities.n === 0 ? "aucun." : `${s.achatsInities.n} dirigeant(s) (${s.achatsInities.acteurs.join(", ")}), ${fmtUsd(s.achatsInities.montant)}, ${s.achatsInities.fenetre}.`}
            {s.achatsInities.groupe ? " Achats groupés : c'est le signal d'initiés le plus fiable selon les études." : ""}
          </p>
        </div>
        <div className="card">
          <h2>Conviction des grands fonds</h2>
          <p className="note">Dernier 13F de chaque fonds : poids de la ligne dans le portefeuille déclaré et rang (1 = plus grosse ligne).</p>
          {s.fonds.length ? (
            <table><thead><tr><th>Fonds</th><th>Mouvement</th><th className="r">Poids</th><th className="r">Rang</th></tr></thead>
              <tbody>{s.fonds.map((x) => <tr key={x.acteur}><td>{x.acteur} <small className="muted">{x.trimestre}</small></td><td className={/Nouvelle|Renforcement/.test(x.operation) ? "buy" : "sell"}>{x.operation}</td><td className="r">{x.poidsPct != null ? `${fmtNum(x.poidsPct, 2)} %` : "—"}</td><td className="r">{x.rang ?? "—"}</td></tr>)}</tbody></table>
          ) : <p className="muted" style={{ margin: 0 }}>Aucun des fonds suivis ne déclare cette action.</p>}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Arrivez-vous trop tard ?</h2>
          <p className="note">Évolution du cours depuis chaque achat récent, jusqu&apos;au {fmtDate(r.dateCours)}. Plus elle est forte, moins il reste de potentiel « gratuit » à suivre.</p>
          {s.retard.details.length ? (
            <ul className="plain">{s.retard.details.map((d) => <li key={d.acteur}>{d.acteur} <small className="muted">achat du {fmtDate(d.date, false)}</small> : <b className={c(d.perf)}>{p(d.perf)}</b></li>)}</ul>
          ) : <p className="muted" style={{ margin: 0 }}>Pas d&apos;achat récent mesurable.</p>}
        </div>
        <div className="card">
          <h2>Historique de réussite de ces investisseurs</h2>
          <p className="note">Évolution moyenne du cours 20 et 60 séances après leurs achats suivis ici, et part des achats en hausse à 20 séances.</p>
          {s.historique.length ? (
            <table><thead><tr><th>Investisseur</th><th className="r">Achats</th><th className="r">+20 s.</th><th className="r">+60 s.</th><th className="r">Réussite</th></tr></thead>
              <tbody>{s.historique.map((h) => <tr key={h.acteur}><td>{h.acteur}</td><td className="r">{h.n}</td><td className={`r ${c(h.perf20)}`}>{p(h.perf20)}</td><td className={`r ${c(h.perf60)}`}>{p(h.perf60)}</td><td className="r">{h.reussite != null ? `${Math.round(h.reussite * 100)} %` : "—"}</td></tr>)}</tbody></table>
          ) : <p className="muted" style={{ margin: 0 }}>Historique insuffisant (cours pas encore disponibles pour leurs achats passés).</p>}
        </div>
      </div>

      <div className="card">
        <h2>Valorisation et santé financière</h2>
        {f ? (
          <>
            <p className="note">Comptes arrêtés au {fmtDate(f.arrete)} (12 mois glissants, données XBRL de la SEC), cours {fmtPrice(r.cours)}.</p>
            <div className="metrics">
              <Metric label="Capitalisation" value={fmtUsd(f.capitalisation)} />
              <Metric label="PER" value={f.per != null ? fmtNum(f.per, 1) : "—"} sub="cours / bénéfice par action" />
              <Metric label="Cours / ventes" value={f.prixVentes != null ? fmtNum(f.prixVentes, 1) : "—"} />
              <Metric label="Chiffre d'affaires 12 m." value={fmtUsd(f.revenuTtm)} sub={`${p(f.croissanceCa)} sur un an`} cls={c(f.croissanceCa)} />
              <Metric label="Bénéfice net 12 m." value={fmtUsd(f.netTtm)} sub={`${p(f.croissanceNet)} sur un an`} cls={c(f.netTtm)} />
              <Metric label="Marge nette" value={p(f.margeNette)} cls={c(f.margeNette)} />
              <Metric label="Flux de trésorerie disponible" value={fmtUsd(f.fcf)} sub={`rendement ${p(f.rendementFcf)}`} cls={c(f.fcf)} />
              <Metric label="Dette nette" value={f.detteNette != null ? (f.detteNette < 0 ? `trésorerie nette ${fmtUsd(-f.detteNette)}` : fmtUsd(f.detteNette)) : "—"} cls={f.detteNette != null && f.detteNette < 0 ? "buy" : ""} />
              <Metric label="Dette / fonds propres" value={f.detteSurFp != null ? fmtNum(f.detteSurFp, 2) : "—"} cls={f.detteSurFp != null && f.detteSurFp > 2 ? "sell" : ""} />
              <Metric label="Nombre d'actions (1 an)" value={p(f.variationActions)} sub={f.variationActions != null && f.variationActions < 0 ? "rachats" : f.variationActions != null && f.variationActions > 0.03 ? "dilution" : "stable"} cls={c(f.variationActions, true)} />
            </div>
            {f.lectures.length > 0 && <ul className="plain lectures">{f.lectures.map((l) => <li key={l}>{l}</li>)}</ul>}
          </>
        ) : <p className="note" style={{ marginBottom: 0 }}>{fiche.financesStatut}</p>}
      </div>

      <div className="card">
        <h2>Risque et marché</h2>
        <p className="note">Sur un an de cours, comparé au S&amp;P 500 (bêta) et au Nasdaq 100 (force relative).</p>
        <div className="metrics">
          <Metric label="Volatilité annuelle" value={p(r.volatilite, 0)} sub={r.volatilite != null ? (r.volatilite > 0.5 ? "très élevée" : r.volatilite > 0.3 ? "élevée" : "modérée") : undefined} />
          <Metric label="Bêta (S&P 500)" value={r.beta != null ? fmtNum(r.beta, 2) : "—"} sub={r.beta != null ? (r.beta > 1.3 ? "amplifie le marché" : r.beta < 0.7 ? "défensive" : "suit le marché") : undefined} />
          <Metric label="Pire baisse sur 1 an" value={p(r.pireBaisse, 0)} cls="sell" />
          <Metric label="Liquidité (échanges/jour)" value={fmtUsd(r.liquiditeUsd)} />
          <Metric label="Force relative 3 mois" value={p(r.force3m)} cls={c(r.force3m)} sub="vs Nasdaq 100" />
          <Metric label="Force relative 6 mois" value={p(r.force6m)} cls={c(r.force6m)} sub="vs Nasdaq 100" />
          <Metric label="Force relative 12 mois" value={p(r.force12m)} cls={c(r.force12m)} sub="vs Nasdaq 100" />
          <Metric label="Distance au plus haut 1 an" value={p(r.distancePlusHaut)} cls={c(r.distancePlusHaut)} />
        </div>
      </div>
    </div>
  );
}
