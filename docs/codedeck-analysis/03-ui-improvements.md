# UI Improvements for Codedeck

> Specific visual and component-level improvements Codedeck should make, informed by OpenCode TUI and Desktop patterns.

## High Priority

### 1. Add Diff Preview to Permission Requests

**Current state:** `chat-permission.tsx` shows permission title + tool name + truncated command. No diff content.

**Target:** Show the actual file diff content within the permission card, with syntax highlighting and expand-to-fullscreen option.

**How OpenCode does it:**

- TUI: Full diff view in `routes/session/permission.tsx` with split/unified modes and `Ctrl+F` for fullscreen
- Desktop: Full diff display using the Pierre diff worker in `MessagePart`

**Recommended implementation:**

- Use the `@pierre/diffs` package (already in `packages/ui` dependencies) to render diffs
- Add a collapsible diff section below the permission title
- Show file path, additions/deletions count
- Support expand-to-fullscreen for large diffs
- This is the single most impactful UI change for user trust

### 2. Add Session Review Panel

**Current state:** No way to see file changes across a session.

**Target:** Add a "Changes" tab or panel that shows all files modified during the session with diffs.

**How OpenCode does it:**

- Desktop: `SessionReview` component with file tree, per-file diffs, and line-level comments
- TUI: Sidebar shows file diff summary with additions/deletions

**Recommended implementation:**

- Add a resizable right panel (or toggle panel) showing changed files
- Use the OpenCode SDK's session diff API (`client.session.diff()`)
- Group by file path with collapsible unified diffs
- Show summary stats (files changed, additions, deletions) in a header

### 3. Add Syntax-Highlighted Code Display

**Current state:** Tool call outputs (file reads, bash results) are displayed as plain text in collapsible cards.

**Target:** Render code blocks with syntax highlighting, line numbers, and language detection.

**How OpenCode does it:**

- TUI: Tree-sitter based syntax highlighting for code blocks
- Desktop: Shiki-based highlighting via the `Code` component

**Recommended implementation:**

- Add Shiki (already popular in the React ecosystem) for syntax highlighting
- Detect language from file extensions in tool call metadata
- Add line numbers for file read results
- Support code block selection and copy

### 4. Enrich the Command Palette

**Current state:** `command-palette.tsx` has "Actions" (New Session only) and session search.

**Target:** Full command palette with session operations, display modes, navigation, and project switching.

**Recommended commands to add:**

- Session operations: Fork, Compact, Export, Share, Undo, Redo
- Display: Cycle display mode, Toggle sidebar, Toggle review panel
- Navigation: Jump to active sessions, Jump to recent, Open project
- Settings: Theme switching, Font selection
- Provider management: Connect provider, View MCP status

### 5. Show Context Usage & Cost

**Current state:** No token count, context percentage, or cost display anywhere.

**Target:** Show context usage bar and cost in the session header or status bar.

**How OpenCode does it:**

- TUI: Header shows "tokens / max (percentage%)" and "$X.XX" cost
- Desktop: `SessionContextUsage` component with progress circle

**Recommended implementation:**

- Add context usage indicator to the `AgentDetail` header bar
- Show input/output token counts from assistant message metadata
- Calculate running cost from token counts and model pricing
- Show context window percentage as a progress bar

## Medium Priority

### 6. Add Theme System

**Current state:** Single zinc dark theme via Tailwind v4.

**Target:** Support multiple themes with dark/light mode toggle.

**Recommended approach:**

- Define theme tokens as CSS custom properties (OpenCode Desktop's approach)
- Create at least 5-8 popular themes (One Dark, Dracula, Nord, Catppuccin, Gruvbox, plus 1-2 light themes)
- Add theme selector to a new Settings dialog
- Support system preference detection for auto dark/light
- Store preference in `persisted-store.ts`

### 7. Add File Tree Panel

**Current state:** No file browsing capability.

**Target:** Collapsible file tree showing project files with change indicators.

**How OpenCode does it:**

- Desktop: `file-tree.tsx` with "All files" and "Changes" modes, file type icons, color-coded change indicators

**Recommended implementation:**

- Use the OpenCode SDK to list project files
- Render as a collapsible tree with directory nodes
- Highlight changed files with green/red indicators
- Click to open file content in a viewer panel
- Drag-and-drop files to add as prompt context

### 8. Improve Tool Call Display

**Current state:** `ChatToolCall` renders tool calls with expandable `ToolCard` components showing title/subtitle/output.

**Target improvements:**

- **Bash commands**: Show command in a code-styled block, output with ANSI color rendering
- **File edits**: Show before/after diff (not just edit description)
- **File reads**: Show syntax-highlighted content with line numbers
- **Grep/glob**: Show results as clickable file paths with line numbers
- **Task (sub-agents)**: Show linked sub-agent with live status and navigation

### 9. Add Markdown Rendering for Responses

**Current state:** `<MessageResponse>` component from `@codedeck/ui` renders text. It's unclear if full markdown is supported.

**Target:** Full GFM markdown rendering with:

- Fenced code blocks with syntax highlighting and copy button
- Tables, lists, blockquotes
- Inline code styling
- Links (clickable, open externally)
- LaTeX/math rendering (for technical discussions)

**How OpenCode does it:**

- TUI: Custom in-terminal markdown renderer
- Desktop: `Markdown` component in `@opencode-ai/ui`

**Recommended implementation:**

- The `@codedeck/ui` package has `@streamdown` in its dependencies, suggesting this may be partially implemented
- Ensure full GFM support with Shiki for code blocks
- Add copy-code-block buttons

### 10. Add Notification System

**Current state:** No in-app or system notifications.

**Target:** Notify users when:

- An agent completes its work
- A permission request needs attention
- A question needs answering
- An agent fails/errors

**How OpenCode does it:**

- Desktop: Full notification system in `context/notification.tsx` with per-event toggles, sound effects, and native OS notifications

**Recommended implementation:**

- Use the Web Notifications API (or Electron notifications)
- Add configurable sound effects for key events
- Show toast notifications within the app
- Badge unseen sessions in the sidebar

## Lower Priority

### 11. Add Inline Title Editing for Sessions

**Current state:** Title editing exists (`SessionItem` has inline edit mode via context menu).

**Improvement:** Also support double-click to edit (in addition to right-click > Rename).

### 12. Add Session Timestamps

**Current state:** Relative timestamps only ("5m", "2h").

**Improvement:** Add an option to show absolute timestamps on messages (like OpenCode's `/timestamps` toggle).

### 13. Add Loading/Splash Screen

**Current state:** No loading state while the OpenCode server starts.

**Target:** Show a branded loading screen while waiting for the server to become ready.

**How OpenCode does it:**

- Desktop: Loading splash screen in `loading.tsx` shown during SQLite init

### 14. Add Keyboard Shortcut Help

**Current state:** No help dialog showing available shortcuts.

**Target:** Add a `?` or `Cmd+/` shortcut that shows all available keybindings.

### 15. Improve Empty States

**Current state:** Empty states show minimal text ("No sessions yet", "No messages yet").

**Target:** Add contextual help and actions to empty states:

- New project: "Run `opencode attach` from your project directory"
- No messages: Show suggested prompts (already done in `new-chat.tsx` but not in existing sessions)
- No projects found: Link to OpenCode docs with setup instructions
