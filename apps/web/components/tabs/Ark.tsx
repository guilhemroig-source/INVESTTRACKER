"use client";
import { useMemo, useState } from "react";
import type { DashboardData } from "@tracker/core";
import { fmtDate, fmtNum, fmtPct, fmtSigned, fmtUsd } from "@/lib/format";
import { DivergingBars, Legend, COLORS, type NetRow } from "../charts";
import { EmptyRow, FreshLine, OpCell, SignalCell, Sym } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

export function Ark({ data }: { data: DashboardData }) {
  const rows = data.ark;
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), "");
  const first = rows.reduce((m, r) => (r.date < m ? r.date : m), last);
  const sessions = new Set(rows.map((r) => r.date)).size;
  const day = rows.filter((r) => r.date === last);
  const sum = (xs: typeof rows) => xs.reduce((a, r) => a + (r.montantUsd ?? 0), 0);

  const net: NetRow[] = useMemo(() => {
    const m = new Map<string, NetRow>();
    for (const r of rows) {
      const e = m.get(r.ticker) ?? { ticker: r.ticker, nom: data.tickers[r.ticker], net: 0, achats: 0, ventes: 0 };
      const v = r.montantUsd ?? 0;
      if (r.operation === "Achat") { e.achats += v; e.net += v; } else { e.ventes += v; e.net -= v; }
      m.set(r.ticker, e);
    }
    const all = [...m.values()];
    const buys = all.filter((r) => r.net > 0).sort((a, b) => b.net - a.net).slice(0, 10);
    const sells = all.filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, 10);
    return [...buys, ...sells.reverse()];
  }, [rows, data.tickers]);

  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => !qq || r.ticker.toLowerCase().includes(qq) || (data.tickers[r.ticker] ?? "").toLowerCase().includes(qq) || r.fonds.toLowerCase().includes(qq));
  }, [rows, q, data.tickers]);

  return (
    <section>
      <FreshLine status={data.sourceStatus} sources={["ark"]} />
      <div className="tiles">
        <div className="tile"><div className="lbl">Dernière séance publiée</div><div className="num">{fmtDate(last, false)}</div></div>
        <div className="tile"><div className="lbl">Achats ce jour-là</div><div className="num buy">{fmtUsd(sum(day.filter((r) => r.operation === "Achat")))}</div></div>
        <div className="tile"><div className="lbl">Ventes ce jour-là</div><div className="num sell">{fmtUsd(sum(day.filter((r) => r.operation === "Vente")))}</div></div>
        <div className="tile"><div className="lbl">Opérations ce jour-là</div><div className="num">{fmtNum(day.length)}</div></div>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Achats nets par action, sur les dernières séances</h2>
          <p className="note">
            Achats moins ventes, tous fonds ARK réunis, du {fmtDate(first)} au {fmtDate(last)} ({sessions} séances). À droite ce qu&apos;ARK
            accumule, à gauche ce qu&apos;elle allège (10 plus gros de chaque côté).
          </p>
          <Legend items={[{ label: "Achat net", color: COLORS.GREEN }, { label: "Vente nette", color: COLORS.RED }]} />
          <DivergingBars rows={net} />
        </div>
        <div className="card">
          <h2>Opérations quotidiennes d&apos;ARK</h2>
          <p className="note">ARK publie chaque soir les achats et ventes de ses ETF (ARKK, ARKW, ARKG, ARKQ, ARKF, ARKX). Montant estimé au cours de clôture ; nombre d&apos;actions recoupé avec les fichiers de positions publiés chaque jour par ARK.</p>
          <div className="controls">
            <input className="search" type="search" placeholder="Rechercher une action ou un fonds" aria-label="Rechercher une action" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>Date</th><th className="hide-sm">Fonds</th><th>Action</th><th>Opération</th><th className="r">Montant</th><th className="r hide-sm">Actions</th><th className="r hide-sm">% ligne</th><th className="r">Analyse</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const s = r.operation === "Achat" ? "achat" : "vente";
                  return (
                    <ExpandableRow key={r.id} cle={r.cleUnique} cols={8}>
                      <td className="nw">{fmtDate(r.date, false)}</td>
                      <td className="hide-sm">{r.fonds}</td>
                      <td><Sym t={r.ticker} name={data.tickers[r.ticker]} /></td>
                      <OpCell op={r.operation} sens={s} />
                      <td className={`r ${s === "achat" ? "buy" : "sell"}`}>{fmtUsd(r.montantUsd)}</td>
                      <td className="r hide-sm" title={r.actions != null ? "Nombre exact, recoupé avec les positions publiées par ARK" : "Pas encore recoupé avec les positions ARK"}>
                        {r.actions != null ? fmtSigned(r.actions) : <span className="muted">—</span>}
                      </td>
                      <td className="r hide-sm">{fmtPct(r.pctPosition, 2, false)}</td>
                      <SignalCell cle={r.cleUnique} analyses={data.analyses} />
                    </ExpandableRow>
                  );
                })}
                {!shown.length && <EmptyRow cols={8} />}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
