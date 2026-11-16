CREATE TABLE `watch_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`dernier_passage` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`valeur` text NOT NULL,
	`sens` text DEFAULT 'tous' NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL
);
