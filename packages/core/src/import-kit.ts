import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/client";
import * as s from "./db/schema";
import * as A from "./adapters";
import { backfillSocietes, insertIgnore, insertOperations, loadTickerNames, runLogged, upsertTickers } from "./store";

const read = <T>(dir: string, f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
const maxOf = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().at(-1) ?? null;

/** Importe les fichiers du kit (data/) dans la base, source par source, avec journal. */
export async function importKit(db: Db, dir: string) {
  const results: Record<string, unknown> = {};

  // 1. Noms de sociétés : référence, puis noms fournis par les sources elles-mêmes.
  results.tickers = await runLogged(db, "import:tickers", async () => {
    const ref = read<{ ticker: string; nom: string }[]>(dir, "noms_actions.json");
    let n = upsertTickers(db, ref.map((r) => ({ ...r, origine: "noms_actions.json" })));
    for (const f of ["insider_trades.json", "superinvestors_13f.json", "congress_trades.json"]) {
      const rows = read<{ ticker: string; societe?: string }[]>(dir, f);
      n += upsertTickers(db, rows.map((r) => ({ ticker: r.ticker, nom: r.societe, origine: f })));
    }
    n += upsertTickers(db, [
      { ticker: "TSLA", nom: "Tesla", origine: "kit" },
      { ticker: "SPCX", nom: "SpaceX", origine: "kit" },
    ]);
    return { lues: ref.length, nouvelles: n };
  });
  const names = loadTickerNames(db);

  results.ark = await runLogged(db, "import:ark", async () => {
    const rows = read<A.ArkTradeJson[]>(dir, "ark_trades.json");
    const r = A.adaptArk(rows, names);
    insertIgnore(db, s.rawArk, r.raw);
    return { lues: rows.length, nouvelles: insertOperations(db, r.operations), donneesAu: maxOf(rows.map((x) => x.date)) };
  });

  for (const [list, file] of [["tesla", "tesla_insiders.json"], ["spacex", "spacex_musk.json"], ["gros", "insider_trades.json"]] as const) {
    results[list] = await runLogged(db, `import:form4-${list}`, async () => {
      const rows = read<A.InsiderJson[]>(dir, file);
      const r = A.adaptForm4(rows, list, names);
      insertIgnore(db, s.rawInsider, r.raw);
      return { lues: rows.length, nouvelles: insertOperations(db, r.operations), donneesAu: maxOf(rows.map((x) => x.depose_le)) };
    });
  }

  results["13f"] = await runLogged(db, "import:13f", async () => {
    const rows = read<A.ThirteenFJson[]>(dir, "superinvestors_13f.json");
    const r = A.adapt13F(rows, names);
    insertIgnore(db, s.raw13f, r.raw);
    return { lues: rows.length, nouvelles: insertOperations(db, r.operations), donneesAu: maxOf(rows.map((x) => x.depose_le)) };
  });

  results.trump = await runLogged(db, "import:trump", async () => {
    const rows = read<A.TrumpTxJson[]>(dir, "trump_recent.json");
    const r = A.adaptTrump(rows, names);
    insertIgnore(db, s.rawTrump, r.raw);
    const filings = read<A.TrumpFilingJson[]>(dir, "trump_filings.json");
    for (const f of filings) {
      const v = { deposeLe: f.depose_le, periode: f.periode, debut: f.debut, fin: f.fin, transactions: f.transactions, achats: f.achats, ventes: f.ventes };
      db.insert(s.rawTrumpFilings).values(v).onConflictDoUpdate({ target: s.rawTrumpFilings.deposeLe, set: v }).run();
    }
    for (const t of read<A.TrumpTickerJson[]>(dir, "trump_tickers.json")) {
      db.insert(s.rawTrumpTickers).values(t).onConflictDoUpdate({ target: s.rawTrumpTickers.ticker, set: { transactions: t.transactions } }).run();
    }
    const [m] = read<A.TrumpMetaJson[]>(dir, "trump_meta.json");
    const meta = {
      id: 1, aJourAu: m.a_jour_au, delaiMedianJours: m.delai_median_jours, partHorsDelai45j: m.part_hors_delai_45j,
      premiereTransaction: m.premiere_transaction, derniereTransaction: m.derniere_transaction,
    };
    db.insert(s.rawTrumpMeta).values(meta).onConflictDoUpdate({ target: s.rawTrumpMeta.id, set: meta }).run();
    return { lues: rows.length, nouvelles: insertOperations(db, r.operations), donneesAu: m.a_jour_au };
  });

  results.congres = await runLogged(db, "import:congres", async () => {
    const rows = read<A.CongressTradeJson[]>(dir, "congress_trades.json");
    const r = A.adaptCongress(rows, names);
    insertIgnore(db, s.rawCongress, r.raw);
    for (const m of read<A.CongressMemberJson[]>(dir, "congress_members.json")) {
      const v = { elu: m.elu, chambre: m.chambre, etat: m.etat, transactions: m.transactions, achats: m.achats, ventes: m.ventes, derniereTransaction: m.derniere_transaction };
      db.insert(s.rawCongressMembers).values(v).onConflictDoUpdate({ target: s.rawCongressMembers.elu, set: v }).run();
    }
    return { lues: rows.length, nouvelles: insertOperations(db, r.operations), donneesAu: maxOf(rows.map((x) => x.date_declaration)) };
  });

  backfillSocietes(db);
  return results;
}
