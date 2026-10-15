---
version: alpha
name: Palot
description: A focused native workspace for long-running OpenCode tasks.
omitted:
  - section: colors
    reason: Palot ships a runtime theme catalog rather than one normative palette.
  - section: typography
    reason: Font families and sizes are user-configurable and resolved against local system fonts.
  - section: spacing
    reason: Layout rhythm is owned by Tailwind and shared component primitives rather than a separate exported scale.
  - section: rounded
    reason: Shape values are owned by the active theme and shared component primitives.
  - section: components
    reason: Palot's stateful desktop components exceed the alpha component-token schema; their contracts are documented below.
---

# Palot Design

## Overview

Palot should feel like a focused native workspace for long-running OpenCode tasks. The interface is quiet by default, dense where the work benefits from density, and consistent enough that people can move between tasks, settings, and workbench panes without relearning the UI.

Themes may change the visual character substantially. These rules define relationships and behavior, not one fixed palette.

## Colors

### Theme Semantics

- Components use semantic tokens such as `background`, `foreground`, `card`, `muted`, `accent`, `border`, and their sidebar equivalents. Product code should not recreate theme colors locally.
- Light and dark themes are independent. A theme only appears in a color mode it actually supports.
- Code, terminal, and diff colors may follow the app theme or use a separate registered code theme.
- Contrast strengthens or softens the relationships between surfaces, borders, controls, icons, and secondary text. It should not replace the theme's accent or semantic status colors.

## Typography

- The configured interface size drives the Tailwind type scale and shared component primitives.
- Product UI uses the named `text-sm`, `text-compact`, `text-meta`, `text-micro`, and `text-tag` roles. Compact, metadata, and micro text keep bounded offsets from the configured interface size; tag text stays tightly capped for compact badges.
- Icons that form a label with UI text use bounded semantic icon sizes. Window chrome, toolbar controls, status glyphs, and geometry-bound icons remain fixed.
- Large product headings use named responsive roles such as `text-page-title` and `text-hero`, not one-off arbitrary sizes.
- Sidebar items, group labels, captions, content, and headings derive from named theme size tokens. Avoid fixed pixel sizes in reusable navigation and settings components.
- Monospace content uses `text-code` or `text-code-compact`. Terminal, diff, and file tree sizes remain independently derived from the configured monospace size where density matters.
- Font size changes should be visible across navigation, settings, controls, content, and previews, not only on the document body.
- User-selected fonts must retain a robust platform fallback stack. Cell-grid surfaces must resolve to a monospace face.

## Layout

- App-shell surfaces fill their allocated panel with `h-full` and `min-h-0`. Viewport-sized primitives should not create extra space inside Electron's fixed root.
- Reusable surfaces respond to allocated space. Establish the query owner with Tailwind's [`@container`](https://tailwindcss.com/docs/responsive-design#container-queries) utility, name nested owners such as `@container/workbench`, and style descendants with variants such as `@sm/workbench:` or an arbitrary container breakpoint. Use viewport variants such as `sm:` only for app-shell behavior tied to the Electron window.
- Choose responsive breakpoints from child and sibling minimum sizes and interaction constraints, not device categories.
- Resizable pane separators are the visible 1px border itself. Panes meet them edge to edge; the pointer hit area comes from the resize library, not from layout gutters, and takes precedence over edge scrollbars it overlaps. A pane that stacks under a narrow container (the Pull requests list) uses a lightweight separator with the same look, an overlaid hit area, arrow/Home/End keys, and double-click to restore its default width.
- Overlay docks reserve exactly the space their content needs. Avoid decorative bottom padding that reads as an empty border or gap.
- Headers across chat, settings, and workbench panes share the same height, border ownership, and material behavior.

## Elevation & Depth

- Native window material and renderer translucency are separate controls.
- Liquid Glass uses documented native options only. Private or unstable material variants are not part of the appearance contract.
- Sidebar, content, composer, inspector, popover, and workbench opacity are derived from shared preferences instead of local alpha values.
- Reduce Transparency always wins. Every translucent surface must have a solid, readable fallback.
- Main content translucency should reveal material without making transcript text, code, inputs, or selected states hard to read.
- Prefer tonal separation, borders, and native material over heavy decorative shadows.

## Shapes

- Shared primitives own radii, borders, and control geometry. Call sites should not create a competing shape language.
- Compact navigation and controls use restrained radii. Larger surfaces may be softer when the extra containment has a real purpose.
- Pills are reserved for badges, statuses, and controls whose shape communicates their role.

## Components

### Sidebars

- The workspace has an always-visible navigation rail beside a collapsible task column. The rail is not part of the sidebar: hiding the task column leaves the rail in place, with its own edge border. Choosing a column view opens a hidden column in that view, and choosing the active view again hides it. The rail holds the Palot mark, the Inbox and Projects column views, global destinations (Scheduled, Usage, Worktrees, Pull requests), and Settings at the bottom. Rail items are icon buttons with a tooltip and an accessible name; column views report `aria-pressed`, destinations report `aria-current`. Attention and unread state appear as a small dot on the rail icon. The rail is self-contained so other shells, such as Settings, can mount it; choosing a column view from outside the workspace returns to it. The destinations own the whole content area: the task column stays hidden there without changing its remembered state, and showing navigation (toggle or rail view) opens it as an overlay sheet, like a compact window.
- The column header shows the current view title, the build badge, and one search icon. Task search lives only in the global command palette (`⌘K`/`Ctrl+K`), including across connections; the sidebar has no inline search field. "New task" is the column's single primary row.
- The footer Palot menu holds connection status, server toggles, and About. Destinations that live on the rail do not repeat there.
- Keep the column quiet: per-row and per-section actions such as "Start a new task in …" reveal on row hover or keyboard focus within the row. Hide them with opacity, never `display: none`, so they stay in the tab order and accessibility tree. Counts stay visible. A section's chevron appears on label hover or keyboard focus while the section is open and stays visible while it is collapsed, as the reopen cue. The Inbox filter/view/options toolbar stays visible.
- Linked pull requests appear as one compact badge at the end of a task row's location line (state glyph, `#N`, checks dot, conflict mark, eye while watching). Rows without a link reserve no space, and each list reads links from one batched query. Destructive PR actions confirm in place: the first press arms, a second press within three seconds confirms, and Escape or blur disarms.
- The Pull requests screen is master–detail: a resizable list pane (360px default, 260–640px, remembered) with debounced search, a filter menu beside Refresh (repository and organization multi-selects that accept typed names, review, checks, hide drafts) applied to every list as GitHub qualifiers, removable chips for active filters under the search field, and collapsible list groups (one gliding highlight per group, a static fill on the selected row), and a detail pane with a fixed header and subtle Summary · Timeline · Code tabs. Under a narrow container the panes stack and the detail gets a back button. The selection lives in the `pr` route param so other surfaces can deep-link to it. Holding Shift reveals per-row quick actions; every irreversible PR action confirms in place. The Code tab reuses the diff toolbar contract: a viewed checkbox starts every file row and diff header (ticking folds the file), line comments join a pending review shown on their lines and in a toolbar tray, and nothing is sent until the review is submitted.
- Task rows carry one triage step for their shelf, revealed on row hover or keyboard focus with opacity only: Settle (when nothing is running or waiting) and Snooze in the Inbox, Unsettle in Settled, Wake in Snoozed. Trailing metadata fades instead of moving; each action's toast offers Undo when the previous state can be restored. Worktrees opens on the current task's project, else the project last shown for that connection.
- The Inbox section header reveals Settle idle tasks on hover or focus: a menu of idle ages (1 day, 3 days, 1 week, all) with the count each would settle, applied to the rows the section shows. A batch settle, including the automatic inactivity sweep, reports once with Undo for the whole batch.
- The pull request screen's Guide tab (Beta) holds a review guide written on request: a rail of numbered stops beside the open stop, with ←/→ or J/K to move. Each stop shows its summary, at most one "Look closely" call, excerpts in the shared diff renderer with lettered notes on their lines, owned files, and suggested questions. Line comments on excerpts join the same pending review as the Code tab; the last stop's Finish review opens the review popover. Changed files the guide skips land in a closing Skim stop. A guide written for an older head says so and offers Rewrite.
- Hover uses one gliding highlight per group of alternatives (the rail, each Inbox section and shelf, Recents, each project's task list), drawn beneath row content. Selected rows keep a static fill; keyboard focus moves the highlight to the focused row. Row actions reserve their width only while shown.
- When the task column is hidden (not in compact mode), resting on the rail's Inbox or Projects button, or on the thin edge beside the rail, peeks that view as a floating overlay. A peek never pins the column or changes the remembered view. It closes when the pointer leaves the rail and overlay, on Escape, on an outside press, and after a task is chosen. Clicking the rail button still pins the column.
- Navigation sidebars share one compact menu item language: consistent height, horizontal padding, radius, icon size, typography, selected state, and focus ring.
- Pinned and Inbox task entries retain their richer multi-line cards: project/status, task title, and branch or location context. Use the shared rich density for these cards; adding connection scope must not replace them with compact Projects rows. Snoozed and Settled keep their existing compact shelves.
- Inbox order must not churn. Tasks sort by their last meaningful event: run start while working, otherwise when the last turn finished. Streaming and sub-agent activity never reorder them. View ordering applies to Inbox and Settled; Pinned stays by pin time and Snoozed by wake time. While the pointer is over the task list, rows hold their order (removed rows still disappear and new rows take their sorted slot) and pending moves apply when it leaves.
- Extend the existing Inbox filter/view toolbar and collapsible sections instead of introducing separate multi-connection navigation chrome. Server visibility belongs in the filter menu; monitoring and connection management belong in options. Preserve empty-section rules, section counts, and expand/collapse controls.
- Section chevrons share the rich cards' right metadata inset. Project headers use the same count/chevron treatment, with the new-task action separate from the collapse button and titles aligned to the left content edge.
- Session rows retain the shared right-click menu and drag-out-to-new-window gesture in every sidebar mode and density. Multi-connection rows must target their own connection, including when it is not the focused one; offline rows must never fall back to another server.
- Group labels use the same size and spacing in projects, inbox, and settings. Uppercase labels are reserved for data that is genuinely categorical, not routine navigation groups.
- Use spacing to separate adjacent navigation groups. Dividers are for real structural boundaries such as a persistent footer, not every list section.
- Compact actions use simple icons. A plus means add; richer folder imagery belongs in empty states or content where the object needs explanation.
- Settings navigation may have a different information structure, but should still use the shared sidebar item and group-label styles.

### Workbench Tabs

- Workbench tabs read as a quiet strip: an icon and muted label, with a soft filled pill for the active tab and no borders or separators. The active tab shows its close button; other tabs reveal it on hover or keyboard focus. Icons identify the surface and never turn into the close control.
- Each tab may add one toolbar row below the header, using the shared compact height. Segmented choices inside it use a borderless track with a raised active segment that slides between choices; they are toggle groups (`aria-pressed`), not tabs. The tab strip's active pill slides between tabs and a lighter pill follows the pointer or keyboard focus.
- "+" opens a New tab: a browser tab with nothing loaded. Its toolbar centres "Search or enter a URL". Below, Tools is a two-column tile grid (Changes, Terminal, Files, Side chat, Context, Pull request when linked, More tools…) with effective shortcuts and one gliding hover highlight, navigable by arrow keys. Choosing a tool turns the tab into that surface in place, or focuses it where it's already open. Suggested lists frequent recent sites from the task browser and hides when empty. A pane with no tabs shows the same page. The chevron beside "+" keeps the full "Open workbench surface" menu.
- Keys follow focus. With focus in the pane, including the address field and a loaded page, Mod+W closes the active workbench tab instead of the window, and the task-switch keys (Ctrl+Tab by default) cycle the pane's tabs when it has more than one. Terminals keep their own Ctrl+W and Ctrl+Tab.
- Diff tabs keep layout, inline highlighting, whitespace, and find choices in one compact options menu in the toolbar row; the trigger icon shows the layout in effect. Find in diff floats at the top-right of the diff area like Find in task.
- In Working mode the Changes tab ends with a quiet commit panel: a branch line (name, ahead/behind, staged count, Stage all, Unstage all, and Push or Publish branch), a message field (Mod+Enter commits), then Generate message and Commit. Results and errors appear inline, with tool output collapsed. Stage checkboxes are always visible at the start of each file header so hovering never shifts rows. Remote connections show a single line instead.

### Shared Controls

- Composer approvals sit with attachments and the agent on the left. Model and reasoning are separate triggers immediately before context and submission on the right; the reasoning trigger appears only when the model offers variants, and Shift+Mod+D cycles Auto → each effort → Auto. Toolbar labels and icons use the shared compact composer button sizing.
- Composer and new-task choices share one picker (`ComposerPicker`, on the fluid Combobox): optional punctuation-insensitive search, labelled sections, rich rows (description, badges, metadata, a check on the current row, disabled rows that say why), an optional detail pane when the popup has room, and footer actions. The model picker lists Favorites and Recent (last five per project) above every visible model grouped by provider; those sections step aside while searching, and models released in the last 30 days show New. A choice closes the popup only after it succeeds, returns focus to the composer, and reports failures in one toast.
- Approval presets reflect authoritative session rules: Defaults clears session overrides; Full access is an explicitly confirmed wildcard allow. Other rules display Custom. New independent drafts never inherit a locally remembered Full access choice, and pending requests are never silently answered by the selector.
- Questions, forms, and permissions from descendant sessions surface in the parent request area with the originating sub-agent identified. Replies and dismissals retain the original session and request ownership. Needs input takes priority over Working; summary cards use request/lifecycle events, not transcript previews, to show that state.

- Composer connection context belongs beside the project/branch controls, not in a separate input row. Hide connected local destinations; show a compact green-cloud badge for remote destinations and an explicit warning when the execution connection is offline.

- Prefer the local shadcn/ui primitives and improve the primitive when several callers need the same behavior.
- Popup lists (menus, selects, comboboxes) draw one gliding highlight behind their rows instead of per-row fills; pointer and keyboard always light the same row. Popups and tooltips enter on a short spring and exit faster; under reduced motion they only fade. Motion timings come from the three shared spring tiers (`lib/springs.ts`), never ad-hoc durations.
- The global command palette opens with a fixed top edge and a capped height; results filter beneath a stationary search field. All · Tasks · Files · Commands · Settings tabs sit under the field (Files lists the open task's files; All adds up to five file matches after tasks and commands once something is typed); ←/→ switch tabs only when the field is empty or the caret is at the edge it points past. The footer shows at most four hints, naming Enter after the highlighted row's action.
- Composer suggestions label their groups (References, Agents, Files) only when a query mixes kinds; single-kind lists stay unlabelled.
- Turn follow-ups such as the review offer appear as one quiet bordered row at the end of the transcript. They are deterministic (shown only when OpenCode reports changed files), dismissible, and never appear while work is running. Delegated subagents use one compact row: agent, description, elapsed time, and Stop while running.
- Shortcut labels, tooltips, menu hints, and `aria-keyshortcuts` always show the effective binding through `useShortcutKeys`/`shortcutKeys`; never hard-code key names. Built-in composer and system keys are locked and show a lock with the reason.
- Notification sounds are short, quiet cues synthesized at runtime. Every event offers Off and a preview, and only one window plays a given event.
- A single choice among a few visible options uses `ChoiceGroup` (radio semantics, one roving tab stop), never toggle buttons with `aria-pressed`; its `card` variant suits options with an icon and description. Toggle groups remain for toolbar segments. Independent multi-select uses `CheckList`, keyed by value.
- Values people copy (ids, paths, URLs, tokens) use `CopyField`; secrets start concealed.
- Palot has one notice component, `Banner` (`SettingsNotice` in settings). `Alert` is legacy and is migrated when touched. Keep a banner mounted and toggle `open` so it can animate out.
- Advanced or rarely changed settings sit in a `SettingsDisclosure`, closed by default. Settings rows use two paddings, `default` and `compact` (long uniform lists); never hand-pad a row.
- Dialogs enter on `spring.slow` and exit on its quicker tween; under reduced motion they only fade. The app honors Palot's own Reduce Motion setting through one `MotionConfig`.
- Undelivered messages sit in a compact stack above the composer, mirrored from OpenCode's session inbox: a one-line preview, attachment count, and a Queued/Steering/Sending/Failed state, with Steer now, Edit, Delete (Undo returns it to the composer), and Retry. More than two collapse to a count. When the task is idle with messages still waiting, the stack shows "Queue paused…" with Resume (sends the next, then OpenCode continues) and Clear (confirm in place). Stop does not resume parked steers.
- The composer context meter is a ring before Send, tinted at 70% (warning) and 90% (destructive). Beside it a muted tabular label shows context tokens and session cost (`101k · $4.55`); cost is hidden for free models and the label hides when the composer is narrower than 30rem. Hover or press opens a popover with "Context window: N% used (M% left)" or "N% full", used / window tokens, a cached / uncached / output bar, session cost, total processed, last compaction, Compact now (disabled with its reason), and Context details. When a task with at least 100k tokens of context has been idle for an hour, Send becomes Compact and send, with Send without compacting and Don't suggest again in its menu; both are General settings. The Context tab reads top to bottom: Window, What the model sees (readable rows, View raw), Instructions & rules (confirm-in-place removal), Compaction history (before → after, Jump to), with collapsed Session totals. Developer diagnostics appear only with Palot diagnostics on.
- Compaction rows read "Compacting context" (adding "This can take a few minutes" after 10 s), then "Context automatically compacted" or "Context compacted"; the detail shows context before → after. Only the newest failed compaction offers Retry, and only while the task is idle. Rows expose `data-palot-compaction="<message ID>"`; other surfaces jump to them through `transcriptJumpTargetAtom`. While a turn runs, the status line adds the agent's latest reasoning line unless reasoning summaries are hidden. Subagent tasks show "Parent › Agent · description" in the header; the parent crumb navigates up. When the agent keeps a plan, a collapsible "Plan · n/m done" card with a thin progress bar sits above the composer and collapses once everything is done.
- Project settings list Scripts: name, the exact command in a `CopyField`, trigger, and timeout. Only local connections run them, through the user's shell in the task's directory; other connections say why. Results arrive as one quiet toast with View output and are never sent to the agent.
- Component variants own typography and visual states. Call-site classes should mainly describe layout or a genuinely unique product state.
- Focus, hover, selected, disabled, loading, empty, and error states use the same semantic treatment wherever the interaction is equivalent.
- Controls use plain labels that describe what changes. Avoid exposing internal implementation terms when a user-facing material, pane, or task concept is available.

### Providers and Models settings

- Providers: connected providers are cards with icon, name, a source badge (Account, API key, External, Env, Config, Integration), a "N of M models shown" link to that provider on Models, and Disconnect, which confirms in place and says which environment or config source remains. A provider turned off by a config `provider.use` deny policy keeps its card with a "Disabled by config" notice naming the policy and file. Add a provider lists popular providers, with Browse all and search for the rest; environment-only providers show their variable names as copy fields. Integration sources sit in a collapsed Advanced disclosure.
- Models: Defaults come first (OpenCode's configured default with its config file, then Palot's per-project override and effort, then read-only agent models). Models are grouped by provider in collapsible groups with "N of M shown" and a show-all switch; search and filter chips (Shown, Hidden, New, Tools, Vision, Reasoning, Deprecated) keep the groups. Rows show status/New badges, context/output, base price per million tokens (Free at zero, tier note), effort levels, and release date. Picker order is set within a provider by drag or Move to top; `?provider=` expands and scrolls to one provider.

## Do's and Don'ts

- Do verify surfaces in light, dark, high-contrast, translucent, opaque, and Reduce Transparency modes.
- Do verify that changing interface size visibly affects a component without breaking its layout.
- Do reuse shared tokens and primitives for color, typography, dividers, radii, and opacity.
- Do match equivalent navigation and control patterns elsewhere in Palot.
- Do test reusable panes at their minimum supported width and height.
- Do preserve keyboard focus, readable contrast, and clear selected states.
- Don't add local styling that duplicates a shared token or component variant.
- Don't use viewport assumptions inside a component that should respond to its allocated pane.
