# Architecture Comparison: Palot vs OpenCode TUI & Desktop

> Technical architecture comparison covering framework choices, state management, rendering, and communication patterns.

## Technology Stack Comparison

| Aspect                | Palot                                 | OpenCode TUI              | OpenCode Desktop            |
| --------------------- | ---------------------------------------- | ------------------------- | --------------------------- |
| **UI Framework**      | React 19                                 | SolidJS (via OpenTUI)     | SolidJS                     |
| **Desktop Shell**     | Electron 40                              | Terminal (Bun process)    | Tauri v2 (Rust)             |
| **Routing**           | TanStack Router                          | Custom (2 routes)         | SolidJS Router              |
| **State Management**  | Zustand + localStorage persist           | SolidJS stores + context  | SolidJS stores + context    |
| **Styling**           | Tailwind v4 + shadcn/ui                  | Custom theme system + CSS | Tailwind v4 + Kobalte       |
| **Component Library** | shadcn/ui (Radix primitives)             | Custom OpenTUI components | Kobalte (headless) + custom |
| **Build Tool**        | electron-vite (Vite)                     | Bun bundler               | Vite                        |
| **Backend**           | Bun + Hono (browser mode) / Electron IPC | Worker thread RPC         | Tauri IPC + HTTP            |
| **Package Manager**   | Bun                                      | Bun                       | Bun                         |
| **Monorepo Tool**     | Turborepo                                | Bun workspaces            | Bun workspaces              |
| **Linting**           | Biome                                    | Built-in                  | Built-in                    |

## Architecture Patterns

### Communication Flow

**Palot (Electron mode):**

```
React App → IPC → Electron Main Process → Child Process (opencode serve)
React App → OpenCode SDK (HTTP/SSE) → opencode serve (port 4101)
```

**Palot (Browser mode):**

```
React App → HTTP (Hono RPC) → Palot Server (port 3100)
React App → OpenCode SDK (HTTP/SSE) → opencode serve (port 4101)
Palot Server → manages → opencode serve process
```

**OpenCode TUI:**

```
Main Thread (OpenTUI renderer) → RPC → Worker Thread (OpenCode server)
```

**OpenCode Desktop:**

```
SolidJS App → OpenCode SDK (HTTP/SSE/WebSocket) → opencode serve (sidecar)
SolidJS App → Tauri IPC → Rust Backend (process management, native dialogs)
```

### Key Architectural Differences

#### 1. Two-Process vs Single-Process

**Palot** runs two processes in Electron mode:

- Electron main process (Node.js) — handles IPC, process management, discovery
- Renderer process (Chromium) — React app

In browser mode, it adds a third:

- Palot Hono server (port 3100) — discovery, model state, file system proxy

**OpenCode TUI** runs as a single Bun process with a worker thread:

- Main thread handles terminal I/O and rendering
- Worker thread runs the OpenCode server

**OpenCode Desktop** uses Tauri's architecture:

- Rust backend (process management, native APIs)
- WebView (SolidJS app)
- Sidecar (opencode CLI binary)

**Trade-offs:**
| | Palot | OpenCode TUI | OpenCode Desktop |
|---|---|---|---|
| Binary size | ~100MB+ (Electron) | ~50MB (Bun) | ~10MB (Tauri) |
| Memory usage | Higher (Chromium) | Lower (terminal) | Medium (WebView) |
| Native integration | Good (Node.js APIs) | None (terminal) | Best (Rust) |
| Cross-platform | Good | Great | Great |

#### 2. State Management Philosophy

**Palot (Zustand):**

- Single global store with flat state
- Manual immutable updates (`set((state) => ({ ...state, ... }))`)
- React 19 compatibility requires careful `useMemo` wrapping to avoid infinite loops
- Persisted state in separate store via Zustand `persist` middleware
- Explicit optimistic updates with `optimistic-` prefixed IDs
- Separate streaming store for high-frequency updates

**OpenCode TUI (SolidJS stores):**

- 15+ nested context providers
- Fine-grained reactivity (no need for manual memoization)
- Stores automatically batch updates
- Binary search for sorted array operations
- Event-driven updates via SSE

**OpenCode Desktop (SolidJS stores):**

- Similar to TUI with global sync context
- Per-directory store management with session eviction
- `event-reducer.ts` for incremental event application

**Trade-offs:**

- Palot's explicit streaming store is more complex but gives better control
- SolidJS's fine-grained reactivity avoids the React 19 footguns Palot documents
- Zustand's flat store is easier to reason about than 15 nested context providers

#### 3. Event Processing

**Palot:**

```
SSE → Event Batcher → {
  Streaming parts → Streaming Store (throttled ~50ms)
  Coalescable events → Coalesce map (latest per key)
  Other events → Queue
} → rAF flush → Zustand processEvent → React re-render
```

**OpenCode TUI:**

```
SSE → RPC event → Store mutation → SolidJS reactivity → Re-render
```

**OpenCode Desktop:**

```
WebSocket → event listener → globalSDK.event.listen() → store mutations
```

**Palot's batching is the most sophisticated** but also the most complex. The `createEventBatcher` function in `connection-manager.ts` is ~100 lines of carefully orchestrated batching, coalescing, and rAF scheduling. This complexity is necessary because React's reconciliation is more expensive than SolidJS's fine-grained updates.

## Monorepo Structure

**Palot:**

```
palot/
  apps/
    desktop/       # Electron + Vite + React 19 (main, preload, renderer)
    server/        # Bun + Hono backend (browser mode only)
  packages/
    ui/            # shadcn/ui component library
```

**OpenCode:**

```
opencode/
  packages/
    opencode/      # Core (CLI, server, tools, agents, sessions, TUI)
    app/           # SolidJS web/desktop app (pages, components, contexts)
    desktop/       # Tauri shell (Rust backend)
    ui/            # Shared component library
    web/           # Documentation website (Astro)
    sdk/           # Auto-generated TypeScript SDK
    plugin/        # Plugin SDK
```

**Palot's structure is simpler** (3 packages vs 7+), which makes it easier to navigate and contribute to. However, OpenCode's richer package structure reflects its much larger feature set.

## Data Flow Comparison

### Session Discovery

**Palot:**

1. Electron main process reads `~/.local/share/opencode/storage/` directly
2. Scans for project and session JSON files
3. Sends to renderer via IPC
4. Renderer stores in `discovery` state
5. Live sessions from OpenCode server supplement discovery data

**OpenCode Desktop:**

1. SolidJS app connects to OpenCode server via SDK
2. Server provides sessions via API
3. Real-time updates via SSE events
4. No separate discovery process needed

**Palot's discovery is more complex** because it reads OpenCode's file storage directly (for offline access), then overlays live session data from the server. This means it can show session history even before the OpenCode server starts.

### Message Loading

**Palot:**

1. On session select, `useSessionChat` triggers one-time fetch
2. Uses `client.session.messages()` with 100 message limit
3. Hydrates Zustand store
4. SSE events keep it up-to-date
5. No pagination (hardcoded `loadingEarlier: false`, `hasEarlierMessages: false`)

**OpenCode Desktop:**

1. Lazy loading with pagination (chunked message fetching)
2. Virtual scrolling for long conversations
3. Infinite scroll with backfill
4. Message prefetching for adjacent sessions

**Palot is missing pagination and virtual scrolling**, which will cause performance issues with long sessions (200+ messages, as indicated by the 200-message cap in `upsertMessage`).

## Security Model

**Palot:**

- Electron's `contextBridge` isolates main/renderer processes
- `window.palot` bridge exposes a limited API
- No authentication between Palot and OpenCode server (localhost only)

**OpenCode Desktop:**

- Tauri's Rust backend provides stronger sandboxing
- Password-protected server auth via Tauri fetch
- Configurable CORS and basic auth

**OpenCode Desktop has a stronger security model** due to Tauri's Rust-based sandboxing and explicit server authentication. Palot's Electron-based approach is adequate for a desktop app but doesn't implement server authentication.

## Build & Distribution

**Palot:**

- electron-vite for development
- electron-builder for packaging (macOS, Windows, Linux)
- Changesets for versioning
- GitHub Actions for CI/CD

**OpenCode Desktop:**

- Vite for development
- Tauri CLI for packaging (smaller binaries)
- Cross-platform signing and notarization

**Palot's Electron builds are significantly larger** (~100MB+ vs ~10MB for Tauri). This is the largest architectural disadvantage. The DESIGN.md mentions Tauri as the target, suggesting a future migration from Electron.
