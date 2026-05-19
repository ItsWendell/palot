# Nexus Builder Architecture

Nexus Builder is a monorepo desktop application that wraps the OpenCode CLI/server with
an Electron interface. The application is split into process boundaries first,
then feature boundaries inside each process.

## System Design

```text
Electron main process
  - owns windows, native dialogs, credentials, notifications, auto-update
  - starts and supervises the local OpenCode server
  - runs automation scheduler and SQLite persistence
  - exposes safe IPC handlers

Preload process
  - exposes the typed window.palot bridge
  - keeps renderer code away from direct Node/Electron APIs

Renderer process
  - React UI, TanStack Router, Jotai state
  - talks to OpenCode through SDK clients and Nexus Builder IPC/service helpers
  - renders chat, review, automation, settings, skills, and project UX

Browser-mode server
  - Hono service used for web-only development
  - starts a single OpenCode server and exposes a small HTTP API

Shared packages
  - @palot/ui: shared shadcn-style components and AI Elements
  - @palot/configconv: migration/conversion library for agent configs
  - configconv CLI: command-line wrapper for the conversion library
```

## Runtime Data Flow

1. The main process starts Nexus Builder and ensures a local OpenCode server is
   available.
2. The renderer requests server configuration through the preload bridge or the
   browser-mode Hono server.
3. `connection-manager.ts` opens the OpenCode event stream and feeds session,
   message, part, permission, question, worktree, and model events into Jotai
   atoms.
4. Derived atoms normalize raw OpenCode events into UI-ready state:
   sessions, project groups, pending requests, metrics, child sessions, and
   sidebar views.
5. React components render the chat, review panel, sidebar, project picker,
   automations, settings, skills manager, and Hive Mind progress UI.

## Process Boundaries

### Main Process

Key responsibilities live under `apps/desktop/src/main/`:

- `index.ts`: Electron application bootstrap.
- `ipc-handlers.ts`: renderer-facing IPC registration.
- `opencode-manager.ts`: local OpenCode server lifecycle.
- `automation/`: scheduler, executor, registry, database, and schema.
- `credential-store.ts`: encrypted credential access through Electron
  `safeStorage`.
- `git-service.ts`: local Git actions used by review/worktree flows.
- `project-directory-service.ts`: validated project folder creation for the Add
  Project flow.
- `skills-service.ts`: filesystem access for OpenCode skill markdown files.
- `settings-store.ts`: persisted application settings.

Main-process code is allowed to use Node.js, Electron, filesystem access, and
native APIs. Renderer code should not import from this layer directly.

### Preload

`apps/desktop/src/preload/index.ts` exposes a narrow `window.palot` API through
`contextBridge`. `apps/desktop/src/preload/api.d.ts` is the contract the
renderer consumes.

All new native capabilities should be added in this order:

1. Main-process implementation.
2. IPC handler.
3. Preload bridge method.
4. Type declaration in `api.d.ts`.
5. Renderer service wrapper in `services/backend.ts`.

### Renderer

Renderer source is under `apps/desktop/src/renderer/`.

- `components/`: React UI organized by domain where possible.
- `hooks/`: reusable React hooks.
- `atoms/`: Jotai state, including derived state and event processors.
- `services/`: renderer-facing service functions.
- `lib/`: pure helpers, formatting, metrics, and common types.
- `router.tsx`: TanStack Router tree.

Large components should be split when they own more than one feature-level
responsibility. Prefer pure helpers in `lib/` for logic that can be tested
without rendering React.

## Authentication and Secrets

Nexus Builder does not currently own a user authentication flow. It delegates AI provider
authentication to OpenCode and stores Nexus Builder server credentials using Electron
`safeStorage`.

Security-sensitive rules:

- Do not expose raw provider secrets to the renderer.
- Keep credential reads/writes in the main process.
- Avoid localStorage for secrets; localStorage is only acceptable for UI
  preferences.
- Treat native IPC methods as trust boundaries and validate inputs before
  touching the filesystem or shell.

## Automation Flow

Automations are defined by filesystem config and tracked in SQLite:

1. User creates or updates an automation in the UI.
2. The main process registry stores automation config and prompt content.
3. The scheduler calculates next run times from RRULE schedules.
4. The executor starts OpenCode sessions, tracks attempts, records results, and
   marks runs as pending review, archived, failed, or completed.
5. The renderer receives updates through IPC push notifications and reloads run
   state.

SQLite stores scheduling and run state. Prompt/config content lives on disk so
it remains easy to inspect and edit outside the app.

## Skills Flow

OpenCode-style skills live in `~/.config/opencode/skills/`. Nexus Builder manages them
through:

- main process: `skills-service.ts`
- IPC: `skills:list`, `skills:write`, `skills:delete`
- renderer service: `listSkills`, `writeSkill`, `deleteSkill`
- UI: `components/skills-page.tsx`

Skill files are markdown documents with YAML-like frontmatter. The service
normalizes filenames before writing or deleting to avoid path traversal.
Shared skill metadata is defined in `apps/desktop/src/shared/skills.ts` so the
main-process service, preload API, and renderer UI all use the same contract.

## Database Overview

The only app-owned database today is the automation SQLite database. See
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for table-level detail.

## Architectural Risks

- `chat-view.tsx`, `sidebar.tsx`, `ipc-handlers.ts`, and `api.d.ts` are still
  large files. Future feature work should extract focused modules instead of
  adding more responsibilities to these files.
- IPC contracts are currently hand-maintained between the bridge and type file.
  A generated or shared contract would reduce drift.
- Renderer state is mostly well-isolated in atoms, but feature directories would
  make ownership clearer as the app grows.
