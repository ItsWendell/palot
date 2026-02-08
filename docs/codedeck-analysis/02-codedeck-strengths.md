# Codedeck Strengths: Where Codedeck Excels

> Areas where Codedeck is better than, different from, or has unique advantages over OpenCode TUI and OpenCode Desktop.

## 1. Streaming Performance Architecture

**Codedeck's dual-store streaming approach is more sophisticated than OpenCode Desktop's.**

Codedeck separates streaming state from main state using two stores:

- **`app-store.ts`**: Main Zustand store for persistent session/message state
- **`streaming-store.ts`**: Lightweight purpose-built store for high-frequency text/reasoning part updates during streaming

The streaming store:

- Accumulates updates at full SSE speed without triggering React re-renders
- Notifies React subscribers at a throttled ~50ms cadence (20 updates/sec)
- Flushes to the main store when a session goes idle
- Uses `useSyncExternalStore` for correct React 19 integration

The event batcher in `connection-manager.ts` adds:

- **Event coalescing**: Only the latest `message.part.updated` per part ID is kept per flush
- **rAF-aligned flushing**: Dispatches align with the browser's paint cycle
- **16ms frame budget**: First event after quiet period flushes immediately (low latency), subsequent events batch until next paint

**OpenCode Desktop** uses a simpler approach: events flow through a single SolidJS store with a WebSocket event listener. SolidJS's fine-grained reactivity handles the update batching implicitly, but this makes it harder to control the exact flush cadence.

**Verdict:** Codedeck's explicit streaming architecture gives it better control over performance during heavy streaming, especially on lower-powered machines. This is a genuine engineering advantage.

## 2. Multi-Project Dashboard Experience

**Codedeck is designed as a multi-project management tool from day one.**

Codedeck's sidebar organizes sessions into three sections:

- **Active Now**: Running/waiting sessions across ALL projects, sorted by creation time
- **Recent**: Recently active sessions across all projects
- **Projects**: Collapsible project folders with session lists, expandable with "Show more"

This creates a **mission control** experience where users see all their AI agents across every project in one view, with active sessions surfaced to the top.

**OpenCode TUI** is single-project by design. You run one instance per project directory. There is no cross-project visibility.

**OpenCode Desktop** has multi-project support via a sidebar, but it's organized as a project list (left column of icons) with per-project session lists. You must click between projects to see their sessions.

**Verdict:** Codedeck's flat "Active Now" + "Recent" sections across all projects is a better UX for users managing multiple concurrent agents. You see everything that matters without clicking into project folders.

## 3. Sub-Agent Visibility Toggle

**Codedeck has a dedicated toggle for showing/hiding sub-agent sessions.**

The sidebar header includes a sub-agent count badge and toggle button. When hidden:

- Sub-agent sessions (those with `parentID`) are excluded from the sidebar
- Project session counts only reflect top-level sessions
- The UI stays clean when agents spawn many sub-tasks

When shown:

- Sub-agents appear with a `GitBranchIcon` to distinguish them from parent sessions
- Full parent-child navigation is available via breadcrumbs in `AgentDetail`

**OpenCode TUI** shows sub-agents inline in session lists but navigates between them with `Ctrl+X Left/Right/Up`.

**OpenCode Desktop** doesn't have an explicit toggle; sub-agents are part of the session hierarchy.

**Verdict:** The toggle is a thoughtful UX feature for power users who spawn many sub-agents. It prevents sidebar clutter without losing access to sub-agent details when needed.

## 4. Turn-Based Display Mode Cycling

**Codedeck offers three display density modes: Default, Compact, and Verbose.**

Persisted across sessions in `persisted-store.ts`:

- **Default**: Active turns show tools expanded; completed turns show pill summary bar
- **Compact**: Active turns show only last 5 parts; completed turns show pill bar
- **Verbose**: All turns show all tools expanded

Users cycle with a single click on the status bar icon.

**OpenCode TUI** has a single display mode with `/details` toggle and `/thinking` toggle for reasoning blocks.

**OpenCode Desktop** has turn-level vs session-level diff toggling but not chat density modes.

**Verdict:** The three density modes are a genuine UX innovation. Verbose mode is great for debugging agent behavior, compact mode is great for monitoring, and default balances both. This is something OpenCode could learn from.

## 5. Tool Category Color System

**Codedeck color-codes tool calls by category with left-border accents.**

```
explore (read, glob, grep, list)     → muted gray border
edit (edit, write, apply_patch)      → amber border
run (bash)                           → blue border
delegate (task)                      → violet border
plan (todowrite, todoread)           → emerald border
ask (question)                       → cyan border
fetch (webfetch)                     → sky border
```

The pill summary bar groups tools by category with icons, so users can instantly see "3 reads, 2 edits, 1 bash command" at a glance.

**OpenCode TUI** shows tool names in message parts but without color categorization.

**OpenCode Desktop** shows tool calls in `MessagePart` components but without category-based color coding.

**Verdict:** The color-coded tool categories make it much easier to scan what an agent did at a glance. This is a visual design win.

## 6. AI Element Component Library

**Codedeck's `packages/ui` has an extensive `ai-elements/` directory with 50+ components.**

Many of these are forward-looking components not yet used in the app:

- `canvas.tsx` - Visual canvas component
- `jsx-preview.tsx` - Live JSX preview
- `web-preview.tsx` - Web page preview
- `sandbox.tsx` - Sandboxed execution view
- `speech-input.tsx` / `mic-selector.tsx` - Voice input
- `audio-player.tsx` - Audio playback
- `transcription.tsx` - Speech transcription display
- `inline-citation.tsx` - Source citations
- `sources.tsx` - Source attribution
- `chain-of-thought.tsx` - Reasoning visualization
- `plan.tsx` - Plan display
- `test-results.tsx` - Test result visualization
- `stack-trace.tsx` - Error stack traces
- `environment-variables.tsx` - Env var display
- `package-info.tsx` - Package metadata

**Verdict:** This component library represents significant investment in future UI capabilities. Many of these components (voice input, web preview, sandbox, canvas) suggest a vision for AI-native UX that goes beyond what OpenCode currently offers.

## 7. Optimistic UI Updates

**Codedeck shows user messages and file attachments immediately before server confirmation.**

In `use-server.ts`:

- Creates an optimistic user message with `optimistic-` prefix ID
- Creates optimistic text and file parts
- Shows images immediately in the chat view
- Removes the optimistic message when the real server message arrives

**OpenCode TUI** also does optimistic updates via the SolidJS store in `sync.tsx`, but Codedeck's implementation is particularly clean with the binary-search-based replacement logic.

**OpenCode Desktop** uses `applyOptimisticAdd` in its sync context for the same purpose.

**Verdict:** Parity, but Codedeck's implementation is well-documented and clean.

## 8. Draft Persistence

**Codedeck persists prompt drafts across session switches and page reloads.**

In `persisted-store.ts`:

- Drafts are keyed by session ID (or `__new_chat__` for the home screen)
- Persisted to localStorage via Zustand's `persist` middleware
- `DraftSync` component syncs the PromptInputProvider's text state to the store

**OpenCode TUI** has a prompt stash feature (`Ctrl+X S`) that saves and restores prompt drafts, but it's manual.

**OpenCode Desktop** doesn't appear to have automatic draft persistence.

**Verdict:** Codedeck's automatic draft persistence is a small but meaningful UX improvement. Users don't lose their half-typed prompts when switching sessions.

## 9. Attach-from-Terminal Feature

**Codedeck provides "Attach from terminal" functionality in both the sidebar and per-session.**

- **Global attach**: Sidebar header button copies `opencode attach <url> --dir .` to clipboard
- **Session attach**: Per-session button copies `opencode attach <url> --session <id> --dir <dir>`
- Both show a popover explaining the command with auto-copy

This creates a bridge between Codedeck's GUI and OpenCode's TUI, allowing users to:

1. Start a session in Codedeck
2. Attach from terminal for keyboard-heavy work
3. See updates in both interfaces in real-time

**OpenCode TUI** has `opencode attach` as a CLI command but no GUI triggers it.

**OpenCode Desktop** doesn't have this feature.

**Verdict:** This is a unique workflow enabler that acknowledges the TUI's strengths while providing a GUI entry point.

## 10. Clean Single-Server Architecture

**Codedeck's migration to a single OpenCode server is architecturally simpler than multi-server.**

After the PLAN-single-server migration:

- One `opencode serve` process handles all projects
- Per-project SDK clients share the same URL with different `x-opencode-directory` headers
- One SSE stream delivers events for all projects
- The store is flat (sessions not nested under servers)

**OpenCode Desktop** uses a similar approach where one server process serves the entire app, with per-directory scoping.

**Verdict:** This is now at parity with OpenCode Desktop's approach, which is cleaner than the original multi-server design.

## 11. Ambitious Future Vision

**Codedeck's DESIGN.md outlines capabilities neither OpenCode version has:**

- **Three execution tiers**: Local worktree, local VM (Docker/OrbStack), cloud container (Cloudflare)
- **Agent mobility**: Move agents between environments with state preserved
- **Cloud containers**: Cloudflare Container-based sandboxed execution
- **Migration protocol**: Git-based state transfer + session export/import
- **Resource monitoring**: CPU, memory, disk per agent

These features are unimplemented but the vision document is comprehensive and the architecture supports it. If executed, this would be a significant differentiator.
