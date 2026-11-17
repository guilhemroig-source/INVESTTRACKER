import { NextResponse } from "next/server";
import { getDb, listActifs } from "@tracker/core";

export const dynamic = "force-dynamic";

/** Intervalles proposés et nombre de bougies demandées (≈ 5 séances en 5 min, 10 en 15 min, 40 en 1 h). */
const INTERVALLES: Record<string, number> = { "5min": 400, "15min": 270, "1h": 290 };
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 5 * 60_000;

/**
 * Cours intrajournaliers (Twelve Data, clé gratuite TWELVEDATA_API_KEY : 800 appels/jour, 8/minute), gardés 5 minutes.
 * GET /api/intraday/NVDA?interval=5min|15min|1h  →  { symbole, interval, bougies: [{ t, o, h, l, c, v }] } (heures UTC)
 */
export async function GET(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const interval = new URL(req.url).searchParams.get("interval") ?? "15min";
  if (!INTERVALLES[interval]) return NextResponse.json({ erreur: "intervalle inconnu (5min, 15min, 1h)" }, { status: 400 });
  const key = process.env.TWELVEDATA_API_KEY?.trim();
  if (!key) return NextResponse.json({ erreur: "Cours intrajournaliers non configurés : ajoutez la variable TWELVEDATA_API_KEY (clé gratuite sur twelvedata.com)." }, { status: 503 });

  // Crypto de « Mon portefeuille » (paire Tiingo btcusd -> BTC/USD) ; actifs à cours saisi : pas de cours intrajournaliers
  const actif = listActifs(getDb()).find((a) => a.ticker === ticker);
  if (actif && actif.cotation !== "crypto") return NextResponse.json({ erreur: "Pas de cours intrajournaliers pour un actif à cours saisi." }, { status: 404 });
  const symbole = actif ? `${actif.indice!.toUpperCase().replace(/USD$/, "")}/USD` : ticker;

  const k = `${symbole}|${interval}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data);
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbole)}&interval=${interval}&outputsize=${INTERVALLES[interval]}&timezone=UTC&order=ASC`;
    const r = await fetch(url, { headers: { Authorization: `apikey ${key}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as { status?: string; code?: number; message?: string; values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[] };
    if (j.status !== "ok" || !j.values) {
      const quota = j.code === 429 || /credits|limit/i.test(j.message ?? "");
      return NextResponse.json({ erreur: quota ? "Quota Twelve Data atteint (8 appels/minute, 800/jour) : réessayez dans une minute." : `Twelve Data : ${j.message ?? "réponse inattendue"}` }, { status: quota ? 429 : 502 });
    }
    const data = {
      symbole, interval,
      bougies: j.values.map((v) => ({ t: v.datetime.replace(" ", "T") + "Z", o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: v.volume ? +v.volume : 0 })),
    };
    cache.set(k, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ erreur: `Twelve Data injoignable : ${(e as Error).message}` }, { status: 502 });
  }
}
