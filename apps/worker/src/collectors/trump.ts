import { type Db, type TrumpTxJson, adaptTrump, insertIgnore, insertOperations, loadTickerNames, parseGetSignalTrump, parseOpenCabinetTrump, schema as s } from "@tracker/core";
import { getText } from "../http";
import { TOOL_UA } from "../env";
import type { Collector } from "./types";

export const GETSIGNAL_URL = "https://getsignal.finance/president/donald-trump";
export const OPENCABINET_URL = "https://open-cabinet.org/officials/trump-donald-j";

const normCo = (n: string) => n.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|THE|CLASS [A-Z]|COM)\b/g, " ").replace(/\s+/g, " ").trim();

/**
 * Ligne « non vérifiée » (symbole déclaré ne correspondant pas à la société, ex. WHIRLPOOL CORP déclaré sous POOL) :
 * on ne corrige le symbole que si le nom déclaré correspond exactement à une seule société connue.
 */
export function resolveUnverified(db: Db, rows: TrumpTxJson[]): { rows: TrumpTxJson[]; notes: string[] } {
  const byName = new Map<string, string[]>();
  for (const t of db.select().from(s.tickers).all()) {
    const k = normCo(t.nom);
    byName.set(k, [...(byName.get(k) ?? []), t.ticker]);
  }
  const notes: string[] = [];
  const out = rows.map((r) => {
    if (!r.non_verifie || !r.nom_declare) return r;
    const cands = [...new Set(byName.get(normCo(r.nom_declare)) ?? [])].filter((t) => !t.includes("-") && !t.includes("."));
    if (cands.length === 1 && cands[0] !== r.ticker) {
      notes.push(`« ${r.nom_declare} » déclaré sous ${r.ticker} : rattaché à ${cands[0]}`);
      return { ...r, ticker: cands[0] };
    }
    return r;
  });
  return { rows: out, notes };
}

/** Donald Trump : déclarations OGE 278-T retranscrites par getsignal, recoupées avec open-cabinet. */
export const collectTrump: Collector = async (db) => {
  const g = parseGetSignalTrump(await getText(GETSIGNAL_URL, { userAgent: TOOL_UA, cacheTtl: 0 }));
  const knownFilings = new Set(db.select({ d: s.rawTrumpFilings.deposeLe }).from(s.rawTrumpFilings).all().map((x) => x.d));
  const evenements = g.filings.filter((f) => !knownFilings.has(f.depose_le)).map((f) => `Nouvelle declaration de Trump (OGE 278-T) deposee le ${f.depose_le} : ${f.transactions} transactions`);

  db.transaction((tx) => {
    for (const f of g.filings) {
      const v = { deposeLe: f.depose_le, periode: f.periode, debut: f.debut, fin: f.fin, transactions: f.transactions, achats: f.achats, ventes: f.ventes };
      tx.insert(s.rawTrumpFilings).values(v).onConflictDoUpdate({ target: s.rawTrumpFilings.deposeLe, set: v }).run();
    }
    for (const t of g.topTickers) tx.insert(s.rawTrumpTickers).values(t).onConflictDoUpdate({ target: s.rawTrumpTickers.ticker, set: { transactions: t.transactions } }).run();
    const m = g.meta;
    const meta = { id: 1, aJourAu: m.a_jour_au, delaiMedianJours: m.delai_median_jours, partHorsDelai45j: m.part_hors_delai_45j, premiereTransaction: m.premiere_transaction, derniereTransaction: m.derniere_transaction };
    tx.insert(s.rawTrumpMeta).values(meta).onConflictDoUpdate({ target: s.rawTrumpMeta.id, set: meta }).run();
  });

  const { rows, notes } = resolveUnverified(db, g.recent);
  const r = adaptTrump(rows, loadTickerNames(db));
  insertIgnore(db, s.rawTrump, r.raw);
  const nouvelles = insertOperations(db, r.operations);

  // Recoupement du nombre de transactions de la dernière déclaration avec open-cabinet.org
  const details = [...notes];
  const last = g.filings.at(-1);
  try {
    const oc = parseOpenCabinetTrump(await getText(OPENCABINET_URL, { userAgent: TOOL_UA, cacheTtl: 0 }));
    if (!oc.derniere_declaration) details.push("open-cabinet : dernière déclaration non lue, recoupement impossible");
    else if (last && oc.derniere_declaration === last.depose_le && oc.transactions === last.transactions) details.push(`Recoupé avec open-cabinet : déclaration du ${last.depose_le}, ${last.transactions} transactions des deux côtés`);
    else details.push(`ÉCART open-cabinet : ${oc.transactions} transactions le ${oc.derniere_declaration} contre ${last?.transactions} le ${last?.depose_le} chez getsignal`);
  } catch (e) { details.push(`open-cabinet indisponible (${(e as Error).message}) : recoupement non fait`); }

  return { lues: g.recent.length, nouvelles, donneesAu: g.meta.a_jour_au, evenements, details };
};
