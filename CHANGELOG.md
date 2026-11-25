# Changelog

Palot uses [Semantic Versioning](https://semver.org/) for public releases. This
file records user-visible changes. Internal refactors belong in Git history
unless they change behavior, compatibility, security, privacy, or release
operations.

## 0.24.0

This remains an experimental pre-release, not a supported stable release.

### Added

- **One task list replaces the Inbox and Projects sidebars.** Tasks that need you (an approval,
  a question, a failure) sit in **Needs you** at the top, oldest wait first; then pinned tasks,
  then the rest with finished, unseen work first. Pinned, Working, Snoozed and Settled are
  sections that collapse to one line with a count. **View** chooses how it's grouped (Inbox,
  Project or Server), where working tasks sit, and whether idle tasks get one line or two; the
  same choices are in Settings under Desktop behavior. Chats are tasks without a project and get
  a **Chats** group when grouped by project.
- Every row says what its task is doing in its second line: "Working · 42s", "Finished · 5m ago",
  "Waiting for approval · bash", what it's running, what the last turn changed, or "Stopped". A
  small pencil after a title marks a message you started there and haven't sent.
- Act from the list without opening the task: **Allow once** or **Deny** an approval, pick an
  answer to a question, step through several requests on one task, **Retry** a failed one. A
  request that just appeared ignores clicks and keys for a moment, and focus moves to the next
  task that needs you.
- Keyboard triage on the focused row: E settle, S snooze, P pin, U read or unread, Space quick
  look, A allow, D deny, F2 rename, J/K or the arrow keys to move. From anywhere: Alt+Up/Down
  opens the previous or next task, Mod+Alt+A the next task that needs you, Mod+1…9 the first nine
  rows (hold Mod to see the numbers); these leave open dialogs, menus and pickers alone. Shift-
  and Mod-click select several rows to settle, snooze or mark read at once.
- **Working docks at the bottom of the task list** by default. The dock shows about four rows,
  scrolls inside itself, collapses to its header with a count, and disappears when nothing runs.
  People who had chosen "Under Needs you" or "In the list" keep their choice.
- **Mark all as read** in the list's View menu, for the tasks the current filter shows, with Undo.
  **Mark as unread** and **Mark as read** in a task's menu.
- **Mod+Shift+S settles the open task** from anywhere, like E on its row: the same toast with Undo,
  and the next task in the list opens.
- **Open in background** in a task row's menu, or a middle-click, opens the task in a new window
  behind the current one. Some Linux window managers raise new windows regardless.
- **Move to folder…** in a task's menu and the command palette moves the task to another project
  or any folder, with OpenCode's session move. If the folder it leaves has uncommitted changes,
  the dialog lists them and asks you to move anyway.
- **Task links.** Copy link in a task's menu, next to **Copy task ID**, copies a
  `palot://task/<id>` link that brings Palot forward on that task and its server. Installed builds
  register the `palot://` scheme, as does a reinstalled local Nightly or Arch install on Linux;
  malformed or unknown links are ignored.
- **One ship button in the task header** offers the next step for the task's checkout and its
  linked pull request: Commit, Commit & push, Push, Push & create PR, Create PR or View PR, and
  nothing once everything is shipped. A commit shows the generated message for editing first, and
  the steps run with named stages in one popover. A failed stage says what failed and keeps the
  commit. It refuses with the reason when the branch is behind or has diverged, on a detached
  HEAD, with unresolved conflicts, or when a pull request would be empty, and on the default
  branch it asks for a feature branch named after the task. It fetches the remote before deciding
  (at most once per 30 seconds, carrying on with "Couldn't check origin" when offline).
  Mod+Shift+Enter presses it. Nothing is pushed without that press.
- **Ship & watch.** When the ship button opens or finds a pull request, its last stage watches it
  for the task, so the agent hears about failing checks, reviews and conflicts. The stage is
  ticked by default and remembered; it is the same "Watch pull request" checkbox the Create pull
  request dialog shows. View PR on an unwatched pull request offers Watch beside it.
- **Ready to merge, or what is still needed.** A linked pull request says "Ready to merge" or
  "Still needed: approval, branch behind" from its draft state, review decision, merge state,
  required checks and open review threads, in the task header, the Pull requests detail header
  and the task row's PR mark. Hosts that don't report a part say so. A watched pull request wakes
  its agent once when it becomes ready, telling it that merging is up to you, and Palot shows a
  desktop notification.
- **Fix review comments**, **Fix failing checks** and **Resolve conflicts** on a linked pull
  request add one chip to the composer, such as "PR #34 · 3 review comments", that gives the agent
  a numbered list of each unresolved comment, failing check or conflict. Fix failing checks adds
  the last 80 lines of each failing GitHub Actions step (capped at 8 KB per check), or
  "(log unavailable)". From the Pull requests screen the chip goes to the task that owns the PR,
  or a new task.
- **Message a subagent directly.** A subagent's task has the normal composer; OpenCode runs the
  message in the subagent and sends its answer to the main task as a report.
- **Edit a goal in place.** Saving sets the goal again, so it restarts from round 1; the field
  says so before you save.
- **A picker for `/review`**: uncommitted changes, the branch against its base, a commit, or saved
  instructions (Settings → General → Review instructions).
- **Comments as quotes in the transcript.** Review and browser element comments in a sent message
  show as compact chips (`src/a.ts:L12–18` and the comment) that open the file, its diff for
  removed lines, or the page. Copy prompt still copies the full text.
- **Jump to message** (Mod+Alt+G, the command palette, or the task's menu, where it replaces
  Prompt timeline) searches every prompt in the task, also ones not loaded yet.
- **Unread side answers.** A side question whose answer arrives while its tab isn't showing gets a
  dot on its tab until you open it.
- Alt+Enter while a task is working queues a message ahead of the others, and queued messages
  after the first have **Move to top**. Mod+Enter on an empty composer steers the first queued
  message.
- The transcript marks where you switched model, reasoning effort or agent mid-task, and a tool
  call waiting for approval shows **Needs approval** on its row.
- **OpenCode automations on the Scheduled page**, in their own section for every project on every
  connected server: their trigger in plain words, what they do, status, next and last run, and
  links to the task they prompt and the task that created them. Pause, Resume and Delete work from
  the row. The section stays hidden when a server has automations off or doesn't support them.
- **Prompts an automation sent say so**: "Automation · <name>" with a clock above the bubble ("ran
  late" when it fired late), linking to Scheduled. They offer no Edit, Up in the composer skips
  them, and message search lists them as Automation.
- **More on the Usage page**: cache hit rate and cost per million tokens, overall and per model;
  the ten most expensive tasks including their subagents; the share of spend that scheduled tasks
  and automations started; Code Mode against direct tool calls and the tools that fail most;
  per-project usage; and CSV or JSON export. A note says what the reported cost includes.
- **What's left on paid models, in the model picker.** Models that OpenCode Console limits show
  what remains on their row ("62% left · resets 18:00"). The selected model warns once per limit
  window under 15% and when it reaches its limit. Limits refresh when a turn ends.
- **Each usage limit says which one it is and how to go on**: "OpenCode Go 5 hour limit reached",
  "Workspace usage limit reached", "<model> spend limit reached", "ChatGPT usage limit reached" or
  "ChatGPT workspace limit reached", with when it resets, and Switch model, Turn on Extra Usage
  for Go, ChatGPT usage, or Copy request for admin.
- **Find in file tabs** (Mod+F): the same find bar as the transcript searches source, rendered
  Markdown, notebooks, documents and tables, including rows not yet scrolled into view. Images,
  PDFs, audio and video say find isn't available. Mod+Alt+F opens the editor's find and replace.
- **Viewed marks in Changes**, as in a pull request's Code tab: ticking one folds the file, the
  toolbar counts "3 of 8 viewed", and the mark lapses with "Changed since viewed" when the agent
  changes the file again.
- **Copy contents** and **Save a copy…** in a text file tab's toolbar, using the text as shown,
  unsaved edits included.
- **Keep the side panel when switching tasks**, an opt-in setting under Settings → General →
  Desktop behavior.
- Ctrl/Cmd-click a file path in a terminal (`src/app.ts:12`, `./build.sh`, compiler output such
  as `main.c:1:25`) or a `file://` hyperlink (with `#L12` fragments, also from a terminal on a
  remote server) to open it in the workbench.
- **Switching from another agent?** Settings → General and an optional last step of the welcome
  guide start a "Switch from …" task for Claude Code, Codex, T3 Code, Pi, Cursor, the OpenCode app
  or another agent. Its prompt has the agent look first, propose a plan, wait for your OK, back up
  every file it changes, keep secrets out of files, and say how to undo it. Copy prompt gives you
  the same prompt. Palot itself detects and changes nothing.
- **Machines (experimental).** Settings → Machines lists the machines linked to each server with
  `experimental.machines` on, with their state, system and how they link. Add machine makes a
  single-use join string; OpenCode 2.4.1 has no worker command that joins with it yet, and the
  dialog says so. Calls that ran on another machine show its name, and links to its files offer
  Copy path instead of opening locally.
- **Connect to another computer** and **Share this computer** walk through pairing in numbered
  steps: a one-time code with its QR and a live expiry, a name for this computer, and help when
  other devices can't reach it. Pairing a server Palot already knows renews its sign-in.
- A failed connection says which part broke: the address, the tunnel or proxy, the HTTPS
  certificate, an expired pairing code, a refused sign-in, or an OpenCode that's too old.
- Each server row in Settings → Connections shows its address, OpenCode version, why it's offline
  with Reconnect, and one menu to rename, test, pair again, edit or remove it. Test connection
  uses the saved sign-in.
- **Warning before restarting OpenCode with tasks running**, naming up to five and asking you to
  "Restart anyway".
- Optional **Check for Palot updates** in Settings → About, off by default: a daily check for a
  newer stable release that links to its notes. It never downloads or installs anything.
- Settings → Permissions: edit a saved approval's action or pattern in place (OpenCode 2.1.0 or
  later).
- Add MCP server has a **Share across projects** switch (OpenCode `pool: true`).
- Provider and MCP sign-in accept the redirect URL pasted from the browser.
- Voice chat asks the server which voice models it can start, and says why when none can.
- **Send now** (or Mod+Enter) for a browser element comment.
- A mouse's back and forward buttons go back and forward in Palot.
- F6 and Shift+F6 move focus between the task list, transcript, composer and workbench; function
  keys can now be bound without a modifier.
- Files dropped or pasted from the file manager attach by path.
- Right-click an email address in a reply to copy it.
- OpenCode's error reference in error toasts ("UnknownError · ref …").

### Changed

- **The composer is rebuilt around one text field.** Mentions, files and comments are chips that
  one Backspace removes. At rest it shows `+`, the agent, one "model · effort" pill (with a short
  model name such as "Opus 5.5" after the maker's icon), the context pie, the microphone and one
  primary button; in a narrow window labels drop first, then the pie and microphone fold into
  `…`. Markdown is always styled as you type (the Rich composer beta setting is gone), up to
  8,000 characters.
- `+` turns the composer into a launcher for files, recent outputs, stashed prompts, commands,
  skills, mentions, shell commands and the task's approvals. Mod+/ opens it too, and `/`, `@` or
  `$` open it at that category. The separate stash and recent output buttons are gone. Mod+K is
  the command palette.
- One primary button sends, queues or steers (your default), runs a shell command, or stops; Stop
  sits beside it while you have a draft. Holding Mod shows the other delivery. The delivery menu
  is gone; Send to several models stays on Shift-click, the launcher and the model popover.
- Goal, plan, voice chat, Undo staged and running work are tabs on the composer's top edge, one
  panel at a time. Permissions, questions, forms and guest messages wait in one panel above the
  text field and page "1 of 3". Escape never answers a request; one that arrives while you type
  waits until you pause, and a draft never becomes its feedback.
- One notice line above the composer covers a missing workspace, a lost connection, a usage limit
  and the suggestion to compact first. Queued messages, comments and errors sit inside the
  composer.
- Up in the composer recalls up to 200 recent prompts per project instead of 25.
- **The transcript is rebuilt around whole turns.** A prompt and all its work, steers included,
  form one turn that folds to one line, such as "Worked for 2m 5s · changed 3 files +40 −12 · ran
  4 commands · 1 failed". A running turn shows one clock and one status line saying what it's
  doing or waiting on; a long command offers **Move to background**, and after Stop it reads
  "Stopping". Durations use one format everywhere.
- Every finished turn that changed files lists them in a card with line counts, opening that
  turn's changes at the file; the latest also offers **Ask for review**.
- Activity summaries lead with what changed and count failures, failed rows say what was
  attempted ("Tried to read app.ts"), and notices and finished background work get their own
  quiet rows.
- Sending while scrolled up keeps your place; **Scroll to bottom** takes you to the new message.
- **Subagents.** Ready for OpenCode's always-background subagents: a subagent row follows its
  child task and shows its latest report. Nested subagents show under the subagent that started
  them and fold behind a count when finished. "Finished" (and its notification and sound) waits
  until the task and every subagent under it are idle; until then the turn reads "Waiting for 2
  subagents", and `wait_tasks`, `settle_task` and scheduled runs wait the same way.
- **Code Mode.** With OpenCode's `full_codemode`, a script's commands, reads, edits and searches
  show as their usual rows instead of an "Orchestrating" card, with the script's source and result
  one `{}` click away. A script that threw ends with "Script failed: …". With OpenCode 2.4, edit,
  write and patch rows show the diff the script reports, files written with `Bun.write` get their
  own row, and running work lists background scripts and can stop them.
- Generated videos (OpenCode 2.4's `generate_video`) get their own notice that plays the video;
  generation calls show their prompt. Search rows name the folder they searched, and OpenCode's
  session tools read "Rename task" and "Move task".
- A watched pull request that merges or closes wakes its task one last time to do post-merge steps
  and settle, instead of Palot settling it silently. The wake is sent once, also when Palot was
  closed, and never to an archived task. Tasks without a watch still settle on merge.
- While OpenCode retries after a usage or rate limit, the transcript says "Usage limit reached ·
  retrying (attempt 2)" with the reset time if known. An empty balance (HTTP 402) reads "Out of
  credits".
- Changes, Turn changes and file diff tabs show a change rail beside the diff with changed lines,
  Find matches and the visible part; click or drag to jump.
- Lockfiles, generated files and migrations start collapsed with a quiet label in Changes, Turn
  changes and a pull request's Code tab, and tests get a "Test" label. Their lines are counted
  apart ("+ 1 lockfile, 2 generated"). Turn it off with **Collapse lockfiles and generated files**
  in the diff options menu.
- Mod+F inside any diff (Changes, Turn changes, a single file's diff, a pull request's Code tab)
  opens Palot's Find in diff; the diff viewer's own search is on Mod+Alt+F.
- A Markdown table's **Copy as table** (was Copy as TSV) also puts an HTML table on the clipboard.
- Settings read as a list: one centred column, label on the left and control on the right, and
  **Reset to default** beside a setting you changed. Timeline settings lead with the three styles,
  with fine-tuning under Advanced.
- The rail has one **Tasks** button instead of Inbox and Projects. Settings no longer has a default
  sidebar, and "Show inbox / Show projects" in the command palette became "Group tasks by …".
  Settle idle tasks, Add project folder, Import task and Manage worktrees moved into the list's
  View menu.
- The task list uses Palot's overlay scrollbar and scrolls to a task opened from elsewhere. The
  list's New task starts where Mod+N does.
- Submenus open after the pointer rests on an item and close a moment after it leaves.
- Server-stored images (OpenCode 2.2.0 or later with `experimental.media_blob`) are shown by
  default, so tasks with many screenshots load less data.
- Browser comment screenshots are stored once per message, making such tasks about 40% lighter to
  load. Streaming replies redraw less, and Palot's agent tools send about 12% less text per turn.
- Electron 45.3.1 (Chromium 156.0.8078.96) and refreshed bundled libraries, including the SQLite
  engine for database previews and the diff and syntax highlighting engine.
- OpenCode 2.4.1 (from 2.2.5). The client, protocol and browser plugin, the tested-version check
  and the release-smoke runtime move to 2.4.1; stable 2.x services from 2.0.7 still connect.
  Along the way: agents can make videos and the image tool is `generate_image` (2.4), voice picks
  GPT-Live by the engine the server reports (2.4), GPT-6.2 caches its system prompt and timed-out
  shell commands keep running in the background (2.3.2), long tasks compact in the background by
  default (2.3.1), usage limits are read again when a credential changes (2.2.7), and running work
  reads only the folders with background jobs (2.2.6).

### Fixed

- On macOS, Palot no longer freezes at startup behind a Keychain prompt. Starting no longer reads
  the Keychain; Palot asks it only when it saves or reads a server password or token, or when
  Connections settings checks how they are stored, and it waits without blocking the window.
- Find in diff and Find in task no longer lose a key typed right after Mod+F, and typing straight
  after clicking into a file in the editor no longer loses the first keystrokes while Palot is busy.
- Opening a task lands on what you haven't seen even when Palot's copy of the task was out of
  date.
- Loading earlier messages keeps the message you were reading in place, also when you keep
  scrolling while it loads, and scrolling up no longer jumps to the first unread reply. Swiping
  sideways across a wide table no longer stops following new output.
- Switching tasks no longer rebuilds the task you're leaving, returns to a task at its saved
  position, and no longer keeps every earlier navigation in memory. The prompt rail appears on a
  cold load.
- A response's tok/s counts reasoning tokens, measures from the first streamed token (OpenCode
  after 2.2.7), and no longer spikes when a provider sends a step all at once.
- Commands and tools you stop or cancel read as stopped, not failed, and don't count as failures;
  background commands that timed out or were killed say so. A tool call stopped before it was
  written no longer shows as an empty row.
- A subagent no longer reads "Finished" while its own subagent or background work still runs, or
  while a report quotes "Background work still running:".
- A running subagent's card no longer flickers or briefly disappears when the task's own turn
  ends while the subagent keeps working.
- A shell command moved to the background after it started shows its later result on its row.
  With OpenCode 2.4, background results show their output instead of a raw `<background-result>`
  tag, and `<system-update>` instructions read "Instruction update".
- A command OpenCode can't analyze no longer asks about "Path: \*" and doesn't offer "Always
  allow". Permission prompts for MCP and other tools list every argument.
- A review comment on a removed line tells the agent it is in the old version of the file.
- Sending while an attachment uploads waits for the upload and then sends.
- Pasting from Word, Pages and similar editors pastes the text instead of a picture of it.
- Pasted screenshots and long text in stashed prompts and drafts survive a restart, and starting
  one Palot channel no longer deletes another channel's unsent pastes.
- Task mentions show by title instead of `@session:ses_…`.
- A forked task's first notice reads **Forked from** and the source task's name.
- A single `~` in your own messages stays as typed.
- Fenced `latex`, `math` and `tex` blocks render as display math.
- Shortened text never cuts an emoji in half.
- The command palette marks failed tasks with a red **Failed** dot, and "xhigh" reads "Extra
  high".
- Screen readers announce changed diff lines as "Added" or "Removed".
- In a narrow window, opening Changes no longer pushes the side panel off the screen.
- File previews (images, PDFs, databases, archives, documents, audio and video) keep their place
  across tab switches, and an open preview no longer resets when another file changes. A folder
  deleted and recreated no longer shows the old files.
- Pasting more than 1 MiB into a terminal arrives in order, or says why it couldn't.
- Escape and Enter in the browser's Find in page leave an input method alone.
- Answered request cards fade out, and focus moves to the message box.
- With Reduce Motion on, spinners keep moving and fades still fade; only movement is removed.
  Panes animate on their own, and buttons show a pressed state.
- Settings and project settings opened by a reload use the connected server and project.
- Errors in connection settings no longer start with "Error invoking remote method…", a server
  paired from settings shows in the task list without a reload, and a connected server can be
  renamed.
- Palot connects by itself when the local OpenCode service starts after it, and starting a
  connection you had disabled keeps it connected.
- After lost live updates or a reconnect, Palot keeps retrying to reload the open task, so replies
  and delivered prompts no longer go missing. Events from several servers no longer interfere.
- Slash commands longer than 30 seconds and slow worktree setup no longer time out.
- Opening the browser pane while a project is still loading waits for its plugins.
- Guest links work again after Palot restarts, crashes or resets settings.
- On Linux with Wayland, the window no longer stays hidden when the page loads slowly at startup.
- Quitting the Linux AppImage no longer leaves Chromium helper processes running, and quitting no
  longer hangs on a slow cleanup step (at most 10 seconds).
- After an Electron update, Palot clears Chromium's GPU caches once, avoiding blank areas.
- A background error after startup is logged instead of opening the recovery window.
- Login-shell environment variables load when your shell sets a DEBUG trap or prints on startup.
- Opening a file in an external editor handles paths with spaces, `#` or `%`.
- Generated commit messages, pull request text and review guides use the model a task in that
  project would use, instead of falling back to OpenCode's hosted free models ("Free usage limit
  reached").
- Choosing a palette under Settings → Appearance → Theme while it followed the system no longer
  makes the Theme section vanish until you leave the page.
- Onboarding: a fresh install connected to a server with tasks opens onboarding, skipping the
  project step uses the most recent project, and a workspace reload no longer ends it.
- Keyboard shortcut settings refuse keys that belong to a locked shortcut.
- Smaller fixes: MCP form descriptions link URLs, the command list closes for `//` and plain
  paths, paths shortened with `...` are no longer broken links, a compaction stays visible when
  its turn folds, and a message sent to an idle task no longer flashes as queued.

### Security

- Pull request watch wakes quote comments as untrusted text, so a comment can't pass as your
  instructions to the agent.
- Palot keeps local OpenCode traffic, including the service password, off Node's environment
  proxy (`NODE_USE_ENV_PROXY=1`).
- On Linux without a keyring, Connection settings and the log say that saved passwords and tokens
  are only obfuscated, and the credential file is readable only by you.

## 0.23.0

This remains an experimental pre-release, not a supported stable release. 0.22.0 was
tagged but never published (its packages failed the dependency license check), so this is
the first release with the 0.22.0 changes below as well.

### Added

- Right-click (or Shift+F10) any file or web link for Palot's link menu: open in the workbench or
  Palot Browser, open in your editor, show in the file manager, or copy the path, relative path
  or link. With text selected, the menu starts with Copy.
- URLs in questions, MCP forms, permission prompts, failed turns and error toasts are clickable.
- Markdown renders GitHub's raw HTML subset everywhere it appears: agent replies (also while
  streaming), pull request descriptions, comments and reviews, guide notes and side answers.
  Details with Markdown inside, `kbd`, `sub`/`sup`, `mark`, HTML tables and lists, aligned blocks
  and images, and GitHub's light/dark `picture` images (following Palot's theme) show as
  formatted content instead of literal tags. Component names, generics and other tags such as
  `<Button>`, `Array<string>` or `<script>` stay readable as literal text.
- `<https://…>` and `<name@example.com>` autolinks, HTML entities such as `&nbsp;`, hard line
  breaks from two trailing spaces, and multi-line setext headings.

- A line comment can be sent on its own with "Send now" or Mod+Enter in its popup, without
  touching the composer's draft or other queued comments. If sending fails, the comment stays
  in the popup to try again.
- On the New task screen, Mod+Alt+O opens the "Work in" picker and Mod+Alt+B the new worktree's
  base branch. Both are shown in the pickers' tooltips and can be changed in Keyboard shortcuts.
- Rename terminals from their workbench tab: double-click the tab or choose Rename terminal from
  its menu; leave the name empty to go back to the automatic title. Terminal tabs and Running
  work show a terminal's name and update when it's renamed from the TUI or another window.
  Needs OpenCode 2.2.4.
- Guided Claude Agent setup in Settings → Providers: copy the Claude Code install and
  `claude auth login` commands, then Check connection to have OpenCode confirm Claude Code is
  installed and signed in. Palot never runs these commands itself.
- Provider cards show Needs sign-in with OpenCode's message and a fix action when a connection
  needs signing in again, and a reply that fails because Claude Code isn't installed, signed in
  or up to date offers the setup and the command to run.
- Agent artifacts (OpenCode 2.2.4+, opt in with `"experimental": { "artifacts": true }` in
  `opencode.json`) show as compact cards in the transcript with their title, kind and last
  update. Open shows the artifact in the task's Palot Browser, reusing its tab, and cards follow
  later updates. OpenCode-hosted artifacts open only when OpenCode runs on this computer.

### Changed

- Inbox rows no longer load a task's folder on the server just to show its branch. Folders the
  server hasn't loaded show the last branch Palot saw, with a "Last seen on" tooltip.
- Running work and Commands & terminals only poll while their list is open; when closed, counts
  follow shell and terminal events.
- A returned subagent's response scrolls with the transcript's overlay scrollbar instead of the
  system one.
- `<details>` follows GitHub: Markdown inside renders after a blank line following `</summary>`.
- Claude Agent is listed with the popular providers and has its own icon.
- Pinned OpenCode dependencies and the isolated release-smoke runtime to 2.2.5. It keeps MCP
  servers connected through very large messages, keeps reasoning across model switches, and
  compacts on LiteLLM context-window errors instead of stopping the task.

### Fixed

- A fresh install opens onboarding again. It could be replaced by the launch screen's
  "Choose a task destination" when both navigated during the first route load.
- A shell command that exits with a non-zero code shows as failed ("Command failed", and in
  failure counts), not as completed. OpenCode completes the tool whatever the exit code.
- Commands from nested folders, such as `/git/commit`, can be typed in the composer: the
  suggestion list keeps up past the folder's slash, and the full name is sent to OpenCode.
- Palot notices an OpenCode event stream that never confirms its subscription within 20 seconds
  and reconnects, and repeated stream failures back off instead of resyncing every few seconds.
- Opening a task no longer loads its subagents' idle worktrees on the OpenCode server; their
  running work is read once they're active, or when you open Running work.
- `~/…` file links resolve to the server's home folder, so clicking, copying and opening them use
  the full path, and ones inside the task folder open in the workbench.
- Palot no longer reloads OpenCode locations, restarting their MCP servers, right after OpenCode
  unloads them for being idle. Before, every unload made Palot refetch every query on the
  connection.
- Palot stops asking the server about deleted task folders after the first "not found".

### Security

- Raw HTML in Markdown goes through an allowlist renderer. Only allowlisted lowercase tags become
  elements; all other tags, including `script`, `style` and `iframe`, show as inert text. Markup
  is never injected, and event handlers, styles, scripts, frames and forms are never rendered.
  Links and images use the Markdown URL policy and the remote-image setting. Deeply nested or
  malformed HTML can no longer stall or crash the view.
- Relative images in pull request content and fetched web pages resolve against their remote URL
  and never read local workspace files.

- Opening an artifact hosted by OpenCode adds the server credential, in Palot's main process,
  only to that artifact's own requests in the task browser, and only for a server on this
  computer. Other pages and other artifacts in the task never receive it.

## 0.22.0

Tagged but not published: the release build stopped at the packaged dependency license
check. These changes ship in 0.23.0.

### Added

- Edit text files in the workbench. Save with Mod+S, or Revert; there is no autosave, so an
  agent's edits are never overwritten silently: if the file changed on disk, Palot offers
  "Overwrite" or "Reload". Closing a tab with unsaved edits asks first. Files on another
  server's task are read-only until you switch to it.
- The Files tab is a lazy-loading folder tree with search.
- Pages in the browser can ask for your microphone or camera. Palot shows the request above
  the page with Allow and Block, which pages and agents cannot press, remembers the answer
  for that site in the task's browser, and shows a microphone in the address bar where you
  can reset it. Before, every request was silently refused.
- New previews: CSV and TSV as a table, Jupyter notebooks with saved outputs (code is never
  run), font specimens, Mermaid files as diagrams, and a hex view for other binary files.
  Markdown, CSV, notebooks and Mermaid share a Preview/Source toggle, and the preview follows
  unsaved edits.
- More previews: SQLite databases (tables and paged rows, read-only), archives (zip, jar, tar,
  gzip; open an entry without extracting it), OpenDocument text, spreadsheets and slides, RTF
  and epub. Select lines in any file to comment on them; the comment joins your next prompt
  like a diff comment.
- Pull requests: create one from Changes with a generated, editable title and description
  (draft supported); it links to the task and can be watched. Fetch, Pull, Sync and "Commit &
  push", with ahead/behind counts, an explicit rebase or merge choice when branches diverged,
  and a confirmation before pushing to the default branch. PR links that appear in an agent's
  finished tool output are linked to the task after Palot checks them with GitHub.
- Branches: switch, create and rename from the task, and name a new task's worktree branch
  (with an optional prefix). Edit a PR's title, description and labels, turn auto-merge on or
  off, and update a branch that is behind. Worktrees can clean up merged checkouts
  automatically (off by default), with "Run cleanup now" and a log; the safety checks of
  manual removal still apply.
- GitLab (merge requests, pipelines, approvals, merge and "merge when pipeline succeeds"),
  Forgejo/Gitea (pull requests, reviews, merge, commit statuses) and Bitbucket Cloud (pull
  requests, approvals, build statuses; merging stays on Bitbucket). Each host's token is
  stored encrypted in Settings → Source control. Actions a host doesn't support are disabled
  with the reason.
- Git actions work for tasks on remote OpenCode servers, including SSH connections, through
  OpenCode's shell API; nothing is added to the task's transcript.
- Agents can create, link and watch pull requests (`create_pull_request` asks first under
  Defaults, like scheduling).
- Scheduled tasks can run on events: a watched PR's CI failing or passing, or a new review or
  comment, with repository and branch filters; or a private local webhook (127.0.0.1 only,
  secret URL, rate-limited) whose JSON fields can be used in the prompt as
  `{{payload.field}}`. Repeated events are deduplicated.
- Transcripts: code blocks can wrap, and shell snippets have "Run in terminal", which pastes
  the command without running it. Opening a task lands on a "New" divider at the first unread
  message. Task-list checkboxes render in replies and can be ticked in Markdown file previews.
  "Edit from here" rewinds to one of your messages, restoring files, and puts it back in the
  composer. HTML code blocks open as static previews (scripts disabled). Local audio and video
  play inline, and images can be copied or saved.
- Inbox: drag across rows from a Settle or Pin button to apply it to all of them, with one
  Undo. Screen readers announce when the open task starts, needs you, finishes or fails, and
  when a background task needs you. A crashing view shows a recovery screen instead of a blank
  window.
- Composer: stash a prompt (Mod+S) and bring it back later from the stash menu; drag a file
  from the Files tree to mention it. A usage-limit failure can "Snooze until reset" and
  continue then. A rich composer (Settings, beta) styles Markdown as you type and shows inline
  chips; large pastes become attachments. New tasks can send one prompt to two to four models
  at once, each in its own worktree, and compare the replies.
- Files tree: reveals the open file, and screen readers announce it by name. A browser tab
  waiting on a permission prompt is flagged in the tab strip.
- Custom themes: copy a theme, edit its colours with a live preview, save it for light or dark,
  export it as JSON, or import a VS Code colour theme including its syntax colours.
- Guest links (beta, off by default): share one task through an expiring, revocable link.
  Guests see a live, text-only transcript and can suggest messages, which reach the agent only
  when you press Send. Publishing the link through Tailscale or OpenTunnel is a separate,
  explicit step; stopping sharing ends access immediately.
- `/reload` and a "Reload configuration" palette command reload OpenCode's configuration and
  plugins without opening Settings.
- The branch menu in a task's header can copy the branch name.
- Tasks show OpenCode's `/goal` in a card above the composer: whether it's being pursued (with
  the round), paused (with why, such as the reviewer seeing no progress) or met (with the
  reviewer's reason), with Pause, Resume and Clear. Starting a new goal while one is unfinished
  asks first. Needs OpenCode 2.2.1.
- Pull requests has an "Open by others" list: everyone else's open pull requests in the
  repositories or organizations you filter to, whether or not anyone is assigned or asked to
  review. The search box narrows it as usual, for example `no:assignee` or `review:none`.
  GitHub only.
- While you write the first side question about selected reply text, that text stays highlighted
  in the transcript.
- PageUp and PageDown in the composer scroll the task by most of a page without moving the caret
  (instantly with Reduce Motion). Both keys are listed under Composer in Keyboard shortcuts.
- Right-clicking a misspelled word shows up to five suggestions and Add to Dictionary above the
  editing items.
- Settings → General → Spelling turns spellchecking on or off. On Linux and Windows you can also
  pick dictionary languages; by default they follow your system languages, plus US English when
  none of them is English. Turning spellchecking off also stops Palot's windows from downloading
  dictionaries.

### Changed

- Pinned OpenCode dependencies and the isolated release-smoke runtime to 2.2.3 (with `effect`
  4.0.6, which its packages require), and moved Palot to the client's `client.experimental`
  group, so the deprecated method names that 2.3 removes are no longer used. Request paths are
  unchanged, so older 2.x servers still work.
- Updated Electron to 45.1.0, sql.js to 1.15.2 (SQLite 3.54), Lucide, officeparser,
  shadcn and the Bun pin (1.4.4).
- Upgraded TanStack DB to the 1.0 release candidate (`@tanstack/db` and `@tanstack/react-db`
  1.0.0-rc.1) and dropped the unused `@tanstack/query-db-collection`. Session state behaves the
  same, and the renderer bundle is about 5 kB gzipped smaller.
- OpenCode's image tool shows as an image card titled "Started image generation": the call only
  starts a background job, and the image arrives in a later notice. This covers both
  `image_generate` and `experimental_image_generate`, its 2.2.2 name, which OpenCode turns on
  whenever an image model is connected.
- When two providers offer a model under the same name, the model picker shows which provider
  each one is from, and same-named models from one provider are told apart by their IDs.
  "(latest)" is no longer part of model names.
- Project paths in the project picker shorten in the middle, keeping the start and the last
  two folders, instead of cutting off the beginning.
- Popovers open with the same short spring as menus.
- Selecting text and Find in task restyle much less of a long transcript: selection and highlight
  styles are matched once at the root and inherited, instead of on every element.
- Question options' text can be selected and copied; a click that ends a selection no longer
  picks the option.
- Running tasks in the Inbox are ordered by when OpenCode started them (2.2.2+), which survives
  reloads and doesn't need the transcript loaded.
- Composer suggestions (`@`, `/`, `$`) keep the highlight on the item you chose as results
  update. A list that scrolls or updates under a resting pointer no longer takes it, and Enter
  never accepts a row left over from the previous query.
- Opening and closing the side and navigation panes does less style work (35–47% less in
  measurements), because the header's window-control spacing no longer restyles the whole
  window.

### Fixed

- Opening a task while another task was being created (including forks, imports and subagents)
  could show "Something went wrong: CancelledError" instead of the transcript. A new session made
  Palot refresh its task list and cancel every load in progress; the refresh now restarts only its
  own lists, and a cancelled lookup no longer fails the task view.
- Saved composer drafts that mention an agent or a reference are no longer dropped on reload.
- A continued subagent links to its task while it is still running, not only once it finishes.
- Error messages no longer include a server's stack trace.
- Slash commands send only their arguments to OpenCode. Custom commands received `/name` as
  part of `$ARGUMENTS`, and `/goal pause` would have started a new goal named "/goal pause".

## 0.21.0

This remains an experimental pre-release, not a supported stable release.

### Added

- Chats without a project: start one from "…or just chat" on the new-task page,
  "No project" in the destination picker, "New chat" in the Inbox or command
  palette, or Mod+Alt+N. Each chat gets its own folder under `.palot/chats` in
  the server's default folder (your home folder for a local server). Chats are
  ordinary Inbox items labeled "Chat", have their own "Chats" filter and Projects
  group, hide branch, worktree and pull request controls, and settle after one
  idle day by default (Settings → General → "Settle idle chats after"). "Move to
  project…" moves a chat and its history into a real project. Chats are not
  available when the server's default folder is inside a Git repository.

### Changed

- Palot's agent tool for organizing tasks is now four tools named after what they
  do: `settle_task`, `snooze_task`, `pin_task` and `archive_task`. Agents look
  tools up by name, and missed `organize_task` when asked to settle a task.
  Renaming uses OpenCode's own `session_rename` tool.
- A task asked to settle itself now settles when its current turn ends. Before,
  the end of that turn counted as new activity and moved it straight back to the
  Inbox. A failed or interrupted turn keeps it in the Inbox, and agents can no
  longer settle another task while it runs or waits for you.

### Fixed

- Moving a task to another worktree could briefly show it in its old location,
  because OpenCode applies a move just after the request returns.
- The prompt to recover a task whose folder was deleted could fail to appear
  when Palot cancelled in-flight requests at the same moment.
- Refusing an unsafe OpenCode download archive no longer raises a second,
  unhandled error in Palot's main process.

## 0.20.0

This remains an experimental pre-release, not a supported stable release.

### Added

- MCP servers that ask for input (for example to pick a repository or sign in) show their form
  above the composer, labeled "MCP server request". Before, the MCP call waited with nothing
  shown. Needs OpenCode 2.1.4 or later.
- Agents can use Palot's own tools (OpenCode 2.1.4 or later): schedule a follow-up for the
  current task or recurring work in its project, list, change or delete scheduled tasks, list
  and read other tasks, wait until one finishes or needs you, and rename, pin, settle, snooze
  or archive tasks. Like ChatGPT's tools, they follow the task's approvals: Full access never
  asks, and Defaults asks before an agent schedules, changes or deletes a scheduled task, with a
  card that names it and its time and prompt. "Always allow for this project" on that card, or
  turning off Settings → General → "Ask before agents schedule tasks", stops asking. Reading and
  organizing tasks never asks. An agent's changes to the
  Inbox appear right away, and its Palot tool calls read as "Schedule task · Check CI · at
  2026-10-27 09:00" in the transcript. Settings → General → "Palot tools for agents" turns them
  off; development builds start with them off, so a Dev and a Nightly build on one server do
  not compete.
- Settings → General → "Approvals for new tasks" can start new tasks in Full access.
- The Usage page has a Limits section for servers signed in to OpenCode Console (OpenCode
  2.2.0 or later): OpenCode Go's 5-hour, weekly and monthly allowance with how much is left,
  whether you are ahead of an even pace, and when each resets, plus the workspace's monthly
  budgets and a link to manage usage. When a usage limit stops a task, its failure offers to
  continue the task when the limit resets, as a one-time scheduled task, and to view usage.
- Type `@` in the composer to mention another task. Mentions in prompts and replies show the
  task's current title and status and open it on click.
- Select text in a terminal tab and choose Quote in composer (Mod+Shift+L) to paste it into
  the task's message as a code block.
- File tabs update live when the file changes on disk (OpenCode 2.2.0 or later).
- The command palette finds settings by name and opens their page.
- A subagent's view shows whether it is running, how long it ran, and its model.
- Settings → Plugins notes plugins whose OpenCode Desktop interface Palot cannot run yet.
- Settings → Diagnostics can capture heap snapshots of Palot's windows, its main process, and a
  same-machine OpenCode server into one folder, with a manifest. Snapshots can contain
  credentials and task content.

### Changed

- Usage and rate-limit failures say so in their heading, and say when to try again when the
  provider reports it.
- Pinned OpenCode dependencies and the isolated release-smoke runtime to 2.2.0, and updated
  Vite+, Electron Builder, KaTeX, TanStack Query, Lucide, and other libraries. Commit message
  and review guide generation keep working with servers older than 2.2.0, which serve text
  generation from its original address.
- Code highlighting covers `.ini`, `.env`, CSV, Prisma, nginx and about 90 more language names
  (Pierre Highlights 0.3.0). Diffs and other code views now share one highlighter instead of
  loading two versions.
- Transcripts of tasks you have not viewed for 10 minutes, and messages from background tasks
  you never open, are released from memory and load again when you open the task. Running tasks
  keep theirs. The supported stable connection minimum
  remains 2.0.7.

### Fixed

- Settled and snoozed tasks no longer return to the Inbox when Palot restarts. OpenCode's
  browser plugin edits a task's permissions whenever Palot attaches or detaches its browser,
  which OpenCode records as an update; the Inbox now counts only finished turns as activity.
- Settings → Voice opened an empty page.
- Live usage-limit failures are titled as such before the transcript records them.

## 0.19.0

This remains an experimental pre-release, not a supported stable release.

### Added

- Voice chat (Beta): press the microphone in the composer or Mod+Alt+V to talk with a task.
  A GPT-Live voice assistant hands your requests to the task's agent, steers work already
  running, and tells you when it finishes or needs approval, which you still give in Palot.
  The call survives switching tasks, floats in a small always-on-top window while Palot is in
  the background, and can use an optional system-wide shortcut. Settings → Voice chooses the
  voice, microphone, greeting, and floating controls. Needs OpenCode 2.0.32 or later and an
  OpenAI API key on the server; ChatGPT sign-in can't start voice sessions.
- Select text in an assistant reply and choose Ask about selection to open a side question
  with the exact quote and a link back to the reply. Side questions accept follow-ups, stay
  tool-free, and can be stopped or retried.
- The command palette shows matching messages from tasks already loaded in Palot, and on
  request searches the latest messages of up to 30 recent tasks per server. The heading says
  what it covered, and Enter opens the task at that message.
- Changes and Turn changes have Previous/Next file buttons with an "N of M" position, and J/K
  inside the review pane.
- Worktrees lists merged worktrees ready to retire. Review checks the pull request, running
  tasks, uncommitted changes, and commits again just before removal, and keeps the worktree
  when anything is unknown.
- The composer shows resolved mentions as removable chips, lists open workbench files first
  when you type `@`, and has a Recent outputs picker for files changed by loaded tasks in the
  project. Up/Down recall includes recent prompts from the same project and server, restoring
  comments and embedded attachments but never stale file grants.

### Changed

- Moving a task to another worktree says that uncommitted edits stay in the original checkout,
  and asks for confirmation when that checkout has changes.
- MCP servers show Sign in, Retry, or Connecting… for their status and recheck it after
  connecting. When OpenCode can't load models or agents for a project, the composer explains
  why and offers Retry.
- Pinned OpenCode dependencies and the isolated release-smoke runtime to 2.1.3, including the
  2.1 renamed provider data and compaction fields. Models settings identify models with fixed
  temperature when OpenCode reports it. The supported stable connection minimum remains 2.0.7.
- Updated to Electron 45 (Chromium 156, Node 24.22) and current releases of Palot's other
  libraries. Whole-app performance traces are now saved in Perfetto format.
- Code is highlighted with Pierre's WebAssembly highlighter instead of Shiki in diffs, file
  views, patch previews, and code blocks in replies. Code blocks in replies now use the selected
  code theme instead of terminal colors. Highlighting is faster and uses less memory; `.ini`,
  `.env`, CSV, and Prisma files show as plain text.

### Fixed

- HTML files in the task's folder open rendered in Palot Browser from reply links, the agent's
  file previews, and a new Open in browser button on HTML file tabs. Previews of files outside
  the task now offer Open externally instead of a file tab that can't load, and blocked
  addresses say why.
- File references in replies, tool rows, and previewed Markdown open reliably. Palot checks
  the file exists, trying the folder the message was written in, the task folder, the project
  root, and then a filename search; several matches show a picker, and a missing file says so
  instead of opening an empty tab. `file://` links work again, line ranges such as `:12-20`
  select the whole range, and commands or code such as `console.log` no longer become links.
- Ask about selection is readable on dark themes.
- Settling or snoozing a task from the multi-server sidebar works on the first click. A task
  whose subagents had loaded after its row was drawn returned to the Inbox straight away.

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
