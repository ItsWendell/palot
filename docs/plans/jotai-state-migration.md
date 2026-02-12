# Jotai State Management Migration Plan

> Status: **Draft** | Created: 2026-02-09

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Vercel AI SDK Patterns Analysis](#3-vercel-ai-sdk-patterns-analysis)
4. [Key Design Principles](#4-key-design-principles)
5. [New Jotai Architecture](#5-new-jotai-architecture)
6. [Atom Design — Detailed](#6-atom-design--detailed)
7. [Streaming Architecture](#7-streaming-architecture)
8. [SSE Event Processing](#8-sse-event-processing)
9. [Derived State & Computed Atoms](#9-derived-state--computed-atoms)
10. [Imperative Access (Outside React)](#10-imperative-access-outside-react)
11. [Persistence Layer](#11-persistence-layer)
12. [TanStack Query Integration](#12-tanstack-query-integration)
13. [Migration Strategy](#13-migration-strategy)
14. [File-by-File Migration Map](#14-file-by-file-migration-map)
15. [Risk Assessment](#15-risk-assessment)
16. [Performance Budget](#16-performance-budget)

---

## 1. Executive Summary

This document proposes migrating Palot's state management from Zustand to Jotai. The motivation is not performance (the current system is well-optimized) but **architectural clarity**:

- **Eliminate the React 19 footgun** — Zustand's `useShallow` + React 19 causes infinite render loops, forcing us to use `useMemo` wrappers everywhere. Jotai's atomic model avoids this entirely.
- **Remove the `partsVersion` hack** — The current system uses a version counter + `getState()` inside `useMemo` to avoid subscribing to the entire `parts` record. Jotai's `atomFamily` gives us per-entity atoms natively.
- **Unify the streaming bypass** — The hand-rolled `useSyncExternalStore` streaming store exists because Zustand's `set()` is too coarse. Jotai's store API + throttled subscriptions can replace it.
- **Flatten the 716-line god store** — Split into focused, composable atoms that are independently testable.

### What We Keep

- **TanStack Query** for server-fetched data (providers, config, VCS, agents, commands, model state)
- **The event batcher** (rAF-based coalescing) — this is transport-level, not state-level
- **The `connection-manager.ts` module** — adapted to write to Jotai store instead of Zustand

### What Changes

| Current | New |
|---------|-----|
| `useAppStore` (716 lines, 1 monolithic store) | ~15 focused atom modules |
| `usePersistedStore` (Zustand + persist middleware) | `atomWithStorage` from `jotai/utils` |
| `streaming-store.ts` (hand-rolled `useSyncExternalStore`) | Throttled atom writes via Jotai store API |
| `partsVersion` counter hack | `atomFamily` per-session / per-message |
| `getState()` imperative reads (29 calls) | `store.get(atom)` / `store.set(atom, value)` |
| `useMemo` for all derived state | Derived atoms (automatic dependency tracking) |

---

## 2. Current Architecture Analysis

### 2.1 Store Inventory

| Store | Type | Lines | Purpose |
|-------|------|-------|---------|
| `useAppStore` | Zustand `create()` | 716 | All runtime state: server, sessions, messages, parts, todos, discovery, UI |
| `usePersistedStore` | Zustand + `persist` | 87 | User preferences: theme, display mode, drafts, project models |
| `streaming-store` | Hand-rolled `useSyncExternalStore` | 170 | High-frequency text/reasoning part buffering during SSE streaming |

### 2.2 State Shape Summary

```
AppStore:
├── opencode: { url, connected }
├── sessions: Record<string, SessionEntry>
│   └── SessionEntry: { session, status, permissions[], questions[], directory, branch?, error? }
├── messages: Record<string, Message[]>        // keyed by sessionId, sorted by id
├── parts: Record<string, Part[]>              // keyed by messageId, sorted by id
├── partsVersion: Record<string, number>       // per-session version counter
├── todos: Record<string, Todo[]>              // keyed by sessionId
├── discovery: { loaded, loading, error, projects[], sessions{} }
└── ui: { commandPaletteOpen, showSubAgents }

PersistedStore:
├── displayMode: "default" | "compact" | "verbose"
├── drafts: Record<string, string>
├── theme: string
├── colorScheme: "dark" | "light" | "system"
└── projectModels: Record<string, PersistedModelRef>

StreamingStore (module-scoped):
├── streamingParts: Record<string, Record<string, Part>>  // [messageId][partId]
├── version: number
└── listeners: Set<Listener>
```

### 2.3 Current Pain Points

1. **React 19 infinite render loops** — Documented in 3 places, requires all derived state to live in hooks via `useMemo` rather than in-store selectors. Every developer must know this constraint.

2. **`partsVersion` hack** — Components subscribe to `s.partsVersion[sessionId]` (a number) instead of `s.parts` (an object), then read actual data via `getState().parts` inside `useMemo`. Uses `void partsVersion` to force dependency tracking. Unconventional and fragile.

3. **Streaming bypass complexity** — 170-line hand-rolled store + merge logic in `useSessionChat` (overlay streaming parts on main store parts, handle parts in streaming but not in base, etc.). Two separate code paths for the same data.

4. **716-line god store** — All runtime state, 23 actions, and a 90-line event dispatcher in a single file. Hard to test individual pieces.

5. **29 `getState()` calls** — Imperative reads scattered across connection manager, hooks, and callbacks. Works but creates invisible dependencies.

6. **Optimistic placeholder cleanup** — Fragile coordination between `sendPrompt` (creates `optimistic-*` message) and `upsertMessage` (removes oldest optimistic on real arrival).

7. **HMR state loss** — Module-scoped state in `connection-manager.ts` and `streaming-store.ts` is lost on Vite HMR. Requires explicit recovery code.

### 2.4 Data Flow Diagram (Current)

```
OpenCode Server
       │
       │ SSE: /global/event
       ▼
connection-manager.ts
       │
       ├─── text/reasoning parts ──▶ streaming-store (module vars)
       │                                    │
       │                                    │ throttled (50ms)
       │                                    ▼
       │                              useSyncExternalStore
       │                                    │
       ├─── all events ──▶ eventBatcher     │
       │    (rAF coalesce)      │           │
       │                        ▼           │
       │                  processEvent()    │
       │                        │           │
       │                        ▼           │
       │                  useAppStore.set()  │
       │                        │           │
       │                        ▼           ▼
       │                  React re-render (merged in useSessionChat useMemo)
       │
       └─── session idle ──▶ flushStreamingParts() ──▶ batchUpsertParts()
```

---

## 3. Vercel AI SDK Patterns Analysis

The AI SDK (source at `/Users/wmisiedjan/Projects/ai`) provides an excellent reference for managing streaming chat state. Key architectural insights:

### 3.1 Three-Layer Architecture

```
Layer 1: React Hook (useChat)              ── thin shell, useSyncExternalStore
Layer 2: Chat Class (AbstractChat)         ── state machine, event dispatcher
Layer 3: Stream Processor                  ── mutable accumulation, immutable snapshots
```

### 3.2 Key Patterns We Adopt

#### Independent Subscription Channels
The AI SDK splits messages, status, and error into **three independent subscription channels**. A status change does NOT re-render components that only read messages. We adopt this by making each concern a separate atom.

#### Mutable Accumulation → Immutable Snapshots
The stream processor mutates text parts in-place (`textPart.text += delta`) for O(1) accumulation, then calls `structuredClone` at the React boundary. We adapt this: the streaming buffer mutates freely, and only when flushing to atoms do we create new references.

#### Throttled Subscriptions
`experimental_throttle: 50` wraps the `useSyncExternalStore` callback with `throttleit`, limiting React notifications to ~20fps during streaming. Jotai's `store.sub()` can be wrapped similarly.

#### Serial Job Executor
A `SerialJobExecutor` serializes concurrent mutations (stream chunks + user actions like `addToolOutput`). Prevents race conditions. We adopt this for our SSE event processing.

#### Progressive Accumulation (Not Optimistic)
The AI SDK doesn't do traditional optimistic updates for assistant messages. It progressively pushes the assistant message (first as empty, then replacing on each chunk). We already do something similar with the streaming store bypass.

### 3.3 Patterns We Adapt (Not Copy)

| AI SDK Pattern | Palot Adaptation | Why Different |
|---|---|---|
| `AbstractChat` class holding all state | Jotai atoms (no class) | We want React-native state, not an external class |
| `structuredClone` on every `replaceMessage` | Only clone on atom boundary flush | Our streaming volume is higher; clone per-token is too expensive |
| SWR for `useCompletion` shared state | Keep TanStack Query | We already have TanStack Query established |
| Single `Chat` instance per conversation | `atomFamily` keyed by sessionId | We manage multiple concurrent sessions |

---

## 4. Key Design Principles

### P1: One Atom Per Concern
Each independently-changing piece of state gets its own atom. No god atoms.

### P2: Derived Atoms Over useMemo
Computed state is expressed as derived atoms with automatic dependency tracking, not manual `useMemo` + `getState()` hacks.

### P3: atomFamily for Entity Collections
Sessions, messages, and parts are accessed via `atomFamily(id)`, not `Record<string, T>` in a single atom. This gives O(1) subscription granularity.

### P4: Explicit Store for Imperative Access
A single Jotai `createStore()` instance is used throughout. The `store.get()` / `store.set()` API replaces all 29 `getState()` calls with a cleaner pattern.

### P5: Streaming Stays Outside Atoms
High-frequency text streaming (hundreds of events/sec) still uses a module-scoped buffer. Atoms are only written at throttled intervals or on flush. This preserves the performance characteristic we already have.

### P6: Event Processing Stays Centralized
The SSE event dispatcher remains a single function (not scattered across atoms). It writes to specific atoms via the store API.

---

## 5. New Jotai Architecture

### 5.1 Directory Structure

```
apps/desktop/src/renderer/
├── atoms/
│   ├── store.ts                    // createStore() singleton + Provider setup
│   ├── connection.ts               // opencode URL, connected status
│   ├── sessions.ts                 // session entries, atomFamily per session
│   ├── messages.ts                 // message arrays, atomFamily per session
│   ├── parts.ts                    // part arrays, atomFamily per message
│   ├── streaming.ts                // streaming buffer (module-scoped) + flush atom
│   ├── todos.ts                    // todo lists, atomFamily per session
│   ├── discovery.ts                // offline project/session discovery
│   ├── ui.ts                       // command palette, sub-agents toggle
│   ├── preferences.ts              // persisted: theme, display mode, drafts, models
│   ├── derived/
│   │   ├── agents.ts               // derives Agent[] from sessions + discovery
│   │   ├── project-list.ts         // derives SidebarProject[] for sidebar
│   │   ├── session-chat.ts         // derives ChatTurn[] for a session
│   │   ├── session-todos.ts        // derives todos from store or message parts
│   │   └── waiting.ts              // derives hasWaiting boolean
│   └── actions/
│       ├── event-processor.ts      // processEvent() — central SSE dispatcher
│       ├── session-actions.ts      // sendPrompt, createSession, rename, delete, etc.
│       └── connection-actions.ts   // connect, disconnect, loadProjectSessions
├── services/
│   └── connection-manager.ts       // adapted: uses store.get/set instead of Zustand
├── hooks/
│   ├── use-session-chat.ts         // thin wrapper: useAtom(sessionChatAtom(id))
│   ├── use-agents.ts               // thin wrapper: useAtom(agentsAtom)
│   ├── use-theme.ts                // useAtom(themeAtom) + layout effect
│   ├── use-server.ts               // useAtom(connectionAtom) + action wrappers
│   ├── use-commands.ts             // derives commands from atoms + server commands
│   ├── use-discovery.ts            // orchestration hook (unchanged pattern)
│   └── use-waiting-indicator.ts    // useAtom(hasWaitingAtom) + document.title
└── ...
```

### 5.2 Architecture Diagram

```
OpenCode Server
       │
       │ SSE: /global/event
       ▼
connection-manager.ts ─────────────────────────────────────────────┐
       │                                                           │
       ├── text/reasoning ──▶ streamingBuffer (module-scoped)      │
       │                         │                                 │
       │                         │ throttled write (50ms)          │
       │                         ▼                                 │
       │                   streamingPartsAtom(messageId)           │
       │                         │                                 │
       │                         │ (derived atoms auto-update)     │
       │                         ▼                                 │
       ├── all events ──▶ eventBatcher ──▶ processEvent()          │
       │                                       │                   │
       │                    ┌──────────────────┤                   │
       │                    ▼                  ▼                   │
       │         store.set(sessionAtom)  store.set(messageAtom)    │
       │         store.set(partsAtom)    store.set(todosAtom)      │
       │                    │                  │                   │
       │                    ▼                  ▼                   │
       │              ┌─────────────────────────┐                  │
       │              │    Jotai Store           │                  │
       │              │  (single instance)       │◀─────────────────┘
       │              │                          │
       │              │  connectionAtom          │
       │              │  sessionFamily(id)       │
       │              │  messageFamily(sid)      │
       │              │  partsFamily(mid)        │
       │              │  todosFamily(sid)        │
       │              │  discoveryAtom           │
       │              │  uiAtom                  │
       │              │  preferencesAtom(*)      │
       │              └────────────┬─────────────┘
       │                           │
       │              ┌────────────┤ (derived atoms)
       │              ▼            ▼
       │         agentsAtom   sessionChatAtom(sid)
       │         projectListAtom  hasWaitingAtom
       │                           │
       │                           ▼
       └─── session idle ──▶ flushStreamingBuffer()
                               └──▶ store.set(partsFamily(mid), ...)
```

---

## 6. Atom Design — Detailed

### 6.1 `atoms/store.ts` — Store Singleton

```typescript
import { createStore } from "jotai"

// Single store instance, used everywhere (React + imperative)
export const appStore = createStore()

// Re-export for convenience in actions/services
export const getAtom = appStore.get
export const setAtom = appStore.set
export const subAtom = appStore.sub
```

Provider setup in the app root:

```tsx
import { Provider } from "jotai"
import { appStore } from "./atoms/store"

const App = () => (
  <Provider store={appStore}>
    <Root />
  </Provider>
)
```

### 6.2 `atoms/connection.ts` — Server Connection

```typescript
import { atom } from "jotai"

// Primitive atoms
export const serverUrlAtom = atom<string | null>(null)
export const serverConnectedAtom = atom<boolean>(false)

// Derived convenience atom
export const connectionAtom = atom((get) => ({
  url: get(serverUrlAtom),
  connected: get(serverConnectedAtom),
}))
```

**Why separate primitives**: A component showing only a connection indicator subscribes to `serverConnectedAtom` (a boolean). It won't re-render when `serverUrlAtom` changes.

### 6.3 `atoms/sessions.ts` — Session Entities

```typescript
import { atom } from "jotai"
import { atomFamily } from "jotai-family"

// Types
interface SessionEntry {
  session: Session
  status: SessionStatus
  permissions: Permission[]
  questions: QuestionRequest[]
  directory: string
  branch?: string
  error?: SessionError
}

// Index atom: set of all known session IDs
export const sessionIdsAtom = atom<Set<string>>(new Set())

// Per-session atom family
export const sessionFamily = atomFamily((sessionId: string) =>
  atom<SessionEntry | null>(null)
)

// Action atoms (write-only)
export const upsertSessionAtom = atom(null, (get, set, args: {
  session: Session
  directory: string
}) => {
  const { session, directory } = args
  const existing = get(sessionFamily(session.id))

  set(sessionFamily(session.id), {
    session,
    directory,
    status: existing?.status ?? { type: "idle" },
    permissions: existing?.permissions ?? [],
    questions: existing?.questions ?? [],
    branch: existing?.branch,
    error: existing?.error,
  })

  // Add to index
  const ids = new Set(get(sessionIdsAtom))
  ids.add(session.id)
  set(sessionIdsAtom, ids)
})

export const removeSessionAtom = atom(null, (get, set, sessionId: string) => {
  sessionFamily.remove(sessionId)
  const ids = new Set(get(sessionIdsAtom))
  ids.delete(sessionId)
  set(sessionIdsAtom, ids)
})

export const setSessionStatusAtom = atom(null, (get, set, args: {
  sessionId: string
  status: SessionStatus
}) => {
  const entry = get(sessionFamily(args.sessionId))
  if (!entry) return
  set(sessionFamily(args.sessionId), { ...entry, status: args.status })
})

export const setSessionErrorAtom = atom(null, (get, set, args: {
  sessionId: string
  error: SessionError | undefined
}) => {
  const entry = get(sessionFamily(args.sessionId))
  if (!entry) return
  set(sessionFamily(args.sessionId), { ...entry, error: args.error })
})

export const addPermissionAtom = atom(null, (get, set, args: {
  sessionId: string
  permission: Permission
}) => {
  const entry = get(sessionFamily(args.sessionId))
  if (!entry) return
  set(sessionFamily(args.sessionId), {
    ...entry,
    permissions: [...entry.permissions, args.permission],
  })
})

export const removePermissionAtom = atom(null, (get, set, args: {
  sessionId: string
  permissionId: string
}) => {
  const entry = get(sessionFamily(args.sessionId))
  if (!entry) return
  set(sessionFamily(args.sessionId), {
    ...entry,
    permissions: entry.permissions.filter((p) => p.id !== args.permissionId),
  })
})

// Similar for questions, branch, etc.
```

**Key change from Zustand**: Each session is an independent atom. Setting session A's status does NOT notify components subscribed to session B. In the old system, all `useAppStore((s) => s.sessions[id])` selectors run on every sessions map change.

### 6.4 `atoms/messages.ts` — Message Collections

```typescript
import { atom } from "jotai"
import { atomFamily } from "jotai-family"

const MAX_MESSAGES_PER_SESSION = 200

// Per-session message list (sorted by id)
export const messagesFamily = atomFamily((sessionId: string) =>
  atom<Message[]>([])
)

// Binary search utility (carried over from current implementation)
function binarySearch<T>(arr: T[], id: string, getId: (t: T) => string) {
  let lo = 0, hi = arr.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const cmp = getId(arr[mid]).localeCompare(id)
    if (cmp === 0) return { found: true, index: mid }
    if (cmp < 0) lo = mid + 1
    else hi = mid - 1
  }
  return { found: false, index: lo }
}

// Upsert message action
export const upsertMessageAtom = atom(null, (get, set, message: Message) => {
  const sessionId = message.metadata?.sessionID
  if (!sessionId) return

  const messages = get(messagesFamily(sessionId))
  const result = binarySearch(messages, message.id, (m) => m.id)

  if (result.found) {
    // Update in place (new array)
    if (messages[result.index] === message) return // reference equality skip
    const next = [...messages]
    next[result.index] = message
    set(messagesFamily(sessionId), next)
  } else {
    // Insert at sorted position
    const next = [...messages]
    next.splice(result.index, 0, message)

    // Handle optimistic placeholder cleanup
    if (message.role === "user" && !message.id.startsWith("optimistic-")) {
      const optIdx = next.findIndex((m) =>
        m.id.startsWith("optimistic-") && m.role === "user"
      )
      if (optIdx !== -1) {
        // Remove optimistic + its parts
        const optMessage = next[optIdx]
        next.splice(optIdx, 1)
        // Clean up parts for the optimistic message
        set(partsFamily(optMessage.id), [])
      }
    }

    // Cap at MAX_MESSAGES_PER_SESSION
    if (next.length > MAX_MESSAGES_PER_SESSION) {
      const removed = next.shift()!
      set(partsFamily(removed.id), []) // clean up parts
    }

    set(messagesFamily(sessionId), next)
  }
})
```

### 6.5 `atoms/parts.ts` — Part Collections

```typescript
import { atom } from "jotai"
import { atomFamily } from "jotai-family"

// Per-message part list (sorted by id)
export const partsFamily = atomFamily((messageId: string) =>
  atom<Part[]>([])
)

// Upsert single part
export const upsertPartAtom = atom(null, (get, set, part: Part) => {
  const messageId = part.messageID
  const parts = get(partsFamily(messageId))
  const result = binarySearch(parts, part.id, (p) => p.id)

  if (result.found) {
    if (parts[result.index] === part) return // reference equality skip
    const next = [...parts]
    next[result.index] = part
    set(partsFamily(messageId), next)
  } else {
    const next = [...parts]
    next.splice(result.index, 0, part)
    set(partsFamily(messageId), next)
  }
})

// Batch upsert (used when flushing streaming buffer)
export const batchUpsertPartsAtom = atom(null, (get, set, parts: Part[]) => {
  // Group by messageId to minimize atom writes
  const byMessage = new Map<string, Part[]>()
  for (const part of parts) {
    const group = byMessage.get(part.messageID) ?? []
    group.push(part)
    byMessage.set(part.messageID, group)
  }

  for (const [messageId, messageParts] of byMessage) {
    const existing = get(partsFamily(messageId))
    let updated = [...existing]

    for (const part of messageParts) {
      const result = binarySearch(updated, part.id, (p) => p.id)
      if (result.found) {
        updated[result.index] = part
      } else {
        updated.splice(result.index, 0, part)
      }
    }

    set(partsFamily(messageId), updated)
  }
})
```

**Key improvement**: No more `partsVersion` hack. Components that render session A's chat subscribe to `partsFamily(messageId)` for each visible message. Updating parts for session B's messages doesn't trigger any re-renders in session A's view.

### 6.6 `atoms/streaming.ts` — Streaming Buffer

```typescript
import { atom } from "jotai"
import type { Part } from "@opencode/sdk"
import { appStore } from "./store"
import { partsFamily } from "./parts"

// --- Module-scoped buffer (NOT atoms — same pattern as current) ---

const FLUSH_THROTTLE_MS = 50

let buffer: Record<string, Record<string, Part>> = {}
// buffer[messageId][partId] = latest Part

let flushScheduled: ReturnType<typeof setTimeout> | undefined
let lastFlush = 0

// Atom that components subscribe to for streaming overlay
// Value is a version counter (cheap subscription)
export const streamingVersionAtom = atom(0)

// Module-scoped version (not an atom — for the buffer)
let bufferVersion = 0

/**
 * Write a part to the streaming buffer.
 * Called by connection-manager on every text/reasoning SSE event.
 */
export function updateStreamingPart(part: Part): void {
  const messageId = part.messageID
  if (!buffer[messageId]) buffer[messageId] = {}
  buffer[messageId][part.id] = part
  bufferVersion++
  scheduleNotify()
}

function scheduleNotify(): void {
  if (flushScheduled) return
  const elapsed = performance.now() - lastFlush
  if (elapsed >= FLUSH_THROTTLE_MS) {
    notify()
  } else {
    flushScheduled = setTimeout(notify, FLUSH_THROTTLE_MS - elapsed)
  }
}

function notify(): void {
  flushScheduled = undefined
  lastFlush = performance.now()
  // Bump the atom version — this triggers React re-renders
  appStore.set(streamingVersionAtom, (v) => v + 1)
}

/**
 * Check if a part type should go through streaming buffer.
 */
export function isStreamingPartType(part: Part): boolean {
  return part.type === "text" || part.type === "reasoning"
}

/**
 * Get streaming parts for a specific message (used in derived atoms).
 */
export function getStreamingPartsForMessage(
  messageId: string,
): Record<string, Part> | undefined {
  return buffer[messageId]
}

/**
 * Get all streaming parts (used during flush).
 */
export function getAllStreamingParts(): Record<string, Record<string, Part>> {
  return buffer
}

/**
 * Check if there are any buffered streaming parts.
 */
export function hasStreamingParts(): boolean {
  return Object.keys(buffer).length > 0
}

/**
 * Flush all streaming parts into the main Jotai atoms.
 * Called when a session goes idle.
 * Returns the flushed data for the batch upsert.
 */
export function flushStreamingParts(): Part[] {
  if (flushScheduled) {
    clearTimeout(flushScheduled)
    flushScheduled = undefined
  }

  const allParts: Part[] = []
  for (const messageId in buffer) {
    for (const partId in buffer[messageId]) {
      allParts.push(buffer[messageId][partId])
    }
  }

  buffer = {}
  bufferVersion = 0

  // Notify React that streaming is cleared
  appStore.set(streamingVersionAtom, (v) => v + 1)

  return allParts
}
```

**What changed vs current**: The streaming buffer is structurally identical (module-scoped, throttled notify). The difference is that `notify()` bumps a Jotai atom instead of calling manual `useSyncExternalStore` listeners. The flush writes to `partsFamily` atoms via `batchUpsertPartsAtom`. This eliminates the need for a separate `subscribe`/`getSnapshot` API.

### 6.7 `atoms/todos.ts`

```typescript
import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { Todo } from "@opencode/sdk"

export const todosFamily = atomFamily((sessionId: string) =>
  atom<Todo[]>([])
)
```

### 6.8 `atoms/discovery.ts`

```typescript
import { atom } from "jotai"

interface DiscoveryState {
  loaded: boolean
  loading: boolean
  error: string | null
  projects: DiscoveredProject[]
  sessions: Record<string, DiscoveredSession[]>
}

export const discoveryAtom = atom<DiscoveryState>({
  loaded: false,
  loading: false,
  error: null,
  projects: [],
  sessions: {},
})

// Convenience selectors
export const discoveryLoadedAtom = atom((get) => get(discoveryAtom).loaded)
export const discoveryLoadingAtom = atom((get) => get(discoveryAtom).loading)
export const discoveryProjectsAtom = atom((get) => get(discoveryAtom).projects)
export const discoverySessionsAtom = atom((get) => get(discoveryAtom).sessions)
```

**Why a single atom here** (not atomFamily): Discovery data is loaded once and rarely changes. It's a single fetch result. There's no performance benefit to splitting it further.

### 6.9 `atoms/ui.ts`

```typescript
import { atom } from "jotai"

export const commandPaletteOpenAtom = atom(false)
export const showSubAgentsAtom = atom(false)

// Toggle helper (write-only atom)
export const toggleShowSubAgentsAtom = atom(null, (get, set) => {
  set(showSubAgentsAtom, !get(showSubAgentsAtom))
})
```

### 6.10 `atoms/preferences.ts`

```typescript
import { atomWithStorage } from "jotai/utils"
import { atom } from "jotai"

// Each preference is an independent atom with localStorage persistence
export const displayModeAtom = atomWithStorage<"default" | "compact" | "verbose">(
  "palot:displayMode",
  "default",
)

export const themeAtom = atomWithStorage<string>(
  "palot:theme",
  "default",
)

export const colorSchemeAtom = atomWithStorage<"dark" | "light" | "system">(
  "palot:colorScheme",
  "dark",
)

export const draftsAtom = atomWithStorage<Record<string, string>>(
  "palot:drafts",
  {},
)

export const projectModelsAtom = atomWithStorage<Record<string, PersistedModelRef>>(
  "palot:projectModels",
  {},
)

// Derived: get/set draft for a specific key
export const draftFamily = atomFamily((key: string) =>
  atom(
    (get) => get(draftsAtom)[key] ?? "",
    (get, set, value: string) => {
      const drafts = { ...get(draftsAtom) }
      if (value) {
        drafts[key] = value
      } else {
        delete drafts[key]
      }
      set(draftsAtom, drafts)
    },
  )
)
```

**Migration note**: The current `usePersistedStore` uses Zustand's `persist` middleware with a single localStorage key `"palot-preferences"`. The new approach uses separate keys per preference. A one-time migration script reads the old key and writes to the new keys.

---

## 7. Streaming Architecture

### 7.1 Design Decision: Keep the Buffer

We keep the module-scoped streaming buffer for the same reason it exists today: Jotai's `store.set()` + React subscription overhead is too high for hundreds of events/second. The buffer coalesces writes and notifies React at ~20fps.

### 7.2 How Derived Atoms Consume Streaming Data

The current system merges streaming data with main-store data in a `useMemo` inside `useSessionChat`. The new system does this in a derived atom:

```typescript
// atoms/derived/session-chat.ts

import { atom } from "jotai"
import { atomFamily } from "jotai-family"

export const sessionPartsFamily = atomFamily((sessionId: string) =>
  atom((get) => {
    const messages = get(messagesFamily(sessionId))
    // Subscribe to streaming version to trigger recomputation
    get(streamingVersionAtom)

    return messages.map((msg) => {
      const baseParts = get(partsFamily(msg.id))
      const overrides = getStreamingPartsForMessage(msg.id)

      if (!overrides) return { info: msg, parts: baseParts }

      // Overlay streaming parts onto base parts
      const merged = baseParts.map((part) => overrides[part.id] ?? part)

      // Include brand-new streaming parts not yet in base store
      const baseIds = new Set(baseParts.map((p) => p.id))
      for (const partId in overrides) {
        if (!baseIds.has(partId)) merged.push(overrides[partId])
      }

      return { info: msg, parts: merged }
    })
  })
)
```

**Key insight**: The derived atom reads `streamingVersionAtom` to establish a Jotai dependency. When the streaming buffer's throttled notify bumps the version, this derived atom recomputes. But it also reads `partsFamily(msg.id)` for each message — so it recomputes when main-store parts change too (e.g., after flush). This **unifies the dual-subscription pattern** that currently requires three separate `useSyncExternalStore` / `useAppStore` calls in `useSessionChat`.

### 7.3 Turn Grouping

```typescript
export const sessionTurnsFamily = atomFamily((sessionId: string) =>
  atom((get) => {
    const entries = get(sessionPartsFamily(sessionId))
    return groupIntoTurns(entries)
  })
)
```

The structural sharing via `turnFingerprint` matching is preserved — it moves from the `useMemo` in `useSessionChat` into the atom's `read` function. Since Jotai only notifies subscribers when the returned value changes (by reference), and we reuse turn objects when fingerprints match, components using `React.memo` will skip re-renders for unchanged turns.

---

## 8. SSE Event Processing

### 8.1 `atoms/actions/event-processor.ts`

The `processEvent` function moves from being a Zustand action to a standalone function that writes to atoms via the store API:

```typescript
import { appStore } from "../store"
import { sessionFamily, sessionIdsAtom } from "../sessions"
import { upsertMessageAtom } from "../messages"
import { upsertPartAtom, batchUpsertPartsAtom } from "../parts"
import { todosFamily } from "../todos"
import { flushStreamingParts, updateStreamingPart, isStreamingPartType } from "../streaming"

export function processEvent(event: Event): void {
  const { get, set } = appStore

  switch (event.type) {
    case "session.created":
    case "session.updated": {
      set(upsertSessionAtom, {
        session: event.properties.info,
        directory: event.properties.directory,
      })
      break
    }

    case "session.deleted": {
      set(removeSessionAtom, event.properties.info.id)
      break
    }

    case "session.status": {
      const sessionId = event.properties.info.id
      const status = event.properties.info.status

      set(setSessionStatusAtom, { sessionId, status })

      // Flush streaming buffer when session goes idle
      if (status.type === "idle") {
        const flushed = flushStreamingParts()
        if (flushed.length > 0) {
          set(batchUpsertPartsAtom, flushed)
        }
      }

      // Clear error when not idle (session resumed)
      if (status.type !== "idle") {
        set(setSessionErrorAtom, { sessionId, error: undefined })
      }
      break
    }

    case "session.error": {
      set(setSessionErrorAtom, {
        sessionId: event.properties.sessionID,
        error: event.properties.error,
      })
      break
    }

    case "message.updated": {
      set(upsertMessageAtom, event.properties.info)
      break
    }

    case "message.removed": {
      set(removeMessageAtom, {
        sessionId: event.properties.sessionID,
        messageId: event.properties.info.id,
      })
      break
    }

    case "message.part.updated": {
      const part = event.properties.part
      // High-frequency text/reasoning → streaming buffer
      if (isStreamingPartType(part)) {
        updateStreamingPart(part)
      }
      // All parts also go to main store (coalesced by event batcher)
      set(upsertPartAtom, part)
      break
    }

    case "message.part.removed": {
      set(removePartAtom, {
        messageId: event.properties.part.messageID,
        partId: event.properties.part.id,
      })
      break
    }

    case "permission.updated": {
      set(addPermissionAtom, {
        sessionId: event.properties.sessionID,
        permission: event.properties.info,
      })
      break
    }

    case "permission.replied": {
      set(removePermissionAtom, {
        sessionId: event.properties.sessionID,
        permissionId: event.properties.info.id,
      })
      break
    }

    case "todo.updated": {
      set(todosFamily(event.properties.sessionID), event.properties.todos)
      break
    }

    // question.* events handled via string comparison (SDK type gap)
    default: {
      const eventType = event.type as string
      if (eventType === "question.asked") {
        const props = (event as any).properties
        set(addQuestionAtom, { sessionId: props.sessionID, question: props })
      } else if (eventType === "question.replied" || eventType === "question.rejected") {
        const props = (event as any).properties
        set(removeQuestionAtom, { sessionId: props.sessionID, requestId: props.requestID })
      }
    }
  }
}
```

**Key change**: `processEvent` is now a pure function with no `this` context. It's called by the event batcher (unchanged) and writes to atoms via `appStore.set()`. The event batcher (`connection-manager.ts`) is unchanged structurally — only the final `flush()` call changes from `useAppStore.getState().processEvent(event)` to `processEvent(event)`.

---

## 9. Derived State & Computed Atoms

### 9.1 `atoms/derived/agents.ts`

The 100-line `useAgents` derivation moves from a `useMemo` in a hook to a derived atom:

```typescript
import { atom } from "jotai"

export const agentsAtom = atom((get) => {
  const sessionIds = get(sessionIdsAtom)
  const discovery = get(discoveryAtom)

  // Build project slug map
  const projectMap = new Map<string, string>()
  // ... (same logic as current useAgents useMemo)

  const agents: Agent[] = []

  // Live sessions
  for (const id of sessionIds) {
    const entry = get(sessionFamily(id))
    if (!entry) continue
    agents.push(deriveAgent(entry, projectMap))
  }

  // Discovered sessions (not live)
  for (const [projectId, sessions] of Object.entries(discovery.sessions)) {
    for (const session of sessions) {
      if (sessionIds.has(session.id)) continue // already live
      agents.push(deriveDiscoveredAgent(session, projectId, projectMap))
    }
  }

  return agents
})
```

**Advantage over current**: This atom automatically recomputes when any of its dependencies change (`sessionIdsAtom`, any `sessionFamily(id)`, `discoveryAtom`). No manual `useMemo` dependency arrays. No risk of stale closures.

**Performance consideration**: This atom reads ALL session atoms. If session A's status changes, this atom recomputes. This is acceptable because:
1. The agent list is displayed in the sidebar (always visible)
2. The derivation is cheap (no heavy computation)
3. The result is structurally shared (same agent objects reused if unchanged)

### 9.2 `atoms/derived/project-list.ts`

```typescript
export const projectListAtom = atom((get) => {
  const agents = get(agentsAtom)
  const showSubAgents = get(showSubAgentsAtom)
  // ... same grouping logic as current useProjectList
  return projects
})
```

### 9.3 `atoms/derived/waiting.ts`

```typescript
export const hasWaitingAtom = atom((get) => {
  const sessionIds = get(sessionIdsAtom)
  for (const id of sessionIds) {
    const entry = get(sessionFamily(id))
    if (!entry) continue
    if (entry.permissions.length > 0 || entry.questions.length > 0) return true
  }
  return false
})
```

---

## 10. Imperative Access (Outside React)

### 10.1 The Store API Pattern

All 29 current `getState()` calls map to `appStore.get(atom)` / `appStore.set(atom, value)`:

```typescript
// Current (Zustand):
const url = useAppStore.getState().opencode?.url
useAppStore.getState().setSessionBranch(sessionId, branch)

// New (Jotai):
import { appStore } from "../atoms/store"
import { serverUrlAtom } from "../atoms/connection"
import { sessionFamily } from "../atoms/sessions"

const url = appStore.get(serverUrlAtom)
const entry = appStore.get(sessionFamily(sessionId))
if (entry) {
  appStore.set(sessionFamily(sessionId), { ...entry, branch })
}
```

### 10.2 connection-manager.ts Adaptation

The connection manager has 11 `getState()` calls. Each maps cleanly:

| Current | New |
|---------|-----|
| `useAppStore.getState().setOpenCodeUrl(url)` | `appStore.set(serverUrlAtom, url)` |
| `useAppStore.getState().setOpenCodeConnected(true)` | `appStore.set(serverConnectedAtom, true)` |
| `useAppStore.getState().opencode?.url` | `appStore.get(serverUrlAtom)` |
| `useAppStore.getState().processEvent(event)` | `processEvent(event)` (standalone function) |
| `useAppStore.getState().batchUpsertParts(parts)` | `appStore.set(batchUpsertPartsAtom, parts)` |
| `useAppStore.getState().setSessions(...)` | `setSessions(...)` (standalone function) |

### 10.3 HMR Recovery

The current HMR recovery pattern (module-scoped `connection` is null but Zustand store remembers URL) works identically with Jotai:

```typescript
if (!connection) {
  const storeUrl = appStore.get(serverUrlAtom)
  if (storeUrl) {
    // Reconnect...
  }
}
```

Jotai store state survives HMR as long as the `Provider` is above the HMR boundary (it is — it's at the app root).

---

## 11. Persistence Layer

### 11.1 Migration from Zustand persist

Current: Single `zustand/middleware/persist` with key `"palot-preferences"`.

New: Individual `atomWithStorage` atoms with separate keys.

### 11.2 One-Time Migration

```typescript
// atoms/preferences.ts — run once on app boot

function migrateFromZustandPersist(): void {
  const oldKey = "palot-preferences"
  const raw = localStorage.getItem(oldKey)
  if (!raw) return

  try {
    const { state } = JSON.parse(raw) // Zustand persist wraps in { state, version }
    if (state.displayMode) localStorage.setItem("palot:displayMode", JSON.stringify(state.displayMode))
    if (state.theme) localStorage.setItem("palot:theme", JSON.stringify(state.theme))
    if (state.colorScheme) localStorage.setItem("palot:colorScheme", JSON.stringify(state.colorScheme))
    if (state.drafts) localStorage.setItem("palot:drafts", JSON.stringify(state.drafts))
    if (state.projectModels) localStorage.setItem("palot:projectModels", JSON.stringify(state.projectModels))

    // Remove old key after successful migration
    localStorage.removeItem(oldKey)
  } catch {
    // Ignore malformed data
  }
}

// Call at module load time
migrateFromZustandPersist()
```

---

## 12. TanStack Query Integration

**No changes needed.** TanStack Query continues handling server-fetched data (providers, config, VCS, agents, commands, model state). The only difference is how it gates on connection status:

```typescript
// Current:
const connected = useAppStore((s) => s.opencode?.connected ?? false)

// New:
const connected = useAtomValue(serverConnectedAtom)
```

The 6 query hooks in `use-opencode-data.ts` change their connection selector from `useAppStore` to `useAtomValue` — a one-line change per hook.

---

## 13. Migration Strategy

### 13.1 Approach: Parallel Coexistence, Then Switch

We do NOT do a big-bang migration. Instead:

1. **Phase 0: Setup** — Install Jotai, create `atoms/store.ts`, add `Provider` to app root alongside existing code.

2. **Phase 1: Preferences** — Migrate `usePersistedStore` to `atomWithStorage` atoms. This is fully independent and low-risk. Run migration script for localStorage keys.

3. **Phase 2: UI atoms** — Migrate `ui.commandPaletteOpen` and `ui.showSubAgents` to Jotai atoms. ~6 consumer sites.

4. **Phase 3: Connection atoms** — Migrate `opencode.url` and `opencode.connected`. Update `connection-manager.ts`. This is the first cross-cutting change.

5. **Phase 4: Session atoms** — Migrate sessions to `atomFamily`. Update event processor to write to session atoms. Update `useAgents`, `useWaitingIndicator`, sidebar components.

6. **Phase 5: Messages + Parts atoms** — The big one. Migrate messages, parts, and the streaming store. Update `useSessionChat`, chat components, `useCommands`.

7. **Phase 6: Discovery + Todos** — Migrate remaining state. Remove `useAppStore` entirely.

8. **Phase 7: Cleanup** — Remove Zustand dependency, delete old store files, update AGENTS.md.

### 13.2 Coexistence Bridge

During migration, some hooks will read from Jotai while others still read from Zustand. To keep them in sync, we use a temporary bridge:

```typescript
// TEMPORARY: Bridge Jotai → Zustand during migration
// Subscribe to Jotai atoms and sync to Zustand store
appStore.sub(serverConnectedAtom, () => {
  useAppStore.getState().setOpenCodeConnected(appStore.get(serverConnectedAtom))
})
```

This bridge is removed when all consumers are migrated.

### 13.3 Phase Timing Estimates

| Phase | Scope | Estimated Effort | Risk |
|-------|-------|-----------------|------|
| Phase 0: Setup | 2 files | 1 hour | None |
| Phase 1: Preferences | 5 atoms, ~15 consumer sites | 2-3 hours | Low |
| Phase 2: UI atoms | 2 atoms, ~6 consumer sites | 1 hour | Low |
| Phase 3: Connection | 2 atoms, connection-manager | 2-3 hours | Medium |
| Phase 4: Sessions | atomFamily + event processor | 4-6 hours | Medium-High |
| Phase 5: Messages + Parts | atomFamily + streaming + chat | 6-8 hours | High |
| Phase 6: Discovery + Todos | 2 atoms, 2 hooks | 2-3 hours | Low |
| Phase 7: Cleanup | Remove Zustand, update docs | 1-2 hours | Low |
| **Total** | | **~20-28 hours** | |

---

## 14. File-by-File Migration Map

### Files to Create

| File | Purpose |
|------|---------|
| `atoms/store.ts` | Store singleton + Provider |
| `atoms/connection.ts` | Server URL + connected |
| `atoms/sessions.ts` | Session atomFamily + actions |
| `atoms/messages.ts` | Messages atomFamily + actions |
| `atoms/parts.ts` | Parts atomFamily + actions |
| `atoms/streaming.ts` | Streaming buffer (adapted from `streaming-store.ts`) |
| `atoms/todos.ts` | Todos atomFamily |
| `atoms/discovery.ts` | Discovery state |
| `atoms/ui.ts` | UI toggles |
| `atoms/preferences.ts` | Persisted preferences |
| `atoms/derived/agents.ts` | Agent derivation |
| `atoms/derived/project-list.ts` | Sidebar project list |
| `atoms/derived/session-chat.ts` | Chat turns + parts merge |
| `atoms/derived/session-todos.ts` | Session todos derivation |
| `atoms/derived/waiting.ts` | Has-waiting boolean |
| `atoms/actions/event-processor.ts` | SSE event dispatcher |
| `atoms/actions/session-actions.ts` | User-initiated session actions |
| `atoms/actions/connection-actions.ts` | Connect/disconnect/load |

### Files to Modify

| File | Changes |
|------|---------|
| `services/connection-manager.ts` | Replace `useAppStore.getState()` with `appStore.get/set` |
| `hooks/use-session-chat.ts` | Simplify to `useAtomValue(sessionTurnsFamily(id))` + fetch logic |
| `hooks/use-agents.ts` | Simplify to `useAtomValue(agentsAtom)` + thin wrappers |
| `hooks/use-opencode-data.ts` | Change connection selector to `useAtomValue(serverConnectedAtom)` |
| `hooks/use-server.ts` | Change connection read + import actions from `atoms/actions/` |
| `hooks/use-commands.ts` | Read from session/message atoms instead of `useAppStore` |
| `hooks/use-theme.ts` | Change to `useAtomValue(themeAtom)` etc. |
| `hooks/use-discovery.ts` | Change to `appStore.set(discoveryAtom, ...)` |
| `hooks/use-waiting-indicator.ts` | Change to `useAtomValue(hasWaitingAtom)` |
| `hooks/use-draft.ts` | Change to `useAtom(draftFamily(key))` |
| All component files using `useAppStore` | Change selectors to `useAtomValue(atom)` |
| `App.tsx` / root layout | Add `<Provider store={appStore}>` |

### Files to Delete

| File | Replaced By |
|------|-------------|
| `stores/app-store.ts` | `atoms/` directory |
| `stores/persisted-store.ts` | `atoms/preferences.ts` |
| `stores/streaming-store.ts` | `atoms/streaming.ts` |

---

## 15. Risk Assessment

### High Risk

| Risk | Mitigation |
|------|------------|
| **atomFamily memory leaks** — Sessions/messages removed from server but atoms not cleaned up | Use `sessionFamily.remove(id)` in `removeSession`. Add a periodic sweep that compares `sessionIdsAtom` against `sessionFamily.getParams()`. |
| **Streaming performance regression** — Jotai atom writes during streaming could be slower than module-scoped mutation | Keep the module-scoped buffer. Only write to atoms at throttled intervals (same 50ms as current). Benchmark before/after. |
| **Race conditions during migration** — Zustand and Jotai out of sync during coexistence | Use the bridge pattern (section 13.2). Migrate in dependency order. Test each phase independently. |

### Medium Risk

| Risk | Mitigation |
|------|------------|
| **Derived atom cascade** — A change to `sessionFamily(id)` triggers `agentsAtom` + `projectListAtom` + `hasWaitingAtom` | This is the same as current (all hooks depend on `s.sessions`). Jotai may actually be faster since it tracks dependencies at the atom level, not the store level. |
| **atomFamily key management** — String keys must be consistent across read/write sites | Use strongly-typed family factories. TypeScript enforces parameter types. |
| **Developer learning curve** — Team needs to learn Jotai patterns | Jotai's API is smaller than Zustand's. The `atom()` / `useAtom()` / `store.get()` trifecta covers 95% of cases. |

### Low Risk

| Risk | Mitigation |
|------|------------|
| **localStorage migration** — Old preferences lost | One-time migration script (section 11.2) runs before any atoms are read. |
| **HMR state preservation** — Jotai store lost on HMR | Jotai store in `Provider` survives HMR as long as the Provider is above the boundary. Same as current Zustand behavior. |
| **Bundle size** — Jotai larger than Zustand | Jotai core is 2KB. Zustand is 1.1KB. With `jotai/utils` we add ~2KB. Net increase: ~3KB. Negligible. |

---

## 16. Performance Budget

### Targets (must match or beat current)

| Metric | Current | Target | How We Achieve It |
|--------|---------|--------|-------------------|
| Streaming text render latency | ≤50ms (throttled) | ≤50ms | Same buffer + throttle (50ms) |
| Session switch time | <100ms | <100ms | `atomFamily` gives O(1) access (no scanning) |
| Sidebar re-renders on part update | 0 (partsVersion scoping) | 0 | Sidebar reads `agentsAtom`, not `partsFamily`. Part changes don't propagate to agents unless status changes. |
| Memory per session | ~200 messages + parts | Same | Same 200-message cap. `atomFamily.remove()` on session delete. |
| Event processing throughput | ~1000 events/sec (batched) | Same | Event batcher is unchanged. `appStore.set()` is synchronous, same as Zustand `set()`. |

### Benchmarking Plan

Before starting Phase 5 (the critical streaming migration), benchmark:

1. **Streaming render FPS** — Record frames during a long streaming response. Must maintain 20+ FPS.
2. **Time-to-interactive after session switch** — Measure from click to first paint of new session's messages.
3. **Memory usage** — Heap snapshot with 5 active sessions, 200 messages each. Compare before/after.
4. **Event processing latency** — Time from SSE event receipt to React commit. Sample 1000 events.

---

## Appendix A: Jotai Utilities Cheat Sheet

| Utility | Package | Used For |
|---------|---------|----------|
| `atom()` | `jotai` | Primitive + derived atoms |
| `useAtom()` | `jotai` | Read + write in components |
| `useAtomValue()` | `jotai` | Read-only in components |
| `useSetAtom()` | `jotai` | Write-only in components (no subscription) |
| `createStore()` | `jotai` | Store singleton for imperative access |
| `Provider` | `jotai` | Scope store to React tree |
| `atomWithStorage()` | `jotai/utils` | localStorage-backed atoms |
| `atomFamily()` | `jotai-family` | Per-entity atom creation (sessions, messages, parts) |
| `selectAtom()` | `jotai/utils` | Escape hatch for subscribing to sub-field of large atom |
| `splitAtom()` | `jotai/utils` | Array → individual item atoms (potential use for message lists) |

## Appendix B: Key Jotai Patterns for This Codebase

### B.1 Write-Only Action Atoms

```typescript
// Pattern: atom(null, setter) creates a write-only atom
const incrementAtom = atom(null, (get, set) => {
  set(countAtom, get(countAtom) + 1)
})

// In component:
const increment = useSetAtom(incrementAtom)
increment() // no subscription, no re-render
```

### B.2 atomFamily for Entities

```typescript
// Pattern: atomFamily creates a unique atom per key
const sessionFamily = atomFamily((id: string) => atom<Session | null>(null))

// Reading:
const session = useAtomValue(sessionFamily("abc123"))

// Writing (imperative):
appStore.set(sessionFamily("abc123"), newSession)

// Cleanup:
sessionFamily.remove("abc123")
```

### B.3 Derived Atom with Multiple Dependencies

```typescript
// Pattern: derived atom reads multiple atoms
const fullNameAtom = atom((get) => {
  const first = get(firstNameAtom)
  const last = get(lastNameAtom)
  return `${first} ${last}`
})
// Re-renders ONLY when first or last name changes
```

### B.4 Imperative Store Access

```typescript
// Pattern: store.get/set for outside-React code
import { appStore } from "./atoms/store"

function doSomething() {
  const url = appStore.get(serverUrlAtom)
  appStore.set(serverConnectedAtom, true)
}

// Subscribe to changes:
const unsub = appStore.sub(serverConnectedAtom, () => {
  console.log("Connected:", appStore.get(serverConnectedAtom))
})
```

## Appendix C: Comparison with AI SDK Patterns

| AI SDK Pattern | Our Jotai Equivalent |
|---|---|
| `useSyncExternalStore` for messages | `useAtomValue(sessionTurnsFamily(id))` |
| `useSyncExternalStore` for status | `useAtomValue(sessionFamily(id))` — status is a field |
| `ReactChatState.#messagesCallbacks` (independent channel) | Separate atoms = separate subscriptions by default |
| `structuredClone` on `replaceMessage` | New array reference on atom `set()` (shallow clone suffices) |
| `throttle(onChange, throttleWaitMs)` | Streaming buffer + `streamingVersionAtom` throttled bump |
| `SerialJobExecutor` | Event batcher already serializes (rAF flush). For user actions, Jotai `set()` is synchronous. |
| `Chat` class as external state holder | `appStore` (Jotai store) as external state holder |
| `chat.messages` getter | `appStore.get(messagesFamily(sessionId))` |
