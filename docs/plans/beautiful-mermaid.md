# beautiful-mermaid Integration Plan

> **Goal:** Replace the current `@streamdown/mermaid` plugin (which wraps the full `mermaid` library) with `beautiful-mermaid` for rendering mermaid diagrams as styled SVGs — gaining better aesthetics, theme integration, smaller bundle size, and zero DOM dependencies.

## Current State

Codedeck renders markdown via **Streamdown** (`streamdown@2.1.0`) with four plugins: `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, and `@streamdown/mermaid`. Mermaid rendering happens in two components:

- `packages/ui/src/components/ai-elements/message.tsx:275` — `MessageResponse` (assistant text)
- `packages/ui/src/components/ai-elements/reasoning.tsx:195` — `ReasoningContent` (thinking blocks)

Both pass `{ cjk, code, math, mermaid }` as Streamdown plugins.

### How `@streamdown/mermaid` works today

The current plugin (`@streamdown/mermaid@1.0.1`) is a thin wrapper around the full `mermaid@^11.12.2` library:

```ts
// @streamdown/mermaid/dist/index.js (decompiled)
import mermaid from "mermaid"

const defaults = {
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  fontFamily: "monospace",
  suppressErrorRendering: true,
}

function createMermaidPlugin(options = {}) {
  let initialized = false
  const config = { ...defaults, ...options.config }

  const instance = {
    initialize(overrides) { /* merge + mermaid.initialize() */ },
    async render(id, source) { return mermaid.render(id, source) },
  }

  return {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid(config) { return instance },
  }
}
```

The plugin implements the `DiagramPlugin` interface expected by Streamdown:

```ts
interface DiagramPlugin {
  name: "mermaid"
  type: "diagram"
  language: string
  getMermaid: (config?: MermaidConfig) => MermaidInstance
}

interface MermaidInstance {
  initialize: (config: MermaidConfig) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}
```

### Problems with current approach

1. **Bundle size** — `mermaid@11.12.2` pulls in D3, dagre, DOMPurify, and other heavy dependencies (~2.5MB minified). `beautiful-mermaid` has a single dependency (`@dagrejs/dagre`) and produces SVG strings with no DOM.
2. **Aesthetics** — Mermaid's default rendering looks dated. beautiful-mermaid produces polished, professional SVGs with a CSS custom property theme system.
3. **Theme integration** — The current plugin uses mermaid's internal theming (`theme: "default"`), which doesn't adapt to Codedeck's light/dark mode. beautiful-mermaid uses `--bg`/`--fg` CSS variables that can derive from the app's theme.
4. **DOM requirement** — `mermaid.render()` requires a DOM (or jsdom). beautiful-mermaid is pure TypeScript with zero DOM dependencies.
5. **Diagram type coverage** — beautiful-mermaid supports flowcharts, state, sequence, class, and ER diagrams. The standard mermaid library supports more types (pie, gantt, etc.), but these 5 cover >95% of AI-generated diagrams.

---

## beautiful-mermaid API

```ts
import { renderMermaid } from "beautiful-mermaid"

// Minimal — uses default zinc theme (white bg, #27272A fg)
const svg = await renderMermaid("graph TD\n  A --> B")

// Custom colors — just bg + fg gives a clean mono diagram
const svg = await renderMermaid("graph TD\n  A --> B", {
  bg: "#1a1b26",
  fg: "#a9b1d6",
})

// Enriched — optional line/accent/muted/surface/border colors
const svg = await renderMermaid("graph TD\n  A --> B", {
  bg: "#1a1b26", fg: "#a9b1d6",
  line: "#3d59a1", accent: "#7aa2f7", muted: "#565f89",
})

// ASCII output (for potential terminal/CLI use)
import { renderMermaidAscii } from "beautiful-mermaid"
const ascii = renderMermaidAscii("graph LR; A --> B --> C")
```

Key API surface:
- `renderMermaid(text, options?)` — async, returns SVG string
- `renderMermaidAscii(text, options?)` — sync, returns ASCII string
- `THEMES` — 15 built-in color palettes (tokyo-night, dracula, nord, github-light, github-dark, etc.)
- `fromShikiTheme(theme)` — extracts `DiagramColors` from any Shiki/VS Code theme object
- `DiagramColors` — `{ bg, fg, line?, accent?, muted?, surface?, border? }`

Package info: `beautiful-mermaid@0.1.3`, MIT license, single runtime dependency (`@dagrejs/dagre`).

---

## Integration Architecture

### Approach: Custom Streamdown Mermaid Plugin

Streamdown expects mermaid plugins to implement the `DiagramPlugin` interface with a `getMermaid()` method returning a `MermaidInstance` (`{ initialize, render }`). We create an adapter that wraps `beautiful-mermaid`'s `renderMermaid()` to conform to this interface.

```
Streamdown encounters ```mermaid code block
  → calls plugin.getMermaid()
  → calls instance.render(id, source)
  → receives { svg: string }
  → inserts SVG into rendered output
```

Our adapter intercepts the `render()` call and routes it through `beautiful-mermaid` instead of the `mermaid` library.

### Theme Integration

Codedeck already uses Shiki with `github-light` and `github-dark` themes (see `code-block.tsx:143`). beautiful-mermaid provides `fromShikiTheme()` that extracts diagram colors from any Shiki theme object. This creates a natural integration path:

1. Detect current theme mode (light/dark) from the app's theme system
2. Use `fromShikiTheme()` with the matching Shiki theme, OR
3. Map Codedeck's CSS variables directly to `DiagramColors`

Since the app uses Tailwind v4 with CSS variables (`--background`, `--foreground`, etc.), the simplest approach is to map these directly:

```ts
function getColorsFromTheme(isDark: boolean): DiagramColors {
  // Option A: Use built-in themes
  return isDark ? THEMES["github-dark"] : THEMES["github-light"]

  // Option B: Extract from computed CSS variables (more accurate)
  // const style = getComputedStyle(document.documentElement)
  // return { bg: style.getPropertyValue("--background"), fg: style.getPropertyValue("--foreground") }
}
```

---

## Implementation Plan

### Phase 1: Core Plugin Adapter

**Effort:** LOW (1-2 hours)
**Files:** New `packages/ui/src/lib/beautiful-mermaid-plugin.ts`

Create a Streamdown-compatible mermaid plugin that wraps `beautiful-mermaid`:

```ts
// packages/ui/src/lib/beautiful-mermaid-plugin.ts
import { renderMermaid, THEMES, fromShikiTheme } from "beautiful-mermaid"
import type { DiagramColors } from "beautiful-mermaid"

interface MermaidInstance {
  initialize: (config: unknown) => void
  render: (id: string, source: string) => Promise<{ svg: string }>
}

interface DiagramPlugin {
  name: "mermaid"
  type: "diagram"
  language: string
  getMermaid: (config?: unknown) => MermaidInstance
}

interface BeautifulMermaidPluginOptions {
  /** Color palette — defaults to github-dark */
  colors?: DiagramColors
  /** Theme name from beautiful-mermaid's built-in themes */
  theme?: string
  /** Font family for diagram text */
  font?: string
  /** If true, SVGs have transparent background */
  transparent?: boolean
}

export function createBeautifulMermaidPlugin(
  options: BeautifulMermaidPluginOptions = {},
): DiagramPlugin {
  let colors = options.colors
    ?? (options.theme ? THEMES[options.theme] : undefined)
    ?? THEMES["github-dark"]

  const instance: MermaidInstance = {
    initialize(config) {
      // beautiful-mermaid doesn't need global init,
      // but we can accept color overrides here
      if (config && typeof config === "object" && "bg" in config) {
        colors = config as DiagramColors
      }
    },
    async render(_id: string, source: string) {
      const svg = await renderMermaid(source, {
        ...colors,
        font: options.font ?? "Inter",
        transparent: options.transparent ?? false,
      })
      return { svg }
    },
  }

  return {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid() {
      return instance
    },
  }
}
```

### Phase 2: Wire Into Streamdown Components

**Effort:** LOW (30 minutes)
**Files:** `packages/ui/src/components/ai-elements/message.tsx`, `reasoning.tsx`

Replace the `@streamdown/mermaid` import with the custom plugin:

```diff
- import { mermaid } from "@streamdown/mermaid"
+ import { createBeautifulMermaidPlugin } from "../../lib/beautiful-mermaid-plugin"

- const streamdownPlugins = { cjk, code, math, mermaid }
+ const mermaid = createBeautifulMermaidPlugin()
+ const streamdownPlugins = { cjk, code, math, mermaid }
```

Both `message.tsx` and `reasoning.tsx` need this change. The plugin object is created at module scope (not per render) since it's stateless.

### Phase 3: Theme-Aware Colors

**Effort:** MEDIUM (1-2 hours)
**Files:** `packages/ui/src/lib/beautiful-mermaid-plugin.ts`, `message.tsx`, `reasoning.tsx`

Make the mermaid plugin react to Codedeck's theme (light/dark mode):

**Option A: Static theme pair (simplest)**

Create two plugin instances and select based on theme:

```ts
const mermaidLight = createBeautifulMermaidPlugin({ theme: "github-light" })
const mermaidDark = createBeautifulMermaidPlugin({ theme: "github-dark" })

// In the component:
const isDark = useTheme() // however Codedeck resolves theme
const mermaid = isDark ? mermaidDark : mermaidLight
const streamdownPlugins = useMemo(() => ({ cjk, code, math, mermaid }), [mermaid])
```

Note: This moves plugin creation into the component and requires `useMemo` on the plugins object to avoid Streamdown re-initialization on every render.

**Option B: CSS variable extraction (more accurate)**

Use `fromShikiTheme()` with the same Shiki themes already used by the code block highlighter:

```ts
import { getSingletonHighlighter } from "shiki"
import { fromShikiTheme } from "beautiful-mermaid"

// At app startup or in a provider:
const highlighter = await getSingletonHighlighter({ themes: ["github-light", "github-dark"] })
const lightColors = fromShikiTheme(highlighter.getTheme("github-light"))
const darkColors = fromShikiTheme(highlighter.getTheme("github-dark"))
```

This ensures mermaid diagrams use the exact same color palette as syntax-highlighted code blocks.

**Option C: Live CSS variable injection (most integrated but complex)**

beautiful-mermaid SVGs use CSS custom properties (`--bg`, `--fg`, etc.) internally. Since the SVGs are rendered as inline HTML (not `<img>` tags), CSS variables from parent elements cascade into them. We could:

1. Render with placeholder colors
2. Add CSS rules that override `--bg`/`--fg` based on Codedeck's theme variables
3. Theme changes propagate automatically without re-rendering

This requires adding a CSS snippet to the global styles:

```css
/* packages/ui/src/styles/globals.css */
.streamdown svg[style*="--bg"] {
  --bg: var(--background) !important;
  --fg: var(--foreground) !important;
}
```

### Phase 4: Dependency Cleanup

**Effort:** LOW (15 minutes)
**Files:** `packages/ui/package.json`

Remove the old mermaid dependencies:

```bash
cd packages/ui
bun remove @streamdown/mermaid mermaid
bun add beautiful-mermaid
```

This should significantly reduce the bundle size since `mermaid@11.12.2` (and its D3/dagre/DOMPurify transitive deps) are removed and replaced with `beautiful-mermaid@0.1.3` (only `@dagrejs/dagre`).

### Phase 5: Fallback for Unsupported Diagram Types

**Effort:** MEDIUM (1-2 hours)
**Files:** `packages/ui/src/lib/beautiful-mermaid-plugin.ts`

beautiful-mermaid supports 5 diagram types: flowchart, state, sequence, class, ER. The standard mermaid library supports additional types (pie, gantt, journey, mindmap, timeline, etc.). While these are rare in AI-generated content, we should handle them gracefully.

**Strategy: Detect and fallback**

```ts
const SUPPORTED_TYPES = /^(graph|flowchart|stateDiagram|sequenceDiagram|classDiagram|erDiagram)/i

async render(_id: string, source: string) {
  const firstLine = source.trim().split(/[\n;]/)[0]?.trim() ?? ""

  if (!SUPPORTED_TYPES.test(firstLine)) {
    // Fallback: render source as a styled code block instead of a diagram
    // OR: lazy-load the full mermaid library for rare diagram types
    return { svg: renderFallbackCodeBlock(source) }
  }

  const svg = await renderMermaid(source, { ...colors, font: "Inter" })
  return { svg }
}
```

**Option A (simpler):** For unsupported types, render the mermaid source as a syntax-highlighted code block with a badge saying "Unsupported diagram type". No fallback library needed.

**Option B (complete):** Lazy-load `mermaid` only for unsupported types using dynamic `import()`. This keeps the happy path fast while still supporting edge cases:

```ts
if (!SUPPORTED_TYPES.test(firstLine)) {
  const { default: mermaid } = await import("mermaid")
  mermaid.initialize({ startOnLoad: false, theme: "default" })
  return mermaid.render(_id, source)
}
```

With Option B, keep `mermaid` as an optional/lazy dependency in `package.json` — it won't be in the initial bundle but can be loaded on demand.

---

## Risks and Mitigations

### R1: Streamdown's internal rendering of the SVG

**Risk:** Streamdown may expect specific SVG structure from the mermaid render output (e.g., sanitization, wrapping in a container, specific attributes).

**Mitigation:** Test the plugin with various diagram types and inspect how Streamdown handles the returned `{ svg }` object. beautiful-mermaid produces self-contained SVGs with inline styles, which should be compatible. If Streamdown strips styles or attributes via `rehype-sanitize`, we may need to configure the sanitization schema.

### R2: SVG size differences

**Risk:** beautiful-mermaid's SVGs may have different dimensions/aspect ratios than mermaid's output, causing layout shifts.

**Mitigation:** beautiful-mermaid's SVGs include explicit `width`/`height` attributes and a `viewBox`, so they should size correctly. Add `max-width: 100%` to the container CSS to prevent overflow.

### R3: Rendering performance during streaming

**Risk:** `renderMermaid()` is async and involves layout computation (dagre). If a mermaid block is being streamed character by character, every partial update triggers a re-render attempt.

**Mitigation:** Streamdown already handles this — mermaid code blocks are only rendered once the closing fence (` ``` `) is detected. During streaming, the block shows as a code block with syntax highlighting. No change needed here.

### R4: Font loading

**Risk:** beautiful-mermaid's SVGs include `@import url()` for Google Fonts (Inter, JetBrains Mono). In an Electron app, this requires network access.

**Mitigation:** Codedeck already uses Inter as its UI font (bundled or loaded). The SVG font import will either hit the browser cache or fall back to `system-ui, sans-serif`. For offline scenarios, we can pass `font: "system-ui"` to skip the Google Fonts import.

### R5: Library maturity

**Risk:** `beautiful-mermaid@0.1.3` is a young library (10 commits, released Jan 2026). It may have parsing edge cases.

**Mitigation:** The library is MIT-licensed, built by Craft.do (a well-known productivity app), and already has 6.8k GitHub stars. Test extensively with Claude-generated mermaid diagrams before shipping. Keep the fallback mechanism (Phase 5) as a safety net.

---

## Bundle Size Impact (Estimated)

| Package | Current | After |
|---------|---------|-------|
| `mermaid` | ~2.5MB minified (incl. D3, dagre, DOMPurify) | Removed |
| `@streamdown/mermaid` | ~2KB | Removed |
| `beautiful-mermaid` | — | ~50-80KB minified (+ `@dagrejs/dagre` ~30KB) |
| **Net change** | — | **~2.4MB reduction** |

This is a significant win for initial load time, especially in the Electron renderer where all JS is loaded from disk.

---

## Implementation Roadmap

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|--------------|
| 1 | Core plugin adapter | 1-2h | None |
| 2 | Wire into Streamdown components | 30min | Phase 1 |
| 3 | Theme-aware colors | 1-2h | Phase 2 |
| 4 | Dependency cleanup | 15min | Phase 2 |
| 5 | Fallback for unsupported diagrams | 1-2h | Phase 1 |

**Total estimated effort:** 4-7 hours

Phases 1-2 are the minimum viable change. Phase 3-5 can be done incrementally.

---

## Testing Checklist

- [ ] Flowchart (`graph TD`, `graph LR`, `flowchart TB`)
- [ ] State diagram (`stateDiagram-v2`)
- [ ] Sequence diagram (`sequenceDiagram`)
- [ ] Class diagram (`classDiagram`)
- [ ] ER diagram (`erDiagram`)
- [ ] Light theme rendering
- [ ] Dark theme rendering
- [ ] Theme toggle while diagram is visible
- [ ] Streaming — diagram renders only after code fence closes
- [ ] Long/complex diagrams (20+ nodes)
- [ ] Unsupported diagram type fallback (e.g., `pie`, `gantt`)
- [ ] Diagram inside reasoning/thinking block
- [ ] Multiple diagrams in single response
- [ ] Error handling — malformed mermaid syntax
- [ ] Electron offline mode (font fallback)
- [ ] Bundle size verification (`bun run package` and compare output sizes)

---

## References

- [beautiful-mermaid GitHub](https://github.com/lukilabs/beautiful-mermaid)
- [beautiful-mermaid Live Demo](https://agents.craft.do/mermaid)
- [Streamdown (Vercel)](https://github.com/vercel/streamdown)
- [@streamdown/mermaid source](https://github.com/vercel/streamdown/tree/main/packages/streamdown-mermaid)
- `packages/ui/src/components/ai-elements/message.tsx` — MessageResponse component
- `packages/ui/src/components/ai-elements/reasoning.tsx` — ReasoningContent component
- `packages/ui/src/components/ai-elements/code-block.tsx` — Shiki theme reference (github-light/github-dark)
