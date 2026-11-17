# Tracker des grands investisseurs

Application web autonome qui suit les achats et ventes d'actions **déclarés officiellement** par :

| Qui | Déclaration | Délai légal de publication |
|---|---|---|
| Super-investisseurs : Buffett, Gates Foundation, Tepper, Druckenmiller, Ackman, Icahn, Thiel | formulaire 13F (SEC), trimestriel | jusqu'à 45 jours après la fin du trimestre |
| Cathie Wood / ARK Invest | publication quotidienne d'ARK | 1 jour |
| Initiés de sociétés cotées, dont Elon Musk (Tesla, SpaceX) | formulaire 4 (SEC) | 2 jours ouvrés |
| Donald Trump | OGE 278-T | ~60 jours en médiane constatée |
| Élus du Congrès | STOCK Act | jusqu'à 45 jours |

Pour chaque opération, l'appli explique le signal selon 8 modèles d'analyse technique, et envoie un SMS récapitulatif chaque matin à 7h47.

> Rien ici n'est un conseil d'investissement. Aucune ligne n'est estimée : si une source est indisponible, l'appli affiche la dernière donnée connue avec sa date.

---

## Sommaire

1. [Démarrage rapide](#1-démarrage-rapide)
2. [Variables d'environnement](#2-variables-denvironnement)
3. [Lancer l'appli et la collecte automatique](#3-lancer-lappli-et-la-collecte-automatique)
4. [Architecture](#4-architecture)
5. [Modèle de données](#5-modèle-de-données)
6. [Sources et collecteurs](#6-sources-et-collecteurs)
7. [Analyse technique et nouvelles de chaque opération](#7-analyse-technique-et-nouvelles-de-chaque-opération)
8. [Alertes SMS](#8-alertes-sms)
9. [Interface](#9-interface)
10. [Tests](#10-tests)
11. [Limites connues](#11-limites-connues)
12. [Dépannage](#12-dépannage)
13. [Passer à Postgres](#13-passer-à-postgres)
14. [Mettre l'appli en ligne](#14-mettre-lappli-en-ligne)

---

## 1. Démarrage rapide

Prérequis : **Node.js 20 ou plus** et **pnpm 10** (`npm install -g pnpm`). Sous Linux, `better-sqlite3` a besoin de `python3`, `make` et `g++` s'il n'existe pas de binaire précompilé pour votre système.

```bash
pnpm install
cp .env.example .env          # puis renseigner au moins SEC_USER_AGENT (voir § 2)
pnpm import-data              # crée var/tracker.db et importe data/*.json (idempotent)
pnpm collect all              # collecte réelle de toutes les sources (~1 min)
pnpm build && pnpm start      # http://localhost:3000
```

En développement : `pnpm dev` (rechargement à chaud).

Pages :
- `http://localhost:3000` : tableau de bord (6 onglets) ;
- `http://localhost:3000/admin` : journal de collecte, état des sources, historique des SMS ;
- `http://localhost:3000/analyse/<clé>` : analyse technique d'une opération en pleine page (aussi visible en dépliant une ligne).

En local, l'appli est ouverte. En ligne, définir `APP_USER` et `APP_PASSWORD` (voir § 14).

---

## 2. Variables d'environnement

Fichier `.env` à la racine (jamais commité ; modèle : `.env.example`).

| Variable | Obligatoire | Rôle |
|---|---|---|
| `SEC_USER_AGENT` | **oui** | Nom et e-mail de contact exigés par la SEC, ex. `"Tracker Jean Dupont jean@exemple.fr"`. Sans elle, les collecteurs EDGAR refusent de démarrer. |
| `TIINGO_API_KEY` | pour l'analyse technique | Clé gratuite sur [tiingo.com](https://www.tiingo.com) (cours journaliers). |
| `TIINGO_MAX_PER_RUN` | non (45) | Nombre d'actions téléchargées par passage (quota gratuit ≈ 50 requêtes/heure). |
| `SMS_PROVIDER` | non (`console`) | `allo`, `twilio` ou `console` (SMS seulement affiché et journalisé). |
| `SMS_API_KEY` | pour envoyer | Clé API Allo, ou `SID:TOKEN` pour Twilio. |
| `SMS_FROM` | pour envoyer | Numéro expéditeur au format international (ligne Allo capable d'envoyer des SMS). |
| `SMS_TO` | pour envoyer | Numéro destinataire au format international. |
| `ALLO_API_URL` | non | Point d'accès d'envoi de SMS Allo (défaut `https://api.withallo.com/v1/api/sms`, **à confirmer**, voir § 11). |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` | non | Secours Twilio si l'envoi principal échoue. |
| `BARGO_API_KEY` | non | Relève les quotas de l'API Congrès (250 lignes par collecte au lieu de 50). |
| `APP_URL` | non | Lien ajouté à la fin des SMS. |
| `DATABASE_PATH` | non | Chemin de la base SQLite (défaut `var/tracker.db`). |
| `APP_USER`, `APP_PASSWORD` | **oui en ligne** | Mot de passe (authentification HTTP) sur toutes les pages, sauf `/api/health`. |
| `NEWS_MAX_8K`, `NEWS_MAX_GDELT` | non (120, 40) | Fenêtres de nouvelles traitées par passage. |
| `FUND_MAX_PER_RUN` | non (80) | Sociétés dont les comptes sont rafraîchis par passage. |
| `PORT` | non (3000) | Port de l'appli web. |

Derrière un proxy d'entreprise, `HTTPS_PROXY` / `HTTP_PROXY` sont pris en compte automatiquement.

---

## 3. Lancer l'appli et la collecte automatique

### Planificateur intégré (recommandé)

```bash
pnpm worker      # process long : à lancer avec pm2, systemd ou screen, à côté de `pnpm start`
```

| Tâche | Quand | Ce qu'elle fait |
|---|---|---|
| Collecte complète | 6h30 et 22h30, heure de Paris | `collect all`. La collecte de 6h30 capte les dépôts américains de la veille (EDGAR accepte les formulaires 4 jusqu'à 22h à New York, 4h à Paris). |
| SMS quotidien | 7h47, heure de Paris, tous les jours | même sans nouveauté (§ 8) |
| Alerte immédiate | toutes les heures, 9h05–17h05 heure de New York, du lundi au vendredi | nouveau formulaire 4 de Musk ou nouveau 13F-HR d'un fonds suivi sur EDGAR |
| Cours | toutes les heures (h+40) | 45 actions par passage (quota Tiingo), puis recalcul des analyses |

Exemple avec pm2 :

```bash
pm2 start "pnpm start" --name tracker-web
pm2 start "pnpm worker" --name tracker-worker
```

### Ou cron système

Serveur réglé sur `Europe/Paris` (`crontab -e`) :

```
30 6,22 * * *    cd /chemin/tracker && pnpm -s collect all  >> var/collect.log 2>&1
47 7 * * *       cd /chemin/tracker && pnpm -s sms envoyer  >> var/sms.log 2>&1
5 15-23 * * 1-5  cd /chemin/tracker && pnpm -s immediat     >> var/immediat.log 2>&1
40 * * * *       cd /chemin/tracker && pnpm -s collect prix >> var/prix.log 2>&1
```

(15h05–23h05 à Paris = 9h05–17h05 à New York, sauf pendant les deux ou trois semaines par an où les changements d'heure ne coïncident pas ; le planificateur intégré n'a pas ce décalage.)

### Commandes manuelles

```bash
pnpm collect                 # liste des collecteurs
pnpm collect <nom>           # un collecteur : tickers, ark, edgar-musk, openinsider, 13f, trump, congres, prix, edgar-insiders
pnpm collect all             # tous (avec secours EDGAR si OpenInsider échoue)
pnpm sms apercu              # affiche le SMS du jour sans l'envoyer
pnpm sms envoyer             # envoie le SMS du jour (ou le journalise si aucune clé)
pnpm sms test                # envoie un SMS de test
pnpm immediat --dry          # vérifie Musk / 13F sur EDGAR sans envoyer
pnpm import-data [dossier]   # (ré)importe un dossier au format de data/
pnpm db:migrate              # applique les migrations (fait aussi automatiquement à l'ouverture)
```

Chaque collecte est journalisée (lignes lues, nouvelles, erreurs, détails) et visible sur `/admin`.

---

## 4. Architecture

```
apps/web         Next.js 15 (App Router, rendu serveur) + Tailwind 4 : tableau de bord, /admin, /analyse, /api/analyse
apps/worker      CLI et planificateur (node-cron) : collecteurs, SMS, alertes immédiates
packages/core    Schéma SQLite (Drizzle) et migrations, adaptateurs par source, parseurs, indicateurs techniques, requêtes
data/            Données de référence au 7 novembre 2026, au format de chaque source (clés JSON en français)
fixtures/        Pages et fichiers réels téléchargés depuis chaque source, pour les tests
ui-reference/    Feuille de style et structure du prototype (reprises dans apps/web/app/globals.css)
var/             Base SQLite (tracker.db) et cache des documents EDGAR (non commités)
```

Flux : **source → parseur → adaptateur → table brute + table `operations` unifiée** (insertion avec dédoublonnage) → interface et SMS.

- Un **parseur** par format (XML de formulaire 4, table d'information 13F, tableaux HTML, JSON embarqué, CSV, API JSON), dans `packages/core/src/parsers/`.
- Un **adaptateur** par source (`packages/core/src/adapters/`) convertit le format de `data/` vers le modèle unifié.
- Les **collecteurs** (`apps/worker/src/collectors/`) téléchargent, parsent, adaptent, vérifient, journalisent.
- Accès réseau : SEC limitée à 8 requêtes/s avec l'en-tête `SEC_USER_AGENT` et un cache local permanent des documents EDGAR (immuables) ; autres sites à 1 requête/s avec l'en-tête honnête `TrackerGrandsInvestisseurs/0.1`. Trois tentatives avec attente croissante sur erreur réseau ou 5xx ; arrêt immédiat sur 429 (quota).

---

## 5. Modèle de données

### Table `operations` (unifiée)

| Colonne | Contenu |
|---|---|
| `source` | `13F`, `ARK`, `FORM4`, `TRUMP`, `CONGRES` |
| `categorie` | libellé affiché : Super-investisseur, ARK, Initié, Tesla / SpaceX, Trump, Congrès |
| `qui` | nom, avec fonction ou État entre parenthèses |
| `ticker`, `societe` | symbole (forme unique : `BRK.B`) et nom de la société |
| `operation`, `sens` | libellé français (Achat, Vente, Renforcement, Nouvelle position, Allègement, Sortie totale, Exercice d'options, Attribution d'actions, Don…) et `achat` / `vente` |
| `montant_usd`, `fourchette` | montant exact (absolu) ou fourchette légale ; jamais les deux, parfois aucun (13F) |
| `volume`, `prix` | nombre d'actions signé, prix par action |
| `date_operation`, `date_publication` | dates ISO |
| `source_url`, `verifie_edgar` | lien vers la déclaration officielle, vérification EDGAR |
| `cle_unique` | clé de dédoublonnage par source |

### Autres tables

- Tables brutes par source : `raw_ark`, `raw_ark_holdings` (positions quotidiennes d'ARK), `raw_insider` (formulaires 4), `raw_13f`, `raw_trump` (+ `raw_trump_filings`, `raw_trump_tickers`, `raw_trump_meta`), `raw_congress` (+ `raw_congress_members`).
- `tickers` : symbole → nom de société (+ CUSIP quand il est connu).
- `funds` : fonds suivis, CIK EDGAR résolu, dernier trimestre connu.
- `prices`, `price_status` : cours journaliers ajustés et état de la couverture par action.
- `analyses` : synthèse de l'analyse technique par opération.
- `alerts` : historique des SMS (envoyés, journalisés ou en erreur).
- `collect_log` : journal de collecte.

### Dédoublonnage

| Source | Clé |
|---|---|
| ARK | date, fonds, symbole, sens |
| Formulaire 4 | symbole, déclarant (ordre des mots indifférent : « Musk Elon » = « Elon Musk »), date d'opération, nombre d'actions signé. En plus, une **déclaration** (symbole + déclarant + date de dépôt) n'est importée que par une seule source, EDGAR faisant foi ; une déclaration déjà lue sur EDGAR (n° d'accession) n'est jamais retéléchargée. |
| 13F | fonds, trimestre, symbole |
| Trump, Congrès | tous les champs + numéro d'ordre parmi les lignes identiques (les déclarations contiennent de vrais doublons ; un nouveau passage n'ajoute que les lignes en plus) |

Modifier le schéma : éditer `packages/core/src/db/schema.ts`, puis `pnpm db:generate` ; la migration s'applique à l'ouverture de la base.

---

## 6. Sources et collecteurs

| Collecteur | Ce qu'il fait | Hôtes |
|---|---|---|
| `tickers` | Noms des sociétés (~10 000) depuis la liste officielle de la SEC | www.sec.gov |
| `ark` | Opérations du jour (cathiesark) + positions quotidiennes publiées par ARK (CSV de chaque fonds). Le nombre exact d'actions de chaque opération est recoupé par différence entre deux jours de positions. Si cathiesark tombe, les opérations sont reconstituées depuis les positions. | cathiesark.com, assets.ark-funds.com |
| `edgar-musk` | Tous les formulaires 4 d'Elon Musk (Tesla, SpaceX) des 2 dernières années, lus en XML sur EDGAR | efts.sec.gov, www.sec.gov |
| `openinsider` | Initiés > 1 M$ du jour + achats/ventes des initiés de Tesla ; vérification sur EDGAR des 2 plus gros mouvements du jour | openinsider.com (HTTP) |
| `edgar-insiders` | **Secours** si OpenInsider est indisponible : lit directement les ~500 formulaires 4 du jour sur EDGAR (~1 min) | efts.sec.gov, www.sec.gov |
| `13f` | Dernier 13F de chaque fonds (insiderset, colonne « Value » ignorée), puis vérification ligne à ligne sur EDGAR par différence entre les tables d'information de deux trimestres. Les mouvements officiels absents d'insiderset sont ajoutés quand leur CUSIP correspond à un symbole connu. Détecte un 13F déposé sur EDGAR avant la mise à jour d'insiderset. | www.insiderset.com, efts.sec.gov, www.sec.gov |
| `trump` | OGE 278-T retranscrits par getsignal (statistiques, déclarations, 150 dernières transactions, top des actions), nombre de transactions de la dernière déclaration recoupé avec open-cabinet | getsignal.finance, open-cabinet.org |
| `congres` | Transactions et classement des élus (API gratuite Bargo, attribution affichée) | www.bargo.ai |
| `prix` | Cours journaliers ajustés pour l'analyse technique et le portefeuille, plus SPY, QQQ et VT (ETF monde) comme références | api.tiingo.com |
| `fondamentaux` | Comptes de chaque société (API XBRL « companyfacts » de la SEC) : chiffre d'affaires, bénéfice et BPA sur 12 mois glissants, flux de trésorerie, dette, trésorerie, nombre d'actions ; rafraîchis chaque semaine | data.sec.gov |
| `news` | Annonces 8-K de chaque société (EDGAR) et articles de presse (GDELT) autour des opérations | efts.sec.gov, www.sec.gov, api.gdeltproject.org |
| `all` | `tickers`, `ark`, `edgar-musk`, `openinsider` (→ `edgar-insiders` si échec), `13f`, `trump`, `congres`, `prix`, `fondamentaux`, `news` | |

### Règles particulières

- **Formulaires 4** : les codes de transaction sont traduits (P achat, S vente, A attribution, D cession à l'émetteur, G don, M/X exercice d'options, F retenue d'actions, C conversion, J autre…). Comme OpenInsider, les lots d'une même déclaration sont regroupés par date et par code (une vente en 40 lots = une ligne au prix moyen pondéré). Montant calculé seulement pour P, S, M, X, F : pour une attribution, le prix déclaré est un prix d'exercice, pas un montant échangé. Musk est collecté exclusivement sur EDGAR, au complet.
- **13F** : CIK des fonds trouvés par recherche plein texte EDGAR (Berkshire : 0001067983) et mémorisés dans `funds` ; amendements (13F-HR/A) ignorés ; options et obligations exclues ; lignes d'un même CUSIP additionnées (plusieurs gérants).
- **Trump** : une ligne « non vérifiée » par la source (symbole déclaré qui ne correspond pas à la société, ex. « WHIRLPOOL CORP » déclaré sous POOL) n'est rattachée à un autre symbole que si le nom déclaré correspond exactement à une seule société connue ; elle garde la mention « non vérifié ».
- **Congrès** : la performance (`perf_pct`) est mise à jour à chaque collecte.

---

## 7. Analyse technique et nouvelles de chaque opération

Cliquer sur une ligne de n'importe quel tableau ouvre l'explication juste en dessous (la colonne « Analyse » en donne le résumé, ex. `5/8`). Les indicateurs sont calculés à la clôture du jour de l'opération (dernier jour du trimestre pour un 13F), sur des cours ajustés :

| # | Modèle | Lecture « pour l'achat » | Lecture « pour la vente » |
|---|---|---|---|
| 01 | RSI 14 (Wilder) | survente (< 30) ou sortie de survente | surachat (> 70) ou sortie de surachat |
| 02 | Moyennes mobiles 20/50/200 | cours au-dessus de moyennes haussières, « golden cross » récent | cours sous des moyennes baissières, « death cross » |
| 03 | MACD 12/26/9 | au-dessus de son signal, croisement récent à la hausse | sous son signal, croisement à la baisse |
| 04 | Bandes de Bollinger 20 j, 2σ | cours sur ou sous la bande basse | cours sur ou au-dessus de la bande haute (+ alerte de resserrement) |
| 05 | Volume vs moyenne 20 j | forte séance de hausse, ou volumes plus forts les jours de hausse | l'inverse |
| 06 | Supports et résistances (pivots sur 6 mois, ≥ 2 contacts) | près d'un support, ou cassure du plus haut de 3 mois | sous une résistance, ou cassure du plus bas |
| 07 | Fibonacci (dernière grande oscillation sur 6 mois) | repli de 38,2–61,8 % dans une hausse | rebond de 38,2–61,8 % dans une baisse, ou cours au sommet |
| 08 | Stochastique 14/3/3 | %K < 20, croisement de %D à la hausse | %K > 80, croisement à la baisse |

L'explication donne aussi :
- un **verdict** : cohérent (au moins 3 signaux d'écart en faveur), à contre-courant, ou mitigé ;
- le **motif probable hors graphique**, selon le type de déclaration : une vente après exercice d'options relève de la rémunération, un achat d'initié sur le marché est un signal fort, un 13F ne donne pas la date exacte, les opérations de Trump ressemblent à une gestion déléguée, etc. ;
- l'évolution du cours **5, 20 et 60 séances après**, et pour un 13F l'évolution sur tout le trimestre.

Les indicateurs décrivent le contexte du cours au moment de l'opération, pas les intentions de l'investisseur.

### Nouvelles qui peuvent expliquer l'opération

Au-dessus de l'analyse technique, la partie « Ce que disaient les nouvelles » rassemble :

- **les annonces officielles** de la société : formulaires 8-K sur EDGAR (60 jours avant à 5 jours après l'opération), avec la rubrique traduite (résultats, accord important, départ de dirigeant…) et le **titre du communiqué de presse joint** (pièce EX-99.1, ex. « American Express raises FY 2026 earnings per share guidance »), sinon la phrase d'annonce du 8-K ;
- **la presse** : articles indexés par GDELT (14 jours avant à 3 jours après), en ne gardant que ceux qui citent la société (nom, surnom usuel, symbole) et quelques articles de marché pour le contexte. Thèmes (résultats, prévisions, analystes, fusion-acquisition, contrat, réglementation, dirigeants, produit, rachat, marché, IA) et tonalité déterminés par des règles lisibles sur les mots des titres ;
- **le contexte de marché** : l'action sur 5 et 20 séances face au S&P 500 (SPY) et au Nasdaq 100 (QQQ), l'écart propre à l'action, la distance au plus haut d'un an ;
- **des hypothèses classées** (confiance forte, moyenne, faible) avec leurs preuves chiffrées : réaction aux résultats (corrigée du mouvement du Nasdaq le même jour), repli ou hausse du marché, décrochage ou surperformance propre à l'action, forte variation sur un mois, actualité spécifique, ou opération de rémunération indépendante de l'actualité ;
- **une chronologie** : annonces, articles (liens vers les sources), fortes séances (avec le Nasdaq du jour) et le jour de l'opération.

Collecteur `news` : fenêtres par lots (`NEWS_MAX_8K`, défaut 120 ; `NEWS_MAX_GDELT`, défaut 40), opérations récentes d'abord ; chaque fenêtre n'est interrogée qu'une fois. GDELT est gratuit et sans clé mais impose une requête toutes les 5 secondes et ne couvre que les **3 derniers mois** : pour les opérations plus anciennes, seules les annonces officielles sont disponibles (l'appli l'indique).

### Fiche action et classement

Sous chaque opération, l'onglet « Fiche » (et l'onglet **Classement** du tableau de bord) réunit, pour l'action :

| Bloc | Indicateurs |
|---|---|
| Score « smart money » (0–100) | acheteurs distincts sur 90 jours (initiés, fonds, ARK : 15 points ; élus : 10 ; Trump : 5 ; plafonné à 45), achats groupés d'initiés (+20, ou +10 pour un seul initié), nouvelles positions de grands fonds (+10 chacune, max 20), renforcement dans le top 10 d'un fonds (+10), vendeurs (−10, −6 ou −3 selon la source, max −30) ; le détail du calcul est affiché |
| Qui achète, qui vend | acteurs distincts sur 90 jours, ventes de rémunération comptées à part, achats d'initiés sur le marché (6 mois, plus grand groupe en 30 jours) |
| Conviction des fonds | dernier 13F de chaque fonds : mouvement, **poids de la ligne dans le portefeuille** et **rang** (d'après la table d'information EDGAR) |
| Arrivez-vous trop tard ? | évolution du cours depuis chaque achat récent |
| Historique de réussite | pour chaque investisseur : évolution moyenne du cours 20 et 60 séances après ses achats suivis ici, part des achats en hausse |
| Valorisation et santé | capitalisation, PER, cours/ventes, chiffre d'affaires et bénéfice sur 12 mois avec croissance, marge nette, flux de trésorerie disponible et rendement, dette nette, dette / fonds propres, rachats ou dilution, avec une lecture en clair |
| Risque et marché | volatilité annuelle, bêta face au S&P 500, pire baisse sur un an, liquidité quotidienne, force relative face au Nasdaq 100 sur 3, 6 et 12 mois, distance au plus haut d'un an |

Le classement trie les ~300 actions traitées ces 90 derniers jours par score (tri possible sur chaque colonne) ; il est calculé à l'ouverture de l'onglet (`/api/classement`). Un score élevé signale l'intérêt des investisseurs suivis, pas une recommandation.

### Portefeuilles miroirs (onglet « Portefeuilles miroirs »)

Pour chaque investisseur : un suiveur qui copie chacun de ses achats **au moment où il est publié** (clôture de la première séance après la publication), avec 1 000 $ par achat, et revend quand l'investisseur publie sa vente (sinon : position gardée jusqu'au dernier cours). Comparaison avec les mêmes montants placés sur le S&P 500 (SPY) aux mêmes dates. Indicateurs : gain du portefeuille, gain du S&P 500, écart moyen par achat, part d'achats gagnants, évolution moyenne à +60 séances, **coût du délai de publication** (gain supplémentaire d'un achat au jour même de l'opération). Détail : courbe face au S&P 500 et liste des positions. Ventes de rémunération exclues ; seuls les achats dont les cours sont disponibles sont simulés.

### Liste de suivi (onglet « Ma liste », boutons « Suivre »)

Trois types de règles : une **action** (achats, ventes ou les deux), un **investisseur**, un **seuil de score smart money**. Après chaque collecte, les nouvelles opérations qui correspondent partent dans un SMS groupé (jamais deux fois la même), et le SMS de 7h47 ajoute « Ta liste : N mouvements ». Les ventes de rémunération ne déclenchent pas d'alerte « investisseur ». Routes : `GET/POST /api/watchlist`, `DELETE /api/watchlist/<id>`.

### Page action (`#action-NVDA`, clic sur n'importe quel symbole)

Cours ajusté (3 mois, 6 mois, 1 an, tout) avec les achats ▲ et ventes ▼ des investisseurs (initiale de la source, filtres par source, infobulle de la journée) et les annonces officielles ◆ ; toutes les opérations sur l'action (dépliables) ; annonces 8-K et presse ; fiche complète ; bouton « Suivre ».

### Mon portefeuille (onglet « Mon portefeuille »)

Vos vraies transactions (achat, vente, dividende ; compte CTO, PEA, assurance-vie ; frais) donnent : positions au prix de revient moyen pondéré frais inclus, gains latents et réalisés, dividendes, poids de chaque ligne, et la **comparaison avec un ETF** (monde VT par défaut, ou S&P 500 / Nasdaq 100) en rejouant chaque achat et chaque vente sur l'ETF pour le même montant et à la même date. Impôt estimé sur le compte-titres (flat tax 30 %). **Règles de risque** réglables (poids maximum d'une ligne, seuil de baisse qui déclenche une revue) ; alertes aussi quand des investisseurs suivis vendent une de vos lignes, quand une décision du journal est à revoir, ou quand une action américaine est déclarée sur un PEA. Les alertes figurent dans le SMS de 7h47. Les cours des actions détenues sont téléchargés même si aucun investisseur suivi ne les détient. Routes : `GET/POST /api/portefeuille`, `DELETE /api/portefeuille/<id>`, `PUT /api/portefeuille/regles`.

### Journal de décisions (onglet « Journal » et chaque page action)

Pour chaque décision (achat, renforcement, vente, allègement, attendre, écarter) : la thèse, ce qui ferait changer d'avis, l'objectif de cours, la conviction (1 à 5) et la date de revue (90 jours par défaut). L'appli fige le contexte du moment (cours, score smart money, PER, acheteurs et vendeurs), mesure la suite face à l'ETF de référence (verdict automatique après 7 jours : un achat est « bon » s'il bat l'ETF, une vente s'il fait moins bien), et rappelle les revues dans le SMS de 7h47. La revue enregistre le résultat et la leçon. Routes : `GET/POST /api/journal`, `PATCH/DELETE /api/journal/<id>`.

Ces deux fonctions, comme la liste de suivi, enregistrent vos données sur votre serveur : elles ne sont pas disponibles dans la page instantanée.

**Cours** : Tiingo (offre gratuite ≈ 50 requêtes/heure, 1 000/jour, 500 symboles/mois). Le collecteur `prix` traite 45 actions par passage, les opérations les plus récentes d'abord, et tourne toutes les heures dans `pnpm worker`. Avec ~385 actions, la première couverture complète prend une dizaine d'heures ; ensuite, seules les séances manquantes sont téléchargées. Un symbole inconnu de Tiingo est réessayé une fois par mois. Les synthèses de la table `analyses` sont recalculées après chaque passage ; le détail est calculé à la demande.

---

## 8. Alertes SMS

### SMS quotidien (7h47, moins de 600 caractères, sans accents)

```
Investisseurs 07/11 : ALERTE Nouveau 13F Warren Buffett (T3 2026) depose le 2026-11-14.
Hier : ARK -TSLA 12,5M, +RKLB 1,7M, +AMD 233k | Inities -INGM 326M, -AXP 99,4M, -RCL 72,4M | Elus 12 nouvelles transactions.
Prochaine echeance : 13F T3 2026 le 16/11. OpenInsider indisponible (secours EDGAR ok). https://…
```

- **ALERTE** : nouveau 13F d'un fonds suivi, nouvelle déclaration de Trump, nouveau formulaire 4 de Musk (Tesla/SpaceX), déposé depuis moins de 3 jours.
- **Hier** : ce qui est arrivé depuis le dernier SMS (ou le dernier import du kit) et a été publié il y a moins de 5 jours : 3 plus gros mouvements ARK, 3 plus gros mouvements d'initiés, nombre de nouvelles transactions d'élus. Sinon « Rien de nouveau hier ».
- **Prochaine échéance** : date limite légale du prochain 13F (45 jours après la fin du trimestre, reportée au jour ouvré suivant de la SEC, jours fériés fédéraux compris).
- Une phrase par source dont la dernière collecte a échoué (« Source trump indisponible »), puis le lien `APP_URL`.
- Au-delà de 600 caractères, les alertes sont résumées, puis le texte est tronqué.

### Alerte immédiate

Pendant la journée américaine, toutes les heures : nouveau formulaire 4 de Musk ou nouveau 13F-HR d'un fonds suivi sur EDGAR. Chaque alerte n'est envoyée qu'une seule fois.

### Fournisseurs

| `SMS_PROVIDER` | Clé | Remarque |
|---|---|---|
| `console` (défaut) | — | SMS affiché et enregistré dans `alerts` (visible sur `/admin`) ; rien n'est envoyé |
| `allo` | `SMS_API_KEY` = clé API Allo | POST JSON `{ from, to, message }`, clé dans l'en-tête `Authorization` |
| `twilio` | `SMS_API_KEY` = `SID:TOKEN` | API Messages de Twilio |

Avec `TWILIO_SID` / `TWILIO_TOKEN` / `TWILIO_FROM`, Twilio prend le relais si l'envoi principal échoue. Chaque tentative est enregistrée dans `alerts`. Pour tester : `pnpm sms test`.

---

## 9. Interface

Style « terminal de trading » repris du prototype (`ui-reference/`) : fond sombre, vert pour les achats, rouge pour les ventes, ambre pour les symboles, chiffres en police monospace, titres de cartes préfixés `// `.

- En-tête : point « LIVE », horloges UTC / New York / Paris en direct, état du NYSE (9h30–16h00 à New York, hors week-end), dernière publication captée.
- Bandeau défilant des 40 dernières opérations (pause au survol), effet CRT discret.
- **Aperçu** en haut de page (repliable, choix mémorisé) : quatre cartes cliquables, avec pour chaque action son cours, sa variation sur un mois et une mini-courbe de 3 mois.
  - **À suivre** : les 6 actions les mieux notées au classement (score > 0) qui ont plus d'acheteurs que de vendeurs parmi les investisseurs suivis (90 jours).
  - **Sous pression vendeuse** : au moins deux vendeurs distincts, plus nombreux que les acheteurs.
  - **Mes actifs** : vos 6 plus grosses positions (plus-value latente, poids, alertes) et le portefeuille comparé à l'ETF ; à défaut, les actions de « Ma liste ».
  - **Les 7 derniers jours** : achats et ventes déclarés, investisseurs actifs, action la plus achetée et la plus vendue, revues du journal et alertes du portefeuille à traiter.
  Données servies par `GET /api/apercu` (`getApercu` dans `packages/core/src/apercu-store.ts`).
- **11 onglets** : Alertes récentes (fil unifié, recherche, filtres, 8 lignes les plus récentes en surbrillance) · Super-investisseurs · Cathie Wood · Initiés & Musk · Donald Trump · Congrès US · Classement · Portefeuilles miroirs · Ma liste · Mon portefeuille · Journal ; et une page par action.
- Dans toutes les tables : symbole en badge suivi du nom réel de la société, opération en pastille verte ou rouge, montants `fr-FR`, dates en français, badge « EDGAR ↗ » vers la déclaration officielle, ligne dépliable avec l'analyse technique.
- Ligne « Données au … · dernière collecte réussie le … » sur chaque onglet ; mention explicite si la dernière collecte a échoué.
- Pied de page « D'où viennent les données, et avec quel délai ».
- Responsive : colonnes secondaires masquées sous 640 px, panneaux d'analyse à la largeur de l'écran.

---

## 10. Tests

```bash
pnpm test        # 110 tests (vitest) dans les 3 paquets
pnpm typecheck   # TypeScript strict
```

| Paquet | Ce qui est testé |
|---|---|
| `packages/core` | **Parseurs sur fixtures réelles** : formulaires 4 Musk/Tesla (17 juin 2026) et Musk/SpaceX, table d'information 13F de Berkshire T2 2026, page insiderset, page cathiesark, CSV ARKK, pages getsignal et open-cabinet, JSON Bargo. Import du kit (470 opérations) et **dédoublonnage strict** (second import = 0 ligne). Adaptateurs et clés. Échéance des 13F (week-ends, jours fériés fédéraux). **Indicateurs** (dont le RSI de référence de Wilder, 70,46) et analyse d'opérations sur séries synthétiques. |
| `apps/worker` | SMS quotidien (alertes, « Rien de nouveau hier », sources en panne, limite de 600 caractères, sans accents), fournisseurs Allo et Twilio (format des requêtes, secours). Recoupement ARK et mode secours. Collecteur de cours avec réponses HTTP simulées (quota, symbole inconnu, pas de retéléchargement). Rattachement des lignes Trump « non vérifiées ». |
| `apps/web` | Formatage `fr-FR` (montants compacts, fourchettes, dates, noms SEC). |

Les tests écrivent dans des bases SQLite jetables, jamais dans `var/tracker.db`, et ne font aucun appel réseau.

La fixture OpenInsider (`fixtures/openinsider-latest.SYNTHETIQUE.html`) est **synthétique** : le site n'était pas joignable depuis l'environnement de développement. Pour la remplacer par une capture réelle :

```bash
curl -s http://openinsider.com/latest-insider-trading > fixtures/openinsider-latest.html
```

---

## 11. Limites connues

**À vérifier à la première mise en service**
- **OpenInsider** n'a jamais pu être testé en réel (site en HTTP simple, injoignable depuis l'environnement de développement). Le parseur repère les colonnes par leur en-tête ; s'il échoue, le journal l'indique et le secours `edgar-insiders` prend le relais.
- **Allo** : l'API d'Allo ne documente pas publiquement son point d'envoi de SMS ; `ALLO_API_URL` vaut par défaut `https://api.withallo.com/v1/api/sms`. Lancer `pnpm sms test` ; en cas d'échec, l'erreur exacte est sur `/admin` et il suffit d'ajuster la variable.

**Sources**
- Les sites intermédiaires (cathiesark, OpenInsider, insiderset, getsignal, open-cabinet) sont lus en HTML : un changement de mise en page casse le parseur. Le collecteur échoue alors explicitement, le SMS le signale, et l'appli continue d'afficher la dernière donnée connue.
- **ARK** : montants arrondis par cathiesark (ex. 42,3 k$) ; le nombre exact d'actions n'est recoupé qu'à partir du 2e jour de positions collectées.
- **13F** : la date exacte des achats et ventes dans le trimestre est inconnue. Certains mouvements officiels ne sont pas repris quand leur CUSIP n'est associé à aucun symbole connu (signalés dans le journal). Pershing Square (Ackman) n'avait pas de 13F du 2e trimestre 2026 ni sur insiderset ni sur EDGAR au moment du développement.
- **Trump** : dépend de la retranscription de getsignal (les originaux OGE sont des PDF scannés) ; seules les 150 dernières transactions sont détaillées, les totaux viennent des statistiques de la page.
- **Congrès** : l'API gratuite de Bargo couvre les 3 derniers mois ; sans clé, 100 lignes par jour.
- **Cours** : quota gratuit Tiingo (≈ 50 requêtes/heure, 500 symboles par mois). Quelques symboles exotiques des déclarations (ex. `UHALB`, `HONAV`) sont inconnus de Tiingo : pas d'analyse pour ces lignes. Stooq n'est pas utilisé (protégé par une vérification anti-robot).
- Les fonctions des déclarants lues sur EDGAR sont en anglais (« Chief Financial Officer »), celles du kit en français.

**Fonctionnement**
- Authentification simple (un identifiant et un mot de passe partagés via `APP_USER` / `APP_PASSWORD`) ; pas de comptes multiples.
- Comptes : seules les sociétés publiant en normes américaines (US GAAP) ont des ratios ; banques, foncières et sociétés financières donnent des ratios atypiques (l'appli l'indique).
- Nouvelles : thèmes et tonalité par mots-clés (pas d'IA) ; la recherche plein texte de GDELT ramène du bruit, filtré en ne gardant que les titres qui citent la société ; archive de presse limitée aux 3 derniers mois.
- SQLite en mode WAL : l'appli lit pendant que le worker écrit ; un seul worker à la fois.
- Le cache des documents EDGAR (`var/cache/`) grossit avec le temps (quelques Mo par mois) ; il peut être vidé sans risque.

---

## 12. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `SEC_USER_AGENT manquant ou invalide` | variable absente ou e-mail `example.com` | renseigner un vrai nom et e-mail |
| `HTTP 403` sur sec.gov | en-tête refusé ou trop de requêtes | vérifier `SEC_USER_AGENT` ; attendre 10 minutes |
| `openinsider.com injoignable` | site en panne, ou réseau bloquant le HTTP | le secours EDGAR prend le relais automatiquement |
| « Quota Tiingo atteint » | quota horaire | rien à faire : reprise au passage suivant |
| « Cours pas encore disponibles » sous une opération | action pas encore téléchargée | attendre les passages horaires de `prix`, ou `pnpm collect prix` |
| SMS « non envoyé, aucune clé configurée » | `SMS_PROVIDER` ou `SMS_API_KEY` vide | renseigner `.env`, puis `pnpm sms test` |
| `Could not locate the bindings file` (better-sqlite3) | module natif non compilé | `pnpm rebuild better-sqlite3` |
| Base corrompue ou à repartir de zéro | — | supprimer `var/tracker.db*`, puis `pnpm import-data && pnpm collect all` |

---

## 13. Passer à Postgres

Le schéma est écrit avec Drizzle. Pour migrer :

1. traduire `packages/core/src/db/schema.ts` de `drizzle-orm/sqlite-core` vers `drizzle-orm/pg-core` (`sqliteTable` → `pgTable`, `integer(..., { mode: "boolean" })` → `boolean`, `real` → `doublePrecision`) ;
2. remplacer `better-sqlite3` par `postgres` (ou `pg`) dans `packages/core/src/db/client.ts`, et passer en asynchrone les quelques appels synchrones (`.all()`, `.get()`, `.run()`, transactions) ;
3. régénérer les migrations (`dialect: "postgresql"` dans `drizzle.config.ts`) ;
4. réimporter : `pnpm import-data && pnpm collect all`.

Les quelques requêtes SQL brutes (`queries.ts`, `analysis-store.ts`, collecteurs `ark` et `prix`) sont en SQL standard, à l'exception de `INSERT … ON CONFLICT`, pris en charge par les deux bases.

---

## 14. Mettre l'appli en ligne

Le dépôt contient tout le nécessaire : `Dockerfile` (appli web + planificateur dans un seul conteneur), `scripts/start-all.mjs` (au premier démarrage : import du kit puis collecte complète), `railway.json` et `render.yaml`. La base vit sur un **volume persistant monté en `/data`**.

### Railway (recommandé, ~5 $/mois)

1. Sur [railway.com](https://railway.com) : *New Project* → *Deploy from GitHub repo* → choisir ce dépôt (Railway lit `railway.json` et construit le `Dockerfile`).
2. Dans le service : *Settings* → *Volumes* → *Add volume*, point de montage **`/data`**.
3. *Variables* : `SEC_USER_AGENT`, `APP_USER`, `APP_PASSWORD`, `TIINGO_API_KEY`, et pour les SMS `SMS_PROVIDER`, `SMS_API_KEY`, `APP_URL` (l'adresse publique, après l'étape 4).
4. *Settings* → *Networking* → *Generate Domain* : l'appli est en ligne, protégée par le mot de passe.

### Render

*New +* → *Blueprint* → choisir ce dépôt : `render.yaml` crée le service Docker et un disque de 1 Go monté en `/data` (offre *Starter*, le disque persistant n'existe pas en gratuit). Renseigner les variables marquées « sync: false ».

### Ailleurs (VPS, NAS, serveur maison)

```bash
docker build -t tracker-investisseurs .
docker run -d --name tracker -p 3000:3000 -v tracker-data:/data --env-file .env --restart unless-stopped tracker-investisseurs
```

Le contrôle de santé est `GET /api/health` (sans mot de passe). Les deux processus (web et planificateur) tournent dans le même conteneur : si l'un s'arrête, le conteneur s'arrête et l'hébergeur le relance.

### Page instantanée

`pnpm --filter @tracker/web snapshot sortie.html` (après `pnpm build`) produit une page HTML autonome de ~2 Mo : tableau de bord, analyses techniques calculées dans le navigateur et nouvelles précalculées, figés à la date de génération.
