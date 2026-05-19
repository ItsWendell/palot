# Development Guide

This guide defines the engineering conventions for Nexus Builder contributors.

## Local Development

```bash
bun install
npm run dev:desktop
```

Useful checks:

```bash
npm run check-types
npm run lint
bun test apps/desktop/src/renderer/lib/agent-progress-display.test.ts
git diff --check
```

## Code Organization

Use the existing monorepo boundaries:

- `apps/desktop`: Electron desktop application.
- `apps/server`: browser-mode development server.
- `packages/ui`: shared UI primitives.
- `packages/configconv`: reusable agent config conversion library.
- `packages/configconv-cli`: CLI wrapper for config conversion.
- `docs`: architecture, API, database, QA, and feature documentation.

Inside the desktop app, organize by runtime:

- `main`: native and privileged Electron code.
- `preload`: typed bridge between Electron and renderer.
- `renderer`: React application.
- `shared`: code safe to share across runtimes.

## Naming Conventions

- React components: `PascalCase`.
- Component files: existing code uses `kebab-case.tsx`; continue that pattern.
- Hooks: `useThing`.
- Jotai atoms: `thingAtom`, `thingFamily`, or `derivedThingAtom`.
- Services: imperative verbs, e.g. `listSkills`, `createSession`.
- Types/interfaces: domain nouns, e.g. `SkillDocument`, `SidebarProject`.
- IPC channels: `domain:action`, e.g. `skills:list`.

## TypeScript Standards

- Keep `check-types` clean.
- Avoid `any` in new code. If a third-party SDK requires it, isolate the cast
  near the boundary and document why.
- Export types for cross-module contracts.
- Prefer discriminated unions for status/state machines.
- Keep pure formatting and classification logic in `lib/` with tests.

## React Standards

- Keep components focused on rendering and user interaction.
- Move derived business logic into hooks, atoms, services, or pure helpers.
- Avoid subscribing to broad state when a derived atom or selector can provide a
  narrower value.
- Use `useMemo` and `useCallback` when they prevent meaningful child re-renders,
  not as a default reflex.
- Prefer stable primitive dependencies in effects.
- Do not define components inside components.

## IPC Standards

All new native capabilities must follow this flow:

1. Implement a main-process service where business logic lives.
2. Register a thin handler in `ipc-handlers.ts`.
3. Expose a narrow preload bridge method.
4. Add the method to `api.d.ts`.
5. Add a renderer-facing wrapper in `services/backend.ts`.

Validate all filesystem paths, filenames, and shell inputs in the main process.
Renderer code is not a security boundary.

If an IPC payload or response shape is used by more than one runtime, put the
type in `apps/desktop/src/shared/` and import it from both sides instead of
duplicating it in `preload/api.d.ts` and renderer code.

## Documentation Standards

- Add or update docs when changing architecture, storage, IPC contracts, or
  workflows.
- Exported functions that are not self-explanatory should have TSDoc.
- Inline comments should explain non-obvious reasons, not restate code.
- Keep feature smoke tests in `docs/` so future engineers can reproduce manual
  validation.

## Contribution Workflow

1. Start from a clean branch.
2. Keep commits scoped to one concern.
3. Run type check and lint before pushing.
4. For UI changes, smoke-test the affected screen in Electron or browser mode.
5. Document any follow-up work that is known but intentionally out of scope.

## Refactoring Policy

Prefer incremental refactors over broad mechanical movement. Move files only
when ownership becomes clearer and imports remain straightforward. Avoid
reshuffling directories during a feature change unless the structure directly
supports the feature.
