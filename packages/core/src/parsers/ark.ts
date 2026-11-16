import * as cheerio from "cheerio";
import { normHeader, parseCompactUsd, parseCsv, parseDate, parseNum } from "./util";

export interface ArkTrade {
  date: string;
  fonds: string;
  ticker: string;
  operation: "Achat" | "Vente";
  montant_usd: number | null;
  pct_position: number | null;
  pct_etf: number | null;
}

/** Lit le tableau de https://cathiesark.com/ark-funds-combined/trades (colonnes repérées par leur en-tête). */
export function parseCathiesArkTrades(html: string): ArkTrade[] {
  const $ = cheerio.load(html);
  const out: ArkTrade[] = [];
  $("table").each((_, table) => {
    const headers = $(table).find("thead th").map((__, th) => normHeader($(th).text())).get();
    const col = (...names: string[]) => headers.findIndex((h) => names.includes(h));
    const iDate = col("date"), iFund = col("fund"), iTicker = col("ticker"), iDir = col("direction");
    const iVal = col("market value"), iPos = col("% of position"), iEtf = col("% of etf");
    if ([iDate, iFund, iTicker, iDir].some((i) => i < 0)) return;
    $(table).find("tbody tr").each((__, tr) => {
      const cells = $(tr).find("td").map((___, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
      const date = parseDate(cells[iDate]);
      const dir = (cells[iDir] ?? "").toLowerCase();
      const ticker = (cells[iTicker] ?? "").toUpperCase();
      if (!date || !ticker || !/buy|sell/.test(dir)) return;
      out.push({
        date,
        fonds: cells[iFund].toUpperCase(),
        ticker,
        operation: dir.includes("buy") ? "Achat" : "Vente",
        montant_usd: iVal >= 0 ? Math.abs(parseCompactUsd(cells[iVal]) ?? NaN) || null : null,
        pct_position: iPos >= 0 ? parseNum(cells[iPos]) : null,
        pct_etf: iEtf >= 0 ? parseNum(cells[iEtf]) : null,
      });
    });
  });
  if (!out.length) throw new Error("cathiesark : aucun tableau d'opérations reconnu (la page a peut-être changé)");
  return out;
}

export interface ArkHolding { date: string; fonds: string; societe: string; ticker: string; cusip: string; actions: number; valeur_usd: number | null; poids_pct: number | null }

/** Lit le CSV quotidien des positions publié par ARK (assets.ark-funds.com). */
export function parseArkHoldingsCsv(text: string): ArkHolding[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const h = head.map(normHeader);
  const i = (n: string) => h.findIndex((x) => x.startsWith(n));
  const [iDate, iFund, iCo, iTk, iCusip, iSh, iVal, iW] = ["date", "fund", "company", "ticker", "cusip", "shares", "market value", "weight"].map(i);
  if (iDate < 0 || iFund < 0 || iSh < 0) throw new Error("CSV ARK : colonnes attendues absentes");
  return rows
    .filter((r) => parseDate(r[iDate]))
    .map((r) => ({
      date: parseDate(r[iDate])!,
      fonds: r[iFund].trim(),
      societe: (r[iCo] ?? "").trim(),
      ticker: (r[iTk] ?? "").trim().toUpperCase(),
      cusip: (r[iCusip] ?? "").trim(),
      actions: parseNum(r[iSh]) ?? 0,
      valeur_usd: parseNum(r[iVal]),
      poids_pct: parseNum(r[iW]),
    }));
}
