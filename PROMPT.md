# Prompt pour Claude Code — « Tracker des grands investisseurs »

> À coller tel quel dans Claude Code, depuis un dossier vide contenant ce kit (`data/`, `ui-reference/`, `PROMPT.md`).

---

Je veux que tu construises une application web autonome, « Tracker des grands investisseurs », qui suit et affiche les achats et ventes d'actions déclarés officiellement par :

1. **les super-investisseurs** (formulaires 13F trimestriels à la SEC) : Warren Buffett / Berkshire Hathaway, Bill Gates Foundation Trust, David Tepper / Appaloosa, Stanley Druckenmiller / Duquesne, Bill Ackman / Pershing Square, Carl Icahn, Peter Thiel / Thiel Macro ;
2. **Cathie Wood / ARK Invest** (opérations quotidiennes publiées par ARK) ;
3. **les initiés de sociétés cotées** (formulaires 4 à la SEC), dont **Elon Musk** sur Tesla (TSLA) et SpaceX (SPCX, cotée depuis juin 2026) ;
4. **Donald Trump** (formulaires OGE 278-T) ;
5. **les élus du Congrès US** (déclarations STOCK Act, Chambre et Sénat).

Un prototype existe déjà sous forme de dashboard Claude. Le dossier `data/` contient les données réelles au 7 novembre 2026 au format exact attendu ; `ui-reference/` contient la feuille de style et la structure des sections du prototype, à reprendre. Pars de ces fichiers : le but est de reproduire et d'industrialiser ce qui existe, pas de réinventer.

## 1. Stack et architecture

- **Monorepo simple**, Node.js 20+ et TypeScript.
- `apps/web` : **Next.js** (App Router), rendu côté serveur, **Tailwind** pour le style. Pas d'auth pour l'instant : l'appli tourne en local ou derrière un reverse proxy privé.
- `apps/worker` : scripts de **collecte** (un module par source) lancés par un **cron** (node-cron ou cron système). Toute la logique de collecte est testable à la main : `pnpm collect ark`, `pnpm collect edgar-musk`, `pnpm collect all`.
- **SQLite** (via Prisma ou Drizzle) comme base locale : une table `operations` unifiée + une table par source brute + `tickers` (symbole → nom de société) + `alerts` (historique des notifications). Migration facile vers Postgres plus tard.
- Variables d'environnement dans `.env` (jamais commitées) : `SEC_USER_AGENT`, `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM`, `SMS_TO`, `BARGO_API_KEY` (optionnelle).
- `README.md` complet : installation, lancement, cron, variables, limites connues.

## 2. Modèle de données unifié

Chaque opération, quelle que soit la source, devient une ligne `operations` :

```
id, source ('13F'|'ARK'|'FORM4'|'TRUMP'|'CONGRES'), categorie (libellé affiché),
qui (nom de l'investisseur / initié / élu, avec fonction ou État entre parenthèses),
ticker, societe, operation ('Achat'|'Vente'|'Renforcement'|'Nouvelle position'|'Allègement'|'Sortie totale'|'Exercice d'options'|'Attribution'|'Don'|...),
sens ('achat'|'vente'),
montant_usd (nombre exact ou null), fourchette (texte ex. "$15,001 - $50,000" ou null),
volume (nombre d'actions, signé si connu, ou null),
prix (ou null), date_operation, date_publication,
source_url (lien vers la déclaration officielle quand il existe), verifie_edgar (bool),
cle_unique (pour dédoublonner entre deux collectes)
```

Les fichiers de `data/` montrent le format de chaque source ; écris un **adaptateur par source** qui convertit vers ce modèle. Les clés JSON de `data/` (en français : `depose_le`, `date_operation`, `montant_usd`, `quantite`, `operation`, etc.) sont la référence.

## 3. Sources et collecte (du plus fiable au moins fiable)

**Règle d'or : SEC EDGAR est la source de vérité pour les initiés et les 13F.** Les sites intermédiaires servent à lister vite ; EDGAR sert à vérifier et à compléter. Respecte la politique d'accès de la SEC : en-tête `User-Agent` avec un nom et un e-mail de contact (`SEC_USER_AGENT`), max 10 requêtes/seconde, mise en cache locale.

### 3.1 SEC EDGAR (officiel)
- **Recherche plein texte** (JSON) : `https://efts.sec.gov/LATEST/search-index?q="<mot>"&forms=4&ciks=<CIK>&dateRange=custom&startdt=AAAA-MM-JJ&enddt=AAAA-MM-JJ`. Les hits donnent `adsh` (n° d'accession), `display_names` (avec CIK), `file_date`, `period_ending`, `_id` (nom du fichier après « : »).
- **Document** : `https://www.sec.gov/Archives/edgar/data/<CIK émetteur sans zéros de tête>/<adsh sans tirets>/<fichier>`.
- **Formulaire 4 (XML)** : parse `nonDerivativeTable` et `derivativeTable` : `transactionDate`, `transactionCode` (P achat, S vente, A attribution, D renonciation/cession à l'émetteur, G don, M exercice d'option, F retenue d'actions, C conversion, J autre), `transactionShares`, `transactionPricePerShare`, `sharesOwnedFollowingTransaction`, `directOrIndirectOwnership`, footnotes. Traduire les codes en libellés français clairs (voir `data/tesla_insiders.json` et `data/spacex_musk.json`).
- **13F-HR (XML information table)** : `nameOfIssuer`, `titleOfClass`, `cusip`, `value`, `sshPrnamt`. Calculer les mouvements par différence entre deux trimestres consécutifs (nouvelle position, renforcement, allègement, sortie totale) ; mapper CUSIP → ticker (table locale, complétée au fil de l'eau).
- **CIK connus** : Elon Musk 0001494730 ; Tesla 0001318605 ; SpaceX 0001181412 ; Berkshire Hathaway 0001067983. Pour les autres fonds, trouver le CIK via une recherche plein texte sur le nom avec `forms=13F-HR`.
- Collecte quotidienne : (a) tous les formulaires 4 de Musk (Tesla et SpaceX) ; (b) détection d'un nouveau 13F-HR pour chaque fonds suivi ; (c) vérification des 2 plus gros mouvements d'initiés du jour relevés chez l'intermédiaire.

### 3.2 ARK Invest (publié par le gestionnaire lui-même)
- ARK publie chaque soir ses opérations ; la page agrégée la plus pratique est `https://cathiesark.com/ark-funds-combined/trades` (date, fonds ARKK/ARKW/ARKG/ARKQ/ARKF/ARKX, Buy/Sell, ticker, montant estimé, % de la position, % de l'ETF). Si ARK propose un flux direct (e-mail quotidien ou fichier), privilégie-le. Format cible : `data/ark_trades.json`.

### 3.3 Initiés (liste rapide)
- `http://openinsider.com/latest-insider-trading` : table HTML (filing date, trade date, ticker, company, insider, title, trade type P/S/S+OE, price, qty, owned, value). Ne garder que |valeur| > 1 000 000 $. Format cible : `data/insider_trades.json`. Vérifier ensuite sur EDGAR (3.1).
- Tesla : `http://openinsider.com/screener?s=TSLA&fd=730&xp=1&xs=1&cnt=100` + fusion avec les formulaires 4 de Musk lus sur EDGAR (OpenInsider n'affiche que les achats/ventes et omet attributions, dons, exercices d'options). Format cible : `data/tesla_insiders.json`.

### 3.4 Super-investisseurs (liste rapide)
- `https://www.insiderset.com/investors` (date du dernier 13F de chacun) puis `https://www.insiderset.com/investor/<slug>/activity/<qN-AAAA>` (Buy / Buy - Position Entry / Sell / Sell - Position Exit, change qty, % change). Slugs : `warren-buffett-berkshire-hathaway`, `bill-gates-bill-and-melinda-gates-foundation-trust`, `david-tepper-appaloosa`, `stanley-druckenmiller-duquesne-family-office`, `bill-ackman-pershing-square-capital-management`, `carl-icahn-icahn`, `thiel-macro-llc`. **Ne pas utiliser leur colonne « Value » (non fiable)**. Vérifier les quantités sur l'information table EDGAR. Format cible : `data/superinvestors_13f.json`. Les 13F du 3e trimestre 2026 sont attendus avant le 16 novembre 2026.

### 3.5 Donald Trump (OGE 278-T)
- Les originaux sont des PDF scannés sur le portail OGE (`extapps2.oge.gov`) : illisibles par machine. Utiliser la retranscription de `https://getsignal.finance/president/donald-trump` (tableau des déclarations, 150 dernières transactions, top tickers, délai médian) et recouper le nombre de transactions avec `https://open-cabinet.org/officials/trump-donald-j`. Format cible : `data/trump_*.json`. Montants en fourchettes légales.

### 3.6 Congrès US (STOCK Act)
- API gratuite Bargo : `https://www.bargo.ai/free-apis/congress/v1/trades?limit=50` et `.../members` (JSON ; sans clé : 30 requêtes et 100 lignes/jour ; une clé gratuite sur `https://www.bargo.ai/free-apis/dash` relève les quotas ; attribution « Bargo » obligatoire). Format cible : `data/congress_trades.json` et `data/congress_members.json`. En secours, les portails officiels `disclosures-clerk.house.gov` et `efdsearch.senate.gov`.

### 3.7 Noms des sociétés
- Table `tickers` initialisée depuis `data/noms_actions.json` ; compléter automatiquement tout nouveau symbole (EDGAR `company_tickers.json` de la SEC est une bonne source : `https://www.sec.gov/files/company_tickers.json`).

## 4. Interface (reprendre le prototype)

Style **terminal de trading, entièrement sombre**, à reprendre de `ui-reference/style-terminal.css` et `ui-reference/layout-sections.html` :
- fond `#05080d`, panneaux `#0b1119`, bordures `#1a2331`, texte `#dbe3ee`, gris `#7d8a9a` ; vert néon `#22e584` pour les achats, rouge `#ff5c5c` pour les ventes, ambre `#ffb547` pour les symboles boursiers ; police monospace pour les chiffres, tableaux, onglets et titres de cartes (préfixés `// `), serif pour le grand titre ;
- en-tête : point vert clignotant « LIVE · déclarations officielles SEC · OGE · Congrès », barre d'état avec horloges UTC / New York / Paris en direct et état « NYSE · Ouvert/Fermé » (9h30–16h00 heure de New York, hors week-end), grand titre « Ce que les grands investisseurs achètent et vendent » avec curseur clignotant, phrase d'accroche avec la dernière publication captée ;
- **bandeau défilant** (ticker tape) sous l'en-tête : les 40 dernières opérations (▲/▼, symbole, qui, montant), en boucle, pause au survol ;
- effet CRT discret (scanlines) et grille fine dans l'en-tête ;
- **6 onglets** : Alertes récentes (fil unifié trié par date de publication, recherche, filtres source et achat/vente, 8 lignes les plus récentes mises en surbrillance), Super-investisseurs (tuiles, « achetées par plusieurs investisseurs », mouvements par investisseur avec sélecteur), Cathie Wood (tuiles de la dernière séance, graphique achats nets par action, table des opérations), Initiés & Musk (tuiles plus gros achat/vente, table des gros mouvements, table Tesla, table SpaceX), Donald Trump (tuiles, graphique par déclaration, top actions, 150 dernières), Congrès US (tuiles, élus les plus actifs, dernières transactions avec perf.) ;
- dans **toutes** les tables : symbole boursier en badge ambre monospace **suivi du nom réel de la société**, opération en pastille verte/rouge, montants formatés (`fr-FR`, $ compact), dates en français ;
- pied de page repliable « D'où viennent les données, et avec quel délai » reprenant les délais légaux (initiés 2 jours ouvrés, ARK 1 jour, 13F jusqu'à 45 jours, Trump ~60 jours en médiane, Congrès jusqu'à 45 jours) et le rappel « rien ici n'est un conseil d'investissement » ;
- responsive mobile (colonnes secondaires masquées sous 640 px).

Graphiques : d3 v7 (ou Recharts si tu préfères), couleurs vert/rouge ci-dessus.

## 5. Alertes

- **SMS quotidien à 7h47 (Europe/Paris), tous les jours**, même sans nouveauté : « Investisseurs JJ/MM : » + ALERTE (nouveau 13F d'un fonds suivi, nouvelle déclaration de Trump, nouvelle déclaration de Musk Tesla/SpaceX) + « Hier » (3 plus gros mouvements ARK, 3 plus gros mouvements d'initiés, nombre de nouvelles transactions d'élus) ou « Rien de nouveau hier » + rappel de la prochaine échéance ; « Source X indisponible » si une collecte a échoué ; lien vers l'appli. Moins de 600 caractères, sans accents.
- Fournisseur SMS **configurable** : implémente une interface `SmsProvider` avec deux adaptateurs, **Allo** (`https://allo.ai`, API REST — c'est mon opérateur actuel ; expéditeur `[numéro expéditeur]`, destinataire `[numéro destinataire]`) et **Twilio** en secours. Tant que les clés ne sont pas renseignées, logguer le SMS dans la console et dans la table `alerts`.
- Option : alerte **immédiate** (hors 7h47) quand un formulaire 4 de Musk ou un 13F d'un fonds suivi apparaît sur EDGAR (vérification toutes les heures en journée américaine).

## 6. Qualité

- Tests unitaires sur les parseurs (formulaire 4 XML, 13F XML, tableaux HTML) à partir de fixtures réelles : télécharge et stocke dans `fixtures/` le formulaire 4 Musk/Tesla du 17 juin 2026 (`https://www.sec.gov/Archives/edgar/data/1318605/000110465926075213/tm2618092-2_4seq1.xml`), le formulaire 4 Musk/SpaceX (`https://www.sec.gov/Archives/edgar/data/1181412/000162828026044069/wk-form4_1781740812.xml`) et l'information table 13F Berkshire T2 2026 (`https://www.sec.gov/Archives/edgar/data/1067983/000119312526352200/56757.xml`).
- Dédoublonnage strict entre collectes (clé unique par source).
- Journal de collecte (date, source, lignes nouvelles, erreurs) visible dans une page `/admin`.
- Aucune ligne inventée : si une source est indisponible, l'appli affiche la dernière donnée connue avec sa date, jamais un chiffre estimé.

## 7. Livraison

Procède par étapes et montre-moi le résultat à chaque étape : (1) squelette + base + import de `data/` + UI complète sur ces données ; (2) collecteurs ARK, OpenInsider, EDGAR Musk ; (3) collecteurs 13F (insiderset + vérification EDGAR), Trump, Congrès ; (4) cron + SMS ; (5) tests + README. Commence par l'étape 1 et lance l'appli en local pour que je la voie.
