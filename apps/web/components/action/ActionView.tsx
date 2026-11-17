"use client";
import { useEffect, useState } from "react";
import type { ActionData } from "@tracker/core";
import { load } from "@/lib/snapshot";
import { fmtDate, fmtPct, fmtPrice, fmtRange, fmtSigned, fmtUsd, sensClass } from "@/lib/format";
import { EmptyRow, OpCell, SignalCell, Who, type AnalysisMap } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";
import { FicheView } from "../analysis/FicheView";
import { WatchButton } from "../WatchButton";
import { PriceChart } from "./PriceChart";
import { JournalPanel } from "../journal/JournalPanel";

const ITEMS: Record<string, string> = { "1.01": "Accord important", "2.01": "Acquisition / cession", "2.02": "Résultats", "5.02": "Dirigeants", "7.01": "Communication", "8.01": "Autre événement", "1.05": "Cybersécurité", "2.05": "Restructuration", "5.07": "Vote des actionnaires", "3.02": "Émission d'actions" };

/** Page d'une action : cours annoté, opérations des investisseurs, annonces et presse, fiche. */
export function ActionView({ ticker, analyses, onClose }: { ticker: string; analyses: AnalysisMap; onClose: () => void }) {
  const [d, setD] = useState<ActionData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null); setErr(null);
    load<ActionData>(`/api/action/${encodeURIComponent(ticker)}`, (s) => s.action?.(ticker)).then(setD, (e) => setErr(String(e.message)));
    window.scrollTo({ top: 0 });
  }, [ticker]);
  if (err) return <div className="card"><p className="note sell">Page indisponible pour {ticker} ({err}).</p><button type="button" className="watch-btn" onClick={onClose}>← Retour</button></div>;
  if (!d) return <div className="card"><p className="note">Chargement de {ticker}…</p></div>;
  const last = d.bars.at(-1), prev = d.bars.at(-2);
  const acteurs = [...new Set(d.ops.map((o) => o.qui.replace(/\s*\(.*\)$/, "")))];
  const official = d.news.filter((n) => n.kind === "officiel");
  const press = d.news.filter((n) => n.kind === "presse").slice(0, 25);
  return (
    <section className="action-page">
      <div className="action-head card">
        <button type="button" className="watch-btn" onClick={onClose}>← Tableau de bord</button>
        <div className="action-title">
          <span className="sym big">{d.ticker}</span>
          <h2 className="action-name">{d.societe ?? d.ticker}</h2>
          {last && <span className="action-px">{fmtPrice(last.close)} {prev && <b className={last.close >= prev.close ? "buy" : "sell"}>{fmtPct((last.close / prev.close - 1) * 100)}</b>} <small className="muted">au {fmtDate(last.date)}</small></span>}
        </div>
        <div className="action-meta">
          <span className="score-pill s3" title={d.fiche.smart.scoreDetail.join("\n")}>Score {d.fiche.smart.score}/100</span>
          <span className="muted">{d.ops.length} opération(s) déclarée(s) par {acteurs.length} investisseur(s)</span>
          <WatchButton type="action" valeur={d.ticker} label={d.ticker} />
        </div>
      </div>

      <div className="grid action-societe">
        <div className="card">
          <h2>Ce que fait {d.profil?.nom ?? d.societe ?? d.ticker}</h2>
          {d.profil?.description ? <>
            <div className="profil-texte">
              {d.profil.logo && <img className="profil-logo" src={d.profil.logo} alt="" width={44} height={44} loading="lazy" />}
              {d.profil.description.split("\n").map((para, i) => <p key={i}>{para}</p>)}
            </div>
            <p className="note" style={{ marginBottom: 0 }}>Source : <a href={d.profil.wikipedia ?? "#"} target="_blank" rel="noreferrer">Wikipédia{d.profil.langue === "en" ? " (en anglais, pas d'article français)" : ""} ↗</a></p>
          </> : <p className="note">{d.profil ? "Pas d'article Wikipédia trouvé pour cette société." : "Profil pas encore collecté (collecteur « societes », clé Finnhub)."}{d.profil?.secteur ? ` Secteur : ${d.profil.secteur}.` : ""}</p>}
          {d.profil && (
            <dl className="profil-faits">
              {d.profil.secteur && <div><dt>Secteur</dt><dd>{d.profil.secteur}</dd></div>}
              {d.profil.pays && <div><dt>Pays</dt><dd>{d.profil.pays}</dd></div>}
              {d.profil.capitalisation != null && <div><dt>Capitalisation</dt><dd>{fmtUsd(d.profil.capitalisation * 1e6)}</dd></div>}
              {d.profil.ipo && <div><dt>En bourse depuis</dt><dd>{d.profil.ipo.slice(0, 4)}</dd></div>}
              {d.profil.bourse && <div><dt>Marché</dt><dd>{d.profil.bourse.replace(/ NMS.*| GLOBAL.*/i, "")}</dd></div>}
              {d.profil.site && <div><dt>Site</dt><dd><a href={d.profil.site} target="_blank" rel="noreferrer">{d.profil.site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} ↗</a></dd></div>}
            </dl>
          )}
        </div>
        <div className="card">
          <h2>Dernières nouvelles</h2>
          <p className="note">Les plus récentes sur 7 jours (Finnhub, médias anglophones), mises à jour deux fois par jour.</p>
          <ol className="timeline">{d.nouvelles.map((n, i) => (
            <li key={i} className="ev k-press">
              <div className="ev-date"><span>{fmtDate(n.date, false)}</span>{n.heure && <small>{n.heure} UTC</small>}</div>
              <div className="ev-body">
                <div className="ev-title">{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.titre}</a> : n.titre}</div>
                <div className="ev-src">{n.source}</div>
                {n.resume && <details className="ev-resume"><summary>Résumé</summary><p>{n.resume}</p></details>}
              </div>
            </li>))}
            {!d.nouvelles.length && <li className="muted">Pas encore de nouvelle collectée pour {d.ticker}.</li>}
          </ol>
        </div>
      </div>

      <div className="card">
        <h2>Le cours et les opérations des investisseurs</h2>
        <p className="note">Chaque repère est placé au jour de l&apos;opération (fin de trimestre pour un 13F). Survolez le graphique pour le détail de la journée. Cours ajustés (Tiingo).{d.mesEntrees ? " En orange : vos achats (prix payé converti en dollars au taux du jour) et votre prix de revient, soit le cours en dollars au-dessus duquel vous êtes gagnant, au taux de change actuel." : ""}</p>
        <PriceChart ticker={d.ticker} bars={d.bars} moi={d.mesEntrees} news={official.map((n) => ({ date: n.date, titre: n.titre, resume: n.resume }))}
          ops={d.ops.map((o) => ({ date: o.dateOperation ?? o.datePublication, sens: o.sens, source: o.source, qui: o.qui, operation: o.operation, montantUsd: o.montantUsd, fourchette: o.fourchette }))} />
      </div>

      <div className="card">
        <h2>Toutes les opérations sur {d.ticker}</h2>
        <p className="note">Cliquez sur une ligne pour l&apos;explication (nouvelles, fiche, analyse technique).</p>
        <div className="scroll tall">
          <table>
            <thead><tr><th>Publié</th><th>Qui</th><th>Opération</th><th className="r">Montant</th><th className="r hide-sm">Volume</th><th className="r hide-sm">Opération le</th><th className="r">Analyse</th></tr></thead>
            <tbody>
              {d.ops.map((o) => (
                <ExpandableRow key={o.id} cle={o.cleUnique} cols={7}>
                  <td className="nw">{fmtDate(o.datePublication)}</td>
                  <td><Who qui={o.qui} /></td>
                  <OpCell op={o.operation} sens={o.sens} />
                  <td className={`r ${sensClass(o.sens)}`}>{o.montantUsd != null ? fmtUsd(o.montantUsd) : o.fourchette ? fmtRange(o.fourchette) : <span className="muted">—</span>}</td>
                  <td className="r hide-sm">{o.volume != null ? fmtSigned(o.volume) : <span className="muted">—</span>}</td>
                  <td className="r hide-sm">{fmtDate(o.dateOperation)}</td>
                  <SignalCell cle={o.cleUnique} analyses={analyses} />
                </ExpandableRow>
              ))}
              {!d.ops.length && <EmptyRow cols={7} />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Annonces officielles (8-K)</h2>
          <p className="note">Déclarations de la société à la SEC autour des opérations suivies.</p>
          <ol className="timeline">{official.slice(0, 20).map((n, i) => (
            <li key={i} className={`ev k-off ${n.ton && n.ton > 0 ? "pos" : n.ton && n.ton < 0 ? "neg" : ""}`}>
              <div className="ev-date"><span>{fmtDate(n.date, false)}</span><small>{n.date.slice(0, 4)}</small></div>
              <div className="ev-body"><div className="ev-top"><span className="ev-kind">{(n.items ?? "").split(",").map((x) => ITEMS[x]).filter(Boolean).join(" · ") || "8-K"}</span></div>
                <div className="ev-title">{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.resume ?? n.titre}</a> : n.resume ?? n.titre}</div></div>
            </li>))}
            {!official.length && <li className="muted">Pas encore d&apos;annonce collectée.</li>}
          </ol>
        </div>
        <div className="card">
          <h2>Dans la presse</h2>
          <p className="note">Articles qui citent la société, autour des opérations (archive GDELT, 3 derniers mois).</p>
          <ol className="timeline">{press.map((n, i) => (
            <li key={i} className={`ev k-press ${n.ton && n.ton > 0 ? "pos" : n.ton && n.ton < 0 ? "neg" : ""}`}>
              <div className="ev-date"><span>{fmtDate(n.date, false)}</span></div>
              <div className="ev-body"><div className="ev-title">{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.titre}</a> : n.titre}</div><div className="ev-src">{n.source}</div></div>
            </li>))}
            {!press.length && <li className="muted">Pas encore d&apos;article collecté.</li>}
          </ol>
        </div>
      </div>

      <div className="card">
        <h2>Mes décisions sur {d.ticker}</h2>
        <p className="note">Notez pourquoi vous achetez, vendez ou attendez, et ce qui vous ferait changer d&apos;avis ; l&apos;appli fige le contexte et mesure la suite.</p>
        <JournalPanel ticker={d.ticker} cours={last?.close ?? null} />
      </div>

      <h2 className="section-title">Fiche {d.ticker}</h2>
      <FicheView fiche={d.fiche} sansActivite />
    </section>
  );
}
