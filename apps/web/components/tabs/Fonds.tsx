"use client";
import { useMemo, useState } from "react";
import type { DashboardData } from "@tracker/core";
import { fmtDate, fmtNum, fmtPct, fmtSigned } from "@/lib/format";
import { next13FDeadline } from "@/lib/deadlines";
import { EdgarBadge, EmptyRow, FreshLine, OpCell, SignalCell, Sym } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

const BUY = new Set(["Nouvelle position", "Renforcement"]);
const ORDER = ["Nouvelle position", "Renforcement", "Allègement", "Sortie totale"];

export function Fonds({ data, today }: { data: DashboardData; today: string }) {
  const rows = data.thirteenF;
  const investors = useMemo(() => {
    const m = new Map<string, { investisseur: string; fonds: string; trimestre: string; deposeLe: string; n: number }>();
    for (const r of rows) {
      const cur = m.get(r.investisseur);
      if (!cur || r.deposeLe > cur.deposeLe) m.set(r.investisseur, { investisseur: r.investisseur, fonds: r.fonds, trimestre: r.trimestre, deposeLe: r.deposeLe, n: 0 });
    }
    for (const r of rows) { const i = m.get(r.investisseur)!; if (r.trimestre === i.trimestre) i.n++; }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rows]);
  const latest = useMemo(() => {
    const q = new Map(investors.map((i) => [i.investisseur, i.trimestre]));
    return rows.filter((r) => q.get(r.investisseur) === r.trimestre);
  }, [rows, investors]);

  const consensus = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of latest) if (BUY.has(r.operation)) (m.get(r.ticker) ?? m.set(r.ticker, new Set()).get(r.ticker)!).add(r.investisseur);
    return [...m.entries()].filter(([, s]) => s.size >= 2).map(([ticker, s]) => ({ ticker, noms: [...s] })).sort((a, b) => b.noms.length - a.noms.length || a.ticker.localeCompare(b.ticker));
  }, [latest]);

  const [sel, setSel] = useState(investors[0]?.investisseur ?? "");
  const detail = useMemo(
    () => latest.filter((r) => r.investisseur === sel)
      .sort((a, b) => ORDER.indexOf(a.operation) - ORDER.indexOf(b.operation) || Math.abs(b.variationActions ?? 0) - Math.abs(a.variationActions ?? 0)),
    [latest, sel],
  );
  const selInfo = investors.find((i) => i.investisseur === sel);
  const next = next13FDeadline(today);

  return (
    <section>
      <FreshLine status={data.sourceStatus} sources={["13f"]} label="Derniers 13F déposés" />
      <div className="tiles">
        <div className="tile"><div className="lbl">Investisseurs suivis</div><div className="num">{investors.length}</div></div>
        <div className="tile"><div className="lbl">Mouvements déclarés</div><div className="num">{fmtNum(latest.length)}</div></div>
        <div className="tile"><div className="lbl">Nouvelles positions</div><div className="num buy">{latest.filter((r) => r.operation === "Nouvelle position").length}</div></div>
        <div className="tile"><div className="lbl">Sorties totales</div><div className="num sell">{latest.filter((r) => r.operation === "Sortie totale").length}</div></div>
        <div className="tile"><div className="lbl">Prochains 13F ({next.trimestre})</div><div className="num">{fmtDate(next.limite, false)}</div><div className="sub">date limite légale</div></div>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Achetées par plusieurs grands investisseurs</h2>
          <p className="note">Actions renforcées ou ouvertes par au moins deux des investisseurs suivis sur leur dernier trimestre déclaré.</p>
          <div className="scroll">
            <table>
              <thead><tr><th>Action</th><th className="r">Acheteurs</th><th>Qui</th></tr></thead>
              <tbody>
                {consensus.map((c) => (
                  <tr key={c.ticker}>
                    <td><Sym t={c.ticker} name={data.tickers[c.ticker]} /></td>
                    <td className="r buy">{c.noms.length}</td>
                    <td>{c.noms.join(", ")}</td>
                  </tr>
                ))}
                {!consensus.length && <EmptyRow cols={3} text="Aucune action achetée par au moins deux investisseurs." />}
              </tbody>
            </table>
          </div>
          <div className="scroll" style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th>Investisseur</th><th className="hide-sm">Fonds</th><th className="r">Dernier 13F</th><th className="r">Mouv.</th></tr></thead>
              <tbody>
                {investors.map((i) => (
                  <tr key={i.investisseur} onClick={() => setSel(i.investisseur)} style={{ cursor: "pointer" }}>
                    <td>{i.investisseur}</td>
                    <td className="hide-sm co">{i.fonds}</td>
                    <td className="r">{i.trimestre} · {fmtDate(i.deposeLe)}</td>
                    <td className="r">{i.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Mouvements par investisseur</h2>
          <p className="note">
            Variation du nombre d&apos;actions détenues entre deux trimestres (formulaire 13F), vérifiée ligne à ligne sur EDGAR. Les prochains 13F ({next.trimestre}) sont attendus
            d&apos;ici le <b>{fmtDate(next.limite)}</b>.
          </p>
          <div className="controls">
            <select className="dash-select" aria-label="Investisseur" value={sel} onChange={(e) => setSel(e.target.value)}>
              {investors.map((i) => <option key={i.investisseur} value={i.investisseur}>{i.investisseur} · {i.fonds}</option>)}
            </select>
          </div>
          {selInfo && <p className="note">{selInfo.trimestre}, déposé le <b>{fmtDate(selInfo.deposeLe)}</b>.</p>}
          <div className="scroll">
            <table>
              <thead><tr><th>Action</th><th>Opération</th><th className="r">Actions</th><th className="r">Var.</th><th className="r hide-sm">Trimestre</th><th className="r">Analyse</th></tr></thead>
              <tbody>
                {detail.map((r) => {
                  const s = BUY.has(r.operation) ? "achat" : "vente";
                  return (
                    <ExpandableRow key={r.id} cle={r.cleUnique} cols={6}>
                      <td>
                        <Sym t={r.ticker} name={r.societe ?? data.tickers[r.ticker]} />
                        {r.verifieEdgar ? <EdgarBadge url={r.sourceUrl} title="Quantité vérifiée sur la table d'information du 13F (EDGAR)" /> : null}
                      </td>
                      <OpCell op={r.operation} sens={s} />
                      <td className={`r ${s === "achat" ? "buy" : "sell"}`}>{fmtSigned(r.variationActions)}</td>
                      <td className="r">{r.operation === "Nouvelle position" ? <span className="muted">nouv.</span> : r.operation === "Sortie totale" ? fmtPct(-100, 0) : fmtPct(r.variationPct)}</td>
                      <td className="r hide-sm">{r.trimestre}</td>
                      <SignalCell cle={r.cleUnique} analyses={data.analyses} />
                    </ExpandableRow>
                  );
                })}
                {!detail.length && <EmptyRow cols={6} />}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
