---
title: Coding Conventions
tags: [conventions, typescript]
updated: 2026-05-13
---

# Coding Conventions

## TypeScript

- Strict mode enabled. No `any` unless unavoidable and commented.
- Prefer `type` over `interface` for unions and aliases; use `interface` for object shapes that may be extended.
- All shared types live in `apps/desktop/src/shared/` — never inline them in component files.
- Import types with `import type` where the value is only used at type-check time.

## Styling

- Tailwind CSS utility classes only — no inline styles, no CSS modules.
- shadcn/ui component library for all interactive primitives (`Button`, `Input`, `Dialog`, etc.).
- Dark theme by default. Use `text-muted-foreground`, `bg-card`, `border-border` tokens.

## State management

- Jotai atoms for all UI state. No Redux, no Context (except for slot injection).
- Derived state via `atom((get) => ...)` — never duplicate data between atoms.
- Atoms that need persistence use `atomWithStorage` (localStorage in renderer).
- Family atoms via `atomFamily` for per-entity state (sessions, child agents).

## Testing

- Test runner: `bun:test` (`describe`, `test`, `expect` from `bun:test`).
- Test files: `*.test.ts` co-located with the file under test.
- Tests use real fs via `fs.mkdtemp` for isolation — no mocking unless unavoidable.
- Run all tests: `bun test apps/desktop/src/...`

## Documentation

- No multi-paragraph docstrings. One-line comments only where the code is non-obvious.
- No AI-slop comments (`// This function...`, `// We need to...`, `// Note that...`).
- Brain files (`[[wikilinks]]`) use Obsidian-compatible Markdown with YAML frontmatter.

## IPC handlers

- All handlers go in `ipc-handlers.ts` inside `registerIpcHandlers()`.
- Wrap with `withLogging(channel, handler)` for error surfacing.
- Channel names: `namespace:action` (e.g. `skills:list`, `brain:read`).

## File ownership

- Parallel agents are safe for planning, research, and docs with disjoint file sets.
- Sequential required for shared writes. See [[file-ownership]] for current assignments.

## Imports

- No barrel re-exports unless the package is a published library.
- Prefer explicit named imports over default imports for local modules.
- Path aliases: `@palot/ui` for the shared UI package.
