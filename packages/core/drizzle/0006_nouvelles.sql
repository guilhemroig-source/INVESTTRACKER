CREATE TABLE `news_fetch` (
	`ticker` text NOT NULL,
	`kind` text NOT NULL,
	`debut` text NOT NULL,
	`fin` text NOT NULL,
	`statut` text NOT NULL,
	`nb` integer DEFAULT 0 NOT NULL,
	`appel` text NOT NULL,
	`erreur` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_fetch_pk` ON `news_fetch` (`ticker`,`kind`,`debut`,`fin`);--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`heure` text,
	`kind` text NOT NULL,
	`titre` text NOT NULL,
	`resume` text,
	`source` text,
	`url` text,
	`items` text,
	`themes` text,
	`ton` integer,
	`cle_unique` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_cle` ON `news_items` (`cle_unique`);--> statement-breakpoint
CREATE INDEX `news_ticker_date` ON `news_items` (`ticker`,`date`);