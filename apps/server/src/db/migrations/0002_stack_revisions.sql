CREATE TABLE `stack_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stack` text NOT NULL,
	`operation_id` text,
	`compose_file` text NOT NULL,
	`compose` text NOT NULL,
	`env` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stack_revisions_stack_idx` ON `stack_revisions` (`stack`,`created_at`);