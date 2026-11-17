CREATE TABLE `evenements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cle` text NOT NULL,
	`date` text NOT NULL,
	`heure` text,
	`ticker` text,
	`type` text NOT NULL,
	`titre` text NOT NULL,
	`details` text,
	`source` text NOT NULL,
	`url` text,
	`collecte_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evenements_cle` ON `evenements` (`cle`);--> statement-breakpoint
CREATE INDEX `evenements_date` ON `evenements` (`date`);