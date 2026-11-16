// Point d'entrée de la version « instantané » : le tableau de bord complet, sans serveur, données intégrées à la page.
import { createRoot } from "react-dom/client";
import { analyzeTrade, type Bar, type TradeInput } from "@tracker/core/ta";
import type { ClassementRow, DashboardData, Fiche, NewsAnalysis } from "@tracker/core";
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
  fiches: Record<string, Fiche>;
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
