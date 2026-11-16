import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/** Source d'une opération dans le modèle unifié. */
export const SOURCES = ["13F", "ARK", "FORM4", "TRUMP", "CONGRES"] as const;
export type Source = (typeof SOURCES)[number];

const createdAt = () => text("cree_le").notNull().$defaultFn(() => new Date().toISOString());

/** Table unifiée : une ligne par opération, quelle que soit la source. */
export const operations = sqliteTable(
  "operations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: SOURCES }).notNull(),
    categorie: text("categorie").notNull(),
    qui: text("qui").notNull(),
    ticker: text("ticker").notNull(),
    societe: text("societe"),
    operation: text("operation").notNull(),
    sens: text("sens", { enum: ["achat", "vente"] }).notNull(),
    /** Montant absolu en dollars (le sens donne la direction), ou null. */
    montantUsd: real("montant_usd"),
    fourchette: text("fourchette"),
    /** Nombre d'actions, signé (négatif = cession) si connu. */
    volume: real("volume"),
    prix: real("prix"),
    dateOperation: text("date_operation"),
    datePublication: text("date_publication").notNull(),
    sourceUrl: text("source_url"),
    verifieEdgar: integer("verifie_edgar", { mode: "boolean" }).notNull().default(false),
    cleUnique: text("cle_unique").notNull(),
    creeLe: createdAt(),
  },
  (t) => [
    uniqueIndex("operations_cle_unique").on(t.cleUnique),
    index("operations_pub").on(t.datePublication),
    index("operations_ticker").on(t.ticker),
  ],
);

export const tickers = sqliteTable("tickers", {
  ticker: text("ticker").primaryKey(),
  nom: text("nom").notNull(),
  cusip: text("cusip"),
  cik: text("cik"),
  origine: text("origine").notNull().default("noms_actions.json"),
});

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'quotidien' | 'immediat'
  canal: text("canal").notNull(), // 'console' | 'allo' | 'twilio'
  destinataire: text("destinataire"),
  message: text("message").notNull(),
  statut: text("statut").notNull(), // 'envoye' | 'logue' | 'erreur'
  erreur: text("erreur"),
  creeLe: createdAt(),
});

/** Journal de collecte, visible sur /admin. */
export const collectLog = sqliteTable("collect_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  debut: text("debut").notNull(),
  fin: text("fin"),
  statut: text("statut").notNull(), // 'ok' | 'erreur'
  lignesLues: integer("lignes_lues").notNull().default(0),
  lignesNouvelles: integer("lignes_nouvelles").notNull().default(0),
  erreur: text("erreur"),
  /** Date de la donnée la plus récente obtenue par cette collecte. */
  donneesAu: text("donnees_au"),
  /** Détails lisibles (une ligne par élément : vérifications, secours, avertissements). */
  details: text("details"),
});

// ---------- Tables brutes, une par source (format de data/) ----------

export const rawArk = sqliteTable(
  "raw_ark",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    fonds: text("fonds").notNull(),
    operation: text("operation").notNull(),
    ticker: text("ticker").notNull(),
    montantUsd: real("montant_usd"),
    pctPosition: real("pct_position"),
    pctEtf: real("pct_etf"),
    /** Nombre d'actions échangées, déduit des fichiers de positions publiés par ARK (null si pas encore recoupé). */
    actions: real("actions"),
    origine: text("origine").notNull().default("cathiesark"),
    cleUnique: text("cle_unique").notNull(),
  },
  (t) => [uniqueIndex("raw_ark_cle").on(t.cleUnique)],
);

/** Positions quotidiennes publiées par ARK (CSV par fonds), pour recouper les opérations. */
export const rawArkHoldings = sqliteTable(
  "raw_ark_holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    fonds: text("fonds").notNull(),
    ticker: text("ticker").notNull(),
    cusip: text("cusip"),
    societe: text("societe"),
    actions: real("actions").notNull(),
    valeurUsd: real("valeur_usd"),
    poidsPct: real("poids_pct"),
  },
  (t) => [uniqueIndex("raw_ark_holdings_cle").on(t.date, t.fonds, t.ticker, t.cusip)],
);

/** Formulaires 4 : OpenInsider (gros mouvements) + EDGAR (Tesla, SpaceX). */
export const rawInsider = sqliteTable(
  "raw_insider",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    liste: text("liste").notNull(), // 'gros' | 'tesla' | 'spacex'
    deposeLe: text("depose_le").notNull(),
    heureDepot: text("heure_depot"),
    dateOperation: text("date_operation"),
    ticker: text("ticker").notNull(),
    societe: text("societe"),
    initie: text("initie").notNull(),
    fonction: text("fonction"),
    operation: text("operation").notNull(),
    codeTransaction: text("code_transaction"),
    prix: real("prix"),
    quantite: real("quantite"),
    montantUsd: real("montant_usd"),
    origine: text("origine"),
    /** N° d'accession EDGAR de la déclaration (ex. 0001104659-26-075213) quand il est connu. */
    accession: text("accession"),
    insiderCik: text("insider_cik"),
    /** Clé de la déclaration (symbole|déclarant|date de dépôt) : une déclaration n'est importée que par une source. */
    cleDeclaration: text("cle_declaration"),
    sourceUrl: text("source_url"),
    verifieEdgar: integer("verifie_edgar", { mode: "boolean" }).notNull().default(false),
    cleUnique: text("cle_unique").notNull(),
  },
  (t) => [uniqueIndex("raw_insider_cle").on(t.cleUnique), index("raw_insider_decl").on(t.cleDeclaration), index("raw_insider_acc").on(t.accession)],
);

export const raw13f = sqliteTable(
  "raw_13f",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    investisseur: text("investisseur").notNull(),
    fonds: text("fonds").notNull(),
    trimestre: text("trimestre").notNull(),
    deposeLe: text("depose_le").notNull(),
    ticker: text("ticker").notNull(),
    societe: text("societe"),
    cusip: text("cusip"),
    operation: text("operation").notNull(),
    variationActions: real("variation_actions"),
    variationPct: real("variation_pct"),
    /** Poids de la ligne dans le portefeuille déclaré (%) et rang, d'après la table d'information EDGAR. */
    poidsPct: real("poids_pct"),
    rang: integer("rang"),
    sourceUrl: text("source_url"),
    verifieEdgar: integer("verifie_edgar", { mode: "boolean" }).notNull().default(false),
    cleUnique: text("cle_unique").notNull(),
  },
  (t) => [uniqueIndex("raw_13f_cle").on(t.cleUnique)],
);

/** Fonds suivis (13F) : CIK résolu sur EDGAR et dernier trimestre connu. */
export const funds = sqliteTable("funds", {
  slug: text("slug").primaryKey(),
  investisseur: text("investisseur").notNull(),
  fonds: text("fonds").notNull(),
  cik: text("cik"),
  dernierTrimestre: text("dernier_trimestre"),
  dernierDepot: text("dernier_depot"),
});

export const rawTrump = sqliteTable(
  "raw_trump",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticker: text("ticker").notNull(),
    operation: text("operation").notNull(),
    montant: text("montant"),
    montantMin: real("montant_min"),
    montantMax: real("montant_max"),
    /** Nom tel que déclaré, quand le symbole n'a pas pu être vérifié par la source. */
    nomDeclare: text("nom_declare"),
    nonVerifie: integer("non_verifie", { mode: "boolean" }).notNull().default(false),
    dateTransaction: text("date_transaction"),
    deposeLe: text("depose_le").notNull(),
    cleUnique: text("cle_unique").notNull(),
  },
  (t) => [uniqueIndex("raw_trump_cle").on(t.cleUnique)],
);

export const rawTrumpFilings = sqliteTable("raw_trump_filings", {
  deposeLe: text("depose_le").primaryKey(),
  periode: text("periode").notNull(),
  debut: text("debut"),
  fin: text("fin"),
  transactions: integer("transactions").notNull(),
  achats: integer("achats").notNull(),
  ventes: integer("ventes").notNull(),
});

export const rawTrumpTickers = sqliteTable("raw_trump_tickers", {
  ticker: text("ticker").primaryKey(),
  transactions: integer("transactions").notNull(),
});

export const rawTrumpMeta = sqliteTable("raw_trump_meta", {
  id: integer("id").primaryKey(),
  aJourAu: text("a_jour_au").notNull(),
  delaiMedianJours: real("delai_median_jours"),
  partHorsDelai45j: real("part_hors_delai_45j"),
  premiereTransaction: text("premiere_transaction"),
  derniereTransaction: text("derniere_transaction"),
});

export const rawCongress = sqliteTable(
  "raw_congress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    elu: text("elu").notNull(),
    chambre: text("chambre").notNull(),
    etat: text("etat"),
    ticker: text("ticker").notNull(),
    societe: text("societe"),
    operation: text("operation").notNull(),
    montant: text("montant"),
    dateTransaction: text("date_transaction"),
    dateDeclaration: text("date_declaration").notNull(),
    perfPct: real("perf_pct"),
    cleUnique: text("cle_unique").notNull(),
  },
  (t) => [uniqueIndex("raw_congress_cle").on(t.cleUnique)],
);

export const rawCongressMembers = sqliteTable("raw_congress_members", {
  elu: text("elu").primaryKey(),
  chambre: text("chambre").notNull(),
  etat: text("etat"),
  transactions: integer("transactions").notNull(),
  achats: integer("achats").notNull(),
  ventes: integer("ventes").notNull(),
  derniereTransaction: text("derniere_transaction"),
});

/** Cours journaliers ajustés (splits et dividendes), pour l'analyse technique. */
export const prices = sqliteTable(
  "prices",
  {
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
    /** Cours de clôture brut (non ajusté), comparable aux prix des déclarations. */
    closeBrut: real("close_brut"),
  },
  (t) => [uniqueIndex("prices_pk").on(t.ticker, t.date)],
);

/** État de la couverture des cours par action (pour ne télécharger que ce qui manque). */
export const priceStatus = sqliteTable("price_status", {
  ticker: text("ticker").primaryKey(),
  statut: text("statut").notNull(), // 'ok' | 'introuvable' | 'erreur'
  premiereDate: text("premiere_date"),
  derniereDate: text("derniere_date"),
  dernierAppel: text("dernier_appel").notNull(),
  erreur: text("erreur"),
});

/** Synthèse de l'analyse technique de chaque opération (recalculée après chaque mise à jour des cours). */
export const analyses = sqliteTable("analyses", {
  cleUnique: text("cle_unique").primaryKey(),
  statut: text("statut").notNull(), // 'ok' | 'insuffisant'
  pour: integer("pour").notNull(),
  contre: integer("contre").notNull(),
  neutres: integer("neutres").notNull(),
  ton: text("ton").notNull(), // 'coherent' | 'contre' | 'mitige'
  dateRef: text("date_ref"),
  /** Évolution du cours 20 et 60 séances après l'opération (historique de réussite des investisseurs). */
  perf20: real("perf20"),
  perf60: real("perf60"),
  calculeLe: text("calcule_le").notNull(),
});

/** Nouvelles autour des opérations : annonces officielles (8-K sur EDGAR) et articles de presse (GDELT). */
export const newsItems = sqliteTable(
  "news_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticker: text("ticker").notNull(),
    date: text("date").notNull(), // AAAA-MM-JJ
    heure: text("heure"),
    kind: text("kind").notNull(), // 'officiel' | 'presse'
    titre: text("titre").notNull(),
    resume: text("resume"),
    source: text("source"), // domaine du média, ou « SEC EDGAR »
    url: text("url"),
    /** 8-K : codes des rubriques (ex. "2.02,7.01") */
    items: text("items"),
    themes: text("themes"), // liste séparée par des virgules
    ton: integer("ton"), // -1, 0, +1
    cleUnique: text("cle_unique").notNull(),
  },
  (t) => [uniqueIndex("news_cle").on(t.cleUnique), index("news_ticker_date").on(t.ticker, t.date)],
);

/** Fenêtres déjà interrogées, par action et par source (pour ne pas redemander). */
export const newsFetch = sqliteTable(
  "news_fetch",
  {
    ticker: text("ticker").notNull(),
    kind: text("kind").notNull(),
    debut: text("debut").notNull(),
    fin: text("fin").notNull(),
    statut: text("statut").notNull(), // 'ok' | 'erreur' | 'hors-fenetre'
    nb: integer("nb").notNull().default(0),
    appel: text("appel").notNull(),
    erreur: text("erreur"),
  },
  (t) => [uniqueIndex("news_fetch_pk").on(t.ticker, t.kind, t.debut, t.fin)],
);

/** Indicateurs financiers par société, calculés depuis les comptes XBRL publiés par la SEC (companyfacts). */
export const fundamentals = sqliteTable("fundamentals", {
  ticker: text("ticker").primaryKey(),
  cik: text("cik"),
  majLe: text("maj_le").notNull(),
  arrete: text("arrete"), // date du dernier arrêté de comptes
  revenuTtm: real("revenu_ttm"),
  revenuTtmPrec: real("revenu_ttm_prec"),
  netTtm: real("net_ttm"),
  netTtmPrec: real("net_ttm_prec"),
  bpaTtm: real("bpa_ttm"),
  cfoTtm: real("cfo_ttm"),
  capexTtm: real("capex_ttm"),
  tresorerie: real("tresorerie"),
  dette: real("dette"),
  fondsPropres: real("fonds_propres"),
  actions: real("actions"),
  actions1an: real("actions_1an"),
  statut: text("statut").notNull(), // 'ok' | 'indisponible' | 'erreur'
  erreur: text("erreur"),
});

/** Liste de suivi : actions, investisseurs ou seuil de score à surveiller (alertes SMS). */
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // 'action' | 'investisseur' | 'score'
  valeur: text("valeur").notNull(), // symbole, nom d'investisseur, ou seuil de score
  sens: text("sens").notNull().default("tous"), // 'tous' | 'achat' | 'vente'
  actif: integer("actif", { mode: "boolean" }).notNull().default(true),
  creeLe: text("cree_le").notNull().$defaultFn(() => new Date().toISOString()),
});

/** Dernier passage de la vérification de la liste de suivi (pour ne signaler que les nouveautés). */
export const watchState = sqliteTable("watch_state", {
  id: integer("id").primaryKey(),
  dernierPassage: text("dernier_passage").notNull(),
});

/** Mon portefeuille : transactions saisies par l'utilisateur (achat, vente, dividende). */
export const portfolioTx = sqliteTable("portfolio_tx", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  type: text("type").notNull(), // 'achat' | 'vente' | 'dividende'
  ticker: text("ticker").notNull(),
  quantite: real("quantite").notNull().default(0),
  prix: real("prix").notNull().default(0), // prix unitaire en dollars (dividende : montant total)
  frais: real("frais").notNull().default(0),
  compte: text("compte").notNull().default("CTO"), // 'CTO' | 'PEA' | 'Assurance-vie' | 'Autre'
  note: text("note"),
  creeLe: text("cree_le").notNull().$defaultFn(() => new Date().toISOString()),
});

/** Journal de décisions : pourquoi, à quel prix, ce qui ferait changer d'avis, et la revue a posteriori. */
export const journal = sqliteTable("journal", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  ticker: text("ticker").notNull(),
  decision: text("decision").notNull(), // 'achat' | 'renforcement' | 'vente' | 'allegement' | 'attendre' | 'ecarter'
  these: text("these").notNull(),
  invalidation: text("invalidation"),
  objectif: real("objectif"),
  prixDecision: real("prix_decision"),
  conviction: integer("conviction"), // 1 à 5
  dateRevue: text("date_revue"),
  /** Contexte figé au moment de la décision (score smart money, PER, acheteurs…) en JSON. */
  contexte: text("contexte"),
  statut: text("statut").notNull().default("ouverte"), // 'ouverte' | 'revue'
  resultat: text("resultat"), // 'bonne' | 'mauvaise' | 'mitigee'
  lecon: text("lecon"),
  revueLe: text("revue_le"),
  creeLe: text("cree_le").notNull().$defaultFn(() => new Date().toISOString()),
});

/** Réglages simples (clé / valeur), ex. règles de risque du portefeuille. */
export const settings = sqliteTable("settings", {
  cle: text("cle").primaryKey(),
  valeur: text("valeur").notNull(),
});
