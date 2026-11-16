/**
 * Indicateurs financiers à partir des comptes XBRL publiés par la SEC (API « companyfacts »).
 * Les flux (chiffre d'affaires, bénéfice, trésorerie d'exploitation…) sont ramenés sur 12 mois glissants :
 * exercice annuel + cumul de l'exercice en cours − cumul de la même période l'an passé.
 */

export interface XbrlFact { start?: string; end: string; val: number; form?: string; fp?: string; filed?: string; frame?: string }
export interface CompanyFacts { cik?: number; entityName?: string; facts: Record<string, Record<string, { units: Record<string, XbrlFact[]> }>> }

const DAY = 86400_000;
const dur = (f: XbrlFact) => (f.start ? (Date.parse(f.end) - Date.parse(f.start)) / DAY : 0);
const near = (a: string, b: string, tol = 12) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY <= tol;
const minusYear = (iso: string) => new Date(Date.parse(iso) - 364 * DAY).toISOString().slice(0, 10);

/** Faits d'un concept (le premier concept disponible le plus récent), dédoublonnés par période (dernier dépôt gagnant). */
function factsOf(cf: CompanyFacts, concepts: string[], ns = "us-gaap"): XbrlFact[] {
  let best: XbrlFact[] = [];
  for (const c of concepts) {
    const u = cf.facts[ns]?.[c]?.units;
    if (!u) continue;
    const list = u.USD ?? u.shares ?? u["USD/shares"] ?? Object.values(u)[0] ?? [];
    const latest = list.reduce((m, f) => (f.end > m ? f.end : m), "");
    const bestLatest = best.reduce((m, f) => (f.end > m ? f.end : m), "");
    if (latest > bestLatest) best = list;
  }
  const byPeriod = new Map<string, XbrlFact>();
  for (const f of best) {
    const k = `${f.start ?? ""}|${f.end}`;
    const prev = byPeriod.get(k);
    if (!prev || (f.filed ?? "") > (prev.filed ?? "")) byPeriod.set(k, f);
  }
  return [...byPeriod.values()];
}

/** Valeur sur 12 mois glissants se terminant à `end` (ou null si les comptes ne permettent pas de la calculer). */
export function ttmAt(facts: XbrlFact[], end: string): number | null {
  const annual = facts.find((f) => near(f.end, end, 3) && dur(f) >= 350 && dur(f) <= 380);
  if (annual) return annual.val;
  // Cumul depuis le début de l'exercice (le plus long se terminant à `end`)
  const ytd = facts.filter((f) => near(f.end, end, 3) && dur(f) >= 80 && dur(f) < 350).sort((a, b) => dur(b) - dur(a))[0];
  if (ytd) {
    const prevYtd = facts.find((f) => near(f.end, minusYear(end), 12) && Math.abs(dur(f) - dur(ytd)) <= 12);
    const fy = facts.find((f) => dur(f) >= 350 && dur(f) <= 380 && prevYtd && f.end > prevYtd.end && f.end < end);
    if (prevYtd && fy) return fy.val + ytd.val - prevYtd.val;
  }
  // Sinon : somme de 4 trimestres consécutifs
  const quarters = facts.filter((f) => dur(f) >= 80 && dur(f) <= 100 && f.end <= end && f.end > minusYear(end)).sort((a, b) => b.end.localeCompare(a.end));
  if (quarters.length >= 4 && near(quarters[0].end, end, 3)) return quarters.slice(0, 4).reduce((a, f) => a + f.val, 0);
  return null;
}

/** Dernière date de clôture pour laquelle un flux sur 12 mois est calculable. */
function latestTtm(facts: XbrlFact[]): { end: string; val: number } | null {
  const ends = [...new Set(facts.filter((f) => dur(f) >= 80).map((f) => f.end))].sort().reverse();
  for (const e of ends.slice(0, 6)) { const v = ttmAt(facts, e); if (v != null) return { end: e, val: v }; }
  return null;
}

/** Valeur ponctuelle (bilan) la plus récente, et celle d'environ un an avant. */
function instant(facts: XbrlFact[], before?: string): number | null {
  const list = facts.filter((f) => !f.start && (!before || f.end <= before)).sort((a, b) => b.end.localeCompare(a.end));
  return list[0]?.val ?? null;
}

export interface Fundamentals {
  arrete: string | null;
  revenuTtm: number | null; revenuTtmPrec: number | null;
  netTtm: number | null; netTtmPrec: number | null;
  bpaTtm: number | null; cfoTtm: number | null; capexTtm: number | null;
  tresorerie: number | null; dette: number | null; fondsPropres: number | null;
  actions: number | null; actions1an: number | null;
}

export function computeFundamentals(cf: CompanyFacts): Fundamentals | null {
  if (!cf.facts["us-gaap"]) return null; // émetteurs étrangers (IFRS) : non pris en charge
  const rev = factsOf(cf, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense"]);
  const net = factsOf(cf, ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]);
  const eps = factsOf(cf, ["EarningsPerShareDiluted", "EarningsPerShareBasic"]);
  const cfo = factsOf(cf, ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]);
  const capex = factsOf(cf, ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]);
  const cash = factsOf(cf, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const equity = factsOf(cf, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]);
  const ltd = factsOf(cf, ["LongTermDebtNoncurrent"]), ltdCur = factsOf(cf, ["LongTermDebtCurrent"]), ltdTotal = factsOf(cf, ["LongTermDebt"]);
  const shares = factsOf(cf, ["EntityCommonStockSharesOutstanding"], "dei");

  const r = latestTtm(rev), n = latestTtm(net);
  const arrete = [r?.end, n?.end].filter(Boolean).sort().at(-1) ?? null;
  const debtNon = instant(ltd), debtCur = instant(ltdCur), debtTot = instant(ltdTotal);
  const sharesNow = shares.sort((a, b) => b.end.localeCompare(a.end))[0];
  const shares1y = sharesNow ? shares.filter((f) => f.end <= minusYear(sharesNow.end)).sort((a, b) => b.end.localeCompare(a.end))[0] : undefined;
  return {
    arrete,
    revenuTtm: r?.val ?? null, revenuTtmPrec: r ? ttmAt(rev, nearestEnd(rev, minusYear(r.end))) : null,
    netTtm: n?.val ?? null, netTtmPrec: n ? ttmAt(net, nearestEnd(net, minusYear(n.end))) : null,
    bpaTtm: arrete ? ttmAt(eps, nearestEnd(eps, arrete)) : null,
    cfoTtm: arrete ? ttmAt(cfo, nearestEnd(cfo, arrete)) : null,
    capexTtm: arrete ? ttmAt(capex, nearestEnd(capex, arrete)) : null,
    tresorerie: instant(cash), fondsPropres: instant(equity),
    dette: debtNon != null || debtCur != null ? (debtNon ?? 0) + (debtCur ?? 0) : debtTot,
    actions: sharesNow?.val ?? null, actions1an: shares1y && near(shares1y.end, minusYear(sharesNow!.end), 120) ? shares1y.val : null,
  };
}

/** Date de clôture disponible la plus proche d'une date visée (à 20 jours près). */
function nearestEnd(facts: XbrlFact[], target: string): string {
  const ends = [...new Set(facts.map((f) => f.end))];
  const best = ends.sort((a, b) => Math.abs(Date.parse(a) - Date.parse(target)) - Math.abs(Date.parse(b) - Date.parse(target)))[0];
  return best && near(best, target, 20) ? best : target;
}
