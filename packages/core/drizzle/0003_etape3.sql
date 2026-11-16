CREATE TABLE `funds` (
	`slug` text PRIMARY KEY NOT NULL,
	`investisseur` text NOT NULL,
	`fonds` text NOT NULL,
	`cik` text,
	`dernier_trimestre` text,
	`dernier_depot` text
);
--> statement-breakpoint
ALTER TABLE `raw_trump` ADD `nom_declare` text;--> statement-breakpoint
ALTER TABLE `raw_trump` ADD `non_verifie` integer DEFAULT false NOT NULL;