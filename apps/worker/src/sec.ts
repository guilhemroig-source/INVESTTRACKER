import { getJson, getText } from "./http";
import { secUserAgent } from "./env";

export const CIK = { MUSK: "0001494730", TESLA: "0001318605", SPACEX: "0001181412", BERKSHIRE: "0001067983" } as const;

export interface EftsHit {
  adsh: string; // n° d'accession avec tirets
  file: string; // nom du document principal
  fileDate: string;
  periodEnding: string | null;
  ciks: string[];
  displayNames: string[];
  xsl: string | null;
  form: string;
  items: string[];
}

interface EftsResponse {
  hits: { total: { value: number }; hits: { _id: string; _source: { adsh: string; file_date: string; period_ending?: string; ciks: string[]; display_names: string[]; xsl?: string; form?: string; root_forms?: string[]; items?: string[] } }[] };
}

/** Recherche plein texte EDGAR (JSON), toutes pages. */
export async function eftsSearch(p: { q?: string; forms: string; ciks?: string; start: string; end: string; max?: number }): Promise<EftsHit[]> {
  const out: EftsHit[] = [];
  const max = p.max ?? 2000;
  for (let from = 0; from < max; from += 100) {
    const qs = new URLSearchParams({ forms: p.forms, dateRange: "custom", startdt: p.start, enddt: p.end, from: String(from) });
    if (p.q) qs.set("q", p.q);
    if (p.ciks) qs.set("ciks", p.ciks);
    const res = await getJson<EftsResponse>(`https://efts.sec.gov/LATEST/search-index?${qs}`, { userAgent: secUserAgent(), cacheTtl: 0 });
    for (const h of res.hits.hits) {
      out.push({
        adsh: h._source.adsh,
        file: h._id.split(":")[1] ?? "",
        fileDate: h._source.file_date,
        periodEnding: h._source.period_ending ?? null,
        ciks: h._source.ciks ?? [],
        displayNames: h._source.display_names ?? [],
        xsl: h._source.xsl ?? null,
        form: h._source.form ?? h._source.root_forms?.[0] ?? p.forms,
        items: h._source.items ?? [],
      });
    }
    if (res.hits.hits.length < 100 || from + 100 >= res.hits.total.value) break;
  }
  return out;
}

export const stripCik = (cik: string) => String(Number(cik));

/** URL d'un document d'une déclaration EDGAR. */
export function archiveUrl(issuerCik: string, adsh: string, file: string, xsl?: string | null) {
  return `https://www.sec.gov/Archives/edgar/data/${stripCik(issuerCik)}/${adsh.replace(/-/g, "")}/${xsl ? xsl + "/" : ""}${file}`;
}

/** Les documents EDGAR sont immuables : cache local permanent. */
export const getArchive = (url: string) => getText(url, { userAgent: secUserAgent(), cacheTtl: Infinity });
