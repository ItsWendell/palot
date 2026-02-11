# Undo/Redo, Slash Commands, and @Mentions Plan

> **Goal:** Bring Palot's input experience to parity with the OpenCode TUI — undo/redo for conversation turns, slash commands for quick actions, and @mentions for file/agent references.

## Current State

Palot has **none** of these features today:

- All user text goes directly to `promptAsync()` — there is no input parsing layer
- The textarea is a plain `<textarea>` element (`PromptInputTextarea` in `packages/ui`)
- No command dispatch, no autocomplete, no mention tokens
- The OpenCode server already exposes the necessary APIs (`revert`, `unrevert`, `command`, `find.files`, `app.agents`)
- The OpenCode TUI already implements all three features — we can reference its patterns

---

## Feature 1: Undo/Redo

### How the Server Handles It

The OpenCode server has a two-phase revert system (see `packages/opencode/src/session/revert.ts`):

1. **`POST /session/:id/revert`** — Takes `{ messageID, partID? }`. Snapshots current filesystem state via `git write-tree`, reverts file changes by checking out previous versions, sets `session.revert = { messageID, snapshot, diff }`, and fires `session.updated` + `session.diff` SSE events. **Messages are NOT deleted** — they remain in storage, soft-marked by the `session.revert` field.

2. **`POST /session/:id/unrevert`** — Restores the filesystem snapshot, clears `session.revert`, fires `session.updated`.

3. **Cleanup** — When a new prompt is sent while `session.revert` is set, `SessionRevert.cleanup()` permanently deletes messages after the revert point and fires `message.removed` events.

### SDK Methods

```typescript
// Undo: revert to a specific message
client.session.revert({
  sessionID: string,
  messageID: string,   // in body
  partID?: string,     // in body
})
// Returns: Session (with .revert field populated)

// Redo: restore reverted messages
client.session.unrevert({
  sessionID: string,
})
// Returns: Session (with .revert field cleared)
```

The `Session` type tracks revert state:
```typescript
session.revert?: {
  messageID: string
  partID?: string
  snapshot?: string
  diff?: string
}
```

### TUI Reference

The TUI's undo/redo logic lives in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`:

- **Undo** (lines 445-479): If session is busy, abort first. Find the last user message before any existing revert point. Call `session.revert({ messageID })`. Restore the user's prompt text from the reverted message's parts.
- **Redo** (lines 482-508): Find the next user message after the revert point. If there is one, call `revert` again with that message ID (moves revert forward). If there isn't, call `unrevert` (fully restores).
- **Keybinds**: `<leader>u` for undo, `<leader>r` for redo (leader = ctrl+x)

### Implementation Steps

#### Step 1: Service Layer

Add to `apps/desktop/src/renderer/services/opencode.ts`:
```typescript
export async function revertSession(
  client: OpencodeClient,
  sessionId: string,
  messageId: string,
): Promise<Session> {
  const result = await client.session.revert({
    sessionID: sessionId,
    messageID: messageId,
  })
  return result.data as Session
}

export async function unrevertSession(
  client: OpencodeClient,
  sessionId: string,
): Promise<Session> {
  const result = await client.session.unrevert({
    sessionID: sessionId,
  })
  return result.data as Session
}
```

#### Step 2: Hook Actions

Add to `useAgentActions()` in `apps/desktop/src/renderer/hooks/use-server.ts`:
```typescript
const revert = useCallback(async (directory: string, sessionId: string, messageId: string) => {
  const client = getProjectClient(directory)
  if (!client) throw new Error("Not connected")
  // If session is busy, abort first
  const entry = useAppStore.getState().sessions[sessionId]
  if (entry?.status === "busy") {
    await client.session.abort({ sessionID: sessionId })
  }
  await client.session.revert({ sessionID: sessionId, messageID: messageId })
}, [])

const unrevert = useCallback(async (directory: string, sessionId: string) => {
  const client = getProjectClient(directory)
  if (!client) throw new Error("Not connected")
  await client.session.unrevert({ sessionID: sessionId })
}, [])
```

#### Step 3: Message Re-fetch After Revert

After revert/unrevert, the message list needs refreshing. The `session.updated` SSE event will update the session's `.revert` field in the store. For message visibility, we have two options:

**Option A (Preferred): Client-side filtering.** When `session.revert` is set, filter out messages at/after `revert.messageID` in `useSessionChat`. This avoids a re-fetch and matches TUI behavior where messages are hidden but not deleted.

**Option B: Re-fetch.** Call `useSessionChat`'s `reload()` after the revert call completes. This is simpler but adds a network round-trip.

#### Step 4: Keyboard Shortcuts

In `apps/desktop/src/renderer/components/root-layout.tsx`, add to `handleKeyDown`:
```typescript
// Cmd+Z — undo last turn
if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
  e.preventDefault()
  // Find selected session, find last user message, call revert
}

// Cmd+Shift+Z — redo
if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
  e.preventDefault()
  // Call unrevert on selected session
}
```

**Guards:**
- Session must exist and be selected
- Session must not be busy (or we abort first, matching TUI behavior)
- For undo: must have at least one user message to revert to
- For redo: `session.revert` must be set

#### Step 5: Per-Turn Undo Button

In `apps/desktop/src/renderer/components/chat/chat-turn.tsx`, add an "Undo from here" action button in the `<MessageActions>` section (alongside the existing "Copy response" button). This gives users a click target for reverting to a specific turn, not just the most recent.

#### Step 6: Revert State Indicator

When `session.revert` is set, show a banner above the input area in `chat-view.tsx`:
```
"Session reverted — type to continue from here, or press Cmd+Shift+Z to redo"
```
Also consider restoring the reverted user message's text into the prompt input (matching TUI behavior), so the user can edit and re-send.

#### Step 7: Command Palette Entries

Add "Undo Last Turn" and "Redo" to the command palette in `command-palette.tsx`.

### Key Files to Modify

| File | Changes |
|------|---------|
| `renderer/services/opencode.ts` | Add `revertSession`, `unrevertSession` |
| `renderer/hooks/use-server.ts` | Add `revert`, `unrevert` to `useAgentActions()` |
| `renderer/hooks/use-session-chat.ts` | Filter messages based on `session.revert` |
| `renderer/components/root-layout.tsx` | Add Cmd+Z / Cmd+Shift+Z keyboard shortcuts |
| `renderer/components/chat/chat-turn.tsx` | Add "Undo from here" action button |
| `renderer/components/chat/chat-view.tsx` | Add revert state banner, prompt text restoration |
| `renderer/components/command-palette.tsx` | Add undo/redo command entries |

---

## Feature 2: Slash Commands

### How the Server Handles It

The OpenCode server has a command system (see `packages/opencode/src/command/index.ts`):

- **Built-in commands**: `init` (create/update AGENTS.md), `review` (review changes)
- **User-defined commands**: From `config.command` entries
- **MCP prompts**: Connected MCP servers expose prompts as commands
- **Skills**: Installed skills become commands

**API endpoints:**
- `GET /command` — Lists all available commands
- `POST /session/:id/command` — Executes a command with `{ command: string, arguments: string, parts?: FilePart[] }`

### TUI Reference

The TUI has two categories of slash commands:

**Client-side commands** (UI actions, no server call):
`/share`, `/rename`, `/timeline`, `/fork`, `/compact`, `/unshare`, `/undo`, `/redo`, `/timestamps`, `/thinking`, `/copy`, `/export`, `/editor`, `/skills`

**Server-side commands** (sent via `POST /session/:id/command`):
`/init`, `/review`, user-defined commands, MCP prompts

**Parsing** (from `prompt/index.tsx` lines 572-624):
1. Check if input starts with `/` and the command name matches a known server command
2. Split first line: `/<command> <arguments>`
3. Client commands are dispatched directly
4. Server commands call `client.session.command()`

### Implementation Steps

#### Step 1: Fetch Available Commands

Add a hook to fetch commands from the server:
```typescript
// Uses client.command.list() — returns available server-side commands
// Combined with local command definitions for client-side actions
```

#### Step 2: Input Interception

In `chat-view.tsx`'s `handleSend`, before calling `onSendMessage`, check if the text starts with `/`:

```typescript
const handleSend = async (text: string, files?: FileAttachment[]) => {
  if (text.startsWith("/")) {
    const handled = await handleSlashCommand(text)
    if (handled) return
  }
  // ... existing send logic
}
```

For **client-side commands** (`/undo`, `/redo`, `/compact`, `/share`, etc.): execute directly, no server call.

For **server-side commands** (`/init`, `/review`, custom): call `client.session.command()`:
```typescript
client.session.command({
  sessionID,
  command: commandName,
  arguments: argsString,
})
```

#### Step 3: Autocomplete Popup

When the user types `/` at the start of the input (or after a newline), show an autocomplete dropdown listing available commands. This requires:

1. A new `SlashCommandAutocomplete` component
2. Triggering on `/` keypress at cursor offset 0
3. Filtering the command list by typed text
4. Enter/click to select and either execute or fill

This component should be rendered as a popover anchored to the textarea cursor position. The library choice for cursor-aware popovers is discussed in "Rich Input" below.

#### Step 4: Register Client-Side Commands

Create a command registry for client-side commands:
```typescript
const CLIENT_COMMANDS = [
  { name: "undo", description: "Undo the last turn", action: handleUndo },
  { name: "redo", description: "Redo the last undone turn", action: handleRedo },
  { name: "compact", description: "Summarize the conversation", action: handleCompact },
  { name: "share", description: "Share the conversation", action: handleShare },
  { name: "clear", description: "Start a new session", action: handleClear },
  // ...
]
```

### Key Files to Modify

| File | Changes |
|------|---------|
| `renderer/hooks/use-opencode-data.ts` | Add `useCommands()` hook to fetch server commands |
| `renderer/components/chat/chat-view.tsx` | Add slash command interception in `handleSend` |
| `renderer/components/chat/slash-command-autocomplete.tsx` | **New** — autocomplete popup |
| `renderer/lib/commands.ts` | **New** — client-side command registry |

---

## Feature 3: @Mentions (Files and Agents)

### How the Server Handles It

When the prompt includes `FilePart` or `AgentPart` entries alongside text, the server:

- **File references**: Reads the file content and injects it as synthetic message parts. Supports line ranges via `source: { start, end }` on `FilePart`.
- **Agent references**: Creates a `task` tool delegation to the named agent.

**API for file search**: `GET /find/file?query=...` returns matching files in the project, sorted by relevance. The TUI uses this for autocomplete.

### TUI Reference

From `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`:

- **Trigger**: `@` preceded by whitespace or at input start
- **Options**:
  1. **Files** — fetched from `client.find.files({ query })`, sorted by frecency
  2. **Agents** — from `sync.data.agent` (available subagents like `@plan`, `@explore`)
  3. **MCP Resources** — from connected MCP servers
- **Line ranges**: `@file.ts#10-20` references specific lines
- **Tab for directories**: Pressing Tab on a directory expands it instead of selecting
- **On select**: Inserts a visual token (`@filename` styled tag) and adds a `FilePart` or `AgentPart` to the prompt's parts array
- **On submit**: File/agent parts are sent alongside text parts to the server

### Implementation Steps

#### Step 1: Rich Textarea Upgrade

The current `PromptInputTextarea` is a plain `<textarea>`. @mentions require rendering styled tokens inline with text. This requires upgrading to a component that supports mixed content.

**Library options** (see Rich Input section below for full analysis):
1. **`rich-textarea`** (~3kB gzipped) — Drop-in textarea replacement with decoration support
2. **Tiptap** — Full ProseMirror-based editor with mention/slash-command extensions
3. **Custom contenteditable** — Most control, most work

#### Step 2: Autocomplete Popup for @

Similar to slash commands, show an autocomplete dropdown when the user types `@`:

1. Detect `@` trigger at cursor position
2. Fetch file results via `client.find.files({ query })` as user types
3. Show agents from `client.app.agents()`
4. On selection, insert a styled token and track it as a `FilePart` or `AgentPart`

#### Step 3: Parts Collection on Submit

When submitting, collect all mention tokens and convert them to SDK part objects:
```typescript
const parts: PromptPart[] = [
  { type: "text", text: plainText },
  ...fileMentions.map(f => ({
    type: "file",
    mime: "text/plain",
    url: `file://${f.path}`,
    filename: f.filename,
    source: f.lineRange ? { start: f.lineRange.start, end: f.lineRange.end } : undefined,
  })),
  ...agentMentions.map(a => ({
    type: "agent",
    name: a.name,
  })),
]
```

### Key Files to Modify

| File | Changes |
|------|---------|
| `packages/ui/src/components/ai-elements/prompt-input.tsx` | Replace or augment textarea with rich input |
| `renderer/components/chat/mention-autocomplete.tsx` | **New** — @mention autocomplete popup |
| `renderer/hooks/use-file-search.ts` | **New** — hook for `client.find.files()` |
| `renderer/hooks/use-server.ts` | Update `sendPrompt` to accept file/agent parts |

---

## Rich Input: Library Evaluation

The current textarea is plain HTML. Both slash commands and @mentions benefit from a richer input that supports cursor-aware popovers and styled tokens. Here's the evaluation:

### Option 1: `rich-textarea` (Recommended for phase 1)

- **Size**: ~3kB gzipped
- **Approach**: Renders a transparent `<textarea>` over a styled `<div>` mirror. Text input stays native.
- **Pros**:
  - Drop-in replacement for `<textarea>` — same API, same form behavior
  - Supports text decoration/coloring via a render function
  - Can expose caret position for positioning autocomplete popovers
  - Native textarea behavior preserved (selection, undo, IME, paste)
  - Works with controlled and uncontrolled modes
  - Compatible with React 19
- **Cons**:
  - Tokens aren't truly interactive DOM nodes (they're styled spans in a background div)
  - No built-in mention or slash-command system — we build the autocomplete ourselves
  - The `@file.ts` token in the text is just styled text, not a removable chip
- **Verdict**: Good for phase 1 — minimal migration risk. We style `@filename` and `/command` text visually, and build autocomplete popovers ourselves. Doesn't support true "token chips" but gets us 80% of the way.

### Option 2: Tiptap (prosemirror)

- **Size**: ~60-80kB gzipped (core + mention + suggestion extensions)
- **Approach**: Full ProseMirror document model with schema, plugins, and extensions.
- **Pros**:
  - First-class mention extension with styled, deletable token nodes
  - Built-in suggestion/autocomplete framework
  - Slash command extension available
  - Rich ecosystem, well-maintained
  - Used by Vercel's own AI chatbot canvas editor
- **Cons**:
  - Significant migration from textarea — different API, different state management
  - Much larger bundle
  - Overkill if we only need mentions and slash commands, not rich text editing
  - ProseMirror's schema model adds complexity for what is essentially a single-line-ish prompt input
  - May conflict with `PromptInputProvider`'s text state management
- **Verdict**: Better for a future phase if we need true rich editing (inline images, formatted text). Too heavy for the initial implementation.

### Option 3: Custom contenteditable

- **Pros**: Total control, minimal bundle size
- **Cons**: Enormous effort, cross-browser nightmares, IME issues, accessibility challenges
- **Verdict**: Not recommended unless we have very specific needs unmet by existing libraries.

### Recommendation

**Phase 1**: Use `rich-textarea` for styled text rendering + custom autocomplete popovers (using `@palot/ui`'s existing Popover/Command components). This keeps the textarea semantics and is a minimal migration.

**Phase 2** (later): If we need true token chips (clickable, deletable mention nodes), evaluate migrating to Tiptap. By then, Vercel's `ai-elements` may also have resolved [their open issue #179](https://github.com/vercel/ai-elements/issues/179) for rich input in PromptInput, which we could adopt.

---

## Implementation Order

| Phase | Feature | Effort | Dependencies |
|-------|---------|--------|-------------|
| **1a** | Undo/redo service layer + keyboard shortcuts | Small | None |
| **1b** | Undo/redo per-turn button + revert banner | Small | 1a |
| **1c** | Slash command interception + client-side commands | Medium | None |
| **2a** | Slash command autocomplete popup | Medium | 1c |
| **2b** | Server-side command integration | Small | 2a |
| **3a** | `rich-textarea` migration | Medium | None |
| **3b** | @mention autocomplete + file search | Large | 3a |
| **3c** | Agent @mentions | Small | 3b |

**Phase 1** (undo/redo + basic slash commands) can be done without any library changes.
**Phase 2** (autocomplete popups) needs cursor-position tracking but can use the existing textarea.
**Phase 3** (@mentions) requires the rich textarea upgrade for styled tokens.

---

## Open Questions

1. **Multi-step undo**: Should Cmd+Z walk back one turn at a time (like the TUI), or only undo the most recent? The TUI supports multi-step by calling `revert` with progressively earlier messageIDs.

2. **Revert while busy**: The TUI aborts the session before reverting. Should we do the same, or show a "stop first" warning?

3. **Message visibility during revert**: Should we filter reverted messages client-side (instant, no re-fetch) or rely on re-fetching from the server? Client-side filtering is more responsive.

4. **Shell mode**: The TUI supports `!command` prefix for shell execution via `client.session.shell()`. Do we want this in the desktop app?

5. **Paste handling**: The TUI collapses large pastes into `[Pasted ~N lines]` tokens. Should we replicate this?

---

## Reference: OpenCode TUI Source Locations

| Feature | File | Lines |
|---------|------|-------|
| Undo command | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 445-479 |
| Redo command | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 482-508 |
| Revert server logic | `packages/opencode/src/session/revert.ts` | 1-122 |
| Server revert route | `packages/opencode/src/server/routes/session.ts` | 838-901 |
| Slash command parsing | `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` | 572-624 |
| Command execution server | `packages/opencode/src/session/prompt.ts` | 1646-1710 |
| @mention autocomplete | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | 49-667 |
| File search API | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | 221-291 |
| Agent list | `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | 333-353 |
| Command list route | `packages/opencode/src/server/server.ts` | 317 |
