// Point d'entrée de la version « instantané » : le tableau de bord complet, sans serveur, données intégrées à la page.
import { createRoot } from "react-dom/client";
import { analyzeTrade, type Bar, type TradeInput } from "@tracker/core/ta";
import type { ActionData, ClassementRow, DashboardData, Fiche, MirrorResult, MirrorSummary, NewsAnalysis } from "@tracker/core";
import { Dashboard } from "@/components/Dashboard";
import { fmtDate } from "@/lib/format";

interface Payload {
  data: DashboardData;
  today: string;
  genereLe: string;
  /** Cours compressés : ticker -> [dates, open, high, low, close, volume] */
  prices: Record<string, [string[], number[], number[], number[], number[], number[]]>;
  trades: Record<string, TradeInput & { ticker: string; news?: NewsAnalysis }>;
  classement: ClassementRow[];
  apercu: unknown;
  calendrier: unknown;
  fiches: Record<string, Fiche>;
  miroirs: MirrorSummary[];
  miroirDetails: Record<string, MirrorResult>;
  newsByTicker: Record<string, ActionData["news"]>;
  profils: Record<string, ActionData["profil"]>;
  nouvelles: Record<string, ActionData["nouvelles"]>;
}

const P = JSON.parse(document.getElementById("tracker-data")!.textContent!) as Payload;
const barsCache = new Map<string, Bar[]>();
const barsOf = (t: string): Bar[] => {
  if (!barsCache.has(t)) {
    const p = P.prices[t];
    barsCache.set(t, p ? p[0].map((date, i) => ({ date, open: p[1][i], high: p[2][i], low: p[3][i], close: p[4][i], volume: p[5][i] })) : []);
  }
  return barsCache.get(t)!;
};

(globalThis as unknown as { __TRACKER_SNAPSHOT__: unknown }).__TRACKER_SNAPSHOT__ = {
  classement: P.classement,
  apercu: P.apercu,
  calendrier: P.calendrier,
  miroirs: P.miroirs,
  miroir: (a: string) => {
    if (P.miroirDetails[a]) return P.miroirDetails[a];
    const m = P.miroirs.find((x) => x.acteur === a);
    return m ? { ...m, trades: [], courbe: [] } : null;
  },
  action: (t: string): ActionData | null => {
    const ops = P.data.operations.filter((o) => o.ticker === t);
    const fiche = P.fiches[t];
    if (!ops.length || !fiche) return null;
    return {
      ticker: t, societe: ops.find((o) => o.societe)?.societe ?? P.data.tickers[t] ?? null,
      bars: barsOf(t).map((b) => ({ date: b.date, close: b.close, volume: b.volume })),
      ops, news: P.newsByTicker[t] ?? [], fiche, suivi: [], profil: P.profils[t] ?? null, nouvelles: P.nouvelles[t] ?? [],
    };
  },
  fiche: (t: string) => P.fiches[t] ?? null,
  analyse(cle: string) {
    const t = P.trades[cle];
    if (!t) return null;
    const bars = barsOf(t.ticker);
    return { sens: t.sens, ticker: t.ticker, analysis: bars.length ? analyzeTrade(bars, t) : null, news: t.news ?? null, fiche: P.fiches[t.ticker] ?? null };
  },
};

function App() {
  return (
    <>
      <div className="snap-note" role="note">
        Instantané du <b>{fmtDate(P.genereLe.slice(0, 10))}</b> · données figées à cette date, sans mise à jour automatique ni SMS.
        La version hébergée, elle, se met à jour seule.
      </div>
      <Dashboard data={P.data} today={P.today} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
