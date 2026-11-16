/** Échéances légales, calculées (jamais estimées à partir de données). */

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** n-ième jour de semaine `wd` (0 = dimanche) d'un mois ; n = -1 pour le dernier. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m, 1));
    return iso(new Date(Date.UTC(y, m, 1 + ((wd - first.getUTCDay() + 7) % 7) + (n - 1) * 7)));
  }
  const last = new Date(Date.UTC(y, m + 1, 0));
  return iso(new Date(Date.UTC(y, m, last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7))));
}
/** Jour férié fixe, décalé au vendredi (samedi) ou au lundi (dimanche). */
function observed(y: number, m: number, d: number): string {
  const x = new Date(Date.UTC(y, m, d));
  if (x.getUTCDay() === 6) x.setUTCDate(d - 1);
  if (x.getUTCDay() === 0) x.setUTCDate(d + 1);
  return iso(x);
}
/** Jours fériés fédéraux américains (jours de fermeture d'EDGAR). */
export function usFederalHolidays(y: number): Set<string> {
  return new Set([
    observed(y, 0, 1), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), nthWeekday(y, 4, 1, -1), observed(y, 5, 19),
    observed(y, 6, 4), nthWeekday(y, 8, 1, 1), nthWeekday(y, 9, 1, 2), observed(y, 10, 11), nthWeekday(y, 10, 4, 4), observed(y, 11, 25),
  ]);
}

/** Prochain jour ouvré de la SEC (ni week-end, ni jour férié fédéral). */
export function nextBusinessDay(d: Date): Date {
  const r = new Date(d);
  while (r.getUTCDay() === 0 || r.getUTCDay() === 6 || usFederalHolidays(r.getUTCFullYear()).has(iso(r))) r.setUTCDate(r.getUTCDate() + 1);
  return r;
}

/** Date limite du prochain 13F (45 jours après la fin du trimestre, reportée au jour ouvré suivant de la SEC). */
export function next13FDeadline(todayIso: string): { trimestre: string; limite: string } {
  const today = new Date(todayIso + "T00:00:00Z");
  for (let y = today.getUTCFullYear() - 1; y <= today.getUTCFullYear() + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      const end = new Date(Date.UTC(y, q * 3, 0)); // dernier jour du trimestre
      const lim = new Date(end);
      lim.setUTCDate(lim.getUTCDate() + 45);
      const limite = nextBusinessDay(lim);
      if (iso(limite) >= todayIso) return { trimestre: `T${q} ${y}`, limite: iso(limite) };
    }
  }
  return { trimestre: "?", limite: todayIso };
}

export function todayParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
