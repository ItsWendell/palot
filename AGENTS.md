# Codedeck Agent Instructions

## Purpose of This File

This file is injected into every agent session for this project. Keep it short.
Only add entries here if an agent is likely to get stuck or repeat a mistake without them.
Do NOT add one-time setup notes, general knowledge, or things discoverable from config files.

## Project Structure

- **Monorepo**: Turborepo + Bun workspaces (Bun 1.3.8)
- **`packages/ui`**: Shared shadcn/ui component library (`@codedeck/ui`)
- **`packages/cc2oc`**: Claude Code to OpenCode migration library (`@codedeck/cc2oc`)
- **`apps/desktop`**: Electron 40 + Vite + React 19 desktop app (via `electron-vite`)
- **`apps/server`**: Bun + Hono backend -- used only in browser-mode dev (`dev:web`), NOT bundled with Electron

### Desktop App Layout (`apps/desktop/src/`)

- **`main/`** -- Electron main process (Node.js): window management, IPC handlers, OpenCode server lifecycle, filesystem reads
- **`preload/`** -- Electron preload bridge: exposes `window.codedeck` API via `contextBridge`
- **`renderer/`** -- React app (browser context): components, hooks, services, atoms (Jotai)

## Commands

- **Electron dev**: `cd apps/desktop && bun run dev` (electron-vite, renderer on port 1420)
- **Browser-only dev**: `cd apps/desktop && bun run dev:web` (Vite only, needs `apps/server` running)
- **Backend server** (browser mode only): `cd apps/server && bun run dev` (port 3100)
- **Lint check**: `bun run lint` (from root)
- **Lint/format fix**: `bun run lint:fix` or `bunx biome check --write .` (from root)
- **Type check all**: `bun run check-types` (from root, via Turborepo)
- **Type check desktop**: `cd apps/desktop && bun run check-types` (uses `tsgo`)
- **Run all tests**: `cd packages/cc2oc && bun test`
- **Run single test file**: `cd packages/cc2oc && bun test test/converter/config.test.ts`
- **Run tests by name**: `cd packages/cc2oc && bun test --grep "converts model"`
- **Rebuild server types**: `cd apps/server && bun run build:types` (required after adding server routes)
- **Add UI component**: `cd packages/ui && bunx shadcn@latest add <component>`
- **Package**: `cd apps/desktop && bun run package` (or `package:linux`, `package:mac`, `package:win`, `package:all`)
- **Package without code signing (macOS)**: `CSC_IDENTITY_AUTO_DISCOVERY=false cd apps/desktop && bun run package:mac`
- **Changeset -- add**: `bun changeset` (interactive -- pick packages, bump type, write description)
- **Changeset -- version**: `bun run version-packages` (applies pending changesets, bumps versions, updates changelogs)

## Code Style

### Formatting (enforced by Biome 2.3.14)

- Tabs for indentation (width 2), line width 100, LF line endings
- Double quotes, no semicolons, trailing commas everywhere
- Arrow functions always use parentheses: `(x) => x`
- Run `bunx biome check --write .` from root to auto-fix

### Imports

- `node:` protocol for all Node.js builtins: `import path from "node:path"`
- Use `import type { ... }` for type-only imports (Biome warns otherwise)
- Order: external packages first, then internal/relative imports (no blank line between)
- Main process: `node:` builtins first, then `electron`, then local
- Renderer: `@codedeck/ui` -> `@tanstack/*` -> `lucide-react` -> `react` -> local atoms/hooks/services

### Naming Conventions

- **Files**: `kebab-case.ts` / `kebab-case.tsx` everywhere
- **Functions/variables**: `camelCase` -- `createLogger()`, `fetchDiscovery()`
- **Components**: `PascalCase` -- `ChatView`, `AppSidebar`, `CommandPalette`
- **Types/interfaces**: `PascalCase` -- `DiscoveredProject`, `AgentStatus`
- **Props**: `ComponentNameProps` -- `ChatViewProps`, `AppSidebarProps`
- **Module-level constants**: `UPPER_SNAKE_CASE` -- `FRAME_BUDGET_MS`, `OPENCODE_PORT`
- **Jotai atoms**: `camelCaseAtom` -- `sessionIdsAtom`, `serverUrlAtom`
- **Atom families**: `camelCaseFamily` -- `sessionFamily`, `partsFamily`

### Types

- Prefer `interface` for object shapes, `type` for unions/aliases
- Export types only when used across modules
- Props: named interface for complex props, inline destructured type for small sub-components
- UI library uses `React.ComponentProps<"element">` intersection pattern for wrapper components

### React Patterns

- Functional components only, no class components
- State: **Jotai atoms** (NOT Zustand -- codebase has migrated). Store in `renderer/atoms/`
- Thin hook wrappers around atoms (e.g., `useAgents()` returns `useAtomValue(agentsAtom)`)
- Use `memo()` with named function expressions for perf-critical sub-components
- Custom hooks return objects, not arrays
- Named exports everywhere -- no default exports (except Hono route modules and Bun server entry)

### Error Handling

- No custom error classes -- use `new Error("descriptive message")`
- Services: try/catch, log with tagged logger, then rethrow
- Hooks: try/catch, set error state (`err instanceof Error ? err.message : "fallback"`)
- Main process IPC: wrap handlers with `withLogging()` for structured error logging
- Filesystem: check `(err as NodeJS.ErrnoException).code === "ENOENT"` for missing files
- Parallel IO: use `Promise.allSettled()` for resilient partial success
- SSE reconnect: exponential backoff loop capped at 30s

### Comments and File Organization

- Module-level `/** ... */` JSDoc at top of files for documentation
- `// ============================================================` section dividers for major sections
- `// ---` sub-section dividers within long functions
- File order: imports -> constants -> types -> state -> helpers -> public API/components -> sub-components

### Accessibility

- Always add `aria-hidden="true"` to decorative inline SVGs

## Critical Footguns

### Electron -- Two Runtime Contexts

The main process runs in Node.js, the renderer runs in a Chromium sandbox. They communicate via IPC only. Never import Node.js modules (`fs`, `child_process`, `path`) in the renderer -- use the `window.codedeck` bridge or `services/backend.ts` instead.

### Backend Service Layer -- `services/backend.ts`

All hooks must import from `services/backend.ts`, NOT from `services/codedeck-server.ts` directly. The backend module detects Electron (`"codedeck" in window`) and routes to IPC or HTTP automatically.

### Jotai + React 19

The codebase uses Jotai for state management. Derive data with `useMemo` from atom values -- do NOT create new objects inside selectors.

### Tailwind v4 Monorepo -- Missing Styles

`packages/ui/src/styles/globals.css` must have `@source "../components";` or utility classes used only in UI components won't generate CSS. Do NOT remove this line.

### Biome -- CSS Disabled

Biome v2 cannot parse Tailwind v4 syntax. CSS linting/formatting is disabled. Do not try to enable it.

### Changesets -- versioning workflow

All five workspace packages are **linked** (version together). When making user-facing changes, run `bun changeset` before opening a PR.

### Packaging -- macOS without code signing

Always set `CSC_IDENTITY_AUTO_DISCOVERY=false` when building locally without an Apple Developer certificate.

### OpenCode SSE -- directory scoping

Use `/global/event` (not `/event`) to stream events from ALL projects. The SDK exposes this as `client.global.event()`.

### OpenCode model resolution

Always pass the resolved model to `promptAsync`. The server has no single "current model" concept.

### Server type regeneration (browser mode only)

When adding routes to `apps/server`, run `cd apps/server && bun run build:types` to regenerate `.d.ts` files. Without this, new routes won't have type inference in the frontend RPC client.

### electron-vite -- Three Build Targets

`electron.vite.config.ts` has three sections: `main`, `preload`, `renderer`. Main and preload use `externalizeDepsPlugin()` to keep Node.js deps external.

### OpenCode source repository

The OpenCode server/TUI source is often checked out locally at `../opencode`. Key paths:

- **Server routes**: `packages/opencode/src/server/routes/`
- **Session logic**: `packages/opencode/src/session/`
- **TUI components**: `packages/opencode/src/cli/cmd/tui/`
- **SDK types**: `packages/opencode/src/server/routes/`

## Testing

- **Framework**: Bun's built-in test runner (`bun:test`) -- no vitest/jest/playwright
- **Tests exist only in `packages/cc2oc`** -- desktop app, server, and UI have no tests
- Tests are NOT run in CI (only lint, type-check, and build are)
- Run all: `cd packages/cc2oc && bun test`
- Run one file: `cd packages/cc2oc && bun test test/converter/mcp.test.ts`
- Run by name: `cd packages/cc2oc && bun test --grep "pattern"`

## agent-browser

- Always use `--headed` flag: `agent-browser navigate --headed <url>`

### Testing the desktop app

**Browser mode (recommended):**

```bash
cd apps/server && bun run dev        # port 3100
cd apps/desktop && bun run dev:web   # port 1420
agent-browser open --headed http://localhost:1420
```

**Electron mode (for IPC/preload testing):**

```bash
ELECTRON_REMOTE_DEBUGGING_PORT=9222 cd apps/desktop && bun run dev
agent-browser --cdp 9222 --headed snapshot
```
