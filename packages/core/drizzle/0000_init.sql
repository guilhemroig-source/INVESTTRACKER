CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`canal` text NOT NULL,
	`destinataire` text,
	`message` text NOT NULL,
	`statut` text NOT NULL,
	`erreur` text,
	`cree_le` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collect_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`debut` text NOT NULL,
	`fin` text,
	`statut` text NOT NULL,
	`lignes_lues` integer DEFAULT 0 NOT NULL,
	`lignes_nouvelles` integer DEFAULT 0 NOT NULL,
	`erreur` text,
	`donnees_au` text
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`categorie` text NOT NULL,
	`qui` text NOT NULL,
	`ticker` text NOT NULL,
	`societe` text,
	`operation` text NOT NULL,
	`sens` text NOT NULL,
	`montant_usd` real,
	`fourchette` text,
	`volume` real,
	`prix` real,
	`date_operation` text,
	`date_publication` text NOT NULL,
	`source_url` text,
	`verifie_edgar` integer DEFAULT false NOT NULL,
	`cle_unique` text NOT NULL,
	`cree_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_cle_unique` ON `operations` (`cle_unique`);--> statement-breakpoint
CREATE INDEX `operations_pub` ON `operations` (`date_publication`);--> statement-breakpoint
CREATE INDEX `operations_ticker` ON `operations` (`ticker`);--> statement-breakpoint
CREATE TABLE `raw_13f` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`investisseur` text NOT NULL,
	`fonds` text NOT NULL,
	`trimestre` text NOT NULL,
	`depose_le` text NOT NULL,
	`ticker` text NOT NULL,
	`societe` text,
	`cusip` text,
	`operation` text NOT NULL,
	`variation_actions` real,
	`variation_pct` real,
	`source_url` text,
	`verifie_edgar` integer DEFAULT false NOT NULL,
	`cle_unique` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_13f_cle` ON `raw_13f` (`cle_unique`);--> statement-breakpoint
CREATE TABLE `raw_ark` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`fonds` text NOT NULL,
	`operation` text NOT NULL,
	`ticker` text NOT NULL,
	`montant_usd` real,
	`pct_position` real,
	`pct_etf` real,
	`cle_unique` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_ark_cle` ON `raw_ark` (`cle_unique`);--> statement-breakpoint
CREATE TABLE `raw_congress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`elu` text NOT NULL,
	`chambre` text NOT NULL,
	`etat` text,
	`ticker` text NOT NULL,
	`societe` text,
	`operation` text NOT NULL,
	`montant` text,
	`date_transaction` text,
	`date_declaration` text NOT NULL,
	`perf_pct` real,
	`cle_unique` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_congress_cle` ON `raw_congress` (`cle_unique`);--> statement-breakpoint
CREATE TABLE `raw_congress_members` (
	`elu` text PRIMARY KEY NOT NULL,
	`chambre` text NOT NULL,
	`etat` text,
	`transactions` integer NOT NULL,
	`achats` integer NOT NULL,
	`ventes` integer NOT NULL,
	`derniere_transaction` text
);
--> statement-breakpoint
CREATE TABLE `raw_insider` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`liste` text NOT NULL,
	`depose_le` text NOT NULL,
	`heure_depot` text,
	`date_operation` text,
	`ticker` text NOT NULL,
	`societe` text,
	`initie` text NOT NULL,
	`fonction` text,
	`operation` text NOT NULL,
	`code_transaction` text,
	`prix` real,
	`quantite` real,
	`montant_usd` real,
	`origine` text,
	`source_url` text,
	`verifie_edgar` integer DEFAULT false NOT NULL,
	`cle_unique` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_insider_cle` ON `raw_insider` (`cle_unique`);--> statement-breakpoint
CREATE TABLE `raw_trump` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`operation` text NOT NULL,
	`montant` text,
	`montant_min` real,
	`montant_max` real,
	`date_transaction` text,
	`depose_le` text NOT NULL,
	`cle_unique` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_trump_cle` ON `raw_trump` (`cle_unique`);--> statement-breakpoint
CREATE TABLE `raw_trump_filings` (
	`depose_le` text PRIMARY KEY NOT NULL,
	`periode` text NOT NULL,
	`debut` text,
	`fin` text,
	`transactions` integer NOT NULL,
	`achats` integer NOT NULL,
	`ventes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raw_trump_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`a_jour_au` text NOT NULL,
	`delai_median_jours` real,
	`part_hors_delai_45j` real,
	`premiere_transaction` text,
	`derniere_transaction` text
);
--> statement-breakpoint
CREATE TABLE `raw_trump_tickers` (
	`ticker` text PRIMARY KEY NOT NULL,
	`transactions` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickers` (
	`ticker` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`cusip` text,
	`cik` text,
	`origine` text DEFAULT 'noms_actions.json' NOT NULL
);
