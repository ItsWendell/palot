# Codedeck Agent Instructions

## Project Structure

- **Monorepo**: Turborepo + Bun workspaces
- **`packages/ui`**: Shared shadcn/ui component library
- **`apps/desktop`**: Vite + React desktop app (will be Tauri later)

## Learnings

### agent-browser
- Always use `--headed` flag so the user can see the browser: `agent-browser navigate --headed <url>`
- Default is headless which hides the browser window

### shadcn/ui Monorepo Setup
- The UI package uses `@codedeck/ui` as its npm name
- Components are installed via `cd packages/ui && bunx shadcn@latest add <component>`
- The `components.json` aliases must use `@codedeck/ui/components`, `@codedeck/ui/lib/utils`, etc.
- The app's `components.json` must point CSS to `../../packages/ui/src/styles/globals.css`
- In the desktop app's Vite config, alias `@codedeck/ui` to `../../packages/ui/src` so all imports resolve
- The desktop app's `index.css` imports `@codedeck/ui/styles/globals.css` (which already includes `@import "tailwindcss"` — do NOT double-import tailwindcss)
- `tw-animate-css` is a required dependency in the UI package (shadcn adds it to globals.css)
- shadcn `--all` can produce duplicate `@layer base` blocks in globals.css — clean up after running it
- Use `@theme inline` (not `@theme`) for sidebar color vars to avoid duplication issues
- Package exports in `packages/ui/package.json` use glob patterns: `"./components/*": "./src/components/*.tsx"` — but for CSS, use explicit entries: `"./styles/globals.css": "./src/styles/globals.css"`

### Tailwind v4 + Monorepo Content Detection
- Tailwind v4's `@tailwindcss/vite` plugin auto-detects source files, but ONLY within the app's own directory
- Components in `packages/ui/src/components/` are NOT auto-scanned since they're outside the app root (resolved via Vite alias)
- **Fix**: Add `@source "../components";` to `packages/ui/src/styles/globals.css` so Tailwind scans the UI component files for class names
- Without this, utility classes used only in UI package components (e.g., `sr-only`, `animate-in`, etc.) will NOT generate CSS
- This was the root cause of `sr-only` not working on the `CommandDialog` header

### Vite + React
- Dev server runs on port 1420 (reserved for future Tauri integration)
- `clearScreen: false` in vite config since Tauri will manage the terminal

### react-resizable-panels
- The `direction` prop was renamed to `orientation` in newer versions — use `orientation="horizontal"` not `direction="horizontal"`
- The `order` prop does not exist on `PanelProps` — panels are ordered by their position in JSX
- For a fixed-width sidebar + resizable content split, use a plain `div` with fixed width for the sidebar and only use `ResizablePanelGroup` for the dynamic content area. Avoids panel sizing issues with percentage-based defaults.

### SVG Accessibility
- Always add a `<title>` element inside inline `<svg>` elements or use `aria-hidden="true"` to avoid lint errors about empty alt text

### Biome (Linter + Formatter)
- Using Biome v2.3.14 as the project linter and formatter
- Config: root `biome.json` with `"extends": "//"` in sub-packages (`packages/ui/biome.json`, `apps/desktop/biome.json`)
- **CSS is disabled** — Biome v2 cannot parse Tailwind v4 syntax (`@theme`, `@custom-variant`, `@apply`). The `css` section has both `linter.enabled: false` and `formatter.enabled: false`
- The `css.parser.allowTailwindSyntax` key does NOT exist in Biome v2 — do not add it
- CSS files are not included in `files.includes` (only `*.ts`, `*.tsx`, `*.js`, `*.json`)
- **shadcn/ui components**: Many a11y and suspicious rules are disabled in `packages/ui/biome.json` because shadcn-generated components intentionally use patterns like `role="group"` on divs, `dangerouslySetInnerHTML` for chart styles, array index keys for sliders, etc. Do NOT re-enable these for the UI package.
- Use `node:` protocol for Node.js builtin imports (enforced by `style/useNodejsImportProtocol`)
- Run `bunx biome check --write .` from root to format; `bunx biome check .` to verify
- Tabs for indentation, double quotes, no semicolons (except where required), trailing commas

### Zustand + React 19
- Zustand 5 with React 19's `useSyncExternalStore` requires selectors to return **referentially stable** values
- Selectors that create new arrays/objects on every call cause "The result of getSnapshot should be cached to avoid an infinite loop" error, which cascades into "Invalid hook call" and "Maximum update depth exceeded"
- **Fix**: Use `useShallow` from `zustand/shallow` to wrap selectors that derive new arrays/objects: `useAppStore(useShallow(selectAllSessions))`
- Export plain selector functions (not hooks) from the store, then wrap them with `useShallow` in the consuming hook
- For simple scalar/reference selectors (e.g., `(s) => s.ui.selectedProject`), `useShallow` is NOT needed — only for selectors that construct new objects/arrays
- Use individual selector hooks (e.g., `useSelectedProject`, `useSetSelectedProject`) instead of a single `useUIState()` hook to minimize re-renders
