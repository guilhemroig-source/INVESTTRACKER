import * as cheerio from "cheerio";
import { normHeader, parseDate, parseNum } from "./util";

export interface OpenInsiderRow {
  depose_le: string;
  heure_depot: string | null;
  date_operation: string | null;
  ticker: string;
  societe: string | null;
  initie: string;
  insider_cik: string | null;
  fonction: string | null;
  type: string; // "P - Purchase", "S - Sale", "S - Sale+OE", ...
  operation: string; // libellé français
  prix: number | null;
  quantite: number | null;
  detenues_apres: number | null;
  montant_usd: number | null;
  sec_url: string | null;
}

/** Libellé français d'un « Trade Type » OpenInsider ; null si le type n'est pas un achat ou une vente. */
export function openInsiderOperation(type: string): string | null {
  const t = type.trim();
  if (/^P\b/.test(t)) return "Achat";
  if (/^S\b/.test(t)) return /\+\s*OE/i.test(t) ? "Vente (après exercice d'options)" : "Vente";
  return null;
}

/**
 * Lit un tableau OpenInsider (`table.tinytable`) : page « latest-insider-trading » ou « screener ».
 * Les colonnes sont repérées par leur en-tête, pas par leur position (le screener n'a pas toujours « Company Name »).
 */
export function parseOpenInsiderTable(html: string): OpenInsiderRow[] {
  const $ = cheerio.load(html);
  const table = $("table.tinytable").first();
  if (!table.length) throw new Error("OpenInsider : tableau « tinytable » introuvable (la page a peut-être changé)");
  const headers = table.find("thead th, tr").first().find("th").map((_, th) => normHeader($(th).text())).get();
  const col = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const idx = {
    filing: col("filing date"), trade: col("trade date"), ticker: col("ticker"), company: col("company name"),
    insider: col("insider name"), title: col("title"), type: col("trade type"), price: col("price"),
    qty: col("qty"), owned: col("owned"), value: col("value"),
  };
  for (const k of ["filing", "ticker", "insider", "type", "qty"] as const) {
    if (idx[k] < 0) throw new Error(`OpenInsider : colonne « ${k} » introuvable (en-têtes : ${headers.join(" | ")})`);
  }
  const out: OpenInsiderRow[] = [];
  table.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (!tds.length) return;
    const txt = (i: number) => (i < 0 ? "" : $(tds[i]).text().replace(/\s+/g, " ").trim());
    const href = (i: number) => (i < 0 ? null : $(tds[i]).find("a").attr("href") ?? null);
    const type = txt(idx.type);
    const filing = txt(idx.filing);
    const depose = parseDate(filing);
    if (!depose) return;
    const insiderHref = href(idx.insider);
    const secHref = href(idx.filing);
    out.push({
      depose_le: depose,
      heure_depot: /\d{2}:\d{2}/.exec(filing)?.[0] ?? null,
      date_operation: parseDate(txt(idx.trade)),
      ticker: txt(idx.ticker).toUpperCase(),
      societe: idx.company >= 0 ? txt(idx.company) || null : null,
      initie: txt(idx.insider),
      insider_cik: insiderHref ? /\/(\d{4,10})(?:[/?#]|$)/.exec(insiderHref)?.[1] ?? null : null,
      fonction: txt(idx.title) || null,
      type,
      operation: openInsiderOperation(type) ?? type,
      prix: parseNum(txt(idx.price)),
      quantite: parseNum(txt(idx.qty)),
      detenues_apres: parseNum(txt(idx.owned)),
      montant_usd: parseNum(txt(idx.value)),
      sec_url: secHref && /sec\.gov/.test(secHref) ? secHref.replace(/^http:/, "https:") : null,
    });
  });
  return out;
}
