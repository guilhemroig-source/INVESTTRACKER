"use client";
import type { DashboardData } from "@tracker/core";
import { displayNameOf } from "@/lib/names";
import { fmtDate, fmtPrice, fmtSigned, fmtUsd } from "@/lib/format";
import { type AnalysisMap, EdgarBadge, EmptyRow, FreshLine, OpCell, SignalCell, Sym } from "../cells";
import { ExpandableRow } from "../analysis/ExpandableRow";

type Row = DashboardData["insiders"][number];
const sensOf = (r: Row) => ((r.quantite ?? r.montantUsd ?? 0) > 0 ? "achat" : "vente");

function InsiderTable({ rows, showTicker, tickers, analyses }: { rows: Row[]; showTicker: boolean; tickers: Record<string, string>; analyses: AnalysisMap }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Publié</th>{showTicker && <th>Action</th>}<th className={showTicker ? "hide-sm" : undefined}>Initié</th><th>Opération</th>
            <th className="r hide-sm">Actions</th><th className="r hide-sm">Prix</th><th className="r">Montant</th><th className="r">Analyse</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = sensOf(r);
            return (
              <ExpandableRow key={r.id} cle={r.cleUnique} cols={showTicker ? 8 : 7}>
                <td className="nw" title={r.dateOperation ? `Opération le ${fmtDate(r.dateOperation)}` : undefined}>{fmtDate(r.deposeLe)}</td>
                {showTicker && <td><Sym t={r.ticker} name={r.societe ?? tickers[r.ticker]} /></td>}
                <td className={showTicker ? "hide-sm" : undefined}>
                  {displayNameOf(r.initie)} {r.fonction ? <span className="who-role">({r.fonction})</span> : null}
                  {r.verifieEdgar ? <EdgarBadge url={r.sourceUrl} title={r.accession ? `Déclaration ${r.accession} sur SEC EDGAR` : undefined} /> : null}
                </td>
                <OpCell op={r.operation} sens={s} />
                <td className={`r hide-sm ${s === "achat" ? "buy" : "sell"}`}>{fmtSigned(r.quantite)}</td>
                <td className="r hide-sm">{fmtPrice(r.prix)}</td>
                <td className={`r ${s === "achat" ? "buy" : "sell"}`}>{r.montantUsd != null ? fmtUsd(r.montantUsd) : <span className="muted">—</span>}</td>
                <SignalCell cle={r.cleUnique} analyses={analyses} />
              </ExpandableRow>
            );
          })}
          {!rows.length && <EmptyRow cols={showTicker ? 8 : 7} />}
        </tbody>
      </table>
    </div>
  );
}

export function Inities({ data }: { data: DashboardData }) {
  const gros = [...data.insiders.filter((r) => r.liste === "gros")]
    .sort((a, b) => b.deposeLe.localeCompare(a.deposeLe) || Math.abs(b.montantUsd ?? 0) - Math.abs(a.montantUsd ?? 0));
  const tesla = data.insiders.filter((r) => r.liste === "tesla");
  const spacex = data.insiders.filter((r) => r.liste === "spacex");
  const buys = gros.filter((r) => (r.montantUsd ?? 0) > 0).sort((a, b) => (b.montantUsd ?? 0) - (a.montantUsd ?? 0));
  const sells = gros.filter((r) => (r.montantUsd ?? 0) < 0).sort((a, b) => (a.montantUsd ?? 0) - (b.montantUsd ?? 0));
  const maxB = buys[0], maxS = sells[0];
  const muskLast = [...tesla, ...spacex].filter((r) => /musk/i.test(r.initie)).map((r) => r.deposeLe).sort().at(-1);

  return (
    <section>
      <FreshLine status={data.sourceStatus} sources={["form4-gros", "form4-tesla", "form4-spacex", "openinsider", "edgar-musk", "edgar-insiders"]} />
      <div className="tiles">
        <div className="tile"><div className="lbl">Plus gros achat d&apos;initié récent</div><div className="num buy">{fmtUsd(maxB?.montantUsd)}</div><div className="sub">{maxB ? `${displayNameOf(maxB.initie)} · ${fmtDate(maxB.deposeLe, false)}` : ""}</div></div>
        <div className="tile"><div className="lbl">Sur l&apos;action</div><div className="num">{maxB ? <span className="sym" style={{ fontSize: "inherit" }}>{maxB.ticker}</span> : "—"}</div><div className="sub">{maxB ? maxB.societe ?? data.tickers[maxB.ticker] : ""}</div></div>
        <div className="tile"><div className="lbl">Plus grosse vente d&apos;initié récente</div><div className="num sell">{fmtUsd(maxS?.montantUsd)}</div><div className="sub">{maxS ? `${displayNameOf(maxS.initie)} · ${fmtDate(maxS.deposeLe, false)}` : ""}</div></div>
        <div className="tile"><div className="lbl">Sur l&apos;action</div><div className="num">{maxS ? <span className="sym" style={{ fontSize: "inherit" }}>{maxS.ticker}</span> : "—"}</div><div className="sub">{maxS ? maxS.societe ?? data.tickers[maxS.ticker] : ""}</div></div>
      </div>
      <div className="card">
        <h2>Gros mouvements d&apos;initiés (plus d&apos;un million de dollars)</h2>
        <p className="note">Dirigeants, administrateurs et actionnaires de plus de 10 % doivent déclarer chaque opération à la SEC sous deux jours ouvrés (formulaire 4) : c&apos;est la donnée légale la plus fraîche.</p>
        <InsiderTable rows={gros} showTicker tickers={data.tickers} analyses={data.analyses} />
      </div>
      <div className="card">
        <h2>Tesla : Elon Musk et les autres initiés</h2>
        <p className="note">
          Achats et ventes des initiés d&apos;après OpenInsider ; les formulaires 4 de Musk sont lus en entier sur EDGAR (exercices d&apos;options,
          attributions, dons, renonciations). Dernier formulaire 4 de Musk publié le <b>{fmtDate(muskLast)}</b>.
        </p>
        <InsiderTable rows={tesla} showTicker={false} tickers={data.tickers} analyses={data.analyses} />
      </div>
      <div className="card">
        <h2>SpaceX (SPCX) : Elon Musk</h2>
        <p className="note">SpaceX est cotée depuis juin 2026 ; Musk y déclare ses opérations comme dirigeant et actionnaire de plus de 10 %. Source : formulaires 4 sur SEC EDGAR.</p>
        <InsiderTable rows={spacex} showTicker={false} tickers={data.tickers} analyses={data.analyses} />
      </div>
    </section>
  );
}
