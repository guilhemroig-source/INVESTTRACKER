// Formatage déterministe (identique serveur / navigateur, pas de dépendance à l'ICU).
const NNBSP = " ";
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function group(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** 1234567.891 -> "1 234 567,89" */
export function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(decimals).split(".");
  return (neg ? "−" : "") + group(i) + (d ? "," + d : "");
}

/** Nombre signé : "+30 000" / "−2 000 000" */
export function fmtSigned(n: number | null | undefined): string {
  if (n == null) return "—";
  return (n > 0 ? "+" : "") + fmtNum(n);
}

/** "15,0" -> "15", "1,70" -> "1,7" */
const trim = (s: string) => (s.includes(",") ? s.replace(/,?0+$/, "") : s);

function compact(a: number): string {
  if (a >= 1e9) return trim(fmtNum(a / 1e9, a >= 1e11 ? 0 : a >= 1e10 ? 1 : 2)) + " Md";
  if (a >= 1e6) return trim(fmtNum(a / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2)) + " M";
  if (a >= 1e3) return trim(fmtNum(a / 1e3, a >= 1e5 ? 0 : 1)) + " k";
  return fmtNum(a);
}

/** Montant compact en dollars : "2,41 M$", "935,5 k$", "7,09 Md$" */
export function fmtUsd(n: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = compact(Math.abs(n)).replace(/ (Md|M|k)$/, `${NNBSP}$1`);
  const sign = opts.signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : "";
  return `${sign}${s}${/[kMd]$/.test(s) ? "" : NNBSP}$`;
}

/** "$15,001 - $50,000" -> "15 k – 50 k$" ; "$50,000,001 +" -> "> 50 M$" */
export function fmtRange(r: string | null | undefined): string {
  if (!r) return "—";
  const nums = (r.match(/[\d,]+/g) ?? []).map((x) => Number(x.replace(/,/g, ""))).filter((x) => x > 0);
  if (nums.length >= 2) {
    const lo = nums[0] % 1000 === 1 ? nums[0] - 1 : nums[0];
    return `${compact(lo).replace(" ", NNBSP)}–${fmtUsd(nums[1])}`;
  }
  if (nums.length === 1) return `>${NNBSP}${fmtUsd(nums[0] - (nums[0] % 1000 === 1 ? 1 : 0))}`;
  return r;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  return fmtNum(n, 2) + NNBSP + "$";
}

export function fmtPct(n: number | null | undefined, decimals = 1, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (signed && n > 0 ? "+" : "") + fmtNum(n, decimals) + NNBSP + "%";
}

/** "2026-11-06" -> "6 nov. 2026" */
export function fmtDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MOIS[Number(m[2]) - 1]}${withYear ? " " + m[1] : ""}`;
}

/** ISO date-heure -> "6 nov. 2026 · 21:05" (heure UTC) */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${fmtDate(iso)} · ${iso.slice(11, 16)} UTC`;
}

export const sensClass = (sens: string) => (sens === "achat" ? "buy" : "sell");
