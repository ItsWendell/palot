# Changelog

Palot uses [Semantic Versioning](https://semver.org/) for public releases. This
file records user-visible changes. Internal refactors belong in Git history
unless they change behavior, compatibility, security, privacy, or release
operations.

## Unreleased

### Added

- External credential setup forms for methods advertised by OpenCode, including
  AWS profiles and Azure CLI authentication.
- Import of multi-address one-time pairing QR payloads, with explicit target
  selection and cleartext consent. Exported QR codes omit loopback addresses.
- Read-only Word, Excel, and PowerPoint content previews, with sheet and slide
  navigation. Previews show text and tables, not full Office layouts or embedded media.
- Recently closed workbench resource tabs, scoped to their task and connection,
  with menu and keyboard restore. Closed browser pages are not restored.
- An always-visible navigation rail for Inbox, Projects, Scheduled, Usage, Worktrees, Pull requests, and Settings,
  also shown in Settings. Task search moved to the command palette, which now
  searches every visible server and lists recent tasks first.
- Keyboard shortcuts: Alt+1–9 and Ctrl+Tab for recent tasks, Ctrl/⌘+L to focus the
  composer, composer model/agent/attach shortcuts, and a Keyboard shortcuts page.
- Composer shell mode (`!` or Ctrl/⌘+Shift+X) runs a command in the task, and ↑/↓
  recall earlier prompts.
- Find in task (Ctrl/⌘+F) searches loaded messages, and Ctrl/⌘+Alt+[ / ] move
  between user turns.
- Mention subagents and OpenCode references with `@` in the composer, and restore
  them when a prompt is undone, edited, or forked.
- Command palette task actions (fork, export, compact, undo, redo, move work to
  background, change model or agent), a Files tab that opens files in the workbench,
  and `/fork`, `/export`, `/agent`, `/mcp`, and `/open` slash commands.
- After a turn that changed files, Palot offers to review the changes or ask the
  agent to review them.
- GitHub pull requests can be linked to tasks by URL or by the task's branch. Palot
  keeps their checks, review, and merge status current, settles the task when the
  PR merges, and can watch a PR to wake the agent when a check fails, the required
  checks pass, someone comments or reviews, or the branch starts to conflict.
  Local connections only; GitHub access uses `GH_TOKEN`/`GITHUB_TOKEN` or `gh`.
  Linked tasks show a PR badge (state, checks, conflicts, watching) in the Inbox and
  project lists, the task header has a Pull request control (link, open, refresh,
  watch, unlink).
- A Pull requests review screen on the rail: search across Review requested,
  Assigned, Authored, Mentioned, and Recently merged, then open a pull request to read
  its summary, checks, reviewers, timeline, and code. Merge (confirmed in place,
  remembering the method per repository and refusing if new commits arrived), approve,
  close, reopen, request reviewers, comment, reply to and resolve threads. The Code
  tab marks files viewed in sync with GitHub, shows existing threads on their lines,
  and collects line comments into a review submitted as Comment, Approve, or Request
  changes. Hold Shift in the list for quick Approve, Merge, and Close.
- Notification sounds: a soft built-in sound (or Off) for turn completed, turn
  failed, permission requests, and questions, with a preview button.
- A Default shell setting under General, saved to the current server's OpenCode config.
- Editable keyboard shortcuts: record new keys, clear, reset one or restore all
  defaults, with conflict warnings. Built-in composer and system keys stay fixed.
- Initialize Git from the Changes tab when a project has no repository.
- Commit and push from the Changes tab (local connections): stage or unstage files,
  write or generate a commit message from the staged changes, and push or publish
  the branch, with clear guidance when hooks, identity, or the remote reject it.
- Diff options: Auto layout picks split or unified from the pane width and whether
  lines were replaced; choose word or character highlights and hide whitespace
  changes. Find in diff (Ctrl/⌘+F) works in the Changes and turn-diff tabs.

### Changed

- Failed turns keep their error card after reload once OpenCode records the failure
  on the turn. Delegated subagents show as one compact row with live time, final
  duration, and an inline Stop button, and the working status names parallel tool
  work such as "Reading 3 files".
- Fluid Functionalism-style interaction: sidebar, rail, menus, selects, context menus,
  and the command palette share one gliding highlight that follows pointer and keyboard;
  popups, tooltips, and the palette open on short springs; switches spring and stretch.
  Workbench tabs and the Working/Branch control use a sliding active pill.
- The command palette has All, Tasks, Commands, and Settings tabs (←/→), a footer that
  names what Enter will do, and a panel that no longer shifts as results filter.
- Hovering Inbox or Projects on the rail while the task column is hidden peeks it
  without pinning it. Sidebar row actions stay out of the way until hovered or focused.
- Workbench tabs follow a quieter strip: a filled active tab, hover-revealed close
  buttons, distinct Changes and Files icons, and one compact toolbar height.
- Pane separators are now 1px lines with an enlarged pointer hit area, so pane
  backgrounds, headers, and diffs meet the border instead of stopping at a gutter.
- Inbox tasks keep their place while they work: they move when a run starts or a
  turn finishes, not on every streamed update. Pinned and Snoozed keep pin and wake
  order, and the list holds still while the pointer is over it.
- On tiling Linux compositors such as Hyprland, Palot no longer draws its own
  close-window button. Elsewhere it is separated from the pane toggles.
- Pinned OpenCode dependencies and the release-smoke runtime to 2.0.26. The
  supported stable connection minimum remains 2.0.7.
- Compact browser navigation shows the host at rest, selects the full URL for
  editing, and restores the current address when an edit is cancelled.
- Unknown provider connection methods show an unsupported state instead of
  breaking settings. Markdown remains selectable and price ranges stay literal.
- Terminals retry transient connection failures against the existing PTY without
  creating another shell or discarding the visible output.

## 0.16.0

This remains an experimental pre-release, not a supported stable release.

### Added

- A searchable project/device destination picker, grouped by server with project
  paths and explicit offline/disabled states.
- `/btw` side questions in separate persisted tabs, without normal transcript
  turns or tool execution. Closing a pending tab cancels its request.
- Browser element comments with page previews and prompt context. Saved drafts
  and restored messages retain descriptions, not live element references.
- Missing-workspace recovery on the original connection, using another directory
  or a new worktree from the project's saved checkout.
- Clickable session IDs that open on their originating connection.
- A unified running-work menu for subagents, commands and terminals, with
  open/stop controls for agents and commands.

### Changed

- New-task navigation defaults to the local device instead of inheriting an
  unrelated remote selection. Explicit destinations retain their owner.
- Response metadata shows the actual model variant used.
- Adjacent plain file reads are grouped more compactly.
- Pinned OpenCode dependencies and the release-smoke runtime to 2.0.23. The
  supported stable connection minimum remains 2.0.7.

### Testing

- Added native scenarios for transient side questions and missing-workspace
  recovery, plus multi-connection destination checks and running-command stops.
- Browser scenarios cover element comments, live references across snapshots,
  child-frame replacement, and paired HTTP transport.

## 0.15.0

This remains an experimental pre-release, not a supported stable release.

### Added

- Opt-in, task-scoped browser tabs with agent tools, managed popups, page recovery,
  saved tab restoration and explicit task-browser data clearing. Traffic uses the
  connected OpenCode server; per-site approval is not available.
- Workspace file browsing/search and image, Markdown, PDF and supported audio/video previews.
- Diff-line review comments that can be edited, removed and sent with a prompt,
  plus a separate view of changes from a completed turn.
- Usage comparisons with the previous period.

### Changed

- Pinned the OpenCode client, protocol, schema, browser plugin and release-smoke
  runtime to 2.0.19. The supported stable connection minimum remains 2.0.7.
- Added one-time pairing links for stable services from 2.0.17, retaining explicit
  legacy credential import for older compatible services.
- Retained live session metadata and project activity, linked background shell
  results to their originating activity, and kept delegated-work anchors visible
  in folded activity groups.
- Improved workbench resizing, expansion, tab navigation, composer framing,
  connection status presentation and usage refresh behavior.

### Testing

- Added isolated native scenarios for workspace previews, review comments and
  turn changes, workbench resizing, browser audits/popups/recovery and HTTP profiles,
  plus usage-comparison assertions. Linux E2E defaults to a private Weston display.
- Browser scenarios do not qualify SSH browser transport,
  external-network OAuth/HTTPS login or cross-window stress behavior.

## 0.12.0 rewrite baseline

The source-only Palot v2 rewrite introduced **0.12.0** (`v0.12.0`), continuing the
public release sequence after [0.11.0](https://github.com/ItsWendell/palot/releases/tag/v0.11.0).
The product generation and independently versioned OpenCode runtime do not reset
Palot's Semantic Versioning sequence.

### Added

- Public contributor, security, privacy, support, accessibility, and trademark
  documentation.
- Pull request CI and an unsigned macOS release-candidate workflow.
- Startup recovery, database backups, scoped reset controls, and redacted
  support-bundle export.
- Release build identity, Electron fuse verification, packaged license notices,
  checksums, SBOM generation, and unsigned provenance metadata.

### Changed

- Hardened renderer CSP, privileged IPC authorization, temporary attachment
  handling, external URL policy, permissions, and production logging.
- Removed the Pets feature from the current product.

### Security

- Renderer processes now use a strict script policy and deny unapproved Electron
  permissions.
- Local attachment previews require main-process grants rather than arbitrary
  renderer-provided file paths.

## Internal rewrite baseline (0.1.0)

Initial internal version of this rewrite, not a successor to the original
Palot's public releases. No supported public binary of this rewrite was published.
