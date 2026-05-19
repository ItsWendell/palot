---
title: Electron IPC & Preload Security
description: Secure IPC bridge patterns, preload conventions, and context isolation for Electron apps.
source: palot-knowledge
tags: electron, ipc, security, preload, typescript
agents: fullstack-developer, ad-security-reviewer, architect-reviewer
updated: 2026-05-16
---

## Two Runtime Contexts

```
Main Process (Node.js)          Renderer Process (Chromium sandbox)
├── ipc-handlers.ts             ├── components/
├── opencode-manager.ts         ├── hooks/
├── agent-service.ts            ├── services/backend.ts   ← IPC caller
└── index.ts                    └── atoms/
         ↕ IPC only via contextBridge
         preload/index.ts
```

**Rule**: Never import `fs`, `child_process`, `path`, or any Node.js built-in in the renderer. Use `window.palot` or `services/backend.ts`.

## Preload Pattern

```ts
// preload/index.ts
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("palot", {
  agents: {
    list: (projectPath?: string) =>
      ipcRenderer.invoke("agents:list", projectPath),
    write: (filename: string, raw: string, projectPath?: string) =>
      ipcRenderer.invoke("agents:write", filename, raw, projectPath),
  },
  // Never expose ipcRenderer itself — only specific named methods
})
```

**Rules:**
- Expose only specific named methods, never the full `ipcRenderer`
- Never expose `shell`, `remote`, or `webContents`
- All params validated in the main process handler, not the preload

## Main Process IPC Handler

```ts
// main/ipc-handlers.ts
import { ipcMain } from "electron"

// Always wrap with withLogging for structured error logging
ipcMain.handle(
  "agents:write",
  withLogging("agents:write", async (_, filename: string, raw: string, projectPath?: string) => {
    // Validate inputs at the boundary
    if (typeof filename !== "string" || !filename.trim()) {
      throw new Error("Invalid filename")
    }
    const service = AgentService.fromProjectDirectory(projectPath ?? process.cwd())
    return service.write(filename, raw)
  }),
)
```

## Path Traversal Prevention

```ts
// Always resolve and validate paths before file operations
function safePath(root: string, userInput: string): string {
  const resolved = path.resolve(root, userInput)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error("Path traversal attempt blocked")
  }
  return resolved
}
```

## External Links — Never Open in Window

```ts
// main/index.ts
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  // Always deny new window — open externally instead
  shell.openExternal(url)
  return { action: "deny" }
})
```

## Content Security Policy

```ts
// main/index.ts
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      ],
    },
  })
})
```

## Type-Safe Bridge

```ts
// preload/api.d.ts
export interface PalotAPI {
  agents: {
    list: (projectPath?: string) => Promise<ManagedAgent[]>
    write: (filename: string, raw: string, projectPath?: string) => Promise<string>
  }
}

declare global {
  interface Window {
    palot: PalotAPI
  }
}
```

## Preload Timing Guard

```ts
// renderer — module-level calls can run before preload finishes
// Guard with optional chaining
const result = await window.palot?.agents.list()

// Or use a service wrapper that checks:
export function isElectron(): boolean {
  return typeof window !== "undefined" && "palot" in window
}
```

## Security Checklist

- [ ] `contextIsolation: true` (default in Electron 12+)
- [ ] `nodeIntegration: false` (default)
- [ ] `sandbox: true` for renderer processes handling untrusted content
- [ ] No `remote` module usage
- [ ] All file paths validated with `safePath()` before filesystem operations
- [ ] External URLs open via `shell.openExternal`, never in the window
- [ ] IPC channels use namespaced names: `"resource:action"` format
- [ ] Input validated in main process handler, not preload
- [ ] `webContents.setWindowOpenHandler` always returns `{ action: "deny" }`

## Common Footguns

- **Preload exports are synchronous** — `invoke()` returns a Promise; don't await at module level
- **IPC is structured-clone** — custom class instances, functions, and DOM nodes don't survive serialization
- **Error handling** — IPC errors from the main process are re-thrown in the renderer; always catch in the renderer
- **`__dirname` in preload** — points to the preload bundle output, not the source directory
