# OpenCode Architecture Reference

Reference document for the official OpenCode repository (`../opencode`), used to inform Codedeck's design decisions.

## Repository Overview

- **Monorepo**: Bun + Turborepo
- **Language**: TypeScript (~95%), Rust (Tauri desktop shell)
- **Runtime**: Bun (server, CLI, TUI), Vite (web/desktop frontend)

### Package Map

| Package | Name | Description |
|---------|------|-------------|
| `packages/opencode` | `@opencode-ai/opencode` | Core: CLI + Server + TUI + agents + tools + storage |
| `packages/app` | `@opencode-ai/app` | Shared SolidJS web UI (used by desktop + web) |
| `packages/desktop` | `@opencode-ai/desktop` | Tauri v2 desktop wrapper |
| `packages/ui` | `@opencode-ai/ui` | Shared SolidJS UI component library |
| `packages/sdk/js` | `@opencode-ai/sdk` | Auto-generated TypeScript API client |
| `packages/plugin` | `@opencode-ai/plugin` | Plugin system SDK |
| `packages/web` | - | Marketing site (Astro + Starlight) |

---

## Server Architecture (`opencode serve`)

Framework: **Hono** on **Bun.serve()**, default port **4096**.

### Key Design Patterns

1. **Directory scoping**: Every request includes a `directory` param (query or `x-opencode-directory` header) that scopes the server instance to a specific project.
2. **SSE broadcast**: The `/event` endpoint broadcasts ALL events for the instance; clients filter by sessionID.
3. **Basic auth**: Optional via `OPENCODE_SERVER_PASSWORD` env var.
4. **Heartbeat**: SSE sends keepalive every 30s (required for WKWebView in Tauri on macOS).

### Complete API Endpoints

#### Session Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/session/` | List sessions (filters: directory, roots, start, search, limit) |
| GET | `/session/status` | Status of all sessions (idle/busy/retry) |
| POST | `/session/` | Create session (body: `{ parentID?, title? }`) |
| GET | `/session/:id` | Get session details |
| PATCH | `/session/:id` | Update session (title, archive time) |
| DELETE | `/session/:id` | Delete session (cascades to children) |
| GET | `/session/:id/children` | List child/forked sessions |
| GET | `/session/:id/todo` | Get session todo list |
| POST | `/session/:id/init` | Initialize session (generate AGENTS.md) |
| POST | `/session/:id/fork` | Fork session at a message point |
| POST | `/session/:id/abort` | Abort active processing |
| POST | `/session/:id/share` | Create shareable link |
| DELETE | `/session/:id/share` | Remove shareable link |
| GET | `/session/:id/diff` | File diffs for a session |
| POST | `/session/:id/summarize` | Trigger compaction |
| POST | `/session/:id/revert` | Revert a message (undo) |
| POST | `/session/:id/unrevert` | Restore reverted messages |

#### Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/session/:id/message` | List messages (optional limit) |
| GET | `/session/:id/message/:msgId` | Get message with parts |
| **POST** | **`/session/:id/message`** | **Send prompt (the main chat endpoint)** |
| POST | `/session/:id/prompt_async` | Send prompt async (returns 204, track via SSE) |
| POST | `/session/:id/command` | Execute a slash command |
| POST | `/session/:id/shell` | Run shell command (! prefix) |
| DELETE | `/session/:id/message/:msgId/part/:partId` | Delete a message part |
| PATCH | `/session/:id/message/:msgId/part/:partId` | Update a message part |

#### PTY (Terminal)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/pty/` | List active PTY sessions |
| POST | `/pty/` | Create PTY (body: `{ command?, args?, cwd?, title? }`) |
| GET | `/pty/:id` | Get PTY session info |
| PUT | `/pty/:id` | Update PTY (title, resize: `{ rows, cols }`) |
| DELETE | `/pty/:id` | Kill and remove PTY |
| **GET** | **`/pty/:id/connect`** | **WebSocket upgrade for PTY I/O** |

#### Permissions & Questions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/permission/` | List pending permission requests |
| POST | `/permission/:id/reply` | Approve/deny permission |
| GET | `/question/` | List pending questions |
| POST | `/question/:id/reply` | Answer a question |
| POST | `/question/:id/reject` | Reject a question |

#### Config, Providers, MCP
| Method | Path | Description |
|--------|------|-------------|
| GET/PATCH | `/config/` | Read/write project config |
| GET | `/config/providers` | List providers with defaults |
| GET | `/provider/` | List all providers/models |
| PUT/DELETE | `/auth/:providerId` | Set/remove provider auth |
| GET/POST | `/mcp/` | MCP server status / add server |
| POST | `/mcp/:name/connect` | Connect MCP server |
| POST | `/mcp/:name/disconnect` | Disconnect MCP server |

#### Files & Search
| Method | Path | Description |
|--------|------|-------------|
| GET | `/find` | Ripgrep text search |
| GET | `/find/file` | File name search |
| GET | `/file` | List files in path |
| GET | `/file/content` | Read file contents |
| GET | `/file/status` | Git status of files |

#### Events
| Method | Path | Description |
|--------|------|-------------|
| GET | `/event` | SSE event stream (instance-scoped) |
| GET | `/global/event` | SSE event stream (cross-directory, includes `directory` field) |
| GET | `/global/health` | Health check |

#### Misc
| Method | Path | Description |
|--------|------|-------------|
| GET | `/path` | Workspace paths |
| GET | `/vcs` | Git branch info |
| GET | `/agent` | List agents |
| GET | `/command` | List commands |
| GET | `/doc` | OpenAPI spec |
| POST | `/instance/dispose` | Dispose instance |

---

## PTY (Terminal) Architecture

Library: **`bun-pty`** (native Bun PTY binding)

### Data Model
```typescript
Pty.Info = {
  id: string,         // "pty_..." 
  title: string,      // Display name
  command: string,     // Shell command (e.g. "/bin/zsh")
  args: string[],
  cwd: string,
  status: "running" | "exited",
  pid: number,
}
```

### Lifecycle
1. **Create**: `POST /pty/` -> spawns process with `TERM=xterm-256color`, stores in-memory buffer
2. **Connect**: `GET /pty/:id/connect` -> WebSocket upgrade, replays buffered output (up to 2MB)
3. **Data flow**: Client sends keystrokes via WebSocket -> `process.write()`. Process output -> broadcast to all connected WebSocket clients.
4. **Resize**: `PUT /pty/:id` with `{ size: { rows, cols } }` -> `process.resize()`
5. **Buffer**: When no clients connected, output accumulates in a 2MB ring buffer. Flushed on reconnect.
6. **Close**: `DELETE /pty/:id` -> kills process, closes WebSockets, emits `pty.deleted`

### Events
- `pty.created`, `pty.updated`, `pty.exited`, `pty.deleted`

---

## Desktop App (Tauri v2)

### Architecture
- **Rust shell** (`src-tauri/`): Window management, native menus, sidecar spawning, auto-update
- **Web frontend**: SolidJS + Tailwind v4, wraps shared `@opencode-ai/app` package
- **Sidecar pattern**: Rust spawns bundled `opencode-cli` binary on a random port with UUID password, then passes URL to frontend
- **IPC**: `tauri-specta` for type-safe Rust <-> TypeScript bindings

### Terminal Component
- Uses **`ghostty-web`** (v0.4.0) -- WebAssembly terminal renderer from the Ghostty project
- NOT xterm.js
- Connects to PTY via WebSocket: `ws://{server}/pty/{id}/connect`
- Features: `FitAddon` (auto-resize), `SerializeAddon` (buffer persistence across tab switches), 10K scrollback
- Terminal state persists per-workspace (shared across sessions in same directory)

### Chat/Conversation UI
- **MessageTimeline**: Scrollable conversation with auto-scroll, scroll spy, pagination (20 turns initially, lazy-load more)
- **SessionTurn**: One user message + all assistant responses. Collapsible tool steps with real-time status labels.
- **PromptInput**: `contenteditable` div (not textarea), supports `@` mentions (agents/files), `/` commands, `!` shell mode, image paste, history (Up/Down), Shift+Enter for newline.
- **Submit flow**: Creates optimistic message -> calls `session.prompt()` -> on failure restores input

### Session Management
- URL-based routing: `/{base64Dir}/session/{sessionId}`
- Sidebar: Icon rail (project avatars) + expanded panel (session tree per workspace)
- Session items show: title, diff badge, status indicators (spinner, colored dots for permissions/errors/unseen)
- Hover cards: Show message list for quick navigation
- Child sessions grouped under parents

---

## SSE Event Types (Complete List)

46 event types broadcast over SSE:

### Core
| Event | Description |
|-------|-------------|
| `server.connected` | SSE connection established |
| `server.instance.disposed` | Instance shutting down |
| `global.disposed` | All instances disposed |

### Session
| Event | Description |
|-------|-------------|
| `session.created` | New session |
| `session.updated` | Session metadata changed |
| `session.deleted` | Session removed |
| `session.diff` | File diffs updated |
| `session.error` | Processing error |
| `session.status` | Status change (idle/busy/retry) |
| `session.compacted` | Context compaction completed |

### Messages
| Event | Description |
|-------|-------------|
| `message.updated` | Message created/updated |
| `message.removed` | Message removed |
| `message.part.updated` | Part created/updated (text, tool, reasoning) |
| `message.part.removed` | Part removed |

### Permissions & Questions
| Event | Description |
|-------|-------------|
| `permission.asked` | Agent needs permission |
| `permission.replied` | Permission answered |
| `question.asked` | Agent asks user a question |
| `question.replied` | Question answered |
| `question.rejected` | Question rejected |

### Terminal
| Event | Description |
|-------|-------------|
| `pty.created` | New PTY session |
| `pty.updated` | PTY updated |
| `pty.exited` | PTY process exited |
| `pty.deleted` | PTY removed |

### Other
| Event | Description |
|-------|-------------|
| `todo.updated` | Todo list changed |
| `vcs.branch.updated` | Git branch changed |
| `file.edited` | File edited |
| `file.watcher.updated` | File change detected |
| `command.executed` | Command executed |
| `mcp.tools.changed` | MCP tools list changed |
| `lsp.updated` | LSP status changed |
| `installation.updated` | Version updated |
| `installation.update.available` | New version available |
| `worktree.ready` | Worktree created |
| `worktree.failed` | Worktree creation failed |

---

## Prompt/Message Flow (End-to-End)

1. Client calls `POST /session/:id/message` with parts (text, files, agent directives)
2. Server creates user message, persists to storage
3. Server enters **processing loop**:
   - Sets session status to `busy`
   - Loads full conversation history
   - Resolves tools, checks for context overflow
   - Calls LLM via AI SDK (Vercel `ai` package)
   - Streams response parts via `message.part.updated` events
   - If LLM returns `tool-calls` -> execute tools, loop back
   - If LLM returns `stop` -> exit loop
   - If context overflow -> auto-compact, continue
4. Sets session status to `idle`
5. Async title generation on first turn (small model)

### Async variant
`POST /session/:id/prompt_async` returns 204 immediately. Track via SSE events.

---

## Key Patterns for Codedeck

### What we can reuse from OpenCode's architecture:

1. **PTY via WebSocket**: The `POST /pty/` + `GET /pty/:id/connect` (WS) pattern is clean. We can connect to OpenCode's PTY endpoints directly -- no need to implement our own PTY.

2. **`session.prompt` for chat**: Use `POST /session/:id/message` to send messages. Track responses via `message.part.updated` SSE events.

3. **`prompt_async` for fire-and-forget**: Better for a dashboard -- send prompt, don't block, watch SSE.

4. **Optimistic messages**: OpenCode desktop adds messages to the UI before server confirms, removes on failure. Good UX pattern.

5. **Terminal renderer**: OpenCode uses `ghostty-web` (WASM). For Codedeck, `@xterm/xterm` is more established and easier to integrate with React. Both connect via the same WebSocket protocol.

6. **Session interaction without live server**: OpenCode desktop always has a server (sidecar). For Codedeck, we'd need to start an OpenCode server for the project first (via our codedeck backend's `POST /api/servers/start`), then interact normally.

### What's different for Codedeck:

1. **Multi-project dashboard**: OpenCode desktop is scoped to one directory. Codedeck manages many projects simultaneously.
2. **No sidecar**: We don't bundle opencode-cli. We detect/spawn servers via our codedeck backend.
3. **React not SolidJS**: Our frontend is React 19, so we'll use React-compatible terminal libs.
4. **Offline-first**: We read from disk for offline sessions. OpenCode desktop always has a server.
