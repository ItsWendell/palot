# Worktrees: Isolated Agent Sessions

How Palot creates and manages git worktrees for agent sessions, the OpenCode API integration, and the apply-to-local / commit-and-push workflows.

## Overview

When a user starts a new chat with "worktree mode" enabled, Palot creates a git worktree so the agent operates in an isolated copy of the repository. The user's working copy stays untouched. After the session, changes can be applied back to the local checkout or committed and pushed to a remote.

Worktrees are managed entirely through OpenCode's worktree HTTP API (`client.worktree.*` from `@opencode-ai/sdk`). This works identically for local and remote OpenCode servers, with no Electron-specific worktree logic.

## Architecture

```
User clicks "Start" with worktree toggle ON
        |
        v
new-chat.tsx
  1. Generate session slug from prompt text
  2. Call worktree-service.createWorktree(projectDir, sourceDir, slug)
        |
        v
worktree-service.ts
  1. Get SDK client for the project via getProjectClient()
  2. Call client.worktree.create({ worktreeCreateInput: { name, startCommand } })
  3. Poll client.worktree.list() until the directory appears (readiness check)
  4. Compute monorepo workspace subpath
  5. Return { worktreeRoot, worktreeWorkspace, branchName }
        |
        v
new-chat.tsx (continued)
  6. Create OpenCode session scoped to worktreeWorkspace
  7. Override session directory back to original projectDir (for sidebar grouping)
  8. Store worktree metadata (path + branch) on the session entry
  9. Send the user's prompt
        |
        v
Session runs in the isolated worktree
  - Agent reads/writes files in the worktree directory
  - Original working copy is not modified
        |
        v
User can then:
  - "Apply to local" -- patch changes back to local checkout
  - "Commit & push" -- commit in the worktree and push the branch
```

## Key Files

| File | Layer | Purpose |
|---|---|---|
| `renderer/services/worktree-service.ts` | Service | Core worktree operations (create, list, remove, reset, remote apply-to-local) |
| `renderer/services/backend.ts` | Service | Re-exports from worktree-service, provides `gitApplyDiffText` for remote apply |
| `renderer/components/new-chat.tsx` | UI | Worktree toggle, creation flow with loading phases |
| `renderer/components/worktree-actions.tsx` | UI | "Apply to local" and "Commit & push" buttons on the session app bar |
| `renderer/components/settings/worktree-settings.tsx` | UI | Settings page listing all worktrees with remove/reset actions |
| `renderer/atoms/actions/event-processor.ts` | State | Handles `worktree.ready` and `worktree.failed` SSE events |
| `main/git-service.ts` | Main process | `applyDiffTextToLocal()` for applying raw diff text via `git apply` |
| `main/ipc-handlers.ts` | Main process | `git:apply-diff-text` IPC handler |
| `preload/index.ts` + `preload/api.d.ts` | Preload | `applyDiffText` bridge method |

## OpenCode SDK API

All worktree operations use the `client.worktree.*` namespace from `@opencode-ai/sdk/v2`. The routes are under `/experimental/worktree` on the server, but the SDK maps them to `client.worktree` (not `client.experimental.worktree`, which only contains `resource`).

### Create

```ts
const result = await client.worktree.create({
  worktreeCreateInput: {
    name: "fix-auth-bug",          // Optional slug for the branch name
    startCommand: "cp .env* ...",  // Optional shell command to run after creation
  },
})
// result.data = { name: "fix-auth-bug", branch: "opencode/fix-auth-bug", directory: "/path/to/worktree" }
```

- Branch is always prefixed with `opencode/` (not configurable without upstream changes).
- Creation is asynchronous on the server: the API returns immediately but checkout and bootstrap happen in the background. Palot polls `worktree.list()` to detect readiness.
- The `startCommand` runs on the server's filesystem after the worktree is created, which is how `.env` file sync works for both local and remote servers.

### List

```ts
const result = await client.worktree.list()
// result.data = ["/path/to/worktree-1", "/path/to/worktree-2"]
```

Returns an array of directory paths (strings). No metadata (disk usage, timestamps, etc.) is available from the API.

### Remove

```ts
await client.worktree.remove({
  worktreeRemoveInput: { directory: "/path/to/worktree" },
})
```

Removes the git worktree and deletes its branch.

### Reset

```ts
await client.worktree.reset({
  worktreeResetInput: { directory: "/path/to/worktree" },
})
```

Resets the worktree branch to the project's default branch.

## Creation Flow in Detail

### 1. Session slug generation

The prompt text is converted to a kebab-case slug (first 4 words, max 40 chars). This becomes both the worktree name and part of the branch name (`opencode/<slug>`).

### 2. `.env` file sync via `startCommand`

Palot builds a shell snippet that copies `.env*` files (excluding `.example` and `.sample`) from the source directory to the worktree:

```sh
for f in "/source/dir"/.env*; do
  [ -f "$f" ] || continue
  case "$f" in *.example|*.sample) continue;; esac
  cp "$f" "/worktree/dir/" 2>/dev/null
done
```

This is passed as `startCommand` to the API, so it runs on the server (works for both local and remote).

### 3. Readiness polling

After creation, Palot polls `client.worktree.list()` every 500ms (up to 60s) until the worktree directory appears in the list. This is necessary because OpenCode creates worktrees asynchronously.

The event processor also listens for `worktree.ready` and `worktree.failed` SSE events, but the polling approach is the primary readiness mechanism.

### 4. Monorepo workspace subpath

If the project's source directory is a subdirectory of the git root (e.g., `/repo/packages/app`), Palot computes the relative subpath and appends it to the worktree directory. The session is then scoped to `/worktree/packages/app` so the agent operates in the correct workspace.

### 5. Session directory override

The OpenCode session is created with the worktree workspace directory, but Palot overrides the session's stored directory back to the original project directory. This ensures the session groups correctly under the right project in the sidebar.

### 6. Loading phases

The UI shows two distinct loading phases during creation:
- "Creating worktree..." -- while calling the API and waiting for readiness
- "Starting session..." -- while creating the OpenCode session

If worktree creation fails, Palot falls back to local mode with a warning rather than blocking the user.

## Apply to Local

After an agent session, the user can apply changes from the worktree back to their local checkout. This works differently for local and remote worktrees.

### Local worktree

Uses `gitApplyToLocal(worktreeDir, localDir)` via Electron IPC, which:
1. Runs `git diff` in the worktree directory
2. Pipes the diff to `git apply` in the local directory

### Remote worktree

Uses `applyRemoteDiffToLocal(projectDir, sessionId, localDir)`:
1. Fetches the diff from OpenCode's `session.diff` API: `client.session.diff({ sessionID })`
2. Applies the diff text locally via `gitApplyDiffText(localDir, diffText)` (Electron IPC)

Remote detection is heuristic: if the worktree path doesn't share a filesystem root with the project directory, it's treated as remote.

Both paths require Electron (for the local `git apply` step). In browser-only mode, apply-to-local is disabled.

## Commit & Push

The commit dialog (`worktree-actions.tsx > CommitDialog`) provides three actions:
1. **Commit** -- commits all changes in the worktree
2. **Commit & push** -- commits and pushes the branch to origin
3. **Commit, push & create PR** -- same as above, then opens a GitHub PR URL in the browser

All git operations use Electron IPC: `gitCommitAll`, `gitPush`, `gitCreateBranch`, `getGitRemoteUrl`.

## Settings Page

The worktree settings page (`Settings > Worktrees`) lists all worktrees across all connected projects. For each project, it calls `listWorktrees(project.directory)` and displays the results with remove and reset buttons.

Since the API only returns directory paths, the settings page does not show disk usage or timestamps (these were available in the now-removed Electron-side worktree manager).

## Sidebar Grouping (Sandbox Merging)

Worktrees created by OpenCode are tracked as "sandboxes" on the parent project. Each `Project` from the API has a `sandboxes: string[]` array listing worktree directories it owns.

Palot merges sandbox projects into their parent so the sidebar stays clean:

1. **`sandboxMappingsAtom`** -- derived atom that builds two maps from discovery data:
   - `sandboxToParent`: sandbox directory -> parent project directory
   - `parentToSandboxes`: parent project directory -> set of sandbox directories

2. **`projectListAtom`** -- filters out sandbox projects from both live sessions and discovery. Sessions in sandbox directories are counted under their parent project's agent count.

3. **`projectSessionIdsFamily`** -- when listing sessions for a project, also includes sessions whose directory matches any of that project's sandbox directories.

4. **`agentFamily`** -- remaps the `project` name and `projectSlug` for sessions running in sandbox directories to the parent project, so they display under the correct name.

5. **`collectAllProjects`** -- excludes sandbox directories from the project slug map.

This means worktree sessions appear under the parent project in the sidebar (with a `GitForkIcon` indicator), and worktree projects never appear as separate top-level entries. Sessions created directly in a worktree (e.g., from the OpenCode CLI) are also correctly absorbed.

## SSE Events

The event processor handles two worktree lifecycle events:

- **`worktree.ready`** -- logged when a worktree is fully bootstrapped (properties: `name`, `branch`)
- **`worktree.failed`** -- logged when worktree creation fails (properties: `message`)

These are currently used for logging only. The primary readiness mechanism is polling.

## Gotchas

- **`client.worktree`, not `client.experimental.worktree`**: The SDK exposes worktree methods at `client.worktree` even though the HTTP routes are under `/experimental/worktree`. The `client.experimental` namespace only contains `resource`.
- **Parameter naming**: The SDK uses named input keys (`worktreeCreateInput`, `worktreeRemoveInput`, `worktreeResetInput`) which it maps to `body` internally. Do not pass `body` directly.
- **Async creation**: The worktree API returns immediately. The actual git checkout and bootstrap happen in the background. Always poll or listen for events before using the worktree.
- **Branch prefix**: All branches are prefixed with `opencode/`. This is not configurable.
- **No fallback**: There is no Electron-side fallback. If the OpenCode server doesn't support the worktree API, creation will fail and the session falls back to local mode.
- **Electron required for git operations**: Apply-to-local, commit, and push all require Electron IPC for local git access. These are unavailable in browser-only mode.
