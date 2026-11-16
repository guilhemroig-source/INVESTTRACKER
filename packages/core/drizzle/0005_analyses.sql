CREATE TABLE `analyses` (
	`cle_unique` text PRIMARY KEY NOT NULL,
	`statut` text NOT NULL,
	`pour` integer NOT NULL,
	`contre` integer NOT NULL,
	`neutres` integer NOT NULL,
	`ton` text NOT NULL,
	`date_ref` text,
	`calcule_le` text NOT NULL
);
