CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY,
	`automation_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`definition_version` integer NOT NULL,
	`definition_snapshot_json` text NOT NULL,
	`trigger` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`occurrence_key` text NOT NULL,
	`state` text NOT NULL,
	`root_session_id` text,
	`inbox_id` text,
	`worktree_directory` text,
	`session_cursors_json` text DEFAULT '{}' NOT NULL,
	`attention_json` text,
	`summary` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`read_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY,
	`profile_id` text NOT NULL,
	`status` text NOT NULL,
	`definition_version` integer NOT NULL,
	`definition_json` text NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_evaluated_at` integer,
	`active_run_id` text,
	`consecutive_start_failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_occurrence_idx` ON `automation_runs` (`occurrence_key`);--> statement-breakpoint
CREATE INDEX `automation_runs_automation_created_idx` ON `automation_runs` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_profile_state_idx` ON `automation_runs` (`profile_id`,`state`);--> statement-breakpoint
CREATE INDEX `automations_profile_status_next_idx` ON `automations` (`profile_id`,`status`,`next_run_at`);