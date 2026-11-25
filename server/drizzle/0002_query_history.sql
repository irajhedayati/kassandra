CREATE TABLE `query_history` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_name` text NOT NULL,
	`query` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`statements` integer NOT NULL,
	`outcome` text NOT NULL,
	`error` text,
	FOREIGN KEY (`connection_name`) REFERENCES `connections`(`name`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `query_history_connection_started_at` ON `query_history` (`connection_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `query_history_params` (
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`entry_id`, `position`),
	FOREIGN KEY (`entry_id`) REFERENCES `query_history`(`id`) ON UPDATE no action ON DELETE cascade
);
