# Plan: Single OpenCode Server Architecture

## Status: IN PROGRESS

## Goal

Replace the current multi-server architecture (one `opencode serve` per project) with a
single shared `opencode serve` instance that serves all projects. This makes the toolbar
(agent selector, model selector, variant selector, VCS info) available for every project
immediately — no need to wait for a per-project server to start.

## Background

OpenCode's `serve` command starts a directory-agnostic HTTP server. Every API request
accepts a `directory` query param (or `x-opencode-directory` header) which scopes
the request to that project via `AsyncLocalStorage`. Config, agents, VCS, sessions,
providers — everything is resolved per-directory, lazily initialized and cached.

The SDK's `createOpencodeClient({ baseUrl, directory })` automatically sends the
directory as a header on every request. So creating multiple clients against the same
URL but with different directories gives us per-project isolation from a single server.

## Architecture: Before vs After

### Before (current)
```
Palot Backend (port 3100)
  ├── manages N opencode serve processes (ports 4101, 4102, ...)
  └── discovery reads disk

Desktop Frontend
  ├── connections Map<serverId, { client, abortController }>
  ├── store.servers: Record<serverId, ServerConnection>
  │     └── sessions nested under each server
  ├── getClient(serverId) → OpencodeClient | undefined
  └── ensureServerForProject(dir) starts a new process if needed
```

### After (target)
```
Palot Backend (port 3100)
  ├── manages ONE opencode serve process (port 4101)
  └── discovery reads disk

Desktop Frontend
  ├── single connection: { url, client, abortController }
  ├── projectClients Map<directory, OpencodeClient>  (same URL, different directory header)
  ├── store redesigned:
  │     ├── server: { url, connected }  (singular)
  │     └── sessions: Record<sessionId, SessionEntry>  (flat, not nested under servers)
  ├── getProjectClient(directory) → OpencodeClient
  └── SSE: one stream, events routed by session.directory or session.projectID
```

---

## Task Breakdown

### Phase 1: Backend — Single Server Lifecycle
- [x] Research completed
- [ ] **1.1** Update `server-manager.ts`: add `ensureSingleServer()` that starts one
  `opencode serve` on a fixed port if not already running. Remove per-directory
  server spawning logic (keep `startServer` but repurpose it).
- [ ] **1.2** Update `routes/servers.ts`: add `GET /opencode` endpoint that returns
  the single server's URL, or starts it if not running. Keep existing endpoints
  for backward compat during transition.
- [ ] **1.3** Backend starts the single server eagerly on boot (in `index.ts`).

### Phase 2: Store Redesign
- [ ] **2.1** Flatten `app-store.ts`:
  - Replace `servers: Record<serverId, ServerConnection>` with:
    - `opencode: { url: string; connected: boolean }` (singular server state)
    - `sessions: Record<sessionId, SessionEntry>` (flat, no server nesting)
  - Update all session actions to operate on flat `sessions` map.
  - `processEvent` no longer takes `serverId` — routes by event content.
- [ ] **2.2** Update `SessionEntry` to include `directory` and `projectID` fields
  (already present on the session object from OpenCode).

### Phase 3: Connection Manager Rewrite
- [ ] **3.1** Replace the `connections Map<serverId, ...>` with a single connection:
  - `serverUrl: string | null`
  - `baseClient: OpencodeClient` (no directory — for SSE subscription)
  - `projectClients: Map<directory, OpencodeClient>` (per-project, same URL)
- [ ] **3.2** New exports:
  - `connectToOpenCode(url)` — connects, loads all sessions, starts SSE
  - `getProjectClient(directory)` — returns or creates a project-scoped client
  - `isConnected()` — simple boolean
  - Remove: `getClient(serverId)`, `findServerForDirectory(dir)`,
    `ensureServerForProject(dir)`, `connectAndSubscribe(serverId, url, dir)`
- [ ] **3.3** SSE event routing: the single stream delivers events for all projects.
  Each session event has `properties.info.directory`. Use this to attribute events
  to the correct project. `processEvent` no longer needs `serverId`.

### Phase 4: Discovery Hook Update
- [ ] **4.1** Rewrite `use-discovery.ts`:
  1. Fetch discovery data (projects/sessions from disk) — same as today.
  2. Call backend to ensure the single server is running → get its URL.
  3. Call `connectToOpenCode(url)` once — loads sessions for ALL projects.
  4. No more loop over detected servers.

### Phase 5: Hook Updates (serverId → directory)
- [ ] **5.1** `use-opencode-data.ts`: Change all hooks from `(serverId)` to
  `(directory)`. Replace `getClient(serverId)` with `getProjectClient(directory)`.
  - `useProviders(directory)`
  - `useConfig(directory)`
  - `useVcs(directory)`
  - `useOpenCodeAgents(directory)`
- [ ] **5.2** `use-server.ts` (`useAgentActions`): Change all actions from
  `(serverId, sessionId, ...)` to `(directory, sessionId, ...)`. Use
  `getProjectClient(directory)` instead of `getClient(serverId)`.
- [ ] **5.3** `use-session-chat.ts`: Change from `(serverId, sessionId)` to
  `(directory, sessionId)`. Use `getProjectClient(directory)`.
- [ ] **5.4** `use-session-messages.ts`: Same change as 5.3.
- [ ] **5.5** `use-agents.ts`: Remove the server-iteration pattern. Derive agents
  from the flat `store.sessions` map + discovery sessions. No more `serverId`
  on Agent — replace with `directory` (already exists on Agent type).

### Phase 6: Component Updates
- [ ] **6.1** `Agent` type in `lib/types.ts`: Remove `serverId` field. The `directory`
  field (already present) is sufficient to get a project client.
- [ ] **6.2** `session-route.tsx`: Pass `agent.directory` instead of `agent.serverId`
  to hooks and action handlers.
- [ ] **6.3** `agent-detail.tsx`: Update `onSendMessage` signature — no more serverId.
- [ ] **6.4** `chat-view.tsx`: Already uses resolved data from parent — minimal changes.
- [ ] **6.5** `new-chat.tsx`: Remove `findServerForDirectory` / `ensureServerForProject`
  logic. Always show toolbar — just pass `selectedDirectory` to hooks.
  The server is always running.
- [ ] **6.6** `sidebar.tsx`: No changes expected (doesn't reference serverId directly).

### Phase 7: Backend Cleanup
- [ ] **7.1** `palot-server.ts` (RPC client): Update/add `fetchOpenCodeUrl()`
  function. Remove or deprecate `startServerForProject`.
- [ ] **7.2** Remove multi-server port allocation from `server-manager.ts`.

### Phase 8: Verification
- [ ] **8.1** Type check: `bun run check-types` passes
- [ ] **8.2** Lint: `bunx biome check --write .` passes
- [ ] **8.3** Visual test: all projects show toolbar immediately in new-chat view
- [ ] **8.4** Visual test: creating a session works for any project
- [ ] **8.5** Visual test: SSE events update sessions in real-time across projects

---

## Key Design Decisions

### How sessions are loaded on connect
Currently, `connectAndSubscribe` calls `listSessions(client)` which returns sessions
for the client's directory. With a single server and no directory on the base client,
we need to load sessions for ALL projects. Options:

**Chosen approach:** After connecting, iterate over all discovered project directories
and call `client.session.list()` with each directory. This gives us all sessions
grouped by project. Alternatively, we could rely purely on discovery (disk) for the
initial session list and let SSE events bring in live status — this avoids N API calls
on startup but means sessions are "completed" until the first SSE status event arrives.

**Hybrid approach (recommended):** Use discovery data for initial session list (already
fast and complete), then fetch session statuses via the single server for all projects
that have active sessions. This minimizes API calls while still getting real-time status.

### How SSE events are attributed to projects
Each session event includes `properties.info.directory` and `properties.info.projectID`.
For `session.status` events, we need to look up the session in our store to find its
directory. This means we need a `sessionId → directory` index in the store or on the
session entry itself.

### What happens if the single server dies
The SSE reconnection loop already handles disconnects with exponential backoff. If the
server process crashes, the Palot backend should detect this and restart it. The
frontend shows "Disconnected" in the status bar and auto-reconnects when the server
comes back.

### The `directory` param on session.messages
The SDK sends `x-opencode-directory` on every request. For `session.messages({ sessionID })`,
the directory scopes it to the right project. Even though session IDs are globally unique,
the server needs the directory to set up the correct Instance context for reading storage.

---

## Files To Modify

| File | Change Type | Description |
|------|------------|-------------|
| `apps/server/src/services/server-manager.ts` | Major rewrite | Single server lifecycle |
| `apps/server/src/routes/servers.ts` | Modify | New endpoint for single server URL |
| `apps/server/src/index.ts` | Minor | Auto-start single server on boot |
| `apps/desktop/src/stores/app-store.ts` | Major rewrite | Flatten sessions, remove server nesting |
| `apps/desktop/src/services/connection-manager.ts` | Major rewrite | Single connection, project clients |
| `apps/desktop/src/services/palot-server.ts` | Modify | New RPC function for server URL |
| `apps/desktop/src/services/opencode.ts` | Minor | May need directory-aware wrappers |
| `apps/desktop/src/hooks/use-discovery.ts` | Rewrite | Single connect flow |
| `apps/desktop/src/hooks/use-opencode-data.ts` | Modify | serverId → directory params |
| `apps/desktop/src/hooks/use-server.ts` | Modify | serverId → directory params |
| `apps/desktop/src/hooks/use-session-chat.ts` | Modify | serverId → directory |
| `apps/desktop/src/hooks/use-session-messages.ts` | Modify | serverId → directory |
| `apps/desktop/src/hooks/use-agents.ts` | Modify | Derive from flat sessions, remove serverId |
| `apps/desktop/src/lib/types.ts` | Modify | Remove serverId from Agent |
| `apps/desktop/src/components/session-route.tsx` | Modify | Pass directory not serverId |
| `apps/desktop/src/components/agent-detail.tsx` | Modify | Update onSendMessage signature |
| `apps/desktop/src/components/chat/chat-view.tsx` | Minor | Minimal prop changes |
| `apps/desktop/src/components/new-chat.tsx` | Simplify | Always show toolbar, remove server checks |
| `apps/desktop/src/components/root-layout.tsx` | Minor | Remove useServerConnection if unused |

---

## Estimated Effort: HIGH

This is a significant architectural change touching ~20 files. The store redesign and
connection manager rewrite are the most complex parts. However, the resulting code will
be simpler (no server multiplexing, no serverId indirection) and the UX will be better
(toolbar always available).
