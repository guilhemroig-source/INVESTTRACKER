import type { Analysis, Fiche, NewsAnalysis, Reading } from "@tracker/core";
import { NewsView } from "./NewsView";
import { FicheView } from "./FicheView";
import { AnalysisTabs } from "./AnalysisTabs";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { LEGENDS } from "./IndicatorCharts";
import { ZoomIndicateurs, ZoomedIndicator } from "./ZoomIndicateurs";

/** Contenu de l'analyse d'une opération : verdict, motif, suite, 8 modèles. Utilisé en pleine page et dans les lignes dépliées. */

const ACCORD = {
  pour: { label: (sens: string) => `Pour ${sens === "achat" ? "l'achat" : "la vente"}`, cls: "buy" },
  contre: { label: (sens: string) => `Contre ${sens === "achat" ? "l'achat" : "la vente"}`, cls: "sell" },
  neutre: { label: () => "Neutre", cls: "" },
} as const;

function IndicatorCard({ r, idx, sens, analysis }: { r: Reading; idx: number; sens: string; analysis: Analysis }) {
  const a = ACCORD[r.accord];
  return (
    <div className="card ind-card">
      <div className="ind-head">
        <span className="ind-num">{String(idx + 1).padStart(2, "0")}</span>
        <h3>{r.titre}</h3>
        <span className={`accord ${a.cls}`}>{a.label(sens)}</span>
      </div>
      <div className="legend">{LEGENDS[r.id].map((l) => <span key={l.label}><span className="sw" style={{ background: l.color }} />{l.label}</span>)}</div>
      <ZoomedIndicator id={r.id} c={analysis.chart} />
      <p className="ind-val">{r.valeur}</p>
      <p className="ind-txt">{r.lecture}</p>
    </div>
  );
}

export function AnalysisView({ analysis, news, fiche, sens, ticker }: { analysis: Analysis | null; news?: NewsAnalysis | null; fiche?: Fiche | null; sens: "achat" | "vente"; ticker: string }) {
  const tabs = [
    ...(news ? [{ id: "news", label: "Nouvelles", content: <NewsView news={news} sens={sens} /> }] : []),
    ...(fiche ? [{ id: "fiche", label: `Fiche ${ticker}`, content: <FicheView fiche={fiche} /> }] : []),
    { id: "tech", label: "Analyse technique", content: <TechView analysis={analysis} sens={sens} ticker={ticker} /> },
  ];
  return <AnalysisTabs tabs={tabs} />;
}

function TechView({ analysis: a, sens, ticker }: { analysis: Analysis | null; sens: "achat" | "vente"; ticker: string }) {
  const verbe = sens === "achat" ? "achat" : "vente";
  if (!a) return (
    <div className="card"><h2>Cours pas encore disponibles</h2><p className="note" style={{ marginBottom: 0 }}>Les cours de {ticker} n&apos;ont pas encore été téléchargés : l&apos;offre gratuite de Tiingo limite le nombre d&apos;actions par heure. L&apos;analyse apparaîtra après un prochain passage du collecteur « prix ».</p></div>
  );
  if (a.statut !== "ok") return <div className="card"><h2>Analyse impossible</h2><p className="note" style={{ marginBottom: 0 }}>{a.raison}</p></div>;
  return (
    <>
      <div className="grid">
        <div className={`card verdict ${a.verdict.ton}`}>
          <h2>Ce que disait le graphique (analyse technique)</h2>
          <p className="verdict-title">{a.verdict.titre}</p>
          <div className="score">
            <span className="buy">{a.pour} pour</span><span className="sell">{a.contre} contre</span><span className="muted">{a.neutres} neutres</span>
          </div>
          <p className="note" style={{ marginBottom: 0 }}>{a.verdict.texte} Indicateurs calculés à la clôture du {fmtDate(a.refDate)} (cours {fmtPrice(a.close)}, ajusté).</p>
        </div>
        <div className="card">
          <h2>Motif probable, hors graphique</h2>
          <p className="verdict-title" style={{ fontSize: "1.05rem" }}>{a.motif.titre}</p>
          <p className="note" style={{ marginBottom: 0 }}>{a.motif.texte}</p>
        </div>
      </div>
      {(a.suite.length > 0 || a.periode) && (
        <div className="tiles">
          {a.periode && (
            <div className="tile"><div className="lbl">Sur le trimestre ({fmtDate(a.periode.debut, false)} → {fmtDate(a.periode.fin, false)})</div>
              <div className={`num ${a.periode.perf >= 0 ? "buy" : "sell"}`}>{fmtPct(a.periode.perf * 100)}</div>
              <div className="sub">entre {fmtPrice(a.periode.min)} et {fmtPrice(a.periode.max)} ; date exacte inconnue</div></div>
          )}
          {a.suite.map((x) => {
            const good = (x.perf >= 0) === (sens === "achat");
            return (
              <div className="tile" key={x.jours}><div className="lbl">Cours {x.jours} séances après</div>
                <div className={`num ${x.perf >= 0 ? "buy" : "sell"}`}>{fmtPct(x.perf * 100)}</div>
                <div className="sub">{fmtDate(x.date)} · {good ? `${verbe} bien placé${sens === "vente" ? "e" : ""}` : `${verbe} à contretemps`}</div></div>
            );
          })}
        </div>
      )}
      <ZoomIndicateurs dates={a.chart.dates} refIndex={a.chart.refIndex}>
        <div className="ind-grid">
          {a.readings.map((r, k) => <IndicatorCard key={r.id} r={r} idx={k} sens={sens} analysis={a} />)}
        </div>
      </ZoomIndicateurs>
    </>
  );
}
