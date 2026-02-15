# Palot Agent Instructions

## Purpose of This File

This file is injected into every agent session for this project. Keep it short.
Only add entries here if an agent is likely to get stuck or repeat a mistake without them.
Do NOT add one-time setup notes, general knowledge, or things discoverable from config files.

## Project Structure

- **Monorepo**: Turborepo + Bun workspaces (Bun 1.3.8)
- **`packages/ui`**: Shared shadcn/ui component library (`@palot/ui`)
- **`packages/configconv`**: Universal agent config converter library (`@palot/configconv`) -- converts between Claude Code, OpenCode, and Cursor formats
- **`packages/configconv-cli`**: Thin CLI wrapper (`configconv`) for the converter library
- **`apps/desktop`**: Electron 40 + Vite + React 19 desktop app (via `electron-vite`)
- **`apps/server`**: Bun + Hono backend -- used only in browser-mode dev (`dev:web`), NOT bundled with Electron

### Desktop App Layout (`apps/desktop/src/`)

- **`main/`** -- Electron main process (Node.js): window management, IPC handlers, OpenCode server lifecycle, filesystem reads
- **`preload/`** -- Electron preload bridge: exposes `window.palot` API via `contextBridge`
- **`renderer/`** -- React app (browser context): components, hooks, services, atoms (Jotai)

## Skills

Project-specific skills live in `.agents/skills/`. Load a skill before starting
work that matches its domain -- they contain patterns and footguns that override
generic knowledge.

| Skill | When to load |
|---|---|
| `react-best-practices` | Writing or reviewing renderer components, optimizing re-renders or bundle size |

## Commands

- **Electron dev**: `cd apps/desktop && bun run dev` (electron-vite, renderer on port 1420)
- **Browser-only dev**: `cd apps/desktop && bun run dev:web` (Vite only, needs `apps/server` running)
- **Backend server** (browser mode only): `cd apps/server && bun run dev` (port 3100)
- **Lint check**: `bun run lint` (from root)
- **Lint/format fix**: `bun run lint:fix` or `bunx biome check --write .` (from root)
- **Type check all**: `bun run check-types` (from root, via Turborepo)
- **Type check desktop**: `cd apps/desktop && bun run check-types` (uses `tsgo`)
- **Run all tests**: `cd packages/configconv && bun test`
- **Run single test file**: `cd packages/configconv && bun test test/converter/config.test.ts`
- **Run tests by name**: `cd packages/configconv && bun test --grep "converts model"`
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
- Renderer: `@palot/ui` -> `@tanstack/*` -> `lucide-react` -> `react` -> local atoms/hooks/services

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

The main process runs in Node.js, the renderer runs in a Chromium sandbox. They communicate via IPC only. Never import Node.js modules (`fs`, `child_process`, `path`) in the renderer -- use the `window.palot` bridge or `services/backend.ts` instead.

### Backend Service Layer -- `services/backend.ts`

All hooks must import from `services/backend.ts`, NOT from `services/palot-server.ts` directly. The backend module detects Electron (`"palot" in window`) and routes to IPC or HTTP automatically.

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

### OpenCode SDK -- Always use v2 types

The `@opencode-ai/sdk` package ships both v1 and v2 type definitions. Always import from `@opencode-ai/sdk/v2/client` and check types under `dist/v2/gen/types.gen.d.ts` (NOT `dist/gen/types.gen.d.ts`). The v2 types are more complete (e.g., `session.create` accepts `permission?: PermissionRuleset`, `Permission` class has `respond`/`reply`/`list` methods). The v1 types are missing many fields and namespaces.

Always prefer re-using types from the SDK rather than defining local copies. The `@opencode-ai/sdk/v2/client` entry point re-exports all types from `gen/types.gen.js`, so types like `PermissionRuleset`, `PermissionRule`, `Session`, `Event`, etc. can be imported directly:

```ts
import type { PermissionRuleset, Session } from "@opencode-ai/sdk/v2/client"
```

### OpenCode model resolution

Always pass the resolved model to `promptAsync`. The server has no single "current model" concept.

### Server type regeneration (browser mode only)

When adding routes to `apps/server`, run `cd apps/server && bun run build:types` to regenerate `.d.ts` files. Without this, new routes won't have type inference in the frontend RPC client.

### Electron -- Preload Timing

The `window.palot` bridge is not available until the preload script finishes. Early-running renderer code (e.g., module-level calls, top-of-file side effects) must guard with optional chaining: `window.palot?.someMethod()`.

### Electron -- External Links

Never open external URLs inside the Electron window. Use `setWindowOpenHandler` in the main process to deny and redirect to `shell.openExternal()`. This prevents navigation to untrusted content inside the app.

### Palot storage -- XDG Base Directory

Palot follows the XDG Base Directory Specification (same convention as OpenCode). Config at `~/.config/palot/`, data at `~/.local/share/palot/`. Automation configs live at `~/.config/palot/automations/<id>/`, SQLite database at `~/.local/share/palot/palot.db`. See `main/automation/paths.ts` for the implementation. Do NOT use `~/.palot/` (legacy) or Electron's `userData` path for automation storage.

### electron-vite -- Three Build Targets

`electron.vite.config.ts` has three sections: `main`, `preload`, `renderer`. Main and preload use `externalizeDepsPlugin()` to keep Node.js deps external.

## Testing

- **Framework**: Bun's built-in test runner (`bun:test`) -- no vitest/jest/playwright
- **Tests exist only in `packages/configconv`** -- desktop app, server, and UI have no tests
- Tests are NOT run in CI (only lint, type-check, and build are)
- Run all: `cd packages/configconv && bun test`
- Run one file: `cd packages/configconv && bun test test/converter/mcp.test.ts`
- Run by name: `cd packages/configconv && bun test --grep "pattern"`
