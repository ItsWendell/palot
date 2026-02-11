# Native OS Notifications Plan

> **Goal:** Notify the user via macOS and Linux native notifications when an agent needs attention — whether it finished, is asking for permission, posed a question, or hit an error — so the user can context-switch away from Palot without missing important moments.

## Problem Statement

Palot is a desktop app where agents run long tasks autonomously. Users naturally switch to other windows (editor, browser, terminal) while agents work. Today the **only** attention signal is a document title change (`(!) Palot — Input needed`) via `use-waiting-indicator.ts`. This is effectively invisible when the app is minimized, behind other windows, on a different virtual desktop, or the user is in full-screen mode in another app.

The result: agents sit idle waiting for permission/question responses, wasting minutes or even timing out. Completed agents go unnoticed. Errors are discovered only when the user happens to check back.

---

## Architecture

### The Background Reliability Problem

The renderer is a Chromium process. When the Palot window is hidden or minimized:

- **macOS App Nap** suspends the renderer's timers and deprioritizes network I/O after ~30s of being hidden
- **Chromium background throttling** clamps `setTimeout`/`setInterval` to 1s+ and pauses `requestAnimationFrame` entirely
- **OS power management** (especially on battery) aggressively throttles hidden windows on both macOS and Linux

The SSE event loop currently lives in the renderer (`connection-manager.ts`) and uses `requestAnimationFrame` for event batching. When the app is backgrounded, this loop may stop processing events entirely — which means the renderer cannot reliably detect notification-worthy transitions in exactly the scenario where notifications matter most.

### Why Not `powerSaveBlocker`?

OpenAI's Codex desktop app solves this by calling `electron.powerSaveBlocker.start("prevent-app-suspension")` whenever an agent runs. This keeps the entire Chromium renderer awake. However:

- The full renderer stays resident at 150-300MB, with V8 GC/compositor running continuously
- macOS cannot App Nap the process — efficiency cores are bypassed, battery drain is measurable
- The entire app stays hot even if the user hasn't looked at it in hours

For Palot, where users run agents for extended periods, this is wasteful. What actually needs to stay awake is: one HTTP connection reading small JSON payloads, a few `if` checks per event, and one Electron API call to fire a notification.

### Approach: Main-Process SSE Watcher

The main process opens its own **independent, lightweight SSE connection** to the OpenCode server's `/global/event` endpoint. This connection is notification-only — it watches for the 4-5 event types that trigger notifications and ignores everything else. The renderer keeps its existing SSE connection unchanged for UI state management.

**Why this is efficient:**

- The Node.js main process is **already running** (manages window, OpenCode server process, IPC). Adding a lightweight SSE parser costs essentially zero additional memory.
- Node.js event loop is **never throttled** — it runs at full speed regardless of window visibility, App Nap, or power management.
- SSE is a single long-lived HTTP connection. Two connections to localhost is negligible.
- Zero impact on the existing renderer streaming path — the high-frequency `message.part.updated` events (200-500/sec during streaming) stay entirely in the renderer with their coalescing and `requestAnimationFrame` batching.
- When the app is backgrounded, the renderer SSE naturally gets throttled by the OS (which is **good** for power efficiency). The main-process watcher takes over notification duty.
- When the user brings the app back to foreground, the renderer reconnects SSE and catches up via `listSessions` + `getSessionStatuses` (existing reconnection path).

**Why not move SSE entirely to the main process?**

At 500 events/sec during streaming, each IPC call costs ~0.1-0.2ms (structured clone + Mojo pipe). That's ~75ms/sec of IPC work, and the renderer's event batcher currently coalesces ~30 events per 16ms frame — with IPC you'd pay serialization 30x before coalescing. The streaming buffer (`atoms/streaming.ts`) only works because it's in the same process as the SSE consumer.

### Data Flow

```
OpenCode Server (/global/event SSE)
    │
    ├──────────────────────────────────┐
    │                                  │
    ▼                                  ▼
Main Process                       Renderer
(notification-watcher.ts)          (connection-manager.ts)
    │                                  │
    │ net.fetch() SSE                  │ SDK SSE (browser fetch)
    │ Raw line parsing                 │ Full event processing
    │ Filter: permission,              │ Batching, coalescing,
    │   question, status, error        │ streaming buffer, Jotai
    │                                  │
    │ Minimal state:                   │ Full UI state:
    │   Map<sessionId, lastStatus>     │   Sessions, messages,
    │   Map<sessionId, title>          │   parts, permissions,
    │   for transition detection       │   questions, todos
    ▼                                  ▼
notifications.ts                   React UI
    │
    │ 1. Detect transitions
    │    (busy->idle, new permission, etc.)
    │ 2. Apply suppression rules
    │    (focused? cooldown? batch?)
    │ 3. Fire Electron Notification
    │ 4. Update dock badge / bounce / flash
    │
    ▼ (user clicks notification)
    │
    │ webContents.send("notification:navigate")
    ▼
Renderer: navigate to session
```

### Notification-Worthy Events

| Event Type | Trigger | Priority | State Needed |
|-----------|---------|----------|-------------|
| `permission.updated` | Agent blocked on permission | High | None — fire immediately |
| `question.asked` | Agent blocked on question | High | None — fire immediately |
| `session.status` | Detect busy/retry -> idle (completion) | Medium | Previous status per session |
| `session.error` | Agent hit an error | Medium | None — fire immediately |
| `session.updated` | Get session title for notification body | — | Cache title per session |

Everything else (`message.part.updated`, `message.updated`, `todo.updated`, etc.) is ignored.

### Suppression Rules

1. **App is focused** — don't fire OS notifications (dock badge/bounce still apply)
2. **Rapid-fire permissions** — batch within 3s window per session
3. **Cooldown** — 30s per session+event type to prevent spam
4. **OS DND** — `Notification.isSupported()` respects system settings

### SSE Lifecycle

1. **Start:** When `opencode-manager.ts` successfully starts/detects the server, also start the notification watcher
2. **Reconnect:** Exponential backoff (1s -> 30s max) via `setTimeout` (never throttled in Node.js)
3. **Stop:** When server stops or app quits, abort the SSE connection

---

## Implementation

### Phase 1: Main-Process Notification Infrastructure

#### `src/main/notifications.ts` — Notification firing + suppression

Handles `Electron.Notification` creation, suppression rules, batching, dock badge, dock bounce, and window flash. Receives notification requests from the watcher.

#### `src/main/notification-watcher.ts` — Lightweight SSE parser

Opens a `net.fetch()` SSE connection to `/global/event`. Parses SSE lines, filters for notification-worthy events, tracks minimal state (`Map<sessionId, status>` and `Map<sessionId, title>`), and calls `notifications.ts` on transitions.

#### Window focus tracking in `src/main/index.ts`

Forward `focus`/`blur`/`show`/`hide` events from `BrowserWindow` so `notifications.ts` knows whether the app is focused. Uses main-process state (no IPC to renderer needed for this).

#### Wire into server lifecycle in `opencode-manager.ts`

Start/stop the notification watcher alongside the OpenCode server.

### Phase 2: IPC + Preload Bridge

#### `src/main/ipc-handlers.ts` — New channels

- `notification:navigate` (main -> renderer push): when user clicks a notification, tell renderer to navigate to the session

#### `src/preload/index.ts` + `src/preload/api.d.ts`

Expose `onNotificationNavigate(callback)` for the renderer to subscribe to navigation events.

### Phase 3: Renderer Integration

#### Navigation handler in root layout

Subscribe to `notification:navigate` and route to the correct session.

#### Dock badge sync

Renderer counts pending permissions + questions and sends count to main process via IPC. Main process calls `app.dock.setBadge()` (macOS) or `app.setBadgeCount()`.

### Phase 4 (Future): User Preferences, Stuck Detection, Sound

Deferred to a follow-up. The core notification infrastructure ships first.

---

## Platform Notes

- **macOS:** No entitlements needed for local notifications. `hardenedRuntime: true` doesn't block them. `appId: com.palot.desktop` groups notifications in System Preferences.
- **Linux:** Uses `libnotify`. No special permissions. `BrowserWindow.flashFrame()` works on X11; varies on Wayland.
- **Windows:** Toast notifications via Windows API. NSIS installer handles app identity.

---

## References

- [Electron Notification API](https://www.electronjs.org/docs/latest/api/notification)
- [Electron app.dock (macOS)](https://www.electronjs.org/docs/latest/api/app#appdock-macos)
- [Electron BrowserWindow.flashFrame](https://www.electronjs.org/docs/latest/api/browser-window#winflashframeflag)
- [Questions & Permissions UX Plan](./questions-and-permissions-ux.md)
- OpenAI Codex desktop app (extracted) — reference implementation at `../codex-app/extracted/`
