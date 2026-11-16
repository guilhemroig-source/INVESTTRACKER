"use client";
import { useMemo, useState } from "react";
import type { DashboardData } from "@tracker/core";
import { fmtDate, fmtPrice, fmtRange, fmtSigned, fmtUsd, sensClass } from "@/lib/format";
import { EdgarBadge, EmptyRow, FreshLine, OpCell, SignalCell, Sym, Who } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

const CATS = [
  ["", "Toutes les sources"],
  ["Super-investisseur", "Super-investisseurs (13F)"],
  ["ARK", "Cathie Wood (ARK)"],
  ["Initié", "Initiés (Form 4)"],
  ["Tesla / SpaceX", "Tesla / SpaceX / Musk"],
  ["Trump", "Donald Trump"],
  ["Congrès", "Congrès US"],
] as const;

export function Alertes({ data }: { data: DashboardData }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sens, setSens] = useState("");
  const fresh = useMemo(() => new Set(data.operations.slice(0, 8).map((o) => o.id)), [data.operations]);
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return data.operations.filter(
      (o) =>
        (!cat || o.categorie === cat) &&
        (!sens || o.sens === sens) &&
        (!qq || o.ticker.toLowerCase().includes(qq) || o.qui.toLowerCase().includes(qq) || (o.societe ?? "").toLowerCase().includes(qq)),
    );
  }, [data.operations, q, cat, sens]);

  return (
    <section>
      <FreshLine status={data.sourceStatus} sources={["ark", "form4-gros", "form4-tesla", "form4-spacex", "openinsider", "edgar-musk", "edgar-insiders", "13f", "trump", "congres"]} />
      <div className="card">
        <h2>Toutes les publications, les plus récentes d&apos;abord</h2>
        <p className="note">
          Un fil unique qui réunit toutes les sources, trié par date de publication. Le montant est exact pour ARK et les initiés, une
          fourchette pour Trump et les élus ; les 13F ne donnent que le nombre d&apos;actions.
        </p>
        <div className="controls">
          <input className="search" type="search" placeholder="Rechercher une action ou un nom (ex. NVDA, Buffett)" aria-label="Rechercher une action ou un nom" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="dash-select" aria-label="Catégorie" value={cat} onChange={(e) => setCat(e.target.value)}>
            {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="dash-select" aria-label="Sens" value={sens} onChange={(e) => setSens(e.target.value)}>
            <option value="">Achats et ventes</option>
            <option value="achat">Achats</option>
            <option value="vente">Ventes</option>
          </select>
        </div>
        <div className="scroll tall">
          <table>
            <thead>
              <tr>
                <th>Publié</th><th>Qui</th><th>Action</th><th>Opération</th><th className="r">Montant</th>
                <th className="r hide-sm">Volume</th><th className="r hide-sm">Opération le</th><th className="r">Analyse</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <ExpandableRow key={o.id} cle={o.cleUnique} cols={8} className={fresh.has(o.id) ? "fresh" : undefined}>
                  <td className="nw">{fmtDate(o.datePublication)}</td>
                  <td>
                    <Who qui={o.qui} />
                    {o.verifieEdgar ? <EdgarBadge url={o.sourceUrl} /> : null}
                  </td>
                  <td><Sym t={o.ticker} name={o.societe ?? data.tickers[o.ticker]} /></td>
                  <OpCell op={o.operation} sens={o.sens} />
                  <td className={`r ${sensClass(o.sens)}`} title={o.prix ? `Prix ${fmtPrice(o.prix)}` : undefined}>
                    {o.montantUsd != null ? fmtUsd(o.montantUsd) : o.fourchette ? fmtRange(o.fourchette) : <span className="muted">—</span>}
                  </td>
                  <td className="r hide-sm">{o.volume != null ? fmtSigned(o.volume) : <span className="muted">—</span>}</td>
                  <td className="r hide-sm">{fmtDate(o.dateOperation)}</td>
                  <SignalCell cle={o.cleUnique} analyses={data.analyses} />
                </ExpandableRow>
              ))}
              {!rows.length && <EmptyRow cols={8} />}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginBottom: 0, marginTop: 8 }}>{rows.length} opérations affichées sur {data.operations.length}.</p>
      </div>
    </section>
  );
}
