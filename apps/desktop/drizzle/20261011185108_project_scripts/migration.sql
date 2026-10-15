CREATE TABLE `project_scripts` (
	`id` text PRIMARY KEY,
	`profile_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`run_on_settle` integer NOT NULL,
	`timeout_seconds` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_scripts_project_idx` ON `project_scripts` (`profile_id`,`project_id`);