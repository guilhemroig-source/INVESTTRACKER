import { getAlerts, getCollectLog, getCounts, getDb, getSourceStatus } from "@tracker/core";
import { fmtDateTime } from "@/lib/format";
import { CollecteButtons } from "@/components/CollecteButtons";

export const dynamic = "force-dynamic";

export default function Admin() {
  const db = getDb();
  const log = getCollectLog(db);
  const status = getSourceStatus(db);
  const counts = getCounts(db);
  const alerts = getAlerts(db);
  return (
    <div className="tk" style={{ paddingTop: 32 }}>
      <p className="kicker">Admin · journal de collecte</p>
      <h1 style={{ fontSize: "2rem" }}>Administration</h1>
      <p className="lead"><a href="/" style={{ color: "var(--tk-accent)" }}>← Retour au tableau de bord</a></p>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Collecter maintenant</h2>
        <p className="note">Sans attendre les collectes de 7h30 et 23h30 (cours : chaque heure). Le résultat s&apos;affiche dans le journal ci-dessous.</p>
        <CollecteButtons />
      </div>
      <div className="grid">
        <div className="card">
          <h2>État par source</h2>
          <div className="scroll" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Source</th><th className="r">Données au</th><th className="r">Dernier succès</th><th className="r">Dernière erreur</th></tr></thead>
              <tbody>
                {status.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td><td className="r">{s.donnees_au ?? "—"}</td><td className="r">{fmtDateTime(s.dernier_ok)}</td>
                    <td className={`r ${s.derniere_erreur ? "sell" : "muted"}`}>{s.derniere_erreur ? fmtDateTime(s.derniere_erreur) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Opérations en base</h2>
          <div className="scroll" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Source</th><th className="r">Lignes</th></tr></thead>
              <tbody>{counts.map((c) => <tr key={c.source}><td>{c.source}</td><td className="r">{c.n}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Journal de collecte (200 dernières exécutions)</h2>
        <div className="scroll tall" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Début</th><th>Source</th><th>Statut</th><th className="r">Lues</th><th className="r">Nouvelles</th><th className="r hide-sm">Données au</th><th>Erreur / détails</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td className="nw">{fmtDateTime(l.debut)}</td><td>{l.source}</td>
                  <td className={l.statut === "ok" ? "buy" : l.statut === "erreur" ? "sell" : "muted"}>{l.statut}</td>
                  <td className="r">{l.lignesLues}</td><td className="r">{l.lignesNouvelles}</td><td className="r hide-sm">{l.donneesAu ?? "—"}</td>
                  <td>
                    {l.erreur ? <div className="sell">{l.erreur}</div> : null}
                    {l.details ? <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: ".7rem" }}>{l.details}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Historique des alertes SMS</h2>
        <div className="scroll" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Canal</th><th>Statut</th><th>Message</th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}><td className="nw">{fmtDateTime(a.creeLe)}</td><td>{a.type}</td><td>{a.canal}</td><td>{a.statut}</td><td style={{ whiteSpace: "pre-wrap" }}>{a.message}</td></tr>
              ))}
              {!alerts.length && <tr><td className="empty" colSpan={5}>Aucune alerte pour l&apos;instant (les SMS arrivent à l&apos;étape 4).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
