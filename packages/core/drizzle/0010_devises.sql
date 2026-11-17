CREATE TABLE `actifs_perso` (
	`ticker` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`devise` text DEFAULT 'EUR' NOT NULL,
	`cotation` text DEFAULT 'manuel' NOT NULL,
	`indice` text,
	`pea_eligible` integer DEFAULT false NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `change` (
	`date` text PRIMARY KEY NOT NULL,
	`eurusd` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cours_manuels` (
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`cours` real NOT NULL,
	`devise` text DEFAULT 'EUR' NOT NULL,
	PRIMARY KEY(`ticker`, `date`)
);
--> statement-breakpoint
ALTER TABLE `portfolio_tx` ADD `devise` text DEFAULT 'USD' NOT NULL;