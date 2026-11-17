import type { Collector } from "./types";
import { collectArk } from "./ark";
import { collectOpenInsider } from "./openinsider";
import { collectEdgarMusk } from "./edgar-musk";
import { collectEdgarInsiders } from "./edgar-insiders";
import { collectTickers } from "./tickers";
import { collect13F } from "./thirteenf";
import { collectTrump } from "./trump";
import { collectCongres } from "./congres";
import { collectPrix } from "./prix";
import { collectNews } from "./news";
import { collectFondamentaux } from "./fondamentaux";
import { collectChange } from "./change";
import { collectCalendrier } from "./calendrier";

export const COLLECTORS: Record<string, { run: Collector; description: string }> = {
  tickers: { run: collectTickers, description: "Noms des sociétés (liste officielle SEC)" },
  ark: { run: collectArk, description: "Cathie Wood / ARK : opérations du jour + positions publiées par ARK" },
  openinsider: { run: collectOpenInsider, description: "Initiés > 1 M$ et initiés de Tesla (OpenInsider), vérification EDGAR des 2 plus gros" },
  "edgar-musk": { run: collectEdgarMusk, description: "Formulaires 4 d'Elon Musk (Tesla, SpaceX) sur SEC EDGAR" },
  "13f": { run: collect13F, description: "Super-investisseurs : derniers 13F (insiderset), quantités vérifiées sur EDGAR" },
  trump: { run: collectTrump, description: "Donald Trump : OGE 278-T (getsignal), recoupé avec open-cabinet" },
  congres: { run: collectCongres, description: "Élus du Congrès (STOCK Act) via l'API Bargo" },
  change: { run: collectChange, description: "Taux de change euro / dollar de la BCE (Mon portefeuille en euros)" },
  calendrier: { run: collectCalendrier, description: "Calendrier : dates de résultats et nouvelles des sociétés (Finnhub)" },
  prix: { run: collectPrix, description: "Cours journaliers (Tiingo) pour l'analyse technique, par tranches de 45 actions" },
  fondamentaux: { run: collectFondamentaux, description: "Comptes des sociétés (XBRL SEC) : valorisation, croissance, dette, rachats" },
  news: { run: collectNews, description: "Nouvelles autour des opérations : annonces 8-K (EDGAR) et presse (GDELT)" },
  "edgar-insiders": { run: collectEdgarInsiders, description: "Secours : formulaires 4 du jour lus directement sur EDGAR" },
};

/** Ordre de « collect all ». edgar-insiders ne tourne que si OpenInsider a échoué. */
export const ALL_ORDER = ["tickers", "ark", "edgar-musk", "openinsider", "13f", "trump", "congres", "change", "prix", "fondamentaux", "news", "calendrier"] as const;
