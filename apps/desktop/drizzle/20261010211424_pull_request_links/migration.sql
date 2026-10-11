CREATE TABLE `pull_request_links` (
	`profile_id` text NOT NULL,
	`session_id` text NOT NULL,
	`pull_request_key` text NOT NULL,
	`host` text NOT NULL,
	`repository` text NOT NULL,
	`number` integer NOT NULL,
	`source` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`checks` text NOT NULL,
	`review_decision` text,
	`mergeable` text NOT NULL,
	`head_branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`author` text,
	`pull_request_updated_at` integer NOT NULL,
	`merged_at` integer,
	`closed_at` integer,
	`linked_at` integer NOT NULL,
	`synced_at` integer,
	`sync_error` text,
	`settle_checked_at` integer,
	`settled_at` integer,
	`watch_json` text,
	`watch_ended_reason` text,
	`watch_ended_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `pull_request_links_pk` PRIMARY KEY(`profile_id`, `session_id`, `pull_request_key`)
);
--> statement-breakpoint
CREATE INDEX `pull_request_links_key_idx` ON `pull_request_links` (`pull_request_key`);--> statement-breakpoint
CREATE INDEX `pull_request_links_state_idx` ON `pull_request_links` (`state`);