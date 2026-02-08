# Codedeck: Electron Migration Plan

## Why Move from Tauri to Electron

Tauri uses WebKitGTK on Linux. WebKitGTK is fundamentally broken for
performance-sensitive desktop apps:

- CSS animations run at **14 FPS** vs 100 FPS in Chromium (7x slower)
- JavaScriptCore's regex is **22-55x slower** than V8
- DOM-heavy operations freeze the UI in ways that don't happen in Chromium
- Every Tauri app on Linux documents this as unfixable (Modrinth, Yaak, Delta Chat)
- Tauri's own maintainer: "I can't 100% recommend tauri [for Linux] as of now"
- The env var workarounds trade crashes for worse performance — no winning config
- Tauri's CEF integration (`cef-rs`) is actively developed but has no public timeline
  for wry/Tauri integration

Electron ships Chromium on all platforms. Linux is a first-class citizen with
identical rendering to Chrome. No env var hacks, no GPU driver detection, no
DMA-BUF workarounds.

---

## Recommended Stack

| Layer              | Choice                                      | Why                                                    |
| ------------------ | ------------------------------------------- | ------------------------------------------------------ |
| **Electron**       | v40 stable (Chromium 144, Node 24)          | Latest stable, ESM support, mature security model      |
| **Build tool**     | `electron-vite` v5 (alex8088)               | Single config for main/preload/renderer, 5.2k stars    |
| **Renderer**       | Existing React 19 + Vite 6 + Tailwind v4   | No changes needed — just runs inside Electron          |
| **UI components**  | Existing `packages/ui` (shadcn)             | Unchanged — imported via Vite alias                    |
| **Packaging**      | `electron-builder`                          | More flexible than Forge, built-in auto-updater        |
| **Auto-update**    | `electron-updater`                          | Supports GitHub Releases, S3, differential updates     |
| **IPC**            | `contextBridge` + typed preload bridge      | Simple, fast, type-safe — no extra libraries needed    |
| **Backend**        | Electron main process (Node.js)             | Replaces both Tauri Rust backend AND `apps/server`     |

### Why NOT bundle Bun as a sidecar

The current `apps/server` (Bun + Hono) exists because browsers can't spawn
processes or read the filesystem. Electron's main process **already has Node.js**
with these capabilities. Bundling Bun would add 60-100MB for zero functional
benefit:

- `Bun.spawn()` → `child_process.spawn()` (identical behavior)
- `Bun.file().json()` → `fs.readFile()` + `JSON.parse()` (identical behavior)
- Hono HTTP routes → `ipcMain.handle()` (faster — IPC is sub-millisecond vs HTTP)
- No CORS needed, no port allocation, no network exposure
- Single process to manage instead of two

The Hono server remains useful for **browser-mode development** (plain `bun run dev`
without Electron). Both modes share the same service functions.

---

## Architecture Overview

### Current (browser + Bun server)

```
Browser (localhost:1420)  ──HTTP──>  Bun Server (localhost:3100)  ──>  opencode CLI
                          ──HTTP+SSE──>  OpenCode Server (127.0.0.1:4101)
```

### Proposed (Electron)

```
Electron Renderer  ──IPC──>  Electron Main Process  ──>  opencode CLI
                   ──HTTP+SSE──>  OpenCode Server (127.0.0.1:4101)
```

The OpenCode SDK channel (SSE events, session management, prompting) stays
**completely unchanged**. The renderer talks directly to the OpenCode server over
HTTP/SSE — Electron's Chromium has no CORS restrictions for localhost.

Only the "privileged operations" channel changes from HTTP (Hono RPC) to
Electron IPC.

---

## Project Structure

```
codedeck/
├── apps/
│   ├── desktop/                          # Electron app
│   │   ├── electron.vite.config.ts       # electron-vite config (main/preload/renderer)
│   │   ├── package.json                  # electron, electron-vite, electron-builder deps
│   │   ├── electron-builder.yml          # Packaging config (targets, signing, updater)
│   │   ├── resources/                    # App icons, native assets
│   │   ├── src/
│   │   │   ├── main/                     # Electron main process
│   │   │   │   ├── index.ts              # App lifecycle, window creation
│   │   │   │   ├── ipc-handlers.ts       # IPC handlers (discovery, server, messages)
│   │   │   │   ├── opencode-manager.ts   # Spawn/manage opencode server process
│   │   │   │   ├── discovery.ts          # Read projects/sessions from disk
│   │   │   │   ├── messages.ts           # Read message/part JSON files
│   │   │   │   └── model-state.ts        # Read model.json
│   │   │   ├── preload/                  # Preload scripts
│   │   │   │   ├── index.ts              # contextBridge.exposeInMainWorld()
│   │   │   │   └── api.d.ts             # Shared type definitions
│   │   │   └── renderer/                 # React app (EXISTING frontend, moved here)
│   │   │       ├── index.html
│   │   │       └── src/                  # Current apps/desktop/src/ contents
│   │   │           ├── components/
│   │   │           ├── hooks/
│   │   │           ├── services/
│   │   │           │   ├── backend.ts    # Updated: uses window.electronAPI
│   │   │           │   ├── codedeck-server.ts  # Kept for browser-mode dev
│   │   │           │   ├── opencode.ts
│   │   │           │   └── connection-manager.ts
│   │   │           ├── stores/
│   │   │           └── lib/
│   │   └── out/                          # Build output (main/, preload/, renderer/)
│   └── server/                           # KEPT — browser-mode dev backend (Bun + Hono)
├── packages/
│   └── ui/                               # Unchanged — shared shadcn components
├── turbo.json
└── package.json
```

### Key differences from current structure

1. **`src/main/`** — NEW. Absorbs `apps/server` logic using Node.js APIs
2. **`src/preload/`** — NEW. Type-safe bridge between main and renderer
3. **`src/renderer/`** — MOVED from current `apps/desktop/src/`. The React app
4. **`apps/server/`** — KEPT for browser-mode development, not bundled with Electron
5. **`src-tauri/`** — REMOVED. Rust backend no longer needed

---

## Server → Main Process Migration

The `apps/server` is ~400 lines across 4 service files. Each maps cleanly to
an Electron IPC handler:

### Process Management (`opencode-manager.ts`)

```typescript
// Before (Bun):
const proc = Bun.spawn(["opencode", "serve", "--hostname=127.0.0.1", "--port=4101"])
await Bun.sleep(250)

// After (Node.js in Electron main):
import { spawn } from "node:child_process"
const proc = spawn("opencode", ["serve", "--hostname=127.0.0.1", "--port=4101"], {
  stdio: "pipe",
  env: { ...process.env, PATH: `${opencodeBinDir}:${process.env.PATH}` }
})
await new Promise(r => setTimeout(r, 250))
```

### Filesystem Operations (`discovery.ts`, `messages.ts`)

```typescript
// Before (Bun):
const data = await Bun.file(path).json()
const exists = await Bun.file(path).exists()

// After (Node.js):
import { readFile, readdir, access } from "node:fs/promises"
const data = JSON.parse(await readFile(path, "utf-8"))
const exists = await access(path).then(() => true, () => false)
```

### IPC Handlers (`ipc-handlers.ts`)

```typescript
import { ipcMain } from "electron"
import { ensureServer, stopServer } from "./opencode-manager"
import { discoverProjectsAndSessions } from "./discovery"
import { readSessionMessages } from "./messages"
import { readModelState } from "./model-state"

export function registerIpcHandlers(): void {
  ipcMain.handle("opencode:ensure", () => ensureServer())
  ipcMain.handle("opencode:stop", () => stopServer())
  ipcMain.handle("discover", () => discoverProjectsAndSessions())
  ipcMain.handle("session:messages", (_, id: string) => readSessionMessages(id))
  ipcMain.handle("model-state", () => readModelState())
}
```

### Preload Bridge (`preload/index.ts`)

```typescript
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("codedeck", {
  ensureOpenCode: () => ipcRenderer.invoke("opencode:ensure"),
  stopOpenCode: () => ipcRenderer.invoke("opencode:stop"),
  discover: () => ipcRenderer.invoke("discover"),
  getSessionMessages: (id: string) => ipcRenderer.invoke("session:messages", id),
  getModelState: () => ipcRenderer.invoke("model-state"),
})
```

### Type Definitions (`preload/api.d.ts`)

```typescript
export interface CodedeckAPI {
  ensureOpenCode: () => Promise<{ url: string; managed: boolean }>
  stopOpenCode: () => Promise<boolean>
  discover: () => Promise<DiscoveryResult>
  getSessionMessages: (id: string) => Promise<MessagesResult>
  getModelState: () => Promise<ModelState>
}

declare global {
  interface Window {
    codedeck: CodedeckAPI
  }
}
```

### Frontend Service Layer (`services/backend.ts`)

```typescript
// Detect environment: Electron vs browser dev
const isElectron = typeof window !== "undefined" && "codedeck" in window

export async function fetchDiscovery() {
  if (isElectron) return window.codedeck.discover()
  const { fetchDiscovery } = await import("./codedeck-server")
  return fetchDiscovery()
}

export async function fetchOpenCodeUrl() {
  if (isElectron) return window.codedeck.ensureOpenCode()
  const { fetchOpenCodeUrl } = await import("./codedeck-server")
  return fetchOpenCodeUrl()
}

// ... same pattern for all endpoints
```

This follows the exact same dual-mode pattern we built for Tauri (`isTauri` →
`isElectron`). The `codedeck-server.ts` Hono RPC client remains as the
browser-mode fallback.

---

## electron-vite Configuration

```typescript
// electron.vite.config.ts
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/renderer/src"),
        "@codedeck/ui": path.resolve(__dirname, "../../packages/ui/src"),
      },
    },
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
})
```

---

## Electron Main Process (`src/main/index.ts`)

```typescript
import { app, BrowserWindow, shell } from "electron"
import path from "node:path"
import { registerIpcHandlers } from "./ipc-handlers"

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,   // REQUIRED — never disable
      sandbox: true,            // REQUIRED — never disable
      nodeIntegration: false,   // REQUIRED — never enable
    },
  })

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Dev: load from Vite dev server | Prod: load built files
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  return win
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

---

## Package Dependencies

### `apps/desktop/package.json`

```jsonc
{
  "name": "@codedeck/desktop",
  "version": "0.1.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "dev:web": "vite --config src/renderer/vite.config.ts",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-builder --config electron-builder.yml",
    "package:linux": "electron-builder --linux --config electron-builder.yml",
    "package:mac": "electron-builder --mac --config electron-builder.yml",
    "package:win": "electron-builder --win --config electron-builder.yml",
    "check-types": "tsgo --noEmit"
  },
  "dependencies": {
    // --- Existing renderer deps (unchanged) ---
    "@codedeck/ui": "workspace:*",
    "@opencode-ai/sdk": "^1.1.53",
    "@tanstack/react-router": "^1.158.4",
    "@tanstack/react-query": "^5.90.20",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^10.1.0",
    "react-resizable-panels": "^4.6.2",
    "react-syntax-highlighter": "^16.1.0",
    "remark-gfm": "^4.0.1",
    "zustand": "^5.0.11",
    "lucide-react": "^0.563.0",
    "@fontsource-variable/inter": "*",
    "@fontsource/ibm-plex-mono": "*",

    // --- Browser-mode fallback (tree-shaken in Electron build) ---
    "hono": "4.7.10"
  },
  "devDependencies": {
    // --- Electron ---
    "electron": "^40.2.1",
    "electron-vite": "^5.0.0",
    "electron-builder": "^26.0.0",
    "electron-updater": "^6.0.0",

    // --- Existing dev deps (unchanged) ---
    "@codedeck/server": "workspace:*",
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.1.0"
  }
}
```

---

## Packaging Configuration

### `electron-builder.yml`

```yaml
appId: com.codedeck.desktop
productName: Codedeck
copyright: Copyright (c) 2025-2026 Codedeck
directories:
  buildResources: resources
  output: release

files:
  - "out/**/*"
  - "!node_modules/**/*"

mac:
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  category: public.app-category.developer-tools
  hardenedRuntime: true
  gatekeeperAssess: false

win:
  target:
    - target: nsis
      arch: [x64, arm64]

linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
    - target: rpm
      arch: [x64]
  category: Development
  maintainer: codedeck

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true

publish:
  provider: github
  releaseType: release
```

---

## Migration Phases

### Phase 1: Scaffold Electron app (effort: LOW)

- Install `electron`, `electron-vite`, `electron-builder`
- Create `electron.vite.config.ts`
- Create `src/main/index.ts` with basic window creation
- Create `src/preload/index.ts` with empty bridge
- Move `src/` (current React app) to `src/renderer/src/`
- Move `index.html` to `src/renderer/index.html`
- Verify `electron-vite dev` opens the existing React app in Electron
- Keep `apps/server` running for backend — no IPC yet

### Phase 2: Migrate server to main process (effort: MEDIUM)

- Port `services/server-manager.ts` → `src/main/opencode-manager.ts`
  (replace `Bun.spawn` with `child_process.spawn`)
- Port `services/discovery.ts` → `src/main/discovery.ts`
  (replace `Bun.file` with `fs.promises`)
- Port `services/messages.ts` → `src/main/messages.ts`
- Port `routes/model-state.ts` → `src/main/model-state.ts`
- Register all IPC handlers in `src/main/ipc-handlers.ts`
- Build typed preload bridge with `contextBridge`
- Update `services/backend.ts` to detect Electron and use IPC
- Remove `@codedeck/server` as a runtime dependency

### Phase 3: Polish and ship (effort: MEDIUM)

- Add `electron-builder.yml` packaging config
- Add auto-updater with `electron-updater`
- Add app icons and metadata
- Add single-instance lock (`app.requestSingleInstanceLock()`)
- Add window state persistence (electron-window-state or manual)
- Handle app lifecycle (graceful shutdown, cleanup OpenCode process)
- Test on Linux (AppImage, deb), macOS (dmg), Windows (nsis)
- Set up CI with GitHub Actions for cross-platform builds

### Phase 4: Cleanup (effort: LOW)

- Remove `src-tauri/` directory entirely
- Remove Tauri dependencies from `Cargo.toml`, `package.json`
- Remove `@tauri-apps/*` packages
- Remove `services/tauri-backend.ts`, `lib/platform.ts`
- Remove Tauri-specific entries from `.gitignore`, `biome.json`
- Update `AGENTS.md` with Electron-specific notes
- Keep `apps/server` for browser-mode development

---

## What Stays The Same

These parts of the codebase are **completely unchanged**:

- `packages/ui/` — all shadcn components
- `stores/app-store.ts` — Zustand state management
- `stores/streaming-store.ts` — streaming part accumulator
- `services/opencode.ts` — OpenCode SDK client factory
- `services/connection-manager.ts` — SSE event batching, project clients
- `hooks/use-session-chat.ts` — turn grouping, structural sharing
- `hooks/use-agents.ts` — agent derivation
- `hooks/use-server.ts` — server connection (talks to OpenCode directly)
- `hooks/use-opencode-data.ts` — live data hooks
- `components/*` — all React components
- `lib/types.ts` — all type definitions
- Router, routes, layouts

The only files that change in the renderer are:
- `services/backend.ts` — swap `isTauri` detection for `isElectron`
- `services/codedeck-server.ts` — kept but only used in browser dev mode

---

## Trade-offs vs Tauri

| Aspect                | Tauri                              | Electron                          |
| --------------------- | ---------------------------------- | --------------------------------- |
| **Linux rendering**   | 14 FPS CSS, broken WebKitGTK       | Full Chromium, identical to Chrome |
| **Bundle size**       | ~15-20 MB                          | ~90-100 MB compressed             |
| **Memory usage**      | ~60-80 MB                          | ~150-250 MB                       |
| **Backend language**  | Rust                               | Node.js (JavaScript/TypeScript)   |
| **Cross-platform**    | Identical HTML, different webviews  | Identical everything              |
| **Auto-update**       | tauri-action (limited)             | electron-updater (mature)         |
| **Dev experience**    | Slow Rust compiles, specta types   | Fast JS rebuilds, native types    |
| **Ecosystem**         | Growing, gaps                      | Massive, battle-tested            |
| **Security**          | CSP + Rust isolation               | contextIsolation + sandbox        |

The 70-80 MB size increase is a worthwhile trade for consistent rendering,
faster development iteration, and a mature ecosystem. For a developer tool
like codedeck, bundle size is not the primary concern — performance and
reliability are.

---

## Open Questions

1. **Keep dual-mode?** Should the app continue supporting browser-mode
   (without Electron)? If yes, keep `apps/server`. If not, simplify by
   removing the Hono fallback from `backend.ts`.

2. **Hash vs browser history?** The app currently uses hash routing
   (`createHashHistory`) which works with `file://` protocol. Electron can
   serve from either `file://` or a dev server URL. Hash routing is safer.

3. **OpenCode binary bundling?** Should we bundle the `opencode` CLI as a
   resource with the Electron app, or expect it to be installed separately?
   Electron's `extraResources` config can bundle it per-platform.

4. **Window chrome?** Use native decorations (current) or custom titlebar?
   Native is recommended for simplicity and platform consistency.
