import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema as s, insertOperations } from "@tracker/core";
import { MAX_SMS, ascii, buildDailySms, short } from "../src/alerts/daily";
import { AlloProvider, ConsoleProvider, TwilioProvider, sendSms, type SmsProvider } from "../src/sms/providers";

const db = getDb();
const NOW = new Date("2026-11-08T06:47:00Z"); // 7h47 à Paris
const iso = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function reset() {
  for (const t of [s.operations, s.alerts, s.collectLog]) db.delete(t).run();
}
function op(o: Partial<typeof s.operations.$inferInsert> & { ticker: string; source: "ARK" | "FORM4" | "CONGRES" | "13F" | "TRUMP" }) {
  insertOperations(db, [{
    categorie: "x", qui: "x", operation: "Achat", sens: "achat", datePublication: "2026-11-07", cleUnique: Math.random().toString(36), creeLe: iso(2), ...o,
  }]);
}
function logRun(source: string, statut: string, details?: string) {
  db.insert(s.collectLog).values({ source, debut: iso(3), fin: iso(3), statut, details: details ?? null }).run();
}

beforeEach(reset);
afterAll(() => { for (const f of fs.readdirSync(require("node:os").tmpdir())) if (f.startsWith(`tracker-test-${process.pid}`)) fs.rmSync(require("node:path").join(require("node:os").tmpdir(), f)); });

describe("SMS quotidien", () => {
  it("dit « Rien de nouveau hier » et rappelle l'échéance", () => {
    logRun("ark", "ok");
    const t = buildDailySms(db, NOW);
    expect(t).toBe("Investisseurs 08/11 : Rien de nouveau hier. Prochaine echeance : 13F T3 2026 le 16/11. https://tracker.example");
  });

  it("donne les 3 plus gros mouvements ARK et d'initiés, et le nombre de transactions d'élus", () => {
    logRun("ark", "ok");
    op({ source: "ARK", ticker: "TSLA", montantUsd: 12_500_000, sens: "vente" });
    op({ source: "ARK", ticker: "AMD", montantUsd: 233_100 });
    op({ source: "ARK", ticker: "RKLB", montantUsd: 1_700_000 });
    op({ source: "ARK", ticker: "TER", montantUsd: 42_300, sens: "vente" });
    op({ source: "FORM4", ticker: "INGM", montantUsd: 326_000_000, sens: "vente" });
    op({ source: "CONGRES", ticker: "MCD" });
    op({ source: "CONGRES", ticker: "AMZN" });
    const t = buildDailySms(db, NOW);
    expect(t).toContain("Hier : ARK -TSLA 12,5M, +RKLB 1,7M, +AMD 233k | Inities -INGM 326M | Elus 2 nouvelles transactions.");
    expect(t).not.toContain("TER");
  });

  it("met les alertes en tête (Musk, 13F, Trump), sans accents", () => {
    logRun("edgar-musk", "ok", "! Nouveau formulaire 4 de Musk sur TSLA depose le 2026-11-07\n0001-26 : 2 ligne(s)");
    logRun("13f", "ok", "! Nouveau 13F Warren Buffett (T3 2026) depose le 2026-11-07");
    const t = buildDailySms(db, NOW);
    expect(t).toMatch(/^Investisseurs 08\/11 : ALERTE Nouveau formulaire 4 de Musk sur TSLA depose le 2026-11-07 ; Nouveau 13F Warren Buffett/);
    expect(t).toBe(ascii(t));
  });

  it("signale une source en panne, et le secours EDGAR d'OpenInsider", () => {
    logRun("trump", "erreur");
    logRun("openinsider", "erreur");
    logRun("edgar-insiders", "ok");
    const t = buildDailySms(db, NOW);
    expect(t).toContain("Source trump indisponible.");
    expect(t).toContain("OpenInsider indisponible (secours EDGAR ok).");
  });

  it("ignore les lignes anciennes rattrapées (publiées il y a plus de 5 jours)", () => {
    logRun("edgar-musk", "ok");
    op({ source: "FORM4", ticker: "TSLA", montantUsd: 7e9, datePublication: "2024-12-31" });
    expect(buildDailySms(db, NOW)).toContain("Rien de nouveau hier");
  });

  it("ne repart que du dernier SMS envoyé", () => {
    logRun("ark", "ok");
    op({ source: "ARK", ticker: "OLD", montantUsd: 1e6, creeLe: iso(30) });
    db.insert(s.alerts).values({ type: "quotidien", canal: "console", message: "x", statut: "logue", creeLe: iso(24) }).run();
    op({ source: "ARK", ticker: "NEW", montantUsd: 2e6 });
    const t = buildDailySms(db, NOW);
    expect(t).toContain("+NEW 2M");
    expect(t).not.toContain("OLD");
  });

  it("reste sous 600 caractères même avec beaucoup d'alertes", () => {
    logRun("13f", "ok", Array.from({ length: 30 }, (_, i) => `! Nouveau 13F Investisseur numero ${i} (T3 2026) depose le 2026-11-07`).join("\n"));
    const t = buildDailySms(db, NOW);
    expect(t.length).toBeLessThanOrEqual(MAX_SMS);
    expect(t).toContain("ALERTE 30 nouvelle(s) declaration(s)");
  });

  it("formats courts", () => {
    expect([short(935_500), short(2_406_600), short(326_000_000), short(7_094_441_104)]).toEqual(["936k", "2,4M", "326M", "7,1Md"]);
    expect(ascii("Allègement · élus")).toBe("Allegement  elus");
  });
});

describe("Fournisseurs SMS", () => {
  it("Allo : POST JSON avec la clé dans Authorization", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await new AlloProvider("CLE", "+33600000001", "https://allo.test/sms", f as unknown as typeof fetch).send("+33600000002", "Bonjour");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://allo.test/sms");
    expect(init.headers).toMatchObject({ Authorization: "CLE" });
    expect(JSON.parse(init.body as string)).toEqual({ from: "+33600000001", to: "+33600000002", message: "Bonjour" });
  });

  it("Twilio : formulaire et authentification Basic", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 201 }));
    await new TwilioProvider("AC1", "tok", "+15550001", f as unknown as typeof fetch).send("+33600000002", "Salut");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic " + Buffer.from("AC1:tok").toString("base64"));
    expect(String(init.body)).toBe("To=%2B33600000002&From=%2B15550001&Body=Salut");
  });

  it("passe au secours si le principal échoue, et journalise dans alerts", async () => {
    const failing: SmsProvider = { name: "allo", send: async () => { throw new Error("HTTP 500"); } };
    const backup = new ConsoleProvider();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await sendSms(db, "test", "msg", { to: "+33600000000", providers: [failing, backup] });
    expect(r).toEqual({ ok: true, canal: "console" });
    expect(db.select().from(s.alerts).all().at(-1)).toMatchObject({ canal: "console", statut: "logue", erreur: "HTTP 500" });
  });

  it("enregistre un échec si tous les fournisseurs échouent", async () => {
    const failing: SmsProvider = { name: "allo", send: async () => { throw new Error("réseau"); } };
    const r = await sendSms(db, "test", "msg", { to: "+33600000002", providers: [failing] });
    expect(r.ok).toBe(false);
    expect(db.select().from(s.alerts).all().at(-1)).toMatchObject({ statut: "erreur", erreur: "réseau" });
  });

  it("refuse un envoi réel sans destinataire (SMS_TO absent de .env)", async () => {
    delete process.env.SMS_TO;
    const send = vi.fn();
    const r = await sendSms(db, "test", "msg", { providers: [{ name: "allo", send }] });
    expect(r).toEqual({ ok: false, erreur: "SMS_TO manquant dans .env" });
    expect(send).not.toHaveBeenCalled();
  });
});
