"use client";
import { useMemo, useState } from "react";
import type { DashboardData } from "@tracker/core";
import { fmtDate, fmtNum, fmtPct, fmtRange } from "@/lib/format";
import { COLORS, Legend, StackedBars } from "../charts";
import { EmptyRow, FreshLine, OpCell, SignalCell, Sym } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

export function Trump({ data }: { data: DashboardData }) {
  const f = data.trumpFilings;
  const meta = data.trumpMeta;
  const tot = f.reduce((a, r) => ({ t: a.t + r.transactions, a: a.a + r.achats, v: a.v + r.ventes }), { t: 0, a: 0, v: 0 });
  const top = data.trumpTickers.slice(0, 15);
  const topMax = Math.max(1, ...top.map((t) => t.transactions));

  const [q, setQ] = useState("");
  const [sens, setSens] = useState("");
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.trump.filter((r) =>
      (!sens || (sens === "achat") === (r.operation === "Achat")) &&
      (!qq || r.ticker.toLowerCase().includes(qq) || (data.tickers[r.ticker] ?? "").toLowerCase().includes(qq)));
  }, [data.trump, data.tickers, q, sens]);

  return (
    <section>
      <FreshLine status={data.sourceStatus} sources={["trump"]} label="Retranscription à jour" />
      <div className="tiles">
        <div className="tile"><div className="lbl">Transactions déclarées</div><div className="num">{fmtNum(tot.t)}</div><div className="sub">{f.length} déclarations OGE 278-T</div></div>
        <div className="tile"><div className="lbl">Achats</div><div className="num buy">{fmtNum(tot.a)}</div></div>
        <div className="tile"><div className="lbl">Ventes</div><div className="num sell">{fmtNum(tot.v)}</div></div>
        <div className="tile"><div className="lbl">Déclarées hors délai (45 j)</div><div className="num">{meta?.partHorsDelai45j != null ? fmtPct(meta.partHorsDelai45j * 100, 1, false) : "—"}</div><div className="sub">délai médian {meta?.delaiMedianJours ?? "—"} jours</div></div>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Transactions par déclaration</h2>
          <p className="note">
            Chaque formulaire OGE 278-T regroupe des centaines d&apos;opérations. Transactions du {fmtDate(meta?.premiereTransaction)} au{" "}
            {fmtDate(meta?.derniereTransaction)}.
          </p>
          <Legend items={[{ label: "Achats", color: COLORS.GREEN }, { label: "Ventes", color: COLORS.RED }]} />
          <StackedBars rows={f.map((r) => ({ label: r.periode, sub: `déposé ${fmtDate(r.deposeLe, false)}`, achats: r.achats, ventes: r.ventes }))} />
        </div>
        <div className="card">
          <h2>Actions les plus échangées</h2>
          <p className="note">Nombre de transactions par action, toutes déclarations confondues (15 premières).</p>
          <div className="scroll">
            <table>
              <thead><tr><th>Action</th><th className="r">Transactions</th><th className="hide-sm" style={{ width: "35%" }}></th></tr></thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.ticker}>
                    <td><Sym t={t.ticker} name={data.tickers[t.ticker]} /></td>
                    <td className="r">{fmtNum(t.transactions)}</td>
                    <td className="hide-sm"><div style={{ height: 6, borderRadius: 3, background: "var(--cds-chart-muted)", width: `${(t.transactions / topMax) * 100}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Les 150 dernières transactions</h2>
        <p className="note">Montants en fourchettes légales. Les originaux OGE sont des PDF scannés : retranscription getsignal.finance, nombre de transactions recoupé avec open-cabinet.org.</p>
        <div className="controls">
          <input className="search" type="search" placeholder="Rechercher une action" aria-label="Rechercher une action" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="dash-select" aria-label="Sens" value={sens} onChange={(e) => setSens(e.target.value)}>
            <option value="">Achats et ventes</option><option value="achat">Achats</option><option value="vente">Ventes</option>
          </select>
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>Déposé</th><th>Action</th><th>Opération</th><th className="r">Montant</th><th className="r hide-sm">Opération le</th><th className="r">Analyse</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = r.operation === "Achat" ? "achat" : "vente";
                return (
                  <ExpandableRow key={r.id} cle={r.cleUnique} cols={6}>
                    <td className="nw">{fmtDate(r.deposeLe)}</td>
                    <td>
                      <Sym t={r.ticker} name={data.tickers[r.ticker] ?? r.nomDeclare} />
                      {r.nonVerifie ? <span className="ok-badge" style={{ color: "var(--tk-amber)", borderColor: "rgba(255,181,71,.4)" }} title={`Symbole non vérifié par la source. Déclaré : ${r.nomDeclare ?? "?"}`}>NON VÉRIFIÉ</span> : null}
                    </td>
                    <OpCell op={r.operation} sens={s} />
                    <td className={`r ${s === "achat" ? "buy" : "sell"}`} title={r.montant ?? undefined}>{fmtRange(r.montant)}</td>
                    <td className="r hide-sm">{fmtDate(r.dateTransaction)}</td>
                    <SignalCell cle={r.cleUnique} analyses={data.analyses} />
                  </ExpandableRow>
                );
              })}
              {!rows.length && <EmptyRow cols={6} />}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
