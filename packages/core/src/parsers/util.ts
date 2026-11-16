/** "-$2,406,600" / "$80.22" / "-30,000" / "+5%" -> nombre ; vide ou "n/a" -> null */
export function parseNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[\s $,%+]/g, "").replace(/[−–]/g, "-");
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}

/** "$42.3K", "$1.70M", "$2.1B", "-$500" -> nombre */
export function parseCompactUsd(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^\s*([-−]?)\$?\s*([\d.,]+)\s*([KMB])?\s*$/i.exec(s.trim());
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[3] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  const n = Math.round(Number(m[2].replace(/,/g, "")) * mult);
  return m[1] ? -n : n;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "Nov 06, 2026" / "11/06/2026" / "2026-11-06 06:00:12" -> "2026-11-06" */
export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Normalise un en-tête de colonne : minuscules, espaces simples, sans accents ni ponctuation. */
export const normHeader = (s: string) =>
  s.replace(/ /g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%δΔ]+/gi, " ").trim();

/** Petit lecteur CSV (guillemets, virgules et retours à la ligne dans les champs). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Forme unique d'un symbole boursier : majuscules, classe d'actions avec un point (BRK-B, BRK/B -> BRK.B). */
export const canonTicker = (t: string) => t.trim().toUpperCase().replace(/[-/ ]/g, ".");

/** Clé d'un nom de personne indépendante de l'ordre des mots et de la ponctuation ("Musk Elon" = "Elon Musk"). */
export const personKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
