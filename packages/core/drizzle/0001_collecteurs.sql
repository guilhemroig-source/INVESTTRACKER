CREATE TABLE `raw_ark_holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`fonds` text NOT NULL,
	`ticker` text NOT NULL,
	`cusip` text,
	`societe` text,
	`actions` real NOT NULL,
	`valeur_usd` real,
	`poids_pct` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_ark_holdings_cle` ON `raw_ark_holdings` (`date`,`fonds`,`ticker`,`cusip`);--> statement-breakpoint
ALTER TABLE `raw_ark` ADD `actions` real;--> statement-breakpoint
ALTER TABLE `raw_ark` ADD `origine` text DEFAULT 'cathiesark' NOT NULL;--> statement-breakpoint
ALTER TABLE `raw_insider` ADD `accession` text;--> statement-breakpoint
ALTER TABLE `raw_insider` ADD `insider_cik` text;--> statement-breakpoint
ALTER TABLE `raw_insider` ADD `cle_declaration` text;--> statement-breakpoint
CREATE INDEX `raw_insider_decl` ON `raw_insider` (`cle_declaration`);--> statement-breakpoint
CREATE INDEX `raw_insider_acc` ON `raw_insider` (`accession`);