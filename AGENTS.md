# Codedeck Agent Instructions

## Purpose of This File

This file is injected into every agent session for this project. Keep it short.
Only add entries here if an agent is likely to get stuck or repeat a mistake without them.
Do NOT add one-time setup notes, general knowledge, or things discoverable from config files.

## Project Structure

- **Monorepo**: Turborepo + Bun workspaces
- **`packages/ui`**: Shared shadcn/ui component library (`@codedeck/ui`)
- **`apps/desktop`**: Electron 40 + Vite + React 19 desktop app (via `electron-vite`)
- **`apps/server`**: Bun + Hono backend — used only in browser-mode dev (`dev:web`), NOT bundled with Electron

### Desktop App Layout (`apps/desktop/src/`)

- **`main/`** — Electron main process (Node.js): window management, IPC handlers, OpenCode server lifecycle, filesystem reads
- **`preload/`** — Electron preload bridge: exposes `window.codedeck` API via `contextBridge`
- **`renderer/`** — React app (browser context): components, hooks, services, stores

## Commands

- **Electron dev**: `cd apps/desktop && bun run dev` (electron-vite, renderer on port 1420)
- **Browser-only dev**: `cd apps/desktop && bun run dev:web` (Vite only, needs `apps/server` running)
- **Backend server** (browser mode only): `cd apps/server && bun run dev` (port 3100)
- **Lint/format**: `bunx biome check --write .` from root
- **Type check**: `cd apps/desktop && bun run check-types`
- **Rebuild server types**: `cd apps/server && bun run build:types` (required after adding server routes)
- **Add UI component**: `cd packages/ui && bunx shadcn@latest add <component>`
- **Package**: `cd apps/desktop && bun run package` (or `package:linux`, `package:mac`, `package:win`)

## Critical Footguns

### Electron — Two Runtime Contexts

The main process runs in Node.js, the renderer runs in a Chromium sandbox. They communicate via IPC only. Never import Node.js modules (`fs`, `child_process`, `path`) in the renderer — use the `window.codedeck` bridge or `services/backend.ts` instead.

### Backend Service Layer — `services/backend.ts`

All hooks must import from `services/backend.ts`, NOT from `services/codedeck-server.ts` directly. The backend module detects Electron (`"codedeck" in window`) and routes to IPC or HTTP automatically. `codedeck-server.ts` is only used as an HTTP fallback for browser-mode dev.

### Zustand + React 19 (causes infinite render loops)

Select raw store references and derive data in `useMemo`. Do NOT use `useShallow` with selectors that create wrapper objects.

```typescript
// WRONG — infinite loop:
const data = useAppStore(useShallow(s => ({ agents: deriveAgents(s) })))

// CORRECT:
const servers = useAppStore((s) => s.servers)
const agents = useMemo(() => deriveAgents(servers), [servers])
```

### Tailwind v4 Monorepo — Missing Styles

`packages/ui/src/styles/globals.css` must have `@source "../components";` or utility classes used only in UI components won't generate CSS. Do NOT remove this line.

### Biome — CSS Disabled

Biome v2 cannot parse Tailwind v4 syntax. CSS linting/formatting is disabled. Do not try to enable it or add `css.parser.allowTailwindSyntax` (does not exist).

### OpenCode SDK

- Session timestamps are in **milliseconds**, not seconds
- Messages endpoint returns `Array<{ info: Message, parts: Part[] }>` — not a flat `Message[]`
- API route is `/session/{id}/message` (singular), not `/messages`
- Zustand store state is lost on Vite HMR reload — server must be reconnected after code changes

### OpenCode SSE — directory scoping

The `/event` SSE endpoint is **scoped to a single project directory** via the `Instance.provide()` middleware. A client without a directory header gets events for `process.cwd()` of the server process, which is almost certainly wrong. Use `/global/event` instead — it streams events from ALL projects, each wrapped as `{ directory: string, payload: Event }`. The SDK exposes this as `client.global.event()`.

### OpenCode model resolution

The server has no single "current model" concept. When `promptAsync` is called without an explicit `model` field, the server falls back to its own provider defaults (first connected provider's default model). The TUI resolves the model client-side using a chain: CLI arg → config.model → recent models from `~/.local/state/opencode/model.json` → first provider default. Our app mirrors this in `resolveEffectiveModel()` and **must always pass the resolved model to `promptAsync`**, not just the user's explicit override.

### Azure provider is broken in browser

The Azure provider causes `TypeError: sdk.responses is not a function` when used from the browser. This is a known upstream issue. Do not attempt to fix it — just ensure the correct provider (e.g. Anthropic) is selected.

### Server type regeneration (browser mode only)

When adding routes to `apps/server`, you must run `cd apps/server && bun run build:types` to regenerate `.d.ts` files in `dist/`. The desktop app imports types from `@codedeck/server/client` which reads from `dist/src/client.d.ts`. Without this step, new routes won't have type inference in the frontend RPC client. This only applies to browser-mode dev — Electron uses IPC instead.

### electron-vite — Three Build Targets

`electron.vite.config.ts` has three sections: `main`, `preload`, `renderer`. Each produces separate output in `out/`. The renderer section is a normal Vite config. Main and preload use `externalizeDepsPlugin()` to keep Node.js deps external.

## Style Rules

- Tabs for indentation, double quotes, no semicolons, trailing commas (enforced by Biome)
- `node:` protocol for Node.js builtin imports
- Always add `aria-hidden="true"` to decorative inline SVGs

## agent-browser

- Always use `--headed` flag: `agent-browser navigate --headed <url>`
