export function Footer() {
  return (
    <details>
      <summary>D&apos;où viennent les données, et avec quel délai</summary>
      <dl>
        <dt>Initiés (formulaire 4, SEC)</dt>
        <dd>Dirigeants, administrateurs et actionnaires de plus de 10 % déclarent chaque opération sous <b>2 jours ouvrés</b>. Liste rapide via OpenInsider, vérification et compléments (attributions, dons, exercices d&apos;options) sur SEC EDGAR, source de vérité.</dd>
        <dt>Cathie Wood / ARK Invest</dt>
        <dd>ARK publie elle-même ses opérations chaque soir : délai de <b>1 jour</b>. Montants estimés au cours de clôture.</dd>
        <dt>Super-investisseurs (13F, SEC)</dt>
        <dd>Portefeuille déclaré chaque trimestre, jusqu&apos;à <b>45 jours</b> après la fin du trimestre. Les mouvements sont calculés par différence entre deux trimestres ; seul le nombre d&apos;actions est fiable, pas le montant.</dd>
        <dt>Donald Trump (OGE 278-T)</dt>
        <dd>Déclarations de transactions publiées par l&apos;Office of Government Ethics, en PDF scannés ; retranscription getsignal.finance, recoupée avec open-cabinet.org. Délai médian constaté <b>~60 jours</b>. Montants en fourchettes légales.</dd>
        <dt>Congrès US (STOCK Act)</dt>
        <dd>Les élus déclarent leurs transactions jusqu&apos;à <b>45 jours</b> après coup, en fourchettes. Données : <a href="https://www.bargo.ai/free-apis" target="_blank" rel="noreferrer">Bargo</a>, d&apos;après les portails officiels de la Chambre et du Sénat.</dd>
      </dl>
      <p style={{ marginTop: 12 }}>
        Rien ici n&apos;est un conseil d&apos;investissement. Aucune ligne n&apos;est estimée : si une source est indisponible, la dernière donnée connue est affichée avec sa date.
      </p>
    </details>
  );
}
