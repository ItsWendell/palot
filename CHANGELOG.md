# Changelog

Palot uses [Semantic Versioning](https://semver.org/) for public releases. This
file records user-visible changes. Internal refactors belong in Git history
unless they change behavior, compatibility, security, privacy, or release
operations.

## Unreleased

## 0.18.0

This remains an experimental pre-release, not a supported stable release.

### Added

- Workbench: "+" opens a New tab page with a centred address field, quick tools (Changes,
  Terminal, Files, Side chat, Context, linked PR), and suggested sites.
- Pull requests: a Guide tab (beta) writes a review guide, a short tour of the change in
  reading order with the calls only you can make. Comment on excerpt lines into your pending
  review, ask about a stop in a new task, or rewrite after a push. Guides stay on this device.
- Project scripts: add a command in Project settings to run in a task's directory each time
  it settles (local connections). A toast reports passed, failed, or timed out, with View
  output.
- Inbox: idle tasks settle automatically after 3 days without activity (Settings → General
  → Auto-settle idle tasks: Off, 1, 3, 7, or 14 days). Running, blocked, failed, and pinned
  tasks stay, and so does a task you move back to Inbox until it has new activity. A toast
  reports each sweep with Undo.
- Pull requests: filter every list by repositories, organizations, review state, checks, or
  hide drafts. Filters apply through GitHub search, so they cover unloaded results, stay
  across restarts, and show as removable chips. Drag the list's border (or use arrow keys)
  to resize it; double-click restores the default width.
- Inbox: the section header's Settle idle tasks menu settles every listed task idle for 1
  day, 3 days, 1 week, or all of them, respecting the current filters, with one Undo.
  Bulk and automatic settles run project settle scripts only in worktrees, once per
  directory.

### Changed

- Mod+W in the workbench pane, including the browser address field and loaded pages, closes
  the active workbench tab instead of the whole window. With focus in a pane that has
  several tabs, Ctrl+Tab and Ctrl+Shift+Tab (or your task-switch keys) cycle its tabs.
- A new task whose last-used model is temporarily missing from the catalog shows it as
  unavailable and won't send, instead of silently creating the task on another model and
  forgetting your choice. It comes back when the model returns.
- The composer shows context tokens and session cost next to the context ring
  (`101k · $4.55`); free models hide the cost.
- Attachments on your messages appear above the text, as in the composer, and no longer
  reload when the sent message is confirmed. Question cards show the ⌘↩ / Ctrl+Enter
  shortcut on Next and Send. The Context tab names variant-only switches ("Switched
  variant to high").
- Diffs use stronger translucent add/delete fills (no longer blended away into the code
  background), color changed line numbers, and give changed words their own text color.
- Image previews in the workbench zoom with a pinch or Ctrl+scroll around the pointer, pan
  with two-finger scroll or drag, and have Zoom in/out and Fit controls. The chat image
  viewer gains pinch and scroll panning. Audio and video previews accept files up to
  256 MiB (was 32 MiB).
- Clicking in the hairline gap between sidebar task rows opens the highlighted task.
- Turns no longer end with a "View turn changes" button. The latest settled turn shows its
  changed files with Review changes only when it changed something; the Changes tab covers
  earlier turns.
- Grouped reasoning reads as one block: all steps share a single scroll region that
  follows new text while it streams. Reasoning, synthetic updates, compaction details,
  and the plan card scroll with the transcript's overlay scrollbar instead of the native one.
- Dragging the border of the task column or the right panel resizes it even where a
  scrollbar runs alongside, instead of grabbing the scrollbar.
- Pull requests, Usage, Worktrees, and Scheduled use the full window: the Inbox/Projects
  column stays hidden there, and showing navigation opens it as an overlay.
- Workbench tabs: the active pill stays aligned when the active tab changes width, and
  inactive tabs fade their title under the close button instead of covering it. Turn
  changes no longer leave a gap above the first file, and its file headers are padded.
- Queued messages appear as a compact stack with Steer now, Edit, Delete with Undo, and
  Retry; stopping a task shows the paused queue with Resume and Clear instead of leaving it
  parked silently.
- Project task rows show Settle, Snooze, Unsettle, and Wake on hover or keyboard focus, and
  Unsettle and Wake can be undone. Worktrees opens on the current task's project.
- Context meter: hover the composer ring for window usage, cost, Compact now, and Context
  details. Large tasks idle for an hour offer Compact and send, so the next message doesn't
  re-read an expired prompt cache. The Context tab is rebuilt around the window, what the
  model sees, instructions, and compaction history; developer diagnostics are hidden unless
  enabled.
- Compaction rows say whether context was compacted automatically or by you, show a hint
  when compacting runs long, fold before → after context size into their details, and let
  you retry the latest failed compaction. The running status shows the agent's latest
  thought, subagent tasks show a breadcrumb back to their parent, and agents that keep a
  plan get a compact progress card above the composer.
- Providers settings show each connected provider's source (account, API key,
  environment, config), how many of its models are shown, and a Disconnect that confirms
  in place. Providers turned off by config policy say so, and environment-only providers
  list the variable names to copy. The connect dialog uses choice cards, copy fields, and
  check lists.
- Models settings start with Defaults (OpenCode's configured default and its file, then
  Palot's project override) and group models by provider, with filters, prices per
  million tokens, release dates, and a show-all switch per provider. Providers link to
  their models and back.
- Model and reasoning effort are separate composer controls. The model picker adds
  Favorites, Recent, provider sections, New/Beta/Deprecated badges, a details pane
  (context, output, inputs, tools, price), and Manage models…. Shift+Mod+D cycles
  reasoning effort and can be rebound. Agent, approvals, model, workspace, branch, and
  destination pickers share one keyboard-navigable picker.
- Settings and dialogs use shared notice banners, choice groups, check lists, and copy
  fields; dialogs and collapsible sections animate on springs and respect Reduce Motion.
- Pinned OpenCode dependencies and the release-smoke runtime to 2.0.29, with Effect
  4.0.1. Project lists hide projects OpenCode archived after their directories
  disappeared. Responses that hit the output-token limit continue without showing
  OpenCode's continue instruction. The supported stable connection minimum remains 2.0.7.
- The tray tooltip says how many tasks need input and how many are running, and the app
  badge (Dock on macOS, supported Linux launchers) counts tasks waiting on a permission,
  question, or form. The Omarchy status file counts every task instead of the first
  three.

## 0.17.0

This remains an experimental pre-release, not a supported stable release.

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
