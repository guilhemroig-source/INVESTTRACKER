"use client";
import { useMemo, useState } from "react";
import type { DashboardData } from "@tracker/core";
import { fmtDate, fmtNum, fmtPct, fmtRange } from "@/lib/format";
import { EmptyRow, FreshLine, OpCell, SignalCell, Sym } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

export function Congres({ data }: { data: DashboardData }) {
  const mem = data.congressMembers;
  const tot = mem.reduce((a, r) => ({ t: a.t + r.transactions, a: a.a + r.achats, v: a.v + r.ventes }), { t: 0, a: 0, v: 0 });
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.congress.filter((r) => !qq || r.ticker.toLowerCase().includes(qq) || r.elu.toLowerCase().includes(qq) || (r.societe ?? "").toLowerCase().includes(qq));
  }, [data.congress, q]);

  return (
    <section>
      <FreshLine status={data.sourceStatus} sources={["congres"]} />
      <div className="tiles">
        <div className="tile"><div className="lbl">Élus suivis</div><div className="num">{mem.length}</div></div>
        <div className="tile"><div className="lbl">Transactions</div><div className="num">{fmtNum(tot.t)}</div></div>
        <div className="tile"><div className="lbl">Achats</div><div className="num buy">{fmtNum(tot.a)}</div></div>
        <div className="tile"><div className="lbl">Ventes</div><div className="num sell">{fmtNum(tot.v)}</div></div>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Élus les plus actifs</h2>
          <p className="note">Nombre de transactions déclarées au titre du STOCK Act, par élu.</p>
          <div className="scroll">
            <table>
              <thead><tr><th>Élu</th><th className="r">Trans.</th><th className="r hide-sm">Achats</th><th className="r hide-sm">Ventes</th><th className="r">Dernière</th></tr></thead>
              <tbody>
                {mem.map((m) => (
                  <tr key={m.elu}>
                    <td>{m.elu} <span className="who-role">({[m.chambre, m.etat].filter(Boolean).join(", ")})</span></td>
                    <td className="r">{fmtNum(m.transactions)}</td>
                    <td className="r hide-sm buy">{fmtNum(m.achats)}</td>
                    <td className="r hide-sm sell">{fmtNum(m.ventes)}</td>
                    <td className="r">{fmtDate(m.derniereTransaction)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Dernières transactions des élus</h2>
          <p className="note">Montants en fourchettes légales. « Perf. » : évolution du cours de l&apos;action depuis la transaction, selon Bargo.</p>
          <div className="controls">
            <input className="search" type="search" placeholder="Rechercher une action ou un élu" aria-label="Rechercher une action ou un élu" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>Déclaré</th><th className="hide-sm">Élu</th><th>Action</th><th>Opération</th><th className="r">Montant</th><th className="r">Perf.</th><th className="r">Analyse</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.operation === "Achat" ? "achat" : "vente";
                  return (
                    <ExpandableRow key={r.id} cle={r.cleUnique} cols={7}>
                      <td className="nw" title={r.dateTransaction ? `Transaction le ${fmtDate(r.dateTransaction)}` : undefined}>{fmtDate(r.dateDeclaration, false)}</td>
                      <td className="hide-sm">{r.elu} <span className="who-role">({r.etat})</span></td>
                      <td><Sym t={r.ticker} name={r.societe ?? data.tickers[r.ticker]} /></td>
                      <OpCell op={r.operation} sens={s} />
                      <td className={`r ${s === "achat" ? "buy" : "sell"}`} title={r.montant ?? undefined}>{fmtRange(r.montant)}</td>
                      <td className={`r ${r.perfPct == null ? "" : r.perfPct >= 0 ? "buy" : "sell"}`}>{fmtPct(r.perfPct)}</td>
                      <SignalCell cle={r.cleUnique} analyses={data.analyses} />
                    </ExpandableRow>
                  );
                })}
                {!rows.length && <EmptyRow cols={7} />}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
            Données Congrès fournies par <a href="https://www.bargo.ai/free-apis" target="_blank" rel="noreferrer">Bargo</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
