"use client";
import { useCallback, useEffect, useState } from "react";
import type { JournalView } from "@tracker/core";
import { snap } from "@/lib/snapshot";
import { fmtDate, fmtNum, fmtPct, fmtPrice } from "@/lib/format";

const DEC: Record<string, { label: string; cls: string }> = {
  achat: { label: "Achat", cls: "buy" }, renforcement: { label: "Renforcement", cls: "buy" }, vente: { label: "Vente", cls: "sell" },
  allegement: { label: "Allègement", cls: "sell" }, attendre: { label: "Attendre / surveiller", cls: "" }, ecarter: { label: "Écarter", cls: "sell" },
};
const RES: Record<string, string> = { bonne: "Bonne décision", mauvaise: "Mauvaise décision", mitigee: "Mitigée" };
const p = (x: number | null | undefined) => (x == null ? "—" : fmtPct(x * 100));
const c = (x: number | null | undefined) => (x == null ? "" : x >= 0 ? "buy" : "sell");
type Data = { entries: JournalView[]; stats: { total: number; revues: number; aRevoir: number; bonnes: number; mauvaises: number; tauxAuto: number | null } };

function Entry({ e, onChange, showTicker }: { e: JournalView; onChange: () => void; showTicker: boolean }) {
  const [rev, setRev] = useState(false);
  const [resultat, setResultat] = useState(e.verdictAuto ?? "mitigee");
  const [lecon, setLecon] = useState("");
  const ctx = e.contexte ? JSON.parse(e.contexte) as { score?: number; per?: number | null; acheteurs?: string[]; vendeurs?: string[] } : null;
  const d = DEC[e.decision] ?? { label: e.decision, cls: "" };
  const save = async () => { await fetch(`/api/journal/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultat, lecon }) }); setRev(false); onChange(); };
  return (
    <li className={`jentry ${e.aRevoir ? "due" : ""} ${e.statut}`}>
      <div className="jhead">
        <span className="ev-date"><span>{fmtDate(e.date)}</span></span>
        {showTicker && <a className="sym sym-link" href={`#action-${e.ticker.replace(/\./g, "-")}`}>{e.ticker}</a>}
        <span className={`pill-big ${d.cls}`}>{d.label}</span>
        {e.conviction ? <span className="muted">conviction {"●".repeat(e.conviction)}{"○".repeat(5 - e.conviction)}</span> : null}
        {e.aRevoir && <span className="conf contre">à revoir</span>}
        {e.statut === "revue" && e.resultat && <span className={`conf ${e.resultat === "bonne" ? "" : "contre"}`}>{RES[e.resultat]}</span>}
      </div>
      <p className="jthese">{e.these}</p>
      {e.invalidation && <p className="jsmall"><b>Je change d&apos;avis si :</b> {e.invalidation}</p>}
      <div className="jnums">
        <span>Prix : {fmtPrice(e.prixDecision)}{e.objectif ? ` · objectif ${fmtPrice(e.objectif)}` : ""}</span>
        <span>Depuis : <b className={c(e.perf)}>{p(e.perf)}</b> · {e.refTicker} <b className={c(e.perfRef)}>{p(e.perfRef)}</b></span>
        {e.verdictAuto && e.statut !== "revue" && <span className="muted">à ce stade : {e.verdictAuto === "bonne" ? "mieux" : "moins bien"} que l&apos;ETF</span>}
        {e.dateRevue && e.statut !== "revue" && <span className="muted">revue prévue le {fmtDate(e.dateRevue)}</span>}
        {ctx && <span className="muted">au moment de décider : score {ctx.score}/100{ctx.per ? `, PER ${fmtNum(ctx.per, 0)}` : ""}{ctx.acheteurs?.length ? `, acheteurs : ${ctx.acheteurs.slice(0, 3).join(", ")}` : ""}{ctx.vendeurs?.length ? `, vendeurs : ${ctx.vendeurs.slice(0, 3).join(", ")}` : ""}</span>}
      </div>
      {e.statut === "revue" && e.lecon && <p className="jsmall"><b>Leçon :</b> {e.lecon}</p>}
      {e.statut !== "revue" && !rev && <button type="button" className="watch-btn" onClick={() => setRev(true)}>Faire la revue</button>}
      {rev && (
        <div className="controls jreview">
          <select className="dash-select" aria-label="Résultat" value={resultat} onChange={(x) => setResultat(x.target.value as typeof resultat)}>
            <option value="bonne">Bonne décision</option><option value="mitigee">Mitigée</option><option value="mauvaise">Mauvaise décision</option>
          </select>
          <input className="search" placeholder="Ce que j'en retiens (facultatif)" aria-label="Leçon" value={lecon} onChange={(x) => setLecon(x.target.value)} />
          <button type="button" className="watch-btn on" onClick={save}>Enregistrer</button>
        </div>
      )}
    </li>
  );
}

/** Journal de décisions (pour une action, ou toutes) : saisie, contexte figé, performance depuis, revue. */
export function JournalPanel({ ticker, cours }: { ticker?: string; cours?: number | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState({ ticker: ticker ?? "", decision: "achat", these: "", invalidation: "", objectif: "", conviction: "3", dateRevue: "" });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!ticker);
  const refresh = useCallback(() => { fetch(`/api/journal${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`).then((r) => r.json()).then(setData).catch((e) => setErr(String(e.message))); }, [ticker]);
  useEffect(() => { if (!snap()) refresh(); }, [refresh]);
  if (snap()) return <p className="note" style={{ margin: 0 }}>Le journal de décisions fonctionne dans la version hébergée (il enregistre vos décisions sur le serveur).</p>;
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(null);
    const r = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      ticker: f.ticker, decision: f.decision, these: f.these, invalidation: f.invalidation || null, objectif: f.objectif ? Number(f.objectif.replace(",", ".")) : null,
      conviction: Number(f.conviction), dateRevue: f.dateRevue || null,
    }) });
    const j = await r.json(); if (!r.ok) { setErr(j.erreur); return; }
    setF({ ...f, these: "", invalidation: "", objectif: "" }); refresh();
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="journal">
      {ticker && !open && <button type="button" className="watch-btn on" onClick={() => setOpen(true)}>+ Noter une décision sur {ticker}</button>}
      {open && (
        <form className="jform" onSubmit={submit}>
          <div className="controls">
            {!ticker && <input id="j-ticker" className="search" style={{ flex: "0 1 9rem" }} required placeholder="Symbole" aria-label="Symbole" value={f.ticker} onChange={set("ticker")} />}
            <select id="j-decision" className="dash-select" aria-label="Décision" value={f.decision} onChange={set("decision")}>
              {Object.entries(DEC).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select id="j-conviction" className="dash-select" aria-label="Conviction" value={f.conviction} onChange={set("conviction")}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Conviction {n}/5</option>)}
            </select>
            <input id="j-objectif" className="search" style={{ flex: "0 1 10rem" }} inputMode="decimal" placeholder={cours ? `Objectif (cours ${fmtNum(cours, 2)})` : "Objectif de cours"} aria-label="Objectif de cours" value={f.objectif} onChange={set("objectif")} />
            <label className="muted jdate">Revue le <input id="j-revue" type="date" className="dash-select" value={f.dateRevue} onChange={set("dateRevue")} /></label>
          </div>
          <textarea id="j-these" className="search jtext" required rows={3} placeholder="Pourquoi ? (ex. 3 dirigeants ont acheté en 2 semaines, PER 18 pour +25 % de croissance, résultats dans 1 mois…)" aria-label="Thèse" value={f.these} onChange={set("these")} />
          <textarea id="j-invalidation" className="search jtext" rows={2} placeholder="Ce qui me ferait changer d'avis (ex. marge en baisse 2 trimestres de suite, vente du PDG, cours sous 80 $)" aria-label="Invalidation" value={f.invalidation} onChange={set("invalidation")} />
          <div className="controls"><button type="submit" className="watch-btn on">Enregistrer la décision</button>
            <span className="muted jsmall">Le cours, le score smart money, le PER et les acheteurs / vendeurs du moment sont enregistrés automatiquement. Revue par défaut dans 90 jours.</span></div>
          {err && <p className="note sell">{err}</p>}
        </form>
      )}
      {data && !ticker && (
        <div className="metrics" style={{ margin: "12px 0" }}>
          <div className="metric"><span className="lbl">Décisions</span><b>{data.stats.total}</b></div>
          <div className="metric"><span className="lbl">À revoir</span><b className={data.stats.aRevoir ? "sell" : ""}>{data.stats.aRevoir}</b></div>
          <div className="metric"><span className="lbl">Revues : bonnes / mauvaises</span><b>{data.stats.bonnes} / {data.stats.mauvaises}</b></div>
          <div className="metric"><span className="lbl">Mieux que l&apos;ETF (à ce jour)</span><b>{data.stats.tauxAuto != null ? `${Math.round(data.stats.tauxAuto * 100)} %` : "—"}</b><small>achats qui battent l&apos;ETF, ventes qui font moins bien</small></div>
        </div>
      )}
      <ul className="jlist">
        {data?.entries.map((e) => <Entry key={e.id} e={e} onChange={refresh} showTicker={!ticker} />)}
        {data && !data.entries.length && <li className="muted">Aucune décision notée{ticker ? ` sur ${ticker}` : ""} pour l&apos;instant.</li>}
      </ul>
    </div>
  );
}
