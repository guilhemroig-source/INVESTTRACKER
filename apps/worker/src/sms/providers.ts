import { type Db, schema as s } from "@tracker/core";

export interface SmsProvider {
  readonly name: "allo" | "twilio" | "console";
  send(to: string, text: string): Promise<void>;
}

type FetchFn = typeof fetch;

/**
 * Allo (allo.ai / withallo.com) : envoi depuis une ligne Allo capable d'envoyer des SMS (SMS_FROM).
 * Point d'accès et format configurables : ALLO_API_URL (défaut ci-dessous), en-tête Authorization = clé API.
 */
export class AlloProvider implements SmsProvider {
  readonly name = "allo" as const;
  constructor(private key: string, private from: string, private url = process.env.ALLO_API_URL || "https://api.withallo.com/v1/api/sms", private f: FetchFn = fetch) {}
  async send(to: string, text: string) {
    const res = await this.f(this.url, {
      method: "POST",
      headers: { Authorization: this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to, message: text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Allo : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** Twilio : identifiants « SID:TOKEN ». */
export class TwilioProvider implements SmsProvider {
  readonly name = "twilio" as const;
  constructor(private sid: string, private token: string, private from: string, private f: FetchFn = fetch) {}
  async send(to: string, text: string) {
    const res = await this.f(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${this.sid}:${this.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: this.from, Body: text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Twilio : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** Tant qu'aucune clé n'est renseignée : le SMS est seulement affiché et journalisé. */
export class ConsoleProvider implements SmsProvider {
  readonly name = "console" as const;
  async send(to: string, text: string) {
    console.log(`\n┌─ SMS (non envoyé, aucune clé configurée) → ${to}\n│ ${text.replace(/\n/g, "\n│ ")}\n└─ ${text.length} caractères\n`);
  }
}

/** Fournisseur principal (SMS_PROVIDER) puis secours Twilio si TWILIO_SID / TWILIO_TOKEN sont renseignés. */
export function providersFromEnv(env = process.env): SmsProvider[] {
  const from = env.SMS_FROM?.trim() ?? "";
  const key = env.SMS_API_KEY?.trim();
  const out: SmsProvider[] = [];
  const kind = (env.SMS_PROVIDER || "console").toLowerCase();
  if (kind === "allo" && key && from) out.push(new AlloProvider(key, from));
  if (kind === "twilio" && key?.includes(":")) { const [sid, token] = key.split(":"); out.push(new TwilioProvider(sid, token, env.TWILIO_FROM || from)); }
  if (kind !== "twilio" && env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM) out.push(new TwilioProvider(env.TWILIO_SID, env.TWILIO_TOKEN, env.TWILIO_FROM));
  if (!out.length) out.push(new ConsoleProvider());
  return out;
}

/** Envoie (avec secours) et enregistre chaque tentative dans la table alerts. */
export async function sendSms(db: Db, type: string, text: string, opts: { to?: string; providers?: SmsProvider[] } = {}) {
  const providers = opts.providers ?? providersFromEnv();
  // Numéros uniquement dans .env (jamais dans le code) : SMS_TO obligatoire pour un envoi réel
  const to = opts.to || process.env.SMS_TO?.trim() || "";
  if (!to && providers.some((p) => p.name !== "console")) {
    db.insert(s.alerts).values({ type, canal: providers.map((p) => p.name).join(">"), destinataire: null, message: text, statut: "erreur", erreur: "SMS_TO manquant dans .env" }).run();
    return { ok: false as const, erreur: "SMS_TO manquant dans .env" };
  }
  const errors: string[] = [];
  for (const p of providers) {
    try {
      await p.send(to, text);
      db.insert(s.alerts).values({ type, canal: p.name, destinataire: to, message: text, statut: p.name === "console" ? "logue" : "envoye", erreur: errors.join(" | ") || null }).run();
      return { ok: true as const, canal: p.name };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  db.insert(s.alerts).values({ type, canal: providers.map((p) => p.name).join(">"), destinataire: to, message: text, statut: "erreur", erreur: errors.join(" | ") }).run();
  return { ok: false as const, erreur: errors.join(" | ") };
}
