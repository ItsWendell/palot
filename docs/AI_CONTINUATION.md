# AI Continuation Guide

This guide is for AI models (Claude, GPT-4, Gemini, etc.) contributing to Nexus Builder. It provides the context, conventions, and patterns needed to continue development without introducing regressions or style inconsistencies.

Read this before reading any other docs. Then read [AGENTS.md](../AGENTS.md) for project commands and the hot path files.

---

## What This Project Is

Nexus Builder is an Electron desktop app that wraps [OpenCode](https://opencode.ai) with a visual GUI. It adds multi-agent orchestration (Lead Agent → child agents), a structured memory system (Brain), cost tracking, supervision policies, and a review panel on top of OpenCode's core chat capabilities.

The app is a monorepo with three runtime contexts that must be kept separate:

| Runtime | Location | Access |
|---------|----------|--------|
| Main process | `apps/desktop/src/main/` | Full Node.js, Electron APIs, filesystem |
| Preload | `apps/desktop/src/preload/` | Typed bridge only, no direct Node |
| Renderer | `apps/desktop/src/renderer/` | Browser APIs only, no Node |

**Critical rule**: Never import main-process modules in the renderer, and never let renderer code access the filesystem directly. All cross-boundary communication goes through `window.palot.*` IPC calls.

---

## Architecture in Brief

```
User action in renderer
  -> window.palot.something() [preload bridge]
  -> ipcMain.handle("domain:action", ...) [main process]
  -> OpenCode SDK client or filesystem operation
  -> returns result back through IPC
  -> Jotai atom update
  -> React component re-render
```

The renderer also subscribes to OpenCode's SSE stream directly (via `@opencode-ai/sdk`) for real-time session events. This bypasses IPC for performance.

---

## File Organization Rules

### Where to put new code

- **New IPC handler**: Add to `apps/desktop/src/main/ipc-handlers.ts`. Group with existing domain handlers (brain:*, tasks:*, supervisor:*, etc.)
- **New preload type**: Add to `apps/desktop/src/preload/api.d.ts` in the relevant interface section. Expose in `apps/desktop/src/preload/index.ts`
- **New renderer service function**: Add to `apps/desktop/src/renderer/services/backend.ts` (wraps IPC call or HTTP fetch)
- **New Jotai atom**: Add to `apps/desktop/src/renderer/atoms/` in the relevant file, or create a new file named by domain
- **New derived atom**: Add to `apps/desktop/src/renderer/atoms/derived/`
- **New React component**: `apps/desktop/src/renderer/components/` using kebab-case filename
- **New hook**: `apps/desktop/src/renderer/hooks/use-*.ts`
- **New pure utility/policy**: `apps/desktop/src/renderer/lib/`
- **New main-process service**: `apps/desktop/src/main/` as a standalone file, imported by `ipc-handlers.ts`

### What NOT to do

- Do not add state to component `useState` if it needs to be shared across components -- use a Jotai atom
- Do not call `window.palot` from within a hook that runs in browser mode without checking `isElectron` first
- Do not create new files in `apps/desktop/src/shared/` without confirming the code is truly runtime-agnostic
- Do not import `electron` in the renderer or preload context
- Do not write to the filesystem from the renderer

---

## IPC Conventions

IPC channels use the format `domain:action`:

| Domain | Description |
|--------|-------------|
| `brain:*` | Per-project structured memory (read, write, search, delete, etc.) |
| `tasks:*` | Model routing and task classification |
| `supervisor:*` | Supervisor state persistence |
| `skills:*` | Agent skill management |
| `knowledge:*` | Knowledge source management |
| `cli:*` | CLI installation and management |
| `automation:*` | Scheduled run management |
| `app:*` | App info, window state |

When adding a new IPC channel:
1. Add the `ipcMain.handle` call in `ipc-handlers.ts` using the `withLogging` wrapper
2. Declare the type in `api.d.ts` under `NexusBuilderAPI` or the relevant sub-interface
3. Expose it in `preload/index.ts` via `contextBridge.exposeInMainWorld`
4. Add the renderer-facing wrapper in `services/backend.ts`

---

## State Management

The app uses [Jotai](https://jotai.org/) for all shared client state.

**Atom naming:**
- Base atoms: `thingAtom` (e.g., `serverUrlAtom`)
- Atom families: `thingFamily` (e.g., `sessionFamily`, `partsFamily`)
- Derived atoms: `derivedThingAtom` or `thingWithDerivedAtom`
- Write-only atoms: `doThingAtom` (e.g., `removeSessionAtom`)

**Atom families** are keyed by a stable string ID (session ID, message ID, project path). Never use object references as atom family keys.

**`appStore`** (`apps/desktop/src/renderer/atoms/store.ts`) is the global store. Import it only for imperative reads/writes outside React (e.g., inside event handlers, IPC callbacks, or service functions). Within React components, prefer `useAtomValue` and `useSetAtom`.

**`atomWithStorage`** -- use sparingly. The supervision events atom uses it for local persistence, but most state should be ephemeral and derived from the OpenCode SDK stream.

---

## React Patterns

### Component structure

```tsx
// 1. Imports
import { ... } from "..."

// 2. Types
interface ComponentNameProps { ... }

// 3. Component (memoized if rendered in a list)
export const ComponentName = memo(function ComponentName({ prop }: ComponentNameProps) {
  // hooks first
  // derived values
  // handlers
  // return JSX
})
```

### Performance rules

- Wrap list-rendered components in `memo()`
- Use `useMemo` for expensive derived values (e.g., filtering large arrays, computing token aggregates)
- Use `useCallback` for handlers passed as props to memoized children
- Prefer `useAtomValue` + `useSetAtom` over `useAtom` when you only need one direction
- Subscribe to atom families at the leaf component, not at the top and passed down as props

### Conditional Electron features

```tsx
const isElectron = typeof window !== "undefined" && "palot" in window

// In a hook or component:
if (!isElectron) return

window.palot.someMethod()
```

Always guard Electron-only features with this check. The renderer runs in both Electron and browser-only dev mode.

---

## TypeScript Conventions

- No `any` in new code. Use `unknown` with type guards at boundaries, or define a proper type.
- Prefer discriminated unions for state machines: `type Status = "idle" | "loading" | "error" | "success"`
- Use `import type { ... }` for type-only imports (Biome enforces this)
- Export interfaces for anything that crosses module boundaries
- Keep types co-located with the code that owns them; only move to `lib/types.ts` if genuinely shared

---

## Styling Conventions

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the full reference. Summary:

- Tailwind CSS v4 with semantic CSS variable tokens
- Use `cn()` from `@palot/ui/lib/utils` for conditional class merging
- No inline `style` attributes except for dynamic values (progress bar widths, positions)
- `text-muted-foreground` for secondary text, `text-foreground` for primary
- Status colors: emerald (active/success), amber (waiting/warning), red (error/failed)
- `rounded-md` for cards/inputs, `rounded-full` for badges/dots

---

## Testing

Tests live in `packages/configconv/test/`. The configconv package has the most comprehensive test coverage.

For the renderer, pure utility functions in `apps/desktop/src/renderer/lib/` should have `.test.ts` co-located files. Run with:

```bash
cd packages/configconv && bun test
bun test apps/desktop/src/renderer/lib/agent-progress-display.test.ts
```

The main process and renderer component code does not have full test coverage yet. When adding complex pure logic, add a test file alongside it.

---

## Known Gaps (as of feat/agent-overhaul)

These items are documented as unfinished or deferred. Address them in priority order:

1. **User-configurable budget thresholds** -- `DEFAULT_SUPERVISION_POLICY` in `supervision-policy.ts` has hardcoded values. A settings UI for budget thresholds is not yet built.

2. **Main-process agent kill switch** -- Supervision policy can produce a "stop" decision, but there is no OpenCode API to forcibly terminate a session from the main process. Requires upstream OpenCode support.

3. **Supervision events durability** -- Supervision events are stored in renderer `atomWithStorage` (localStorage). This is not durable across devices or reinstalls. A main-process SQLite table would be the right solution.

4. **Semantic memory search** -- Brain search is currently keyword substring matching. A vector/embedding-based search would improve recall for natural language queries. Deferred due to external API dependency.

5. **End-to-end tests** -- The full Lead Agent → Architect → Builder → Reviewer pipeline has no automated test. A Playwright or Spectron test covering this flow would catch regressions.

6. **Electron dev crash on macOS 15** -- `bun run dev` inside the repo crashes in AppKit registration when launched from certain environments (CI, Codex). The packaged app works. Root cause is an AppKit initialization issue with the generic Electron dev binary in restricted environments.

---

## Commit and Branch Conventions

Branch names: `feat/description`, `fix/description`, `chore/description`

Commit messages follow Conventional Commits:
- `feat(scope): description` -- new feature
- `fix(scope): description` -- bug fix
- `chore(scope): description` -- non-functional change
- `refactor(scope): description` -- code restructuring without behavior change

Scopes match the area of change: `orchestration`, `delegation`, `spawn`, `ui`, `security`, `brain`, `automation`.

Every PR should include a changeset entry (`bun changeset`) unless it is a purely internal change with no user-facing effect.

---

## Quick Reference: Hot Path Files

| File | What it does |
|------|-------------|
| `apps/desktop/src/main/ipc-handlers.ts` | All IPC handler registrations |
| `apps/desktop/src/preload/api.d.ts` | `window.palot` type definitions |
| `apps/desktop/src/renderer/components/multi-agent-panel.tsx` | Hive Mind sidebar panel |
| `apps/desktop/src/renderer/lib/hive-spawn-prompt.ts` | Agent spawn prompt builder |
| `apps/desktop/src/renderer/lib/supervision-policy.ts` | Budget/count/context policy |
| `apps/desktop/src/renderer/lib/pending-spawn-queue.ts` | Spawn request detection |
| `apps/desktop/src/renderer/components/chat/use-chat-send.ts` | Message send + compaction logic |
| `apps/desktop/src/renderer/atoms/sub-agents.ts` | Child session derived atom |
| `apps/desktop/src/main/project-brain-service.ts` | Per-project brain file operations |
| `apps/desktop/src/main/model-routing-service.ts` | Task complexity → model selection |
| `apps/desktop/src/main/supervisor-state-service.ts` | Cross-session milestone persistence |
