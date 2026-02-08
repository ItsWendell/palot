# Message Queueing & Steering

## Status: Implemented

## Context

Users should be able to send follow-up messages while the AI is still responding. This is commonly called "queueing" or "steering" -- the user types a correction, clarification, or new instruction mid-response, and the AI incorporates it on its next loop iteration without losing its place.

OpenCode already supports this on the server side. The infrastructure is fully implemented in the `SessionPrompt.prompt()` / `loop()` functions. Codedeck's desktop app currently **blocks the input** while the AI is working (`canSend = isConnected && !isWorking && !sending`), so the feature is invisible to users.

### How OpenCode's queueing works (server side)

The server uses a **promise-callback queue** pattern:

1. `prompt()` is called with the user's message
2. `createUserMessage()` **immediately persists** the message to storage (regardless of busy state)
3. `loop()` calls `start(sessionID)` -- if the session already has an active loop, `start()` returns `undefined`
4. When `start()` returns `undefined`, `loop()` pushes a `{ resolve, reject }` callback onto `state()[sessionID].callbacks` and returns a pending Promise
5. The active loop re-reads messages from storage on each step -- so it naturally sees the new user message
6. The loop's exit condition checks `lastUser.id < lastAssistant.id` -- a new user message (with a higher ID) prevents the loop from exiting
7. On `step > 1`, user messages that arrived after the last finished assistant message get wrapped in `<system-reminder>` tags (ephemeral, on a clone -- original messages are unmodified):
   ```
   <system-reminder>
   The user sent the following message:
   {original text}

   Please address this message and continue with your tasks.
   </system-reminder>
   ```
8. When the loop finally finishes, all queued callbacks are resolved with the same final assistant message

**Key insight**: There is no explicit queue data structure for messages. The queue is *implicit* -- messages are persisted immediately, and the processing loop discovers them by re-reading storage.

### What Codedeck does today

| Aspect | Current behavior | Problem |
|---|---|---|
| Input while busy | Textarea shows "Waiting for response...", submit is disabled | User cannot type or send |
| Stop button | In top bar header only (not in submit button) | Separate from input, easy to miss |
| `PromptInputSubmit` | Has `onStop` prop and streaming state support | Not wired up -- `onStop` is never passed |
| `sendPrompt()` | Sends optimistic message + `promptAsync` | Works fine -- server handles queueing |
| Abort | `useAgentActions().abort()` exists and works | Only reachable from header stop button |

## Implementation Plan

### Phase 1: Enable input while busy (Effort: LOW)

The most impactful change: let users type and send messages while the AI is running. The server already handles queueing -- we just need to stop blocking the UI.

**Files to change:**

1. **`apps/desktop/src/components/chat/chat-view.tsx`** -- `ChatView`
   - Remove `isWorking` from the `canSend` guard: `const canSend = isConnected && !sending`
   - The `sending` flag still prevents double-submit of the same message (it's set true during the `promptAsync` call and cleared in `finally`), so rapid clicking is still safe
   - Change the textarea placeholder when working from "Waiting for response..." to something that invites input, e.g. "Send a follow-up or correction..."
   - Keep the `status={isWorking ? "streaming" : undefined}` on `PromptInputSubmit` so the button still shows the stop icon when no text is entered

2. **`apps/desktop/src/components/chat/chat-view.tsx`** -- `PromptInputSubmit`
   - Wire up `onStop` prop to trigger abort: `onStop={() => onStop?.(agent)}`
   - This makes the submit button dual-purpose: stop (when empty + streaming) or send (when text entered)
   - Pass `onStop` through from `AgentDetail` via a new prop on `ChatView`

3. **`apps/desktop/src/components/agent-detail.tsx`** -- `AgentDetail`
   - Pass `onStop` through to `ChatView` (currently only used for the header stop button)

**Behavior after Phase 1:**

| State | Submit button | Action |
|---|---|---|
| Idle, no text | Arrow (disabled) | Nothing |
| Idle, has text | Arrow (enabled) | Send message |
| Working, no text | Square/stop (enabled) | Abort session |
| Working, has text | Arrow (enabled) | Send queued message |

### Phase 2: Optimistic UI for queued messages (Effort: LOW)

The existing `sendPrompt()` already creates optimistic messages. These will appear immediately in the chat regardless of session state. The SSE event flow will naturally replace them when the server persists the real user message.

**Verify (no code changes expected):**
- Optimistic message appears instantly below the streaming response
- When the server confirms the user message via `message.updated` SSE event, the optimistic message is replaced (existing `upsertMessage` logic handles `optimistic-*` ID cleanup)
- The streaming response continues uninterrupted above the queued message

**Potential issue to test:**
- If `promptAsync` rejects (network error), the optimistic message stays. Consider adding rollback (remove optimistic message + restore input text). This is an existing gap that affects all messages, not specific to queueing -- can be addressed separately.

### Phase 3: Visual distinction for queued messages (Effort: LOW-MEDIUM)

Users need feedback that their message was queued, not immediately processed.

**Files to change:**

1. **`apps/desktop/src/components/chat/chat-turn.tsx`** -- `ChatTurnComponent`
   - Detect queued messages: a user message is "queued" if it appears after an assistant message that hasn't finished yet (i.e., the turn below has `isWorking && isLast`)
   - Simpler: check if the user message's optimistic ID is still present (hasn't been replaced by server-confirmed message yet) AND `isWorking` is true
   - Show a subtle "Queued" badge or muted styling on queued user messages
   - Once the AI starts processing the queued message (its turn gets a response), the badge disappears naturally

2. **`apps/desktop/src/stores/app-store.ts`** -- consider adding a `queued` flag to optimistic messages
   - When `sendPrompt` creates an optimistic message while the session is running, tag it with a marker
   - This makes detection in the UI trivial

**Visual treatment options:**
- Subtle "Queued" badge next to the user message timestamp
- Slightly muted opacity (0.7) with a brief fade-in when the message gets processed
- A small queue icon (e.g., `ListOrderedIcon` from lucide) next to the message

### Phase 4: Input UX polish (Effort: MEDIUM)

Refine the input experience during active responses.

1. **Keyboard shortcut: Escape to abort**
   - Add `onKeyDown` handler to `PromptInputTextarea` (or the `ChatView` wrapper)
   - When Escape is pressed and input is empty and session is running, trigger abort
   - Consider double-press pattern (like OpenCode TUI) to prevent accidental aborts:
     - First Escape: show "Press Esc again to stop" hint in the status bar
     - Second Escape within 3s: trigger abort
     - After 3s: reset

2. **Status bar feedback**
   - Show "Message queued -- will be addressed next" in the `StatusBar` component briefly after a queued message is sent
   - Show "Press Esc to stop" when the session is running and input is empty

3. **Auto-scroll behavior**
   - Ensure the conversation auto-scrolls to show the newly queued user message
   - Current auto-scroll (in `Conversation` component) should handle this since `upsertMessage` triggers a re-render, but verify

### Phase 5: Multiple queued messages (Effort: LOW)

The server supports multiple queued messages naturally (each `prompt()` call pushes another callback). Verify that:

1. Multiple rapid sends create multiple optimistic messages in order
2. All queued messages appear in the chat in submission order
3. The AI addresses all of them (server's steering wrap handles this)
4. All optimistic messages get properly replaced by server-confirmed messages

**No code changes expected** -- this should work out of the box given the server's implicit queue design and the store's sorted-insert logic.

## Out of scope (for now)

- **Edit/retract queued messages** -- once sent, the message is persisted server-side. Would need a new `session.retract` API endpoint.
- **Queue reordering** -- messages are processed in ID order, which matches submission order. No reordering UX.
- **Queue limit** -- the server has no limit on queued callbacks. Could add a client-side guard (e.g., max 5 pending messages) if abuse becomes an issue.
- **Interrupt + replace** -- a pattern where the user aborts the current response AND sends a new message atomically. This is complex and the simple "queue" model (let it finish, then address) is sufficient for now.

## Key Files Reference

| Concern | Path |
|---|---|
| Chat view (submit guard, input) | `apps/desktop/src/components/chat/chat-view.tsx` |
| Agent detail (stop button, layout) | `apps/desktop/src/components/agent-detail.tsx` |
| Send prompt + optimistic messages | `apps/desktop/src/hooks/use-server.ts` |
| Zustand store (message upsert) | `apps/desktop/src/stores/app-store.ts` |
| Chat turn rendering | `apps/desktop/src/components/chat/chat-turn.tsx` |
| Prompt toolbar + status bar | `apps/desktop/src/components/chat/prompt-toolbar.tsx` |
| Shared PromptInput (submit button) | `packages/ui/src/components/ai-elements/prompt-input.tsx` |
| Server-side queueing (reference) | `../opencode/packages/opencode/src/session/prompt.ts` |
