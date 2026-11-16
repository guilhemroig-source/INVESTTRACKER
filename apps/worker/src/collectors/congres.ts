import { type BargoMember, type BargoTrade, adaptCongress, bargoMembersToJson, bargoTradesToJson, insertOperations, loadTickerNames, schema as s } from "@tracker/core";
import { sql } from "drizzle-orm";
import { getJson } from "../http";
import { TOOL_UA } from "../env";
import type { Collector } from "./types";

const BASE = "https://www.bargo.ai/free-apis/congress/v1";

/** Élus du Congrès (STOCK Act) via l'API gratuite de Bargo (attribution « Bargo » obligatoire, faite dans l'interface). */
export const collectCongres: Collector = async (db) => {
  const key = process.env.BARGO_API_KEY?.trim();
  // Sans clé : 30 requêtes et 100 lignes par jour → 1 appel de 50 lignes + la liste des élus. Avec clé : 250 lignes.
  const limit = key ? 250 : 50;
  const opts = { userAgent: TOOL_UA, cacheTtl: 0, ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) };
  const { trades } = await getJson<{ trades: BargoTrade[] }>(`${BASE}/trades?limit=${limit}`, opts);
  const { members } = await getJson<{ members: BargoMember[] }>(`${BASE}/members`, opts);

  const json = bargoTradesToJson(trades);
  const r = adaptCongress(json, loadTickerNames(db));
  let nouvelles = 0;
  db.transaction((tx) => {
    for (const row of r.raw) {
      // perf_pct évolue chaque jour : mise à jour si la ligne existe déjà.
      tx.insert(s.rawCongress).values(row).onConflictDoUpdate({ target: s.rawCongress.cleUnique, set: { perfPct: sql`excluded.perf_pct` } }).run();
    }
    for (const m of bargoMembersToJson(members)) {
      const v = { elu: m.elu, chambre: m.chambre, etat: m.etat, transactions: m.transactions, achats: m.achats, ventes: m.ventes, derniereTransaction: m.derniere_transaction };
      tx.insert(s.rawCongressMembers).values(v).onConflictDoUpdate({ target: s.rawCongressMembers.elu, set: v }).run();
    }
  });
  nouvelles = insertOperations(db, r.operations);
  return {
    lues: trades.length, nouvelles,
    donneesAu: json.map((t) => t.date_declaration).sort().at(-1) ?? null,
    evenements: nouvelles ? [`${nouvelles} nouvelle(s) transaction(s) d'elus du Congres`] : [],
    details: [`${trades.length} transactions lues (${json.length} achats/ventes d'actions), ${members.length} élus`, key ? "clé Bargo utilisée" : "sans clé Bargo (quota 100 lignes/jour)"],
  };
};
