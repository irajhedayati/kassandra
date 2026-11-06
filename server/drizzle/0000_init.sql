CREATE TABLE `app_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_connection` text,
	FOREIGN KEY (`last_connection`) REFERENCES `connections`(`name`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "app_state_single_row" CHECK("app_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `column_enum_values` (
	`column_id` integer NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`column_id`, `position`),
	FOREIGN KEY (`column_id`) REFERENCES `column_metadata`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `column_map_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`column_id` integer NOT NULL,
	`position` integer NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`display_type` text,
	FOREIGN KEY (`column_id`) REFERENCES `column_metadata`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `column_map_entries_unique` ON `column_map_entries` (`column_id`,`position`);--> statement-breakpoint
CREATE TABLE `column_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_id` integer NOT NULL,
	`column_name` text NOT NULL,
	`hide` integer,
	`display_type` text,
	FOREIGN KEY (`table_id`) REFERENCES `table_metadata`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `column_metadata_unique` ON `column_metadata` (`table_id`,`column_name`);--> statement-breakpoint
CREATE TABLE `connection_hosts` (
	`connection_name` text NOT NULL,
	`position` integer NOT NULL,
	`host` text NOT NULL,
	PRIMARY KEY(`connection_name`, `position`),
	FOREIGN KEY (`connection_name`) REFERENCES `connections`(`name`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`name` text PRIMARY KEY NOT NULL,
	`port` integer NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`password` text DEFAULT '' NOT NULL,
	`ssl_enabled` integer DEFAULT false NOT NULL,
	`ssl_protocol` text NOT NULL,
	`ssl_cert_path` text DEFAULT '' NOT NULL,
	`default_keyspace` text DEFAULT '' NOT NULL,
	`consistency_level` text NOT NULL,
	`connection_timeout` integer NOT NULL,
	`protocol_version` integer NOT NULL,
	`local_datacenter` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorite_keyspaces` (
	`connection_name` text NOT NULL,
	`keyspace` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_name`, `keyspace`),
	FOREIGN KEY (`connection_name`) REFERENCES `connections`(`name`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`taken_at` integer NOT NULL,
	CONSTRAINT "lock_single_row" CHECK("lock"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `map_entry_enum_values` (
	`entry_id` integer NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`entry_id`, `position`),
	FOREIGN KEY (`entry_id`) REFERENCES `column_map_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`query` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_queries_name_unique` ON `saved_queries` (`name`);--> statement-breakpoint
CREATE TABLE `saved_query_params` (
	`query_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	PRIMARY KEY(`query_id`, `name`),
	FOREIGN KEY (`query_id`) REFERENCES `saved_queries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `table_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_name` text NOT NULL,
	`keyspace` text NOT NULL,
	`table_name` text NOT NULL,
	FOREIGN KEY (`connection_name`) REFERENCES `connections`(`name`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `table_metadata_unique` ON `table_metadata` (`connection_name`,`keyspace`,`table_name`);