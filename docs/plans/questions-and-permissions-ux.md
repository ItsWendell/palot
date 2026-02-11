# Questions & Permissions UX Plan

> **Goal:** Make it immediately clear when an agent is blocked on user input — whether that's a permission request, a question from `mcp_question`, or any future interactive tool — and provide a polished, inline UX for responding.

## Problem Statement

Palot currently has two separate "agent needs human input" mechanisms in the OpenCode SDK, but only one is partially implemented:

1. **Permissions** (`permission.updated` / `permission.replied`) — partially working. Rendered as a bottom bar in `AgentDetail` when `agent.status === "waiting"`. Functional but disconnected from the chat flow.

2. **Questions** (`question.asked` / `question.replied` / `question.rejected`) — completely broken. The SDK has a full question system with structured questions, multi-select options, custom text input, and reply/reject endpoints. Palot ignores all three question events. The `mcp_question` tool renders as a generic tool call icon with no interactive UI.

**Impact:** When an agent asks a question (via `mcp_question`), the user sees nothing actionable. The agent appears stuck with no explanation. There is no way to answer the question, so the agent either times out or the user has to abort.

---

## Current Architecture

### SDK Question Types

```typescript
// The agent asks structured questions
type QuestionInfo = {
  question: string        // Full question text
  header: string          // Short label (max 30 chars)
  options: QuestionOption[] // Available choices
  multiple?: boolean      // Allow selecting multiple
  custom?: boolean        // Allow free-text (default: true)
}

type QuestionOption = {
  label: string           // Display text (1-5 words)
  description: string     // Explanation of choice
}

// A request bundles multiple questions + links to the tool call
type QuestionRequest = {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: { messageID: string; callID: string }
}

// SSE events
EventQuestionAsked    -> { type: "question.asked", properties: QuestionRequest }
EventQuestionReplied  -> { type: "question.replied", properties: { sessionID, requestID, answers } }
EventQuestionRejected -> { type: "question.rejected", properties: { sessionID, requestID } }

// API endpoints
GET    /question                     -> list pending questions
POST   /question/{requestID}/reply   -> { answers: QuestionAnswer[] }
POST   /question/{requestID}/reject  -> reject the question

// SDK client
client.question.list()
client.question.reply({ requestID, answers })
client.question.reject({ requestID })
```

### SDK Permission Types

```typescript
type Permission = {
  id: string
  type: string            // "bash", "edit", "webfetch", "question", etc.
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: Record<string, unknown>
  time: { created: number }
}

// SSE events
EventPermissionAsked   -> { type: "permission.updated", properties: Permission }
EventPermissionReplied -> { type: "permission.replied", properties: { sessionID, permissionID, response } }

// API
POST /session/{id}/permissions/{permissionID} -> { response: "once" | "always" | "reject" }

// SDK client
client.permission.respond({ sessionID, permissionID, response })
```

### What Exists Today

| Layer | Permissions | Questions |
|-------|------------|-----------|
| SSE events | Handled in `processEvent` | **Not handled** |
| Store state | `SessionEntry.permissions[]` | **Nothing** |
| Agent derivation | `permissions.length > 0` -> `status: "waiting"` | **Nothing** |
| Sidebar | Yellow dot + "Waiting" label | **Nothing** |
| Top bar | "Waiting" status badge | **Nothing** |
| Chat inline | **Not shown** | Generic tool icon only |
| Bottom bar | `<PermissionRequests>` with Approve/Deny | **Nothing** |
| Response API | `respondToPermission()` in `opencode.ts` | **Nothing** |

### Key Files

- `apps/desktop/src/stores/app-store.ts` — event processing, store state
- `apps/desktop/src/services/opencode.ts` — SDK wrapper functions
- `apps/desktop/src/services/connection-manager.ts` — SSE event loop
- `apps/desktop/src/hooks/use-agents.ts` — agent status derivation
- `apps/desktop/src/hooks/use-server.ts` — action hooks
- `apps/desktop/src/lib/types.ts` — type re-exports
- `apps/desktop/src/components/agent-detail.tsx` — permission bottom bar
- `apps/desktop/src/components/chat/chat-tool-call.tsx` — tool rendering
- `apps/desktop/src/components/chat/chat-turn.tsx` — turn rendering
- `apps/desktop/src/components/chat/chat-view.tsx` — main chat view
- `apps/desktop/src/components/session-route.tsx` — route + handlers
- `apps/desktop/src/components/sidebar.tsx` — sidebar agent list

---

## Design Principles

1. **Visibility** — At every level of the UI (sidebar, top bar, chat, bottom bar), it should be immediately obvious that an agent needs user input.
2. **Context** — The question/permission should be shown inline in the chat flow near the tool call that triggered it, not just in a disconnected bar.
3. **Unified model** — Both permissions and questions should follow the same visual pattern: the agent is "waiting for you" and here's what it needs.
4. **Non-blocking** — Users should be able to review the chat history, scroll up, and read context before answering.
5. **Keyboard-first** — Questions with options should support keyboard navigation. Permission approve/deny should have hotkeys.

---

## Implementation Plan

### Phase 1: Wire Up Questions (Backend Plumbing)

**Effort: MEDIUM**

#### 1.1 Add question types to `lib/types.ts`

Re-export from the SDK:
```typescript
export type {
  QuestionRequest,
  QuestionInfo,
  QuestionOption,
  QuestionAnswer,
  EventQuestionAsked,
  EventQuestionReplied,
  EventQuestionRejected,
} from "@opencode-ai/sdk"
```

#### 1.2 Add question state to the store (`app-store.ts`)

Add a `questions` field to `SessionEntry`:
```typescript
export interface SessionEntry {
  session: Session
  status: SessionStatus
  permissions: Permission[]
  questions: QuestionRequest[]  // NEW
  directory: string
}
```

Add store actions:
```typescript
addQuestion: (sessionId: string, question: QuestionRequest) => void
removeQuestion: (sessionId: string, requestId: string) => void
```

#### 1.3 Handle question events in `processEvent`

```typescript
case "question.asked":
  state.addQuestion(event.properties.sessionID, event.properties)
  break

case "question.replied":
  state.removeQuestion(event.properties.sessionID, event.properties.requestID)
  break

case "question.rejected":
  state.removeQuestion(event.properties.sessionID, event.properties.requestID)
  break
```

#### 1.4 Add SDK wrapper functions in `opencode.ts`

```typescript
export async function replyToQuestion(
  client: OpencodeClient,
  requestId: string,
  answers: QuestionAnswer[],
): Promise<void> {
  await client.question.reply({ requestID: requestId, answers })
}

export async function rejectQuestion(
  client: OpencodeClient,
  requestId: string,
): Promise<void> {
  await client.question.reject({ requestID: requestId })
}
```

#### 1.5 Add action hooks in `use-server.ts`

Expose `replyToQuestion` and `rejectQuestion` via `useAgentActions()`.

#### 1.6 Update agent status derivation in `use-agents.ts`

Questions should also trigger `status: "waiting"`:
```typescript
function deriveAgentStatus(status, hasPermissions, hasQuestions): AgentStatus {
  if (hasPermissions || hasQuestions) return "waiting"
  // ...
}
```

Update `currentActivity`:
```typescript
currentActivity: 
  questions.length > 0
    ? `Asking: ${questions[0].questions[0]?.header ?? "Question"}`
    : permissions.length > 0
      ? `Waiting for approval: ${permissions[0].title}`
      : // ...
```

---

### Phase 2: Inline Question UI (Chat Integration)

**Effort: HIGH**

#### 2.1 Create `ChatQuestionCard` component

A new component in `apps/desktop/src/components/chat/chat-question.tsx` that renders inline in the chat flow when a question is pending.

**Design:**
```
┌─────────────────────────────────────────────────┐
│  ? Agent has a question                         │
│                                                 │
│  ┌─ Question 1 ──────────────────────────────┐  │
│  │  What framework should we use?            │  │
│  │                                           │  │
│  │  ○ React (Recommended)                    │  │
│  │    Most popular, large ecosystem          │  │
│  │                                           │  │
│  │  ○ Vue                                    │  │
│  │    Progressive, gentle learning curve     │  │
│  │                                           │  │
│  │  ○ Svelte                                 │  │
│  │    Compiled, excellent performance        │  │
│  │                                           │  │
│  │  ┌──────────────────────────────────────┐ │  │
│  │  │ Type a custom answer...              │ │  │
│  │  └──────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│                          [Dismiss]  [Submit]    │
└─────────────────────────────────────────────────┘
```

Features:
- Radio buttons for single-select, checkboxes for `multiple: true`
- Optional free-text input when `custom: true` (default)
- Keyboard navigation: arrow keys between options, Enter to submit
- Animated entrance (slide in from bottom of chat)
- Auto-scroll to bring the question card into view
- Dismiss = `rejectQuestion()`
- Submit = `replyToQuestion()` with selected labels

#### 2.2 Render questions in `ChatView`

Two placement strategies (both implemented):

**A. Sticky bottom overlay** (primary — ensures visibility):
When `agent.questions.length > 0`, render a `<ChatQuestionCard>` above the prompt input, similar to the current permission bar but with richer UI. This replaces the permission-only bottom bar with a unified "agent needs input" bar.

**B. Inline in chat turn** (contextual — links to the tool call):
In `ChatTurnComponent`, when a tool part has `tool === "question"` and matches a pending `QuestionRequest.tool.callID`, render the question card inline next to the tool call instead of the generic icon.

The sticky overlay is the primary interaction point (always visible), while the inline rendering provides context (shows where in the conversation the question was asked).

#### 2.3 Unified "Agent Needs Input" bottom bar

Replace the current permission-only bottom bar in `AgentDetail` with a unified component:

```typescript
// agent-detail.tsx — replace current permission bar
{agent.status === "waiting" && (
  <div className="border-t border-border p-3">
    <AgentInputRequired
      agent={agent}
      onApprove={onApprove}
      onDeny={onDeny}
      onReplyQuestion={onReplyQuestion}
      onRejectQuestion={onRejectQuestion}
      isConnected={isConnected}
    />
  </div>
)}
```

The `AgentInputRequired` component shows:
- Permission cards (existing, improved)
- Question cards (new)
- Both in chronological order, with the most urgent at top

---

### Phase 3: Improved Permission UX

**Effort: MEDIUM**

#### 3.1 Add "Always Allow" option

The SDK supports `response: "always"` but the UI only shows "Approve" (sends `"once"`) and "Deny". Add a dropdown to the Approve button:

```
[Deny]  [Approve ▼]
         ├── Approve once
         └── Always allow for this tool
```

#### 3.2 Inline permission rendering in chat

When a tool part (e.g., `bash`) has `state.status === "pending"` or `"running"` AND there's a matching pending permission, render the permission inline with the tool call:

```
▸ Explored 3 files, Ran 1 command

  ⚡ Shell — rm -rf node_modules
  ┌──────────────────────────────────┐
  │ Allow this bash command?         │
  │          [Deny]  [Approve ▼]    │
  └──────────────────────────────────┘
```

This connects the permission request to the tool call that triggered it, making it contextually clear what's being approved.

#### 3.3 Permission matching

Link permissions to their tool parts via `permission.messageID` + `permission.callID`. When rendering a `ToolPart`, check if there's a matching pending permission and render the approval UI inline.

---

### Phase 4: Global Awareness (Sidebar + Notifications)

**Effort: LOW**

#### 4.1 Sidebar waiting indicator

Already partially working (yellow dot). Enhance:
- Add a subtle pulse animation to the session row when waiting
- Show the question/permission summary text in the session subtitle:
  ```
  palot                        ● Waiting
  └─ Session: Feature X
     Asking: What framework?
  ```

#### 4.2 Browser tab title / favicon

When any agent is waiting for input:
- Update document title: `(!) Palot — Question pending`
- Optionally swap favicon to an attention-grabbing variant

#### 4.3 Desktop notification (optional, future)

If the tab is not focused and an agent starts waiting, fire a browser notification:
```
Palot — Agent needs input
"What framework should we use?"
[Answer] [Dismiss]
```

---

### Phase 5: Keyboard Shortcuts & Polish

**Effort: LOW**

#### 5.1 Keyboard shortcuts

- `Ctrl+Enter` — Approve first pending permission
- `Ctrl+Shift+Enter` — Deny first pending permission
- Arrow keys — Navigate question options when focused
- `Enter` — Submit selected question answers
- `Escape` — Dismiss/reject question

#### 5.2 Animations

- Question card slides in from below with spring animation
- Permission card appears with subtle fade-in
- "Waiting" status pulses gently
- Answered questions collapse with slide-out animation

#### 5.3 Sound (optional)

- Subtle notification sound when a question/permission arrives
- Configurable in settings

---

## Data Flow (Target State)

```
OpenCode Server
    │
    │ SSE: question.asked / permission.updated
    ▼
connection-manager.ts: batcher.enqueue(event)
    │
    ▼
app-store.ts: processEvent(event)
    ├── "question.asked"     -> addQuestion(sessionID, questionRequest)
    ├── "question.replied"   -> removeQuestion(sessionID, requestID)
    ├── "question.rejected"  -> removeQuestion(sessionID, requestID)
    ├── "permission.updated" -> addPermission(sessionID, permission)
    └── "permission.replied" -> removePermission(sessionID, permissionID)
    │
    ▼
Store: sessions[id].questions[] + sessions[id].permissions[]
    │
    ▼
useAgents() hook
    ├── questions.length > 0 || permissions.length > 0 -> status: "waiting"
    └── currentActivity: "Asking: {header}" or "Waiting for approval: {title}"
    │
    ▼
UI Rendering
    ├── Sidebar: yellow pulse dot, subtitle shows question/permission text
    ├── Top bar: "Waiting" status badge
    ├── Chat inline: question card / permission card at the matching tool call
    └── Bottom bar: unified "Agent needs input" with questions + permissions
    │
    ▼ (user interaction)
    │
session-route.tsx: handleReplyQuestion / handleApprovePermission
    │
    ▼
opencode.ts: replyToQuestion() / respondToPermission()
    │
    ▼
SDK: client.question.reply() / client.permission.respond()
    │
    ▼ (SSE: question.replied / permission.replied)
    │
Store: removeQuestion / removePermission
    ▼
UI: agent transitions from "waiting" to "running"
```

---

## Implementation Order

| Order | Task | Effort | Depends On |
|-------|------|--------|------------|
| 1 | Phase 1: Wire up question events + store + SDK wrappers | MEDIUM | — |
| 2 | Phase 2.1-2.2: ChatQuestionCard + sticky overlay | HIGH | Phase 1 |
| 3 | Phase 2.3: Unified bottom bar | MEDIUM | Phase 1 |
| 4 | Phase 3.1: Always Allow dropdown | LOW | — |
| 5 | Phase 3.2-3.3: Inline permission in chat | MEDIUM | — |
| 6 | Phase 4.1: Sidebar enhancements | LOW | Phase 1 |
| 7 | Phase 4.2: Tab title/favicon | LOW | Phase 1 |
| 8 | Phase 5: Keyboard shortcuts + polish | LOW | Phase 2 |

Phases 1-3 are the critical path. Phase 1 is the foundation — without it, nothing else works. Phase 2 is where the user sees the improvement. Phase 3-5 are polish.

---

## Testing Strategy

1. **Manual testing with `mcp_question`**: The OpenCode agent already has the `mcp_question` tool. Start a session, ask the agent to do something that triggers questions. Verify the full flow.

2. **Mock question events**: Inject fake `question.asked` events into the store to test the UI without a live agent.

3. **Permission regression**: Ensure existing permission flow still works after the refactoring.

4. **Edge cases**:
   - Multiple questions in a single request
   - Questions with no options (free-text only)
   - Questions with `multiple: true`
   - Questions with `custom: false` (no free-text)
   - Permission + question arriving simultaneously
   - Answering a question while another arrives
   - Agent aborted while question is pending
   - Session goes idle while question is pending (stale question cleanup)
