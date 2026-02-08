# Feature Parity Roadmap for Codedeck

> Prioritized roadmap to close the most impactful gaps between Codedeck and OpenCode TUI/Desktop.

## Prioritization Criteria

- **User impact**: How many users are affected and how severely
- **Trust/Safety**: Features needed for users to trust the agent
- **Differentiation**: Features that make Codedeck unique, not just OpenCode-in-a-window
- **Implementation effort**: Estimated complexity and dependencies
- **Foundation**: Features that unblock other features

---

## Phase 1: Trust & Core Chat (2-3 weeks)

> **Goal:** Make Codedeck trustworthy for daily use. Users must be able to see what the agent is doing before approving.

### 1.1 Diff Preview in Permissions (**Critical**)

- Show actual file diffs within permission request cards
- Add expand-to-fullscreen for large diffs
- Use `@pierre/diffs` (already in dependencies)
- **Impact:** Users currently approve edits blind. This is the #1 trust issue.
- **Effort:** Medium (diff data available in permission metadata)

### 1.2 Session Undo/Redo (**Critical**)

- Add `/undo` equivalent via the OpenCode SDK (`client.session.revert()`)
- Show "Undo last turn" button on the last assistant message
- Implement redo functionality
- **Impact:** Users can't recover from agent mistakes
- **Effort:** Low (SDK already supports it)

### 1.3 Context Usage & Cost Display

- Add context window usage meter to session header
- Show running cost from token counts
- Warning at 80% context usage
- **Impact:** Users fly blind on cost and context limits
- **Effort:** Low (data available from message metadata)

### 1.4 Session Compact/Summarize

- Add "Compact" action in command palette and status bar
- Wire to `client.session.compact()` via SDK
- Show compaction summary in chat
- **Impact:** Sessions become unusable when context fills up
- **Effort:** Low (SDK supports it)

---

## Phase 2: Prompt Power (1-2 weeks)

> **Goal:** Make the prompt input competitive with OpenCode TUI's rich input capabilities.

### 2.1 `@` File Mentions

- Implement fuzzy file search triggered by `@` in the textarea
- Show results in a floating autocomplete popup
- Insert selected file as context (with optional line range `#10-20`)
- **Impact:** Highest-impact prompt improvement for code-focused tasks
- **Effort:** Medium (need file listing API, fuzzy search, popup UI)

### 2.2 Slash Commands

- Add `/` trigger for command autocomplete in the textarea
- Include: `/compact`, `/fork`, `/undo`, `/redo`, `/share`, `/export`
- **Impact:** Keyboard-driven users expect commands
- **Effort:** Medium (need command registry, autocomplete popup)

### 2.3 Prompt History

- Up/Down arrow navigation through previous prompts
- Store in `persisted-store.ts`
- **Impact:** Users frequently refine and reuse prompts
- **Effort:** Low

### 2.4 Enrich Command Palette

- Add session operations, display mode, navigation commands
- Add project switching
- Show keybind hints
- **Impact:** Cmd+K is the power user's primary interface
- **Effort:** Medium

---

## Phase 3: Code Review (2-3 weeks)

> **Goal:** Add the review and code browsing capabilities that make Codedeck a complete workspace.

### 3.1 Session Review Panel

- Resizable right panel showing all file changes in the session
- Per-file unified diffs with syntax highlighting
- File change summary header (files, additions, deletions)
- Wire to `client.session.diff()` API
- **Impact:** Core value prop for a desktop coding assistant
- **Effort:** High (new panel, diff rendering, file list)

### 3.2 Syntax-Highlighted Code Display

- Add Shiki for code block rendering in chat messages
- Syntax highlighting in tool call outputs (file reads, bash results)
- Copy button on code blocks
- **Impact:** Code readability is fundamental for a coding tool
- **Effort:** Medium

### 3.3 File Tree Panel

- Collapsible file tree in a sidebar or panel
- "All files" and "Changes" filter modes
- File type icons and change indicators
- Click to view file content
- **Impact:** Project navigation without leaving the app
- **Effort:** High (file listing API, tree rendering, viewer)

---

## Phase 4: Personalization (1-2 weeks)

> **Goal:** Let users customize Codedeck to their preferences.

### 4.1 Theme System

- Define 5-8 themes (One Dark, Dracula, Nord, Catppuccin, Solarized, plus 2 light themes)
- Dark/Light/System mode toggle
- Theme selector in Settings or command palette
- CSS custom properties for theme tokens
- **Impact:** Daily driver adoption requires visual comfort
- **Effort:** Medium

### 4.2 Settings Dialog

- General: Theme, display mode, font (if applicable)
- Shortcuts: View/customize keybindings
- Notifications: Enable/disable per-event
- **Impact:** Users expect to customize their tools
- **Effort:** Medium

### 4.3 Keyboard Shortcut System

- Configurable keybindings stored in persisted store
- Support Cmd/Ctrl modifiers
- Help dialog showing all shortcuts
- **Impact:** Power user productivity
- **Effort:** Medium

---

## Phase 5: Session Management (1-2 weeks)

> **Goal:** Bring session management to parity with OpenCode TUI.

### 5.1 Fork Session

- Fork from current point or from any message in the timeline
- Wire to `client.session.fork()` API
- **Impact:** Essential for exploring alternative approaches
- **Effort:** Low (SDK supports it, need timeline UI)

### 5.2 Share Session

- Create public URL via `client.session.share()`
- Copy URL to clipboard with toast notification
- **Impact:** Collaboration and knowledge sharing
- **Effort:** Low

### 5.3 Export Session

- Export as Markdown file
- Wire to `client.session.export()` API
- **Impact:** Documentation and record-keeping
- **Effort:** Low

### 5.4 Session Archive

- Move completed sessions to an "Archive" section
- Configurable auto-archive after N hours
- **Impact:** Keep the sidebar clean over time
- **Effort:** Low

---

## Phase 6: Environment & Terminal (3-4 weeks)

> **Goal:** Add the workspace features that justify a desktop app over the TUI.

### 6.1 Embedded Terminal

- Add xterm.js (or similar) terminal emulator
- Connect via WebSocket to OpenCode's PTY API
- Support multiple terminal tabs
- **Impact:** Eliminates need to switch to a separate terminal
- **Effort:** High (terminal emulation, PTY connection, tab management)

### 6.2 Notification System

- Native desktop notifications (via Electron)
- In-app toast notifications
- Sound effects for key events
- Per-event configurable toggles
- **Impact:** Users miss important events when app is backgrounded
- **Effort:** Medium

### 6.3 Provider Management

- Connect new providers from within the app
- Show connected provider status
- MCP server management
- **Impact:** First-time setup without leaving the app
- **Effort:** High (provider setup flows, API key management)

---

## Phase 7: Advanced & Differentiating (4+ weeks)

> **Goal:** Build features that set Codedeck apart from OpenCode.

### 7.1 Multi-Agent Overview Dashboard

- Unified activity feed across all projects
- Aggregate metrics (total cost, tokens, active agents)
- Attention-required alerts
- **Impact:** Codedeck's core differentiator as a "mission control"
- **Effort:** High

### 7.2 Git Workflow Integration

- Branch visualization per session
- "Create PR" action for completed sessions
- PR status tracking
- Merge conflict detection
- **Impact:** Completes the agent lifecycle
- **Effort:** High

### 7.3 Voice Input (using existing components)

- Leverage `speech-input.tsx`, `mic-selector.tsx` from the UI library
- Speech-to-text for prompt input
- **Impact:** Novel interaction mode for hands-free coding
- **Effort:** Medium (components exist, need integration)

### 7.4 Cloud/VM Execution Environments

- Implement the DESIGN.md vision for multi-environment agents
- Local worktree, Docker containers, Cloudflare Containers
- Agent mobility between environments
- **Impact:** Major differentiator but huge scope
- **Effort:** Very High

---

## Timeline Summary

| Phase                        | Duration     | Key Deliverables                                |
| ---------------------------- | ------------ | ----------------------------------------------- |
| **Phase 1**: Trust & Core    | 2-3 weeks    | Diff preview, undo/redo, context usage, compact |
| **Phase 2**: Prompt Power    | 1-2 weeks    | @ mentions, slash commands, prompt history      |
| **Phase 3**: Code Review     | 2-3 weeks    | Review panel, syntax highlighting, file tree    |
| **Phase 4**: Personalization | 1-2 weeks    | Themes, settings, keyboard shortcuts            |
| **Phase 5**: Session Mgmt    | 1-2 weeks    | Fork, share, export, archive                    |
| **Phase 6**: Environment     | 3-4 weeks    | Terminal, notifications, providers              |
| **Phase 7**: Differentiating | 4+ weeks     | Dashboard, git workflow, voice, cloud           |
| **Total**                    | ~14-17 weeks | Full feature parity + differentiation           |

## Quick Wins (Can Be Done Anytime)

These require minimal effort and can be sprinkled into any phase:

1. **Show "load earlier messages" count** — Display how many messages are hidden
2. **Add prompt history** — Store last 20 prompts in persisted store
3. **Session archive** — Simple filter to hide old sessions
4. **Keyboard shortcut: Cmd+N** — Already mentioned in command palette but not wired
5. **Context usage display** — Token counts from message metadata
6. **Double-click to rename** — Add to session items alongside right-click
7. **Escape to clear prompt** — Common UX pattern for text inputs
8. **Auto-scroll toggle** — Pin/unpin auto-scroll behavior
