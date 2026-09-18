CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
-- Bestandsdaten übernehmen (#670): jeder vorhandene users.api_key_hash wird
-- Key "Laptop". Spalte users.api_key_hash bleibt danach unbenutzt stehen
-- (kein Datenverlust, keine Schreibzugriffe mehr).
INSERT INTO `api_keys` (`user_id`, `name`, `key_hash`, `created_at`)
SELECT `id`, 'Laptop', `api_key_hash`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `users`
WHERE `api_key_hash` IS NOT NULL;