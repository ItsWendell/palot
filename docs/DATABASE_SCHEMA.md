# Database Schema

Nexus Builder currently owns one SQLite database for automation scheduling and run
history. OpenCode stores its own session data separately.

## Storage Location

The database is created by `apps/desktop/src/main/automation/database.ts` inside
Nexus Builder's application data directory as `palot.db`.

Migrations live under:

```text
apps/desktop/drizzle/
```

## Tables

### `automations`

Stores scheduler state for each configured automation. The automation's prompt
and full config are stored on disk; this table tracks timing and health.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `next_run_at` | integer | Next scheduled run timestamp. |
| `last_run_at` | integer | Last run timestamp. |
| `run_count` | integer | Total successful/attempted run counter, defaults to `0`. |
| `consecutive_failures` | integer | Failure streak used for operational visibility. |
| `created_at` | integer | Creation timestamp. |
| `updated_at` | integer | Last update timestamp. |

### `automation_runs`

Stores execution history for automation runs.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `automation_id` | text | Foreign key to `automations.id`, cascades on delete. |
| `workspace` | text | Workspace path used for the run. |
| `status` | text | Run lifecycle state. |
| `attempt` | integer | Attempt number, defaults to `1`. |
| `session_id` | text | OpenCode session ID when one was created. |
| `worktree_path` | text | Isolated worktree path when worktree execution is used. |
| `started_at` | integer | Start timestamp. |
| `completed_at` | integer | Completion timestamp. |
| `timeout_at` | integer | Timeout deadline. |
| `result_title` | text | Human-readable result title. |
| `result_summary` | text | Result summary shown in the UI. |
| `result_has_actionable` | integer | Boolean flag for actionable changes. |
| `result_branch` | text | Branch produced by the run. |
| `result_pr_url` | text | Pull request URL if one was created. |
| `error_message` | text | Failure detail. |
| `archived_reason` | text | Why a run was archived. |
| `archived_assistant_message` | text | Assistant-provided archive message. |
| `read_at` | integer | When the user marked the run as read. |
| `created_at` | integer | Creation timestamp. |
| `updated_at` | integer | Last update timestamp. |

Indexes:

- `idx_runs_automation` on `automation_id`
- `idx_runs_status` on `status`
- `idx_runs_created` on `created_at`

## Relationships

```text
automations 1 ─── * automation_runs
```

Deleting an automation deletes its run history through the foreign key cascade.

## RLS Policies

There are no row-level security policies. The database is local to the desktop
app and is not exposed as a multi-tenant service.

## Schema Ownership

Drizzle schema source:

```text
apps/desktop/src/main/automation/schema.ts
```

When changing tables:

1. Update the Drizzle schema.
2. Add a migration under `apps/desktop/drizzle/`.
3. Update this document.
4. Run type check and any automation workflow smoke tests.
