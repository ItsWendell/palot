# Engineering Audit

This audit captures the current production-readiness state of the repository and
the refactors completed during the cleanup pass.

## Executive Summary

Nexus Builder already has a strong monorepo foundation: runtime boundaries are clear,
the UI stack is modern, automation logic is isolated, and shared packages keep
migration and UI primitives reusable. The largest risks are not framework
choices; they are maintainability pressure from oversized files, hand-maintained
IPC contracts, and missing team-facing documentation.

This pass focused on low-risk improvements that make the codebase easier for a
team to extend:

- Extracted skills filesystem logic from the catch-all IPC registry into a
  dedicated main-process service.
- Extracted project directory creation into a validated main-process service.
- Split standalone chat scroll/input helper components out of `chat-view.tsx`.
- Split sidebar project folder and session item rendering out of `sidebar.tsx`.
- Added a shared managed-skill contract used by main, preload, and renderer code.
- Added tests for skills CRUD, project directory creation, automation registry
  CRUD, and agent progress display helpers.
- Added architecture, development, API, database, and Hive Mind validation docs.
- Linked the engineering docs from the README.
- Preserved existing behavior while making the new skills and Hive Mind work
  easier to reason about.

## Architecture Overview

The repo is organized as:

```text
apps/
  desktop/     Electron application
  server/      browser-mode Hono development server
packages/
  ui/          shared UI components and styles
  configconv/  agent config migration library
  configconv-cli/
docs/          engineering and workflow documentation
```

The desktop app has three strict runtime layers:

- main process: privileged Node/Electron functionality
- preload process: typed bridge
- renderer process: React UI and Jotai state

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design.

## Issues Identified

### 1. Skills business logic lived inside `ipc-handlers.ts`

Problem: frontmatter parsing, directory management, filename normalization, file
reads, writes, and deletes were embedded directly in the IPC registration file.

Why it matters: IPC registries should be thin adapters. Embedding business logic
there makes the file harder to scan and makes logic difficult to test.

Resolution: added `apps/desktop/src/main/skills-service.ts` and made IPC
handlers delegate to it.

### 2. Skills filename handling needed a clear trust-boundary abstraction

Problem: renderer-provided filenames were sanitized inline at write/delete call
sites.

Why it matters: filesystem operations are a privileged boundary. Sanitization
should be centralized so future callers cannot bypass it accidentally.

Resolution: added `normalizeSkillFilename()` and tests covering unsafe names,
existing `.md` extensions, and empty/invalid input.

### 3. Project creation accepted raw folder names inside the IPC handler

Problem: native project creation joined the selected parent path with the
renderer-provided project name directly inside `ipc-handlers.ts`.

Why it matters: project creation is a filesystem boundary. It should be isolated
and testable, and it should reject names that are actually paths.

Resolution: added `project-directory-service.ts`, which trims names, rejects
empty/path-like values, and creates a single child directory under the selected
parent.

### 4. Hive Mind progress behavior was documented as a scratch note

Problem: the swarm UI validation note was untracked and not discoverable.

Why it matters: manual QA flows are part of production readiness. If they live
as loose scratch files, future contributors will not find or update them.

Resolution: moved the material into `docs/swarm-ui-validation.md` and linked it
from the README.

### 5. Repository onboarding documentation was incomplete

Problem: the README covered product usage well, but deeper engineering docs for
architecture, API surfaces, database schema, and contribution conventions were
missing.

Why it matters: a multi-developer team needs stable references for where code
belongs, how process boundaries work, and how to change storage or IPC safely.

Resolution: added `ARCHITECTURE.md`, `DEVELOPMENT_GUIDE.md`,
`API_REFERENCE.md`, and `DATABASE_SCHEMA.md`.

### 6. Large files remain a scaling risk

Problem: `chat-view.tsx`, `sidebar.tsx`, `ipc-handlers.ts`, `api.d.ts`, and
`skills-page.tsx` are large enough that future changes will become harder to
review.

Why it matters: large files collect unrelated responsibilities and increase
merge conflict risk.

Resolution: extracted skills and project creation services, plus the first
round of chat/sidebar rendering modules. Further decomposition is recommended
but should continue incrementally by feature.

## Refactoring Performed

- Added `SkillsService` for skills list/write/delete behavior.
- Added pure parser helpers for skill markdown documents.
- Added `project-directory-service.ts` for validated project creation.
- Split chat scroll helpers, prompt-input bridges, and input extras out of
  `chat-view.tsx`.
- Split project-folder and session-item rendering out of `sidebar.tsx`.
- Added shared managed-skill types in `apps/desktop/src/shared/skills.ts`.
- Added tests for skills, project creation, automation registry, and progress
  display helpers.
- Kept IPC handlers as thin adapters.
- Preserved the renderer-facing API shape so no UI behavior changed.
- Kept existing folder conventions instead of introducing disruptive top-level
  reshuffling.

## New Folder Structure

No broad folder move was performed. The repo already has appropriate top-level
monorepo boundaries. The meaningful structure addition is:

```text
docs/
  API_REFERENCE.md
  ARCHITECTURE.md
  DATABASE_SCHEMA.md
  DEVELOPMENT_GUIDE.md
  ENGINEERING_AUDIT.md
  swarm-ui-validation.md

apps/desktop/src/main/
  project-directory-service.ts
  project-directory-service.test.ts
  skills-service.ts
  skills-service.test.ts

apps/desktop/src/renderer/components/
  sidebar-project-folder.tsx
  sidebar-session-item.tsx

apps/desktop/src/renderer/components/chat/
  chat-input-extras.tsx
  chat-scroll.tsx
  prompt-input-bridges.tsx

apps/desktop/src/shared/
  skills.ts
```

## Documentation Added

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)
- [API_REFERENCE.md](./API_REFERENCE.md)
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- [swarm-ui-validation.md](./swarm-ui-validation.md)

## Dependency Changes

No dependencies were added or removed in this pass.

The package set is broadly reasonable for the current Electron/React/Hono stack.
Dependency pruning should be done with usage analysis in a separate pass because
several packages are feature-specific and easy to misclassify without running
the full app and packaging flows.

## Security Improvements

- Centralized skill filename normalization in the main process.
- Centralized project folder-name validation in the main process.
- Prevented path traversal through skill write/delete filenames.
- Prevented path-like project names from creating nested or parent-relative
  folders.
- Documented IPC as a trust boundary in the development guide.
- Documented that credentials must remain in the main process and not in
  renderer localStorage.

## Performance Improvements

- Centralized budget/status display helpers so progress UI components do less
  duplicated classification work.
- Documented remaining React risks around large components and broad state
  subscriptions.

No speculative memoization or lazy-loading changes were made without a measured
rendering issue.

## Validation

Commands run:

```bash
bun test apps/desktop/src/main/skills-service.test.ts apps/desktop/src/renderer/lib/agent-progress-display.test.ts
bun test apps/desktop/src/main/project-directory-service.test.ts apps/desktop/src/main/automation/registry.test.ts
npm run check-types
npm run lint
git diff --check
```

All passed.

## Remaining Recommendations

1. Continue splitting `chat-view.tsx` into message orchestration, input state, permission
   handling, and rendering submodules.
2. Continue splitting `sidebar.tsx` into project list, recent sessions, footer navigation,
   and session row modules.
3. Generate or share IPC types so `preload/index.ts`, `api.d.ts`, and
   `backend.ts` cannot drift.
4. Add integration tests around skills CRUD, project creation, and automation
   run lifecycle.
5. Add package-level dependency usage checks before pruning dependencies.
6. Add a small renderer smoke-test suite for critical screens once the preferred
   browser automation workflow is standardized.
