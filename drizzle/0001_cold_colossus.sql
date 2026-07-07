CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_name_unique` ON `locations` (`name`);--> statement-breakpoint
ALTER TABLE `projects` ADD `location_id` integer REFERENCES locations(id);--> statement-breakpoint
ALTER TABLE `projects` ADD `wiki_ref` text;