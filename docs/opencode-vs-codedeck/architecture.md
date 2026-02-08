# Architecture Deep-Dive

## OpenCode Architecture

### Monorepo Structure

OpenCode is a large TypeScript monorepo (Turborepo + Bun) with 17+ packages:

```
packages/
  opencode/     # Core: CLI, TUI, server, tools, agents, sessions, providers
  app/          # Shared web UI (SolidJS)
  desktop/      # Native desktop app (Tauri wrapping app)
  sdk/          # @opencode-ai/sdk — JS client SDK
  plugin/       # @opencode-ai/plugin — Plugin author SDK
  ui/           # Shared UI components
  console/      # Admin console
  enterprise/   # Enterprise features
  identity/     # Auth/identity service
  web/          # Public website
  docs/         # Documentation site
  containers/   # Container definitions
  extensions/   # Editor extensions (VS Code, etc.)
  slack/        # Slack integration
  function/     # Serverless functions
  script/       # Build/utility scripts
  util/         # Shared utilities
```

### Core Package (`packages/opencode/`)

The core package contains everything needed to run OpenCode:

```
src/
  cli/cmd/          # CLI commands (run, serve, web, auth, agent, mcp, etc.)
  cli/cmd/tui/      # Full TUI application (SolidJS + opentui)
  provider/         # 20+ AI provider implementations
  tool/             # 20+ built-in tools
  agent/            # Agent definitions and generation
  session/          # Session management, LLM streaming, compaction
  mcp/              # MCP client manager
  permission/       # Rule-based permission system
  server/           # Hono HTTP server
  plugin/           # Plugin loader
  skill/            # Skill discovery and loading
  lsp/              # LSP integration
  snapshot/         # Git-based file snapshots
  worktree/         # Git worktree management
  config/           # Configuration system
  command/          # Slash command system
  share/            # Session sharing
  acp/              # Agent Client Protocol
  pty/              # Pseudo-terminal
  bus/              # Event bus
  file/             # File operations + watcher
  format/           # Code formatter integration
  storage/          # KV storage
  auth/             # Credential management
  shell/            # Shell detection + process management
  scheduler/        # Task scheduler
  util/             # Utilities
```

### Runtime Architecture

```
                    CLI / TUI
                       |
               ┌───────┴───────┐
               │   App Layer   │
               │  (SolidJS +   │
               │   opentui)    │
               └───────┬───────┘
                       |
               ┌───────┴───────┐
               │  Server Layer │  (Hono, port 4096)
               │  REST + SSE   │
               └───────┬───────┘
                       |
          ┌────────────┼────────────┐
          |            |            |
    ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
    │ Session   │ │ Tool  │ │ Provider  │
    │ Manager   │ │ Exec  │ │ Manager   │
    │ (LLM loop)│ │       │ │ (20+ AI)  │
    └─────┬─────┘ └───┬───┘ └─────┬─────┘
          |           |           |
    ┌─────┴─────┐ ┌───┴───┐ ┌────┴────┐
    │ Storage   │ │ MCP   │ │ Vercel  │
    │ (KV/File) │ │Clients│ │ AI SDK  │
    └───────────┘ └───────┘ └─────────┘
```

### Key Patterns

1. **Event Bus** — Central pub/sub (`Bus.publish()` / `Bus.subscribe()`) for decoupled cross-system communication. 46+ event types covering sessions, messages, permissions, tools, providers, files, etc.

2. **AsyncLocalStorage Context** — Uses Node.js `AsyncLocalStorage` for request-scoped context (project info, session state), avoiding prop-drilling through deeply nested function calls.

3. **Lazy Initialization with Reset** — `Lazy()` utility for expensive resources that need reconstruction after config changes. Supports `reset()` to invalidate cached instances.

4. **Zod-Validated Functions** — `fn()` utility wraps functions with Zod input/output schemas for runtime type safety at system boundaries.

5. **Provider-Specific Middleware** — `transform.ts` applies per-provider message transformations (prompt caching for Anthropic, schema sanitization for Google, tool ID normalization for Mistral) as middleware before LLM calls.

6. **9-Strategy Fuzzy Edit Matching** — The edit tool cascades through 9 progressively fuzzier matching strategies (exact → trimmed → anchor → whitespace-normalized → indent-flexible → escape-normalized → boundary-trimmed → context-aware → multi-occurrence) to find the right location even when AI output has formatting differences.

---

## Codedeck Architecture

### Monorepo Structure

Codedeck is a smaller, focused monorepo:

```
apps/
  desktop/    # @codedeck/desktop — Vite + React 19 app
  server/     # @codedeck/server — Bun + Hono backend
packages/
  ui/         # @codedeck/ui — Shared shadcn/ui components
```

### Three-Tier Data Flow

```
┌──────────────────────────────────────────┐
│         Codedeck Desktop (React 19)      │
│         Port 1420 (Vite dev server)      │
│                                          │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  │
│  │ Zustand  │  │ Hooks    │  │ React  │  │
│  │ Store    │  │ + Memo   │  │ Router │  │
│  └────┬─────┘  └────┬─────┘  └────┬───┘  │
│       └──────────────┴─────────────┘      │
│                      |                    │
│              ┌───────┴──────┐             │
│              │ Connection   │             │
│              │ Manager      │             │
│              └───────┬──────┘             │
└──────────────────────┼────────────────────┘
                       |
          ┌────────────┼────────────┐
          |                        |
┌─────────┴──────────┐  ┌─────────┴──────────┐
│  Codedeck Server   │  │  OpenCode Server   │
│  Port 3100 (Hono)  │  │  Port 4101 (Hono)  │
│                    │  │                    │
│  - Discovery       │  │  - Sessions        │
│  - Server Manager  │  │  - Messages        │
│  - Offline Msgs    │  │  - Providers       │
│  - Model State     │  │  - SSE Events      │
│                    │  │  - Permissions      │
└────────────────────┘  └────────────────────┘
         |                        |
         v                        v
  ~/.local/share/           OpenCode SDK
  opencode/storage/         (REST + SSE)
```

### Key Patterns

1. **Binary Search Sorted Insert** — Messages and parts are stored in sorted arrays. Inserts/updates use binary search for O(log n) operations instead of naive O(n) scans.

2. **Structural Sharing for Turns** — Turn objects (user message + assistant responses) are fingerprinted (`{msgId}:{completedTime}:{partCount}:{lastPartId}`). Previous turn references are reused when fingerprints match, preventing unnecessary React re-renders.

3. **Optimistic Updates** — User messages are immediately added to the store with `optimistic-*` prefix IDs. These are replaced when the real message arrives via SSE, providing instant feedback.

4. **Single SSE Stream** — One global SSE connection to OpenCode serves events for ALL projects. Each event is tagged with `{ directory, payload }`, and the store routes events to the correct session.

5. **Derived State via useMemo** — To avoid React 19 + Zustand infinite render loops, raw store values are selected individually and derived data is computed in `useMemo` hooks. This is a critical pattern documented in AGENTS.md.

---

## Architectural Differences

### State Management

| Aspect | OpenCode | Codedeck |
|--------|----------|----------|
| Framework | SolidJS signals + createStore | Zustand + React hooks |
| Reactivity | Fine-grained (signal-level) | Component-level (selector subscriptions) |
| Persistence | File-based KV store | In-memory only (lost on HMR) |
| Context | AsyncLocalStorage | React Context (limited) |

SolidJS's fine-grained reactivity means OpenCode only re-renders the exact DOM nodes that depend on changed data. React re-renders entire component subtrees, requiring careful memoization. Codedeck mitigates this with binary search + structural sharing, but it's fundamentally more work.

### Server Architecture

| Aspect | OpenCode | Codedeck |
|--------|----------|----------|
| Server | Single Hono server (port 4096) | Two servers (Codedeck 3100 + OpenCode 4101) |
| Process | Self-contained | Manages child OpenCode process |
| Discovery | Built-in project/session storage | Reads OpenCode's storage files from disk |
| API Surface | 50+ endpoints | 7 endpoints (mostly proxying) |

Codedeck's two-server architecture adds complexity. The Codedeck backend server exists primarily to:
1. Manage the OpenCode process lifecycle
2. Discover projects/sessions from disk (offline mode)
3. Read model state
4. Serve as a typed RPC endpoint for the frontend

When Tauri is integrated, much of this can move to Rust.

### Event System

| Aspect | OpenCode | Codedeck |
|--------|----------|----------|
| Bus | Custom pub/sub with typed events | SSE consumer only |
| Scope | Internal (cross-system) + External (SSE) | External only (SSE from OpenCode) |
| Events | 46+ event types | ~12 handled |

OpenCode's event bus is bidirectional — internal systems both publish and subscribe. Codedeck is a passive consumer of OpenCode's SSE stream, handling only the events needed for the UI.

### Storage

| Aspect | OpenCode | Codedeck |
|--------|----------|----------|
| Sessions | File-based JSON (per-project directories) | In-memory Zustand (hydrated from OpenCode) |
| Messages | File-based JSON (per-session directories) | In-memory (200-message cap per session) |
| Preferences | Persistent KV store | None (resets on reload) |
| Config | JSONC files with deep merge + env interpolation | None (reads OpenCode's config) |

Codedeck's lack of persistent preferences means UI state (sidebar position, theme, display preferences) resets on every page reload. OpenCode persists 15+ UI preferences to its KV store.
