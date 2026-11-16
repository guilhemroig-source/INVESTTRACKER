CREATE TABLE `journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`ticker` text NOT NULL,
	`decision` text NOT NULL,
	`these` text NOT NULL,
	`invalidation` text,
	`objectif` real,
	`prix_decision` real,
	`conviction` integer,
	`date_revue` text,
	`contexte` text,
	`statut` text DEFAULT 'ouverte' NOT NULL,
	`resultat` text,
	`lecon` text,
	`revue_le` text,
	`cree_le` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portfolio_tx` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`ticker` text NOT NULL,
	`quantite` real DEFAULT 0 NOT NULL,
	`prix` real DEFAULT 0 NOT NULL,
	`frais` real DEFAULT 0 NOT NULL,
	`compte` text DEFAULT 'CTO' NOT NULL,
	`note` text,
	`cree_le` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`cle` text PRIMARY KEY NOT NULL,
	`valeur` text NOT NULL
);
