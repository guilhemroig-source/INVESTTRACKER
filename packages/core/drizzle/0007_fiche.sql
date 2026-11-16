CREATE TABLE `fundamentals` (
	`ticker` text PRIMARY KEY NOT NULL,
	`cik` text,
	`maj_le` text NOT NULL,
	`arrete` text,
	`revenu_ttm` real,
	`revenu_ttm_prec` real,
	`net_ttm` real,
	`net_ttm_prec` real,
	`bpa_ttm` real,
	`cfo_ttm` real,
	`capex_ttm` real,
	`tresorerie` real,
	`dette` real,
	`fonds_propres` real,
	`actions` real,
	`actions_1an` real,
	`statut` text NOT NULL,
	`erreur` text
);
--> statement-breakpoint
ALTER TABLE `analyses` ADD `perf20` real;--> statement-breakpoint
ALTER TABLE `analyses` ADD `perf60` real;--> statement-breakpoint
ALTER TABLE `raw_13f` ADD `poids_pct` real;--> statement-breakpoint
ALTER TABLE `raw_13f` ADD `rang` integer;