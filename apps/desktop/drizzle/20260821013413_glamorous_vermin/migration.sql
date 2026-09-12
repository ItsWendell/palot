CREATE TABLE `session_triage` (
	`profile_id` text NOT NULL,
	`session_id` text NOT NULL,
	`disposition` text,
	`disposition_changed_at` integer,
	`pinned_at` integer,
	`snoozed_until` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `session_triage_pk` PRIMARY KEY(`profile_id`, `session_id`),
	CONSTRAINT `fk_session_triage_profile_id_triage_profiles_profile_id_fk` FOREIGN KEY (`profile_id`) REFERENCES `triage_profiles`(`profile_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `triage_profiles` (
	`profile_id` text PRIMARY KEY,
	`bootstrap_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
