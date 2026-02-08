# Recommended Improvements for Codedeck

Prioritized improvements Codedeck should implement, organized by impact and effort. Each item references the OpenCode feature it's inspired by and why it matters for a GUI dashboard.

## Priority Tiers

- **P0 (Critical)** — Missing features that significantly hurt usability
- **P1 (High)** — Features that would meaningfully differentiate Codedeck
- **P2 (Medium)** — Nice-to-have features that improve polish
- **P3 (Low)** — Future considerations

---

## P0: Critical Improvements

### 1. Cost & Token Tracking Display

**What OpenCode has:** Per-message input/output token counts, session total cost in USD, context window % used — all displayed in the session header.

**What Codedeck needs:**
- Display token count and cost in session header or status bar
- Show context window usage as a progress bar/percentage
- Warn when context is nearly full (>80%)
- The data is already available via OpenCode's session/message API

**Why it matters:** Without cost visibility, users have no idea how much they're spending. This is table stakes for any AI tool dashboard. The `tokenlens` library is already in Codedeck's dependencies but unused.

**Effort:** LOW — Data available from OpenCode SDK, just needs UI rendering

---

### 2. Session Fork, Undo/Redo, and Compaction

**What OpenCode has:**
- **Fork:** Create a new session branching from any message in the timeline
- **Undo:** Revert the last message AND its file changes (with diff display)
- **Redo:** Re-apply an undone message
- **Compact:** Compress the context window to continue long sessions

**What Codedeck needs:**
- Fork button in message context menu or toolbar
- Undo/Redo buttons in session toolbar
- Compact button (with confirmation) when context is high
- Timeline view (modal) showing all messages for fork-point selection

**Why it matters:** These are the most powerful session operations after basic chat. Fork lets users explore alternatives. Undo/redo lets them recover from bad agent decisions. Compaction prevents sessions from dying when context overflows. All APIs exist in OpenCode's SDK (`session.fork()`, `session.revert()`).

**Effort:** MEDIUM — API calls exist, needs UI design for timeline + diff display

---

### 3. File Diff Display

**What OpenCode has:** Split/unified diff views with syntax highlighting, line numbers, added/removed coloring, and revert capability. Diffs appear in:
- Permission prompts (showing what the agent wants to change)
- Tool outputs (showing what changed)
- Session sidebar (showing modified files)
- Undo/redo operations (showing reverted changes)

**What Codedeck needs:**
- Diff component (can use `react-diff-viewer` or build on Shiki)
- Show diffs in permission approval dialogs (critical — users currently approve blind)
- Show diffs inline in tool call expansions for edit/write/apply_patch
- Session diff panel showing all modified files

**Why it matters:** Users currently approve file changes without seeing what will change. This is a major trust/safety gap. A GUI should make diffs MORE visible than a TUI, not less.

**Effort:** MEDIUM — Need to build diff component + wire up snapshot API

---

### 4. Enhanced Permission Approval

**What OpenCode has:**
- Show the actual diff of what will change
- "Allow once" / "Allow always" / "Reject with message" options
- "Always" responses persist per-session, auto-resolving future identical requests
- Fullscreen diff toggle
- Reject with correction message (agent receives feedback)

**What Codedeck needs:**
- Diff display in permission dialog
- "Always allow" option (reduces interrupt fatigue)
- "Reject with message" input field
- Permission rule management UI (configure what auto-approves)

**Why it matters:** The current Approve/Deny binary is too crude. Users get permission fatigue and start blindly approving, or they deny and the agent gets no feedback. "Always allow" for trusted patterns and "reject with feedback" for corrections are essential.

**Effort:** MEDIUM — Permission API supports this, needs UI redesign

---

### 5. Error Display & Toast Notifications

**What OpenCode has:**
- Inline error boxes in chat (red border, error message)
- Toast notifications (top-right, auto-dismiss, variants: error/warning/success/info)
- Tool error display (red text below tool output)
- Fatal error screen with stack trace + "Copy issue URL"

**What Codedeck needs:**
- Toast notification system (Sonner is already in dependencies)
- Inline error display in chat messages
- Connection error/retry indicator
- Tool error details in expandable tool call views

**Why it matters:** Silent failures are the worst UX. When something goes wrong, users need clear feedback. Codedeck currently swallows most errors.

**Effort:** LOW — Sonner already in deps, just needs integration

---

## P1: High-Impact Improvements

### 6. Enhanced Command Palette

**What OpenCode has:** `Ctrl+P` opens a command palette with 50+ commands organized by category (Session, Agent, Provider, System, Prompt), all fuzzy-searchable. Commands include model switching, session operations, display toggles, etc.

**What Codedeck needs:** Expand the existing `Cmd+K` palette from just sessions to:
- Session operations (new, fork, rename, delete, compact, share, export)
- Model switching (search + select)
- Agent switching
- Display toggles (sub-agents, theme)
- Navigation (go to project, go to session)
- System actions (reconnect, clear cache)

**Why it matters:** A command palette is the power-user's Swiss Army knife. The current implementation only searches sessions. Every significant action should be accessible from `Cmd+K`.

**Effort:** MEDIUM — `cmdk` already integrated, needs command registration

---

### 7. MCP Server Management UI

**What OpenCode has:** Full MCP server lifecycle management — view status, connect/disconnect servers, OAuth authentication flows, tool listing per server, prompt listing, resource access, status indicators in footer.

**What Codedeck needs:**
- MCP status panel (list all configured servers with status dots)
- Connect/disconnect toggle per server
- OAuth flow support (open browser, handle callback)
- Tool listing per MCP server
- MCP server configuration UI (add/remove/edit)
- Status indicator in the status bar

**Why it matters:** MCP servers are the primary extension mechanism for AI coding tools. Users need to manage them without editing JSON config files. The OpenCode server API fully supports this (`/mcp` routes).

**Effort:** HIGH — Full feature area, multiple screens/dialogs

---

### 8. Prompt Input Enhancements

**What OpenCode has:**
- **Prompt history** — 50 entries, persisted, navigable with Up/Down
- **Prompt stash** — Save/restore prompt drafts (like git stash)
- **Slash commands** — `/new`, `/fork`, `/models`, `/agents`, `/compact`, etc.
- **Shell mode** — Type `!` to run shell commands directly
- **@file autocomplete** — Fuzzy file search with frecency scoring
- **Large paste collapse** — 3+ lines collapsed to `[Pasted ~N lines]`
- **External editor** — Open `$EDITOR` for complex prompts

**What Codedeck needs (in priority order):**
1. Prompt history (Up/Down to cycle through previous prompts)
2. Slash command support (`/` prefix shows available commands)
3. @file autocomplete with file search (if not already functional)
4. Paste summarization (collapse large pastes)

**Why it matters:** The prompt input is the most-used UI element. Every improvement there multiplies across all sessions.

**Effort:** MEDIUM — Each sub-feature is small but there are several

---

### 9. Theme System

**What OpenCode has:** 33 built-in themes (catppuccin, dracula, nord, tokyo-night, gruvbox, etc.) + custom theme JSON support + live preview during selection + dark/light mode toggle + auto-detect terminal background.

**What Codedeck needs:**
- Theme selector with at least a few popular presets
- Dark/light mode toggle (currently dark-only)
- Theme persistence (currently resets on reload)
- CSS variable-based theming (already structured this way)

**Why it matters:** Theme support is expected in any modern development tool. The CSS variable system in `globals.css` already defines all the tokens — they just need alternate value sets.

**Effort:** MEDIUM — CSS variable infrastructure exists, need theme definitions + selector UI

---

### 10. Session Export & Sharing

**What OpenCode has:**
- Share sessions with public URLs
- Export sessions in multiple formats
- Copy full transcript to clipboard
- Import sessions from files

**What Codedeck needs:**
- Share button in session toolbar (calls `session.share()`)
- Share URL display + copy
- Export dropdown (Markdown, JSON, etc.)
- Copy transcript button

**Why it matters:** Sharing agent sessions is common for code reviews, documentation, and collaboration. OpenCode's share API is already available.

**Effort:** LOW — API calls exist, minimal UI needed

---

## P2: Medium-Impact Improvements

### 11. Keyboard Shortcut System

**What OpenCode has:** 65+ configurable keybindings with a leader key system. Every significant action has a keyboard shortcut.

**What Codedeck needs:**
- Keyboard shortcut help dialog (show all shortcuts)
- More shortcuts: session operations, model switching, navigation
- Shortcut customization (store in localStorage)
- Leader key system or modifier-based shortcuts

**Effort:** MEDIUM

---

### 12. Session Sidebar Enhancements

**What OpenCode has:** Rich sidebar showing:
- Session title
- Context stats (tokens, cost, context %)
- MCP server status (per-server with dots)
- LSP server status
- TODO list (agent's current plan)
- Modified files (with +/- diff counts)

**What Codedeck needs:**
- Context stats panel
- Agent's current TODO/plan display
- Modified files list
- MCP/LSP status indicators

**Effort:** MEDIUM — Data available from OpenCode, needs layout work

---

### 13. UI Preference Persistence

**What OpenCode has:** 15+ UI preferences persisted to KV store: theme, sidebar state, scroll visibility, animation toggle, diff wrap mode, timestamps, tool detail level, thinking visibility, etc.

**What Codedeck needs:**
- localStorage-based preference persistence
- Remember: sidebar width, sub-agent visibility, last active project/session, display toggles

**Why it matters:** Losing all UI state on every page reload is frustrating.

**Effort:** LOW — localStorage wrapper + Zustand persist middleware

---

### 14. Git Snapshot & Revert UI

**What OpenCode has:** Shadow git repository that snapshots file state before each tool execution. Users can revert any message's file changes to their pre-change state.

**What Codedeck needs:**
- "Revert changes" button per message or per tool call
- Diff view showing what will be reverted
- Session-level "revert all" option

**Effort:** MEDIUM — Need to call OpenCode's snapshot API + build diff UI

---

### 15. Provider Connection UI

**What OpenCode has:**
- Provider list dialog with auth status
- API key input dialog
- OAuth flow with browser redirect
- Getting Started flow for new users
- Provider connect from within model picker

**What Codedeck needs:**
- Settings page with provider management
- API key input form per provider
- OAuth flow initiation
- Connection status indicators

**Effort:** HIGH — Full settings area, auth flows

---

### 16. Search Across Sessions

**What OpenCode has:** Server-side session search with text query, debounced input, limit parameter.

**What Codedeck needs:**
- Search input in sidebar (filter sessions by title/content)
- Full-text search across all session messages

**Effort:** LOW — SDK `session.list({ search })` already supports this

---

## P3: Future Considerations

### 17. Worktree Management UI

Manage git worktrees from the dashboard — create, switch, reset, delete. This pairs with the planned multi-environment execution model.

**Effort:** HIGH

### 18. Plugin & Skill Management

Browse, install, configure, and manage plugins and skills through the GUI. View available hooks, registered tools, and loaded skills.

**Effort:** VERY HIGH

### 19. LSP Status Dashboard

Show connected LSP servers, their status, and diagnostics count per file. Enable/disable per-language.

**Effort:** MEDIUM

### 20. ACP Integration

Adopt Agent Client Protocol for standardized multi-agent communication, enabling Codedeck to orchestrate agents beyond just OpenCode.

**Effort:** VERY HIGH

### 21. PTY / Terminal Integration

Embed a terminal in Codedeck for direct shell access alongside agent sessions.

**Effort:** HIGH (Tauri prerequisite)

### 22. Inline Code Editor

Allow users to edit files directly in Codedeck with syntax highlighting, rather than switching to their editor.

**Effort:** VERY HIGH

### 23. Session Timeline Visualization

Visual timeline showing message flow, branching (forks), and sub-agent delegation as a graph rather than a flat list.

**Effort:** HIGH

### 24. Real-time Collaboration

Multiple users viewing/controlling the same agent session simultaneously.

**Effort:** VERY HIGH

---

## Implementation Roadmap Suggestion

### Phase 1: Essential UX (P0)
1. Cost & token tracking display
2. Error display & toasts
3. Enhanced permission approval (with diffs)
4. UI preference persistence

### Phase 2: Power User Features (P0-P1)
5. Session fork, undo/redo, compaction
6. File diff display
7. Enhanced command palette
8. Prompt input improvements (history, slash commands)

### Phase 3: Management Features (P1)
9. MCP server management
10. Theme system
11. Session export & sharing
12. Provider connection UI

### Phase 4: Advanced (P2-P3)
13. Keyboard shortcut system
14. Git snapshot & revert UI
15. Session sidebar enhancements
16. Search across sessions
17. Worktree management
18. Plugin & skill management
