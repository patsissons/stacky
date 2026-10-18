CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`stack` text NOT NULL,
	`action` text NOT NULL,
	`services` text NOT NULL,
	`state` text NOT NULL,
	`commands` text NOT NULL,
	`exit_code` integer,
	`error` text,
	`output` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `operations_stack_created_idx` ON `operations` (`stack`,`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
