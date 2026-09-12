import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const triageProfiles = sqliteTable("triage_profiles", {
  profileID: text("profile_id").primaryKey(),
  bootstrapUpdatedAt: integer("bootstrap_at"),
  bootstrapSessionID: text("bootstrap_session_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessionTriage = sqliteTable(
  "session_triage",
  {
    profileID: text("profile_id")
      .notNull()
      .references(() => triageProfiles.profileID, { onDelete: "cascade" }),
    sessionID: text("session_id").notNull(),
    disposition: text("disposition", { enum: ["inbox", "settled"] }),
    settledUpdatedAt: integer("disposition_changed_at"),
    settledSessionID: text("settled_session_id"),
    pinnedAt: integer("pinned_at"),
    snoozedUntil: integer("snoozed_until"),
    snoozedUpdatedAt: integer("snoozed_updated_at"),
    snoozedSessionID: text("snoozed_session_id"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileID, table.sessionID] })],
);

export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    profileID: text("profile_id").notNull(),
    status: text("status", { enum: ["active", "paused", "deleted"] }).notNull(),
    definitionVersion: integer("definition_version").notNull(),
    definitionJSON: text("definition_json").notNull(),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    lastEvaluatedAt: integer("last_evaluated_at"),
    activeRunID: text("active_run_id"),
    consecutiveStartFailures: integer("consecutive_start_failures").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("automations_profile_status_next_idx").on(table.profileID, table.status, table.nextRunAt),
  ],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationID: text("automation_id").notNull(),
    profileID: text("profile_id").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    definitionSnapshotJSON: text("definition_snapshot_json").notNull(),
    trigger: text("trigger", {
      enum: ["scheduled", "catch-up", "manual", "retry"],
    }).notNull(),
    scheduledFor: integer("scheduled_for").notNull(),
    occurrenceKey: text("occurrence_key").notNull(),
    state: text("state", {
      enum: [
        "pending",
        "preparing",
        "queued",
        "running",
        "needs-attention",
        "settling",
        "succeeded",
        "failed",
        "interrupted",
        "cancelled",
        "skipped",
        "unknown",
      ],
    }).notNull(),
    rootSessionID: text("root_session_id"),
    inboxID: text("inbox_id"),
    worktreeDirectory: text("worktree_directory"),
    sessionCursorsJSON: text("session_cursors_json").notNull().default("{}"),
    attentionJSON: text("attention_json"),
    summary: text("summary"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    executionStartedAt: integer("execution_started_at"),
    executionCompletedAt: integer("execution_completed_at"),
    readAt: integer("read_at"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("automation_runs_occurrence_idx").on(table.occurrenceKey),
    index("automation_runs_automation_created_idx").on(table.automationID, table.createdAt),
    index("automation_runs_profile_state_idx").on(table.profileID, table.state),
  ],
);
