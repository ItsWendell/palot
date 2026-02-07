# Codedeck Agent Instructions

## Purpose of This File

This file is injected into every agent session for this project. Keep it short.
Only add entries here if an agent is likely to get stuck or repeat a mistake without them.
Do NOT add one-time setup notes, general knowledge, or things discoverable from config files.

## Project Structure

- **Monorepo**: Turborepo + Bun workspaces
- **`packages/ui`**: Shared shadcn/ui component library (`@codedeck/ui`)
- **`apps/desktop`**: Vite + React 19 desktop app (future Tauri)

## Commands

- **Dev server**: `cd apps/desktop && bun run dev` (port 1420)
- **Lint/format**: `bunx biome check --write .` from root
- **Type check**: `cd apps/desktop && bun run check-types`
- **Add UI component**: `cd packages/ui && bunx shadcn@latest add <component>`

## Critical Footguns

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

## Style Rules

- Tabs for indentation, double quotes, no semicolons, trailing commas (enforced by Biome)
- `node:` protocol for Node.js builtin imports
- Always add `aria-hidden="true"` to decorative inline SVGs

## agent-browser

- Always use `--headed` flag: `agent-browser navigate --headed <url>`
