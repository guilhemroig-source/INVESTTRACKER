"use client";
import { useCallback, useEffect, useState } from "react";
import type { PortfolioResult } from "@tracker/core";
import { snap } from "@/lib/snapshot";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { EmptyRow, Sym } from "../cells";

type Data = PortfolioResult & {
  regles: { poidsMax: number; baisseMax: number; reference: string };
  transactions: { id: number; date: string; type: string; ticker: string; quantite: number; prix: number; frais: number; compte: string; note: string | null }[];
  societes: Record<string, string | null>;
};
const p = (x: number | null | undefined) => (x == null ? "—" : fmtPct(x * 100));
const c = (x: number | null | undefined) => (x == null ? "" : x >= 0 ? "buy" : "sell");
const today = () => new Date().toISOString().slice(0, 10);
const REFS: Record<string, string> = { VT: "ETF monde (VT)", SPY: "S&P 500 (SPY)", QQQ: "Nasdaq 100 (QQQ)" };

/** Mon portefeuille : mes vraies positions, comparées à un ETF, avec mes règles de risque. */
export function Portefeuille() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ date: today(), type: "achat", ticker: "", quantite: "", prix: "", frais: "0", compte: "CTO", note: "" });
  const refresh = useCallback(() => { fetch("/api/portefeuille").then((r) => r.json()).then(setD).catch((e) => setErr(String(e.message))); }, []);
  useEffect(() => { if (!snap()) refresh(); }, [refresh]);
  if (snap()) return <section><div className="card"><h2>Mon portefeuille</h2><p className="note" style={{ marginBottom: 0 }}>Le suivi de votre portefeuille fonctionne dans la version hébergée (vos transactions sont enregistrées sur votre serveur, jamais dans ce lien).</p></div></section>;
  const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = await fetch("/api/portefeuille", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, quantite: num(f.quantite || "0"), prix: num(f.prix), frais: num(f.frais || "0") }) });
    const j = await r.json(); if (!r.ok) { setErr(j.erreur); return; }
    setF({ ...f, ticker: "", quantite: "", prix: "", note: "" }); refresh();
  };
  const del = async (id: number) => { await fetch(`/api/portefeuille/${id}`, { method: "DELETE" }); refresh(); };
  const setRegle = async (k: string, v: number | string) => {
    const r = await fetch("/api/portefeuille/regles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [k]: v }) });
    if (!r.ok) setErr((await r.json()).erreur); refresh();
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const t = d?.totaux, ref = d?.reference;
  const ouvertes = d?.positions.filter((x) => x.quantite > 0) ?? [];
  return (
    <section>
      {d && d.transactions.length > 0 && (
        <div className="tiles">
          <div className="tile"><div className="lbl">Valeur actuelle</div><div className="num">{fmtUsd(t!.valeur)}</div><div className="sub">investi net {fmtUsd(t!.investiNet)}</div></div>
          <div className="tile"><div className="lbl">Mon gain total</div><div className={`num ${t!.gainTotal >= 0 ? "buy" : "sell"}`}>{p(t!.gainTotalPct)}</div><div className="sub">{fmtUsd(t!.gainTotal)} (latent {fmtUsd(t!.gainLatent)}, réalisé {fmtUsd(t!.gainRealise)}, dividendes {fmtUsd(t!.dividendes)})</div></div>
          <div className="tile"><div className="lbl">Même argent sur {ref ? REFS[ref.ticker] ?? ref.ticker : "l'ETF"}</div><div className={`num ${ref && (ref.gainTotal ?? 0) >= 0 ? "buy" : "sell"}`}>{p(ref?.gainTotalPct)}</div><div className="sub">{ref ? fmtUsd(ref.gainTotal) : "cours de l'ETF pas encore téléchargés"}</div></div>
          <div className="tile"><div className="lbl">Je fais {ref && t!.gainTotalPct != null && ref.gainTotalPct != null && t!.gainTotalPct >= ref.gainTotalPct ? "mieux" : "moins bien"} que l&apos;ETF</div><div className={`num ${ref && t!.gainTotalPct != null && ref.gainTotalPct != null ? (t!.gainTotalPct >= ref.gainTotalPct ? "buy" : "sell") : ""}`}>{ref && t!.gainTotalPct != null && ref.gainTotalPct != null ? p(t!.gainTotalPct - ref.gainTotalPct) : "—"}</div><div className="sub">écart de performance</div></div>
          <div className="tile"><div className="lbl">Impôt estimé (CTO)</div><div className="num">{fmtUsd(t!.impotEstime)}</div><div className="sub">flat tax 30 % sur gains et dividendes, si tout était vendu</div></div>
        </div>
      )}
      {d && d.alertes.length > 0 && (
        <div className="card alert-card"><h2>À regarder</h2><ul className="plain lectures">{d.alertes.map((a) => <li key={a}>{a}</li>)}</ul></div>
      )}
      <div className="card">
        <h2>Mes positions</h2>
        <p className="note">Prix de revient moyen (frais inclus), dernier cours connu. Comparaison : chaque achat et chaque vente sont rejoués sur l&apos;ETF de référence pour le même montant et à la même date (dividendes de l&apos;ETF réinvestis). Montants en dollars.</p>
        <div className="scroll">
          <table>
            <thead><tr><th>Action</th><th className="hide-sm">Compte</th><th className="r">Quantité</th><th className="r hide-sm">Prix de revient</th><th className="r">Cours</th><th className="r">Valeur</th><th className="r">Gain</th><th className="r hide-sm">Poids</th></tr></thead>
            <tbody>
              {ouvertes.map((x) => (
                <tr key={`${x.ticker}|${x.compte}`}>
                  <td><Sym t={x.ticker} name={d!.societes[x.ticker]} />{x.alertes.length > 0 && <span className="conf contre" title={x.alertes.join("\n")} style={{ marginLeft: 6 }}>⚠ {x.alertes.length}</span>}</td>
                  <td className="hide-sm">{x.compte}</td>
                  <td className="r">{fmtNum(x.quantite, x.quantite % 1 ? 3 : 0)}</td>
                  <td className="r hide-sm">{fmtPrice(x.pru)}</td>
                  <td className="r" title={x.dateCours ? `au ${fmtDate(x.dateCours)}` : "cours pas encore téléchargé"}>{fmtPrice(x.cours)}</td>
                  <td className="r">{fmtUsd(x.valeur ?? x.investi)}</td>
                  <td className={`r ${c(x.gainLatentPct)}`}>{p(x.gainLatentPct)}<br /><small>{x.gainLatent != null ? fmtUsd(x.gainLatent, { signed: true }) : ""}</small></td>
                  <td className="r hide-sm">{x.poids != null ? `${fmtNum(x.poids * 100, 1)} %` : "—"}</td>
                </tr>
              ))}
              {d && !ouvertes.length && <EmptyRow cols={8} text="Aucune position. Ajoutez votre premier achat ci-dessous." />}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Ajouter une transaction</h2>
          <form onSubmit={add}>
            <div className="controls">
              <select id="tx-type" className="dash-select" aria-label="Type" value={f.type} onChange={set("type")}><option value="achat">Achat</option><option value="vente">Vente</option><option value="dividende">Dividende reçu</option></select>
              <input id="tx-date" type="date" className="dash-select" aria-label="Date" value={f.date} onChange={set("date")} required />
              <input id="tx-ticker" className="search" style={{ flex: "0 1 8rem" }} placeholder="Symbole" aria-label="Symbole" value={f.ticker} onChange={set("ticker")} required />
              <select id="tx-compte" className="dash-select" aria-label="Compte" value={f.compte} onChange={set("compte")}><option>CTO</option><option>PEA</option><option>Assurance-vie</option><option>Autre</option></select>
            </div>
            <div className="controls">
              {f.type !== "dividende" && <input id="tx-qte" className="search" inputMode="decimal" placeholder="Quantité" aria-label="Quantité" value={f.quantite} onChange={set("quantite")} required />}
              <input id="tx-prix" className="search" inputMode="decimal" placeholder={f.type === "dividende" ? "Montant reçu ($)" : "Prix unitaire ($)"} aria-label="Prix" value={f.prix} onChange={set("prix")} required />
              <input id="tx-frais" className="search" inputMode="decimal" placeholder="Frais ($)" aria-label="Frais" value={f.frais} onChange={set("frais")} />
            </div>
            <div className="controls"><input id="tx-note" className="search" placeholder="Note (facultatif)" aria-label="Note" value={f.note} onChange={set("note")} /><button type="submit" className="watch-btn on">Ajouter</button></div>
            {err && <p className="note sell">{err}</p>}
          </form>
        </div>
        <div className="card">
          <h2>Mes règles de risque</h2>
          <p className="note">Écrites à l&apos;avance, elles évitent de décider sous le coup de l&apos;émotion. Une alerte apparaît ici et dans le SMS de 7h47.</p>
          {d && (
            <div className="controls rules">
              <label>Poids max d&apos;une ligne
                <select className="dash-select" value={d.regles.poidsMax} onChange={(e) => setRegle("poidsMax", Number(e.target.value))}>{[0.05, 0.1, 0.15, 0.2, 0.25].map((v) => <option key={v} value={v}>{v * 100} %</option>)}</select></label>
              <label>Revoir une ligne à partir de
                <select className="dash-select" value={d.regles.baisseMax} onChange={(e) => setRegle("baisseMax", Number(e.target.value))}>{[0.1, 0.15, 0.2, 0.25, 0.3, 0.4].map((v) => <option key={v} value={v}>−{v * 100} %</option>)}</select></label>
              <label>Comparer à
                <select className="dash-select" value={d.regles.reference} onChange={(e) => setRegle("reference", e.target.value)}>{Object.entries(REFS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
          )}
          <p className="note" style={{ marginBottom: 0 }}>Rappel : les actions américaines ne sont pas éligibles au PEA ; sur un CTO, gains et dividendes supportent la flat tax de 30 % (et une retenue à la source américaine sur les dividendes).</p>
        </div>
      </div>
      <div className="card">
        <h2>Mes transactions</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Action</th><th className="r">Quantité</th><th className="r">Prix</th><th className="r hide-sm">Frais</th><th className="hide-sm">Compte</th><th></th></tr></thead>
            <tbody>
              {d?.transactions.map((x) => (
                <tr key={x.id}>
                  <td className="nw">{fmtDate(x.date)}</td><td className={x.type === "vente" ? "sell" : x.type === "achat" ? "buy" : ""}>{x.type}</td><td><Sym t={x.ticker} /></td>
                  <td className="r">{x.type === "dividende" ? "—" : fmtNum(x.quantite, x.quantite % 1 ? 3 : 0)}</td><td className="r">{fmtPrice(x.prix)}</td><td className="r hide-sm">{fmtPrice(x.frais)}</td><td className="hide-sm">{x.compte}</td>
                  <td className="r"><button type="button" className="watch-del" onClick={() => del(x.id)} aria-label="Supprimer la transaction">Supprimer</button></td>
                </tr>
              ))}
              {d && !d.transactions.length && <EmptyRow cols={8} text="Aucune transaction." />}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
