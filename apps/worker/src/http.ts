import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { repoRoot } from "@tracker/core";

// Derrière un proxy (bac à sable, entreprise), fetch de Node ne lit pas HTTPS_PROXY tout seul.
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) {
  // Délai de connexion large : certains services (GDELT) mettent plus de 10 s à répondre à travers un proxy.
  // (requestTls : délai de la connexion TLS vers le site à travers le tunnel du proxy, 10 s par défaut)
  setGlobalDispatcher(new EnvHttpProxyAgent({ connect: { timeout: 60_000 }, requestTls: { timeout: 60_000 }, proxyTls: { timeout: 60_000 } } as ConstructorParameters<typeof EnvHttpProxyAgent>[0]));
}

/** Débit maximal par hôte (requêtes/seconde). SEC : 10/s autorisées, on reste à 8. */
const RATE: Record<string, number> = { "www.sec.gov": 8, "efts.sec.gov": 8, "data.sec.gov": 8, "finnhub.io": 0.9, "query.wikidata.org": 0.5, "fr.wikipedia.org": 0.4, "en.wikipedia.org": 0.4 }; // Wikimedia : appels espacés // Finnhub gratuit : 60/min
const DEFAULT_RATE = 1;
const nextSlot = new Map<string, number>();

async function throttle(host: string) {
  const gap = 1000 / (RATE[host] ?? DEFAULT_RATE);
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const cacheDir = () => path.join(repoRoot(), "var", "cache");
const cachePath = (url: string) => path.join(cacheDir(), crypto.createHash("sha1").update(url).digest("hex").slice(0, 20));

export interface GetOptions {
  userAgent: string;
  /** Durée de validité du cache local en secondes ; Infinity pour les documents EDGAR (immuables). 0 = pas de cache. */
  cacheTtl?: number;
  accept?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(public url: string, public status: number, msg: string) { super(msg); }
}

/** GET avec limite de débit par hôte, cache disque, 3 tentatives (attente croissante) sur erreur réseau, 429 ou 5xx. */
export async function getText(url: string, opts: GetOptions): Promise<string> {
  const ttl = opts.cacheTtl ?? 0;
  const file = cachePath(url);
  if (ttl > 0 && fs.existsSync(file)) {
    const age = (Date.now() - fs.statSync(file).mtimeMs) / 1000;
    if (age < ttl) return fs.readFileSync(file, "utf8");
  }
  const host = new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    await throttle(host);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": opts.userAgent, Accept: opts.accept ?? "*/*", "Accept-Encoding": "gzip, deflate", ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        redirect: "follow",
      });
      if (res.status === 429) throw new HttpError(url, 429, `HTTP 429 (quota dépassé) sur ${url}`);
      if (res.status >= 500) { lastErr = new HttpError(url, res.status, `HTTP ${res.status} sur ${url}`); continue; }
      if (!res.ok) throw new HttpError(url, res.status, `HTTP ${res.status} sur ${url}`);
      const text = await res.text();
      if (ttl > 0) { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(file, text); }
      return text;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;
      lastErr = e;
    }
  }
  // Quota dépassé ou erreur serveur persistante : on garde le code HTTP pour que l'appelant puisse réagir (ex. 429).
  if (lastErr instanceof HttpError) throw lastErr;
  const msg = lastErr instanceof Error ? (lastErr.cause instanceof Error ? `${lastErr.message} (${lastErr.cause.message})` : lastErr.message) : String(lastErr);
  throw new Error(`${host} injoignable après 3 tentatives : ${msg}`);
}

export async function getJson<T>(url: string, opts: GetOptions): Promise<T> {
  return JSON.parse(await getText(url, { accept: "application/json", ...opts })) as T;
}
