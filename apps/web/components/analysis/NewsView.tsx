import type { NewsAnalysis, TimelineEvent } from "@tracker/core";
import { fmtDate, fmtPct } from "@/lib/format";

/** « Ce que disaient les nouvelles » : hypothèses, contexte de marché, thèmes, chronologie. */

const KIND: Record<TimelineEvent["kind"], { label: string; cls: string }> = {
  officiel: { label: "Annonce officielle", cls: "k-off" },
  presse: { label: "Presse", cls: "k-press" },
  cours: { label: "Séance", cls: "k-cours" },
  operation: { label: "Opération", cls: "k-op" },
};
const CONF = { forte: "Confiance forte", moyenne: "Confiance moyenne", faible: "Piste faible" } as const;
const pct = (x: number | null) => (x == null ? "—" : fmtPct(x * 100));
const cls = (x: number | null) => (x == null ? "" : x >= 0 ? "buy" : "sell");
const rel = (j: number) => (j === 0 ? "J" : j > 0 ? `J+${j}` : `J${j}`);

export function NewsView({ news, sens }: { news: NewsAnalysis; sens: "achat" | "vente" }) {
  const c = news.contexte;
  const ecart = c.action5 != null && c.qqq5 != null ? c.action5 - c.qqq5 : null;
  return (
    <div className="card news">
      <h2>Ce que disaient les nouvelles</h2>
      <p className="news-resume">{news.resume}</p>

      <div className="ctx-row" aria-label="Contexte de marché">
        <div><span className="lbl">Action · 5 séances</span><b className={cls(c.action5)}>{pct(c.action5)}</b></div>
        <div><span className="lbl">Nasdaq 100 · 5 séances</span><b className={cls(c.qqq5)}>{pct(c.qqq5)}</b></div>
        <div><span className="lbl">S&amp;P 500 · 5 séances</span><b className={cls(c.spy5)}>{pct(c.spy5)}</b></div>
        <div><span className="lbl">Écart propre à l&apos;action</span><b className={cls(ecart)}>{pct(ecart)}</b></div>
        <div><span className="lbl">Action · 20 séances</span><b className={cls(c.action20)}>{pct(c.action20)}</b></div>
        <div><span className="lbl">Distance au plus haut 1 an</span><b className={cls(c.plusHaut52)}>{pct(c.plusHaut52)}</b></div>
      </div>

      <h3 className="news-h3">Ce qui peut expliquer {sens === "achat" ? "cet achat" : "cette vente"}</h3>
      <ol className="hyps">
        {news.hypotheses.map((h, k) => (
          <li key={k} className={`hyp c-${h.confiance} a-${h.accord}`}>
            <div className="hyp-head">
              <span className="conf">{CONF[h.confiance]}</span>
              {h.accord === "contre" && <span className="conf contre">à contre-pied</span>}
              <span className="hyp-title">{h.titre}</span>
            </div>
            <ul>{h.preuves.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </li>
        ))}
      </ol>

      {news.themes.length > 0 && (
        <>
          <h3 className="news-h3">Thèmes de l&apos;actualité</h3>
          <div className="chips">
            {news.themes.map((t) => (
              <span key={t.id} className={`chip ${t.ton > 0.2 ? "pos" : t.ton < -0.2 ? "neg" : ""}`} title={t.ton > 0.2 ? "Tonalité plutôt positive" : t.ton < -0.2 ? "Tonalité plutôt négative" : "Tonalité partagée"}>
                {t.label} <b>{t.n}</b>
              </span>
            ))}
          </div>
        </>
      )}

      <h3 className="news-h3">Chronologie</h3>
      <ol className="timeline">
        {news.chronologie.map((e, k) => {
          const kd = KIND[e.kind];
          return (
            <li key={k} className={`ev ${kd.cls} ${e.ton > 0 ? "pos" : e.ton < 0 ? "neg" : ""}`}>
              <div className="ev-date"><span>{fmtDate(e.date, false)}</span><small>{rel(e.jours)}</small></div>
              <div className="ev-body">
                <div className="ev-top">
                  <span className="ev-kind">{kd.label}</span>
                  {e.reaction != null && e.kind !== "cours" && e.kind !== "operation" && <span className={`ev-react ${cls(e.reaction)}`} title="Variation du cours le jour de la nouvelle">{pct(e.reaction)} ce jour-là</span>}
                  {e.themes.slice(0, 3).map((t) => <span key={t} className="chip mini">{t}</span>)}
                </div>
                <div className="ev-title">{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.titre}</a> : e.titre}</div>
                {(e.detail || e.source) && <div className="ev-src">{e.detail}{e.detail && e.source ? " · " : ""}{e.source}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="note" style={{ marginBottom: 0 }}>
        {news.couverture.officiel} annonce(s) officielle(s) (formulaires 8-K, SEC) · {news.couverture.presse} article(s) citant la société (GDELT).
        {news.couverture.note ? ` ${news.couverture.note}` : ""} Thèmes et tonalité déterminés à partir des mots des titres ; les hypothèses sont des pistes, pas des certitudes.
      </p>
    </div>
  );
}
