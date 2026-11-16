CREATE TABLE `price_status` (
	`ticker` text PRIMARY KEY NOT NULL,
	`statut` text NOT NULL,
	`premiere_date` text,
	`derniere_date` text,
	`dernier_appel` text NOT NULL,
	`erreur` text
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	`close_brut` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prices_pk` ON `prices` (`ticker`,`date`);