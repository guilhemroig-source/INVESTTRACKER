import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, getFiche, getTradeAnalysis, todayParis } from "@tracker/core";
import { AnalysisView } from "@/components/analysis/AnalysisView";
import { Sym, Who } from "@/components/cells";
import { fmtDate, fmtPrice, fmtRange, fmtSigned, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AnalysePage({ params }: { params: Promise<{ cle: string }> }) {
  const { cle } = await params;
  const res = getTradeAnalysis(getDb(), decodeURIComponent(cle));
  if (!res) notFound();
  const { op, analysis, societe, news } = res;
  return (
    <div className="tk" style={{ paddingTop: 28 }}>
      <p className="kicker">Analyse technique · pourquoi {op.sens === "achat" ? "cet achat" : "cette vente"} ?</p>
      <p className="lead" style={{ margin: "0 0 12px" }}><Link href="/" style={{ color: "var(--tk-accent)" }}>← Retour au tableau de bord</Link></p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="op-head">
          <div>
            <div style={{ fontSize: "1.35rem", marginBottom: 6 }}><Sym t={op.ticker} name={societe} /></div>
            <div><Who qui={op.qui} /></div>
          </div>
          <div className="op-facts">
            <span className={`pill-big ${op.sens === "achat" ? "buy" : "sell"}`}>{op.operation}</span>
            <span>{op.montantUsd != null ? fmtUsd(op.montantUsd) : op.fourchette ? fmtRange(op.fourchette) : op.volume != null ? `${fmtSigned(op.volume)} actions` : ""}</span>
            {op.prix ? <span className="muted">à {fmtPrice(op.prix)}</span> : null}
            <span className="muted">opération le {fmtDate(op.dateOperation)} · publiée le {fmtDate(op.datePublication)}</span>
            {op.sourceUrl ? <a className="ok-badge" href={op.sourceUrl} target="_blank" rel="noreferrer">Déclaration ↗</a> : null}
          </div>
        </div>
      </div>
      <AnalysisView analysis={analysis} news={news} fiche={getFiche(getDb(), op.ticker, todayParis())} sens={op.sens} ticker={op.ticker} />
      <details open>
        <summary>Comment lire cette analyse</summary>
        <p style={{ marginTop: 10 }}>
          Chaque modèle est lu de façon classique (RSI 14 jours, moyennes 20/50/200, MACD 12/26/9, Bollinger 20 jours à 2 écarts-types,
          volume comparé à la moyenne de 20 jours, supports et résistances à partir des plus hauts et plus bas de 6 mois, retracements de
          Fibonacci de la dernière grande oscillation, stochastique 14/3/3). « Pour » signifie que le signal allait dans le sens de
          l&apos;opération déclarée. Ces outils décrivent le contexte du cours : ils ne révèlent pas les intentions de l&apos;investisseur,
          souvent motivées par d&apos;autres raisons (voir le motif probable). Cours ajustés fournis par Tiingo. Rien ici n&apos;est un conseil
          d&apos;investissement.
        </p>
      </details>
    </div>
  );
}
