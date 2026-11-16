import * as cheerio from "cheerio";
import type { TrumpFilingJson, TrumpMetaJson, TrumpTickerJson, TrumpTxJson } from "../adapters/trump";
import { normHeader, parseDate, parseNum } from "./util";

const MOIS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

/** Libellé de période d'une déclaration : « T1 2026 » si elle couvre plusieurs mois d'un trimestre, sinon « Mai 2026 ». */
export function filingPeriod(debut: string, fin: string): string {
  const [y1, m1] = debut.split("-").map(Number), [y2, m2] = fin.split("-").map(Number);
  if (y1 === y2 && m1 === m2) return `${MOIS[m1 - 1]} ${y1}`;
  if (y1 === y2 && Math.ceil(m1 / 3) === Math.ceil(m2 / 3)) return `T${Math.ceil(m1 / 3)} ${y1}`;
  return `${MOIS[m1 - 1]} ${y1} – ${MOIS[m2 - 1]} ${y2}`;
}

export interface GetSignalTrump { meta: TrumpMetaJson; filings: TrumpFilingJson[]; recent: TrumpTxJson[]; topTickers: TrumpTickerJson[] }

/** Texte visible de la page, avec un espace entre éléments (cheerio colle les blocs voisins). */
export function pageText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
}

const RANGE = /\$([\d,]+)\s*-\s*\$([\d,]+)|Over\s+\$([\d,]+)|\$([\d,]+)\s*\+/i;

/** Lit la page https://getsignal.finance/president/donald-trump (retranscription des OGE 278-T). */
export function parseGetSignalTrump(html: string): GetSignalTrump {
  const $ = cheerio.load(html);
  const text = pageText(html);

  const asOf = /As of ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text);
  const range = /([A-Z][a-z]{2} \d{1,2}, \d{4}) to ([A-Z][a-z]{2} \d{1,2}, \d{4}) First and last trade date/.exec(text);
  const median = /(\d+)d Median days from trade to filing/.exec(text);
  const late = /([\d.]+)% Share of transactions filed more than 45 days/.exec(text);
  if (!asOf || !median || !late) throw new Error("getsignal : statistiques introuvables (la page a peut-être changé)");

  const tables = $("table").toArray();
  const headersOf = (t: (typeof tables)[number]) => $(t).find("thead th, tr:first-child th").map((_, th) => normHeader($(th).text())).get();
  const filingsTable = tables.find((t) => headersOf(t).includes("filed") && headersOf(t).some((h) => h.startsWith("transactions")));
  const recentTable = tables.find((t) => headersOf(t).includes("asset") && headersOf(t).includes("action"));
  if (!filingsTable || !recentTable) throw new Error("getsignal : tableaux des déclarations / transactions introuvables");

  const filings: TrumpFilingJson[] = $(filingsTable).find("tbody tr").toArray().flatMap((tr) => {
    const c = $(tr).find("td").map((_, td) => pageText($(td).html() ?? "").trim()).get();
    const depose = parseDate(c[0]);
    const [achats, ventes] = (c[2] ?? "").split("/").map((x) => parseNum(x));
    const dates = /([A-Z][a-z]{2} \d{1,2}, \d{4}) to ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(c[3] ?? "");
    if (!depose || !dates) return [];
    const debut = parseDate(dates[1])!, fin = parseDate(dates[2])!;
    return [{ depose_le: depose, periode: filingPeriod(debut, fin), debut, fin, transactions: parseNum(c[1]) ?? 0, achats: achats ?? 0, ventes: ventes ?? 0 }];
  }).sort((a, b) => a.depose_le.localeCompare(b.depose_le));

  const h = headersOf(recentTable);
  const col = (n: string) => h.findIndex((x) => x === n || x.startsWith(n));
  const [iAsset, iType, iAction, iAmount, iTrade, iFiled] = ["asset", "type", "action", "amount", "trade date", "filed"].map(col);
  const recent: TrumpTxJson[] = $(recentTable).find("tbody tr").toArray().flatMap((tr) => {
    const tds = $(tr).find("td");
    const cell = (i: number) => pageText($(tds[i]).html() ?? "").trim();
    const href = $(tds[iAsset]).find("a").attr("href");
    // Symbole : lien /stocks/xxx, sinon « filed under VGNTw » (titre « when issued »), sinon premier mot en capitales.
    const asset = cell(iAsset);
    const ticker = (href && /\/stocks\/([^/?#]+)/.exec(href)?.[1])
      || /filed under ([A-Z][A-Z0-9.]*)/.exec(asset)?.[1]
      || /^([A-Z][A-Z0-9.\-]{0,9})\b/.exec(asset)?.[1];
    const action = cell(iAction).toLowerCase();
    // Les lignes « Unverified » / « When issued » sont gardées (elles figurent dans la déclaration) ; obligations exclues.
    if (!ticker || !/purchase|sale|sell|buy/.test(action) || (iType >= 0 && /bond|note|treasury/i.test(cell(iType)))) return [];
    const amount = cell(iAmount);
    const r = RANGE.exec(amount);
    const lo = r ? parseNum(r[1] ?? r[3] ?? r[4]) : null;
    const hi = r?.[2] ? parseNum(r[2]) : null;
    const nonVerifie = iType >= 0 && /unverified|when issued/i.test(cell(iType));
    const declared = /As filed: (.*)$/.exec(asset)?.[1] ?? asset.replace(/\s*filed under .*$/, "");
    return [{
      ticker: ticker.toUpperCase().replace(/-/g, "."),
      nom_declare: declared.trim() || null,
      non_verifie: nonVerifie,
      operation: /purchase|buy/.test(action) ? "Achat" : "Vente",
      montant: amount, montant_min: lo, montant_max: hi,
      date_transaction: parseDate(cell(iTrade)), depose_le: parseDate(cell(iFiled))!,
    } satisfies TrumpTxJson];
  }).filter((r) => r.depose_le);

  const top = /Most traded stock rows only, by number of transactions (.*?)(?: Disclosed|$)/.exec(text)?.[1] ?? "";
  const topTickers: TrumpTickerJson[] = [...top.matchAll(/([A-Z][A-Z0-9.\-]{0,9}) (\d[\d,]*)/g)].map((m) => ({ ticker: m[1], transactions: parseNum(m[2])! }));

  return {
    meta: {
      a_jour_au: parseDate(asOf[1])!,
      delai_median_jours: Number(median[1]),
      part_hors_delai_45j: Number(late[1]) / 100,
      premiere_transaction: range ? parseDate(range[1])! : recent.map((r) => r.date_transaction!).sort()[0],
      derniere_transaction: range ? parseDate(range[2])! : recent.map((r) => r.date_transaction!).sort().at(-1)!,
    },
    filings, recent, topTickers,
  };
}

/** open-cabinet.org : date de la dernière déclaration 278-T et nombre de transactions qu'elle ajoute (pour recouper). */
export function parseOpenCabinetTrump(html: string): { derniere_declaration: string | null; transactions: number | null } {
  const text = pageText(html);
  const m = /\+\s*([\d,]+) new trade\s*s? for .*? 278-T posted to OGE on ([A-Z][a-z]{2,4})\.? (\d{1,2}), (\d{4})/.exec(text);
  if (!m) return { derniere_declaration: null, transactions: null };
  return { derniere_declaration: parseDate(`${m[2].slice(0, 3)} ${m[3]}, ${m[4]}`), transactions: parseNum(m[1]) };
}
