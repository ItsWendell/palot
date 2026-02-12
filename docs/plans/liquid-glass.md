# Liquid Glass — macOS Tahoe Transparency System

> Three-tier progressive transparency for Palot: native liquid glass on macOS 26+, vibrancy fallback on older macOS, opaque everywhere else. Zero visual regressions on non-macOS platforms.

## Design Principles

1. **Theme-layer only** — all glass effects live in `globals.css` via CSS variables and `data-slot` selectors. No shadcn component source modifications for glass styling.
2. **Backwards compatible** — Windows, Linux, and browser-mode are completely unaffected. The `electron-transparent` class is never added outside Electron on macOS.
3. **Opt-out** — users can toggle "opaque windows" to disable all transparency.
4. **Progressive** — three tiers degrade gracefully based on OS capabilities.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                        │
│                                                                 │
│  liquid-glass.ts                                                │
│  ├─ isLiquidGlassSupported()   macOS 26+ check via native mod  │
│  ├─ resolveWindowChrome()      → BrowserWindow options          │
│  └─ installLiquidGlass()       → native NSGlassEffectView      │
│                                                                 │
│  Tier resolution:                                               │
│    macOS 26+ ───→ transparent:true + native glass   (tier 1)   │
│    macOS <26  ───→ vibrancy:"menu"                  (tier 2)   │
│    non-macOS  ───→ opaque (no changes)              (tier 3)   │
│    user pref  ───→ opaque override                  (tier 3)   │
│                                                                 │
│         ┌── IPC: "chrome-tier" ──┐                              │
│         ▼                        │                              │
│  Preload Bridge                  │                              │
│  └─ onChromeTier(cb)             │                              │
│                                  │                              │
│  Renderer (React)                │                              │
│  ├─ useChromeTier() hook         │                              │
│  │   sets <html> class:          │                              │
│  │   • electron-transparent      │                              │
│  │   • electron-vibrancy         │                              │
│  │   • electron-opaque           │                              │
│  │                               │                              │
│  └─ globals.css                  │                              │
│      ├─ :root.electron-transparent [data-slot="..."]            │
│      │   → semi-transparent bg + backdrop-blur                  │
│      ├─ :root.electron-vibrancy [data-slot="..."]               │
│      │   → semi-transparent bg only (native blur handles it)    │
│      └─ :root.electron-opaque / :root:not(.electron-transparent)│
│          → solid fallback (identical to current look)           │
└─────────────────────────────────────────────────────────────────┘
```

## Current State (Already Implemented)

These files already exist in the working tree (uncommitted):

| Component | File | Status |
|---|---|---|
| Native glass module | `apps/desktop/src/main/liquid-glass.ts` | Done |
| Preload bridge | `apps/desktop/src/preload/index.ts` | Done — `onChromeTier()` |
| Type definitions | `apps/desktop/src/preload/api.d.ts` | Done — `WindowChromeTier` |
| Renderer hook | `apps/desktop/src/renderer/hooks/use-chrome-tier.ts` | Done |
| Preference atoms | `apps/desktop/src/renderer/atoms/preferences.ts` | Done — `opaqueWindowsAtom`, `chromeTierAtom`, `isTransparentAtom` |
| Root layout integration | `apps/desktop/src/renderer/components/root-layout.tsx` | Done |
| BrowserWindow integration | `apps/desktop/src/main/index.ts` | Done |
| electron-builder config | `apps/desktop/electron-builder.yml` | Done |
| Base CSS utilities | `packages/ui/src/styles/globals.css` | Partial — needs revision |

### What Needs Revision in Existing Work

The current CSS approach uses **component utility classes** (`glass-sidebar`, `glass-popover`, etc.) that must be manually added to each component. This plan replaces that pattern with **`data-slot` CSS selectors** that target components from the theme layer without any component source changes.

The existing changes to `command.tsx` and `dialog.tsx` should be **reverted** — the glass styling will be applied through `globals.css` instead.

---

## The `data-slot` Strategy

Every shadcn/ui component in our library renders a `data-slot="component-name"` attribute. This is the standard shadcn v2 pattern. We can target these from `globals.css` to apply glass effects without touching any component `.tsx` files.

### Why This Matters

- **Zero shadcn source changes for glass** — components stay stock, easy to update via `shadcn add`
- **Single source of truth** — all glass behavior in one CSS file section
- **Trivial to disable** — remove the CSS block and glass is gone
- **Scoped to transparent mode** — selectors are gated behind `:root.electron-transparent`

### Component Inventory — `data-slot` Mapping

| Component | `data-slot` value | Current BG class | Glass treatment |
|---|---|---|---|
| Dropdown menu | `dropdown-menu-content` | `bg-popover` | Semi-transparent + blur |
| Dropdown sub-menu | `dropdown-menu-sub-content` | `bg-popover` | Semi-transparent + blur |
| Popover | `popover-content` | `bg-popover` | Semi-transparent + blur |
| Context menu | `context-menu-content` | `bg-popover` | Semi-transparent + blur |
| Context sub-menu | `context-menu-sub-content` | `bg-popover` | Semi-transparent + blur |
| Select | `select-content` | `bg-popover` | Semi-transparent + blur |
| Command | `command` | `bg-popover` | Semi-transparent + blur |
| Dialog content | `dialog-content` | `bg-background` | Semi-transparent + blur |
| Dialog overlay | `dialog-overlay` | `bg-black/50` | No change (already semi-transparent) |
| Sheet content | `sheet-content` | `bg-background` | Semi-transparent + blur |
| Card | `card` | `bg-card` | Subtle transparency (high opacity) |
| Tooltip | `tooltip-content` | `bg-foreground` | Skip — inverted scheme, not suitable for glass |
| Sidebar | `sidebar` | `bg-sidebar` | Semi-transparent + blur |
| Tabs list | `tabs-list` | `bg-muted` | Subtle transparency |
| Input | `input` | `bg-transparent` | Already transparent — inherits parent |
| Textarea | `textarea` | `bg-transparent` | Already transparent — inherits parent |

### Components That Need NO Changes At All

- **Input / Textarea** — already use `bg-transparent` (light) and `dark:bg-input/30` (dark). They naturally inherit glass from their parent container.
- **Tooltip** — uses `bg-foreground` (inverted color scheme). Making `--foreground` semi-transparent would break all text in the app. Leave tooltips opaque. This is fine — macOS system tooltips are also opaque.
- **Skeleton** — purely decorative, no glass needed.
- **Table** — data-dense, readability trumps glass effect.

---

## Phase 1: Foundation Hardening

### 1.1 Wire Up Opaque Preference IPC

**Problem:** The main process currently hardcodes `isOpaque = false`. The renderer has the preference in localStorage but the main process can't read it at window creation time (before the renderer loads).

**Solution:**

```
apps/desktop/src/main/ipc-handlers.ts     — add get/set handlers
apps/desktop/src/main/index.ts             — read preference before createWindow()
apps/desktop/src/preload/index.ts          — expose get/set methods
apps/desktop/src/preload/api.d.ts          — type definitions
```

Use `electron-store` or a simple JSON file in `app.getPath('userData')` to persist the preference in the main process. The renderer writes to both localStorage (for its own reads) and IPC (for main process persistence).

### 1.2 Restart Prompt on Toggle

`BrowserWindow.transparent` is a creation-time option — it cannot be changed at runtime. When the user toggles transparency in the command palette:

1. Persist the new value via IPC to main process storage
2. Show a dialog: "Transparency changes take effect after restart. Restart now?"
3. If confirmed, call `app.relaunch()` + `app.exit(0)`

### 1.3 Add `electron-vibrancy` CSS Class

The current implementation only toggles `electron-transparent` / `electron-opaque`. Tier 2 (vibrancy) needs its own class so we can skip CSS-level `backdrop-filter` when native vibrancy already provides blur.

Update `useChromeTier()`:

```typescript
// Sync CSS classes on <html>
useEffect(() => {
  const root = document.documentElement
  root.classList.remove("electron-transparent", "electron-vibrancy", "electron-opaque")

  if (!isElectron()) return // browser mode — no class at all

  const tier = chromeTier
  if (tier === "liquid-glass" && !isOpaque) {
    root.classList.add("electron-transparent")
  } else if (tier === "vibrancy" && !isOpaque) {
    root.classList.add("electron-vibrancy")
  } else {
    root.classList.add("electron-opaque")
  }
}, [chromeTier, isOpaque])
```

### 1.4 Validate Native Module Packaging

- Confirm `electron-liquid-glass` prebuilt binaries match Electron 40 (arm64 + x64)
- Test: `CSC_IDENTITY_AUTO_DISCOVERY=false bun run package:mac`
- Add to `asarUnpack` in `electron-builder.yml` if the `.node` binary needs to be outside the asar
- Consider moving to `optionalDependencies` if it causes `bun install` failures on Linux/Windows CI
- Add `electron-rebuild` as a postinstall or afterPack hook if prebuilds don't match

### 1.5 Revert Existing shadcn Component Changes

The existing diffs to `command.tsx` and `dialog.tsx` that add `glass-popover`, `backdrop-blur-md`, opacity changes, and animation timing should be reverted. These will be handled entirely through `globals.css` `data-slot` rules instead.

**Exception:** The `scrollbar-none overscroll-contain` change on `CommandList` is a UX improvement unrelated to glass — keep that.

---

## Phase 2: Glass Design Token System

### 2.1 Glass Opacity Custom Properties

Add to `globals.css` in `@layer base` under `:root`:

```css
:root {
  /* Glass opacity scale — percentage values for color-mix().
   * Themes can override these to tune glass intensity. */
  --glass-body: 50%;        /* Window body background */
  --glass-sidebar: 70%;     /* Sidebar panel */
  --glass-surface: 80%;     /* App bar, main surface dividers */
  --glass-elevated: 85%;    /* Popovers, dropdowns, command palette */
  --glass-card: 92%;        /* Cards, inline panels — high opacity for readability */

  /* Blur scale — reusable backdrop-filter values */
  --blur-sm: 8px;
  --blur-md: 12px;
  --blur-lg: 16px;
  --blur-xl: 24px;
}
```

These are the **only** new custom properties needed. Themes override them to tune glass intensity per-theme (e.g. a theme that prefers more transparency sets `--glass-body: 40%`).

### 2.2 Superellipse Corner Radius (Tahoe Visual Language)

macOS 26 uses superellipse (squircle) corners instead of circular `border-radius`. This is purely additive — browsers that don't support `corner-shape` ignore it.

```css
@supports (corner-shape: superellipse(1.5)) {
  :root {
    --corner-radius-scale: 1.25;
    --radius: calc(0.625rem * var(--corner-radius-scale));
  }

  /* Apply superellipse to common rounded utilities */
  .rounded-md, .rounded-lg, .rounded-xl,
  .rounded-2xl, .rounded-3xl {
    corner-shape: superellipse(1.5);
  }

  /* Also target shadcn components that use rounded corners */
  [data-slot="dialog-content"],
  [data-slot="popover-content"],
  [data-slot="dropdown-menu-content"],
  [data-slot="context-menu-content"],
  [data-slot="select-content"],
  [data-slot="command"],
  [data-slot="card"],
  [data-slot="tooltip-content"],
  [data-slot="sheet-content"] {
    corner-shape: superellipse(1.5);
  }
}
```

---

## Phase 3: `data-slot` Glass Rules in `globals.css`

This is the core of the approach. All glass effects are applied through CSS selectors targeting `data-slot` attributes, gated behind the `:root.electron-transparent` or `:root.electron-vibrancy` class.

### 3.1 Tier 1: Liquid Glass (`.electron-transparent`)

Native glass provides the blur behind the window. CSS adds semi-transparent backgrounds so the glass bleeds through, plus `backdrop-filter` for in-app layered panels (popovers on top of content).

```css
/* ============================================================
 * Tier 1: Liquid Glass — macOS 26+ (Tahoe)
 *
 * The native NSGlassEffectView provides system-level blur behind
 * the entire window. We make surfaces semi-transparent so the
 * glass effect is visible. Floating panels (popovers, dialogs)
 * add CSS backdrop-blur for layered glass-on-glass depth.
 * ============================================================ */

@layer components {

  /* --- Body --- */
  :root.electron-transparent body {
    background: color-mix(in srgb, var(--background) var(--glass-body), transparent);
  }

  /* --- Sidebar --- */
  :root.electron-transparent [data-slot="sidebar"] {
    background: color-mix(in srgb, var(--sidebar) var(--glass-sidebar), transparent);
  }

  /* --- Floating panels (popovers, dropdowns, selects, context menus) ---
   * These float above page content, so they need their own backdrop-blur
   * to create the layered glass effect. */
  :root.electron-transparent [data-slot="dropdown-menu-content"],
  :root.electron-transparent [data-slot="dropdown-menu-sub-content"],
  :root.electron-transparent [data-slot="popover-content"],
  :root.electron-transparent [data-slot="context-menu-content"],
  :root.electron-transparent [data-slot="context-menu-sub-content"],
  :root.electron-transparent [data-slot="select-content"] {
    background: color-mix(in srgb, var(--popover) var(--glass-elevated), transparent);
    -webkit-backdrop-filter: blur(var(--blur-lg));
    backdrop-filter: blur(var(--blur-lg));
  }

  /* --- Command palette --- */
  :root.electron-transparent [data-slot="command"] {
    background: color-mix(in srgb, var(--popover) var(--glass-elevated), transparent);
    -webkit-backdrop-filter: blur(var(--blur-xl));
    backdrop-filter: blur(var(--blur-xl));
  }

  /* --- Dialogs --- */
  :root.electron-transparent [data-slot="dialog-content"] {
    background: color-mix(in srgb, var(--background) var(--glass-elevated), transparent);
    -webkit-backdrop-filter: blur(var(--blur-xl));
    backdrop-filter: blur(var(--blur-xl));
  }

  /* --- Sheet (slide-over panel) --- */
  :root.electron-transparent [data-slot="sheet-content"] {
    background: color-mix(in srgb, var(--background) var(--glass-elevated), transparent);
    -webkit-backdrop-filter: blur(var(--blur-xl));
    backdrop-filter: blur(var(--blur-xl));
  }

  /* --- Cards --- subtle transparency, high opacity for readability */
  :root.electron-transparent [data-slot="card"] {
    background: color-mix(in srgb, var(--card) var(--glass-card), transparent);
  }

  /* --- Tabs list --- */
  :root.electron-transparent [data-slot="tabs-list"] {
    background: color-mix(in srgb, var(--muted) var(--glass-card), transparent);
  }
}
```

### 3.2 Tier 2: Vibrancy (`.electron-vibrancy`)

Native `NSVisualEffectView` handles the blur. We only make backgrounds semi-transparent — **no CSS `backdrop-filter`** needed (it would double-blur and look wrong).

```css
/* ============================================================
 * Tier 2: Vibrancy — older macOS (pre-Tahoe)
 *
 * Electron's built-in vibrancy:"menu" provides native blur.
 * We only make backgrounds semi-transparent. No CSS backdrop-filter
 * — the native layer already handles blur.
 * ============================================================ */

@layer components {

  :root.electron-vibrancy body {
    background: color-mix(in srgb, var(--background) var(--glass-body), transparent);
  }

  :root.electron-vibrancy [data-slot="sidebar"] {
    background: color-mix(in srgb, var(--sidebar) var(--glass-sidebar), transparent);
  }

  :root.electron-vibrancy [data-slot="dropdown-menu-content"],
  :root.electron-vibrancy [data-slot="dropdown-menu-sub-content"],
  :root.electron-vibrancy [data-slot="popover-content"],
  :root.electron-vibrancy [data-slot="context-menu-content"],
  :root.electron-vibrancy [data-slot="context-menu-sub-content"],
  :root.electron-vibrancy [data-slot="select-content"],
  :root.electron-vibrancy [data-slot="command"],
  :root.electron-vibrancy [data-slot="dialog-content"],
  :root.electron-vibrancy [data-slot="sheet-content"] {
    background: color-mix(in srgb, var(--popover) var(--glass-elevated), transparent);
  }

  :root.electron-vibrancy [data-slot="card"] {
    background: color-mix(in srgb, var(--card) var(--glass-card), transparent);
  }

  :root.electron-vibrancy [data-slot="tabs-list"] {
    background: color-mix(in srgb, var(--muted) var(--glass-card), transparent);
  }
}
```

### 3.3 Tier 3: Opaque (default / fallback)

No CSS changes at all — components use their stock `bg-popover`, `bg-card`, `bg-background` Tailwind classes which resolve to solid CSS variables. The `:root.electron-opaque` class and `:root:not(.electron-transparent):not(.electron-vibrancy)` case produce the same look as today.

### 3.4 Desktop-App-Specific Surface Overrides

The sidebar and app-bar in the desktop renderer (`apps/desktop/src/renderer/components/`) currently use custom background classes. These should be simplified to rely on the `data-slot` rules:

- **`sidebar.tsx`** — ensure the wrapping element has `data-slot="sidebar"` (the shadcn sidebar component already provides this). Remove any hardcoded `glass-sidebar` class.
- **`app-bar.tsx`** — this is a custom component without a `data-slot`. Add a `data-slot="app-bar"` attribute and target it in CSS:

```css
:root.electron-transparent [data-slot="app-bar"] {
  background: color-mix(in srgb, var(--sidebar) var(--glass-surface), transparent);
  -webkit-backdrop-filter: blur(var(--blur-md));
  backdrop-filter: blur(var(--blur-md));
}
:root.electron-vibrancy [data-slot="app-bar"] {
  background: color-mix(in srgb, var(--sidebar) var(--glass-surface), transparent);
}
```

- **`prompt-toolbar.tsx`** — the sticky input area at the bottom of the chat. Add `data-slot="prompt-toolbar"`:

```css
:root.electron-transparent [data-slot="prompt-toolbar"] {
  background: color-mix(in srgb, var(--background) var(--glass-surface), transparent);
  -webkit-backdrop-filter: blur(var(--blur-md));
  backdrop-filter: blur(var(--blur-md));
}
```

These are **not** shadcn components — they're our own. Adding `data-slot` attributes to our own components is fine and keeps the pattern consistent.

---

## Phase 4: Theme System Integration

### 4.1 Extend `ThemeDefinition`

Add glass-specific overrides to `apps/desktop/src/renderer/lib/themes.ts`:

```typescript
export interface ThemeDefinition {
  // ... existing fields ...

  /** Glass transparency tuning. Only applies when window has native transparency. */
  glass?: {
    /** Override --glass-body (0-100). Default: 50 */
    bodyOpacity?: number
    /** Override --glass-sidebar (0-100). Default: 70 */
    sidebarOpacity?: number
    /** Override --glass-surface (0-100). Default: 80 */
    surfaceOpacity?: number
    /** Override --glass-elevated (0-100). Default: 85 */
    elevatedOpacity?: number
    /** Override --glass-card (0-100). Default: 92 */
    cardOpacity?: number
    /** Blur multiplier (1.0 = default, 0.5 = half blur, 2.0 = double). Default: 1.0 */
    blurScale?: number
    /** Disable glass for this theme entirely. Default: false */
    disabled?: boolean
  }
}
```

### 4.2 Apply Glass Vars in `useThemeEffect()`

In `apps/desktop/src/renderer/hooks/use-theme.ts`, when building the injected `<style>` block:

```typescript
// Inside useThemeEffect(), when constructing CSS variable overrides:
if (theme.glass && !theme.glass.disabled) {
  const g = theme.glass
  if (g.bodyOpacity !== undefined) vars.push(`--glass-body: ${g.bodyOpacity}%`)
  if (g.sidebarOpacity !== undefined) vars.push(`--glass-sidebar: ${g.sidebarOpacity}%`)
  if (g.surfaceOpacity !== undefined) vars.push(`--glass-surface: ${g.surfaceOpacity}%`)
  if (g.elevatedOpacity !== undefined) vars.push(`--glass-elevated: ${g.elevatedOpacity}%`)
  if (g.cardOpacity !== undefined) vars.push(`--glass-card: ${g.cardOpacity}%`)
  if (g.blurScale !== undefined) {
    const s = g.blurScale
    vars.push(`--blur-sm: ${8 * s}px`)
    vars.push(`--blur-md: ${12 * s}px`)
    vars.push(`--blur-lg: ${16 * s}px`)
    vars.push(`--blur-xl: ${24 * s}px`)
  }
}
```

### 4.3 Per-Theme Glass Tuning

| Theme | Glass Config | Rationale |
|---|---|---|
| **OpenCode** (default) | `{ bodyOpacity: 50, sidebarOpacity: 70 }` | Warm smoke grays complement frosted glass well |
| **Codex** | `{ bodyOpacity: 50, elevatedOpacity: 90, blurScale: 1.2 }` | Cool neutrals, slightly stronger blur to match OpenAI feel |
| Future "Minimal" | `{ disabled: true }` | Clean opaque look regardless of OS |

### 4.4 Glass-Disabled Theme Behavior

When `theme.glass.disabled === true`, the hook should add `electron-opaque` class even if the window has native transparency. This forces solid backgrounds regardless of platform tier.

---

## Phase 5: User Preferences

### 5.1 Command Palette Commands

| Command | Group | Action |
|---|---|---|
| "Enable window transparency" | Appearance | Set `opaqueWindows = false`, persist via IPC, prompt restart |
| "Disable window transparency" | Appearance | Set `opaqueWindows = true`, persist via IPC, prompt restart |

### 5.2 Future Settings Panel

When a settings UI is built:

- **Toggle:** "Transparent windows" — with description "Use translucent backgrounds with system glass effects (macOS only)"
- **Info line:** Show active tier: "Liquid Glass (macOS 26+)" / "Vibrancy" / "Opaque"
- **Note:** "Changes require app restart"

---

## Phase 6: Performance & Edge Cases

### 6.1 GPU Compositing Budget

Each CSS `backdrop-filter: blur()` triggers a GPU compositing layer. Guidelines:

- **Max 3-4 simultaneous blur layers** — sidebar + app bar + 1-2 floating panels is fine
- **No nested blur** — child elements inside a glass panel must NOT also have `backdrop-filter`. The `data-slot` approach naturally avoids this since selectors target specific components
- **Cards get NO blur** — only `color-mix` transparency at 92% opacity. Cards are often rendered in lists (many instances) and adding blur to each would be expensive

### 6.2 Vibrancy-Specific Behavior

- Tier 2 CSS rules intentionally omit `backdrop-filter` — native `NSVisualEffectView` provides window-level blur. Adding CSS blur would double-blur
- `visualEffectState: "active"` keeps the effect when the window loses focus

### 6.3 Content Readability

- All text containers (chat messages, code blocks, diffs) sit on surfaces with ≥85% opacity
- Dark mode is more forgiving (dark glass + dark surfaces = good contrast)
- Light mode needs careful QA — bright desktop wallpapers can wash out text through low-opacity surfaces
- Cards and data-dense areas use 92% opacity minimum

### 6.4 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  /* Disable animated glass transitions */
  [data-slot] {
    transition: none !important;
  }
}
```

### 6.5 Window Lifecycle

- **`transparent: true` is creation-time only** — cannot be toggled at runtime, hence the restart requirement
- **Multiple windows** — if Palot ever supports secondary/HUD windows, each gets its own `resolveWindowChrome()` call. The `appearance` parameter ("primary" / "secondary" / "hud") maps to different chrome configs (following the Codex pattern)
- **HMR (dev)** — Vite HMR loses Jotai state, but the chrome tier IPC re-fires on reconnect
- **Browser mode** — no Electron, no `electron-*` class, all glass CSS is inert

---

## Phase 7: Titlebar Tint (Future)

Codex supports per-conversation accent color tinting on the titlebar. This is optional but the CSS hook is trivial to prepare:

```css
[data-slot="app-bar"] {
  background-color: var(--palot-titlebar-tint, transparent);
}
```

Applied via:
```typescript
document.documentElement.style.setProperty('--palot-titlebar-tint', color)
```

This can be wired to agent/project accent colors later without any additional component changes.

---

## Changes Summary

### Files to Modify

| File | Changes | Touches shadcn? |
|---|---|---|
| `packages/ui/src/styles/globals.css` | Replace glass utility classes with `data-slot` rules, add glass opacity vars, add superellipse support, add tier 1 + tier 2 rule blocks | **No** — CSS only |
| `apps/desktop/src/renderer/hooks/use-chrome-tier.ts` | Add `electron-vibrancy` class, refine class toggling | No |
| `apps/desktop/src/renderer/hooks/use-theme.ts` | Inject glass CSS vars from theme definition | No |
| `apps/desktop/src/renderer/lib/themes.ts` | Add `glass` field to `ThemeDefinition`, configure per-theme | No |
| `apps/desktop/src/main/ipc-handlers.ts` | Add `get-opaque-windows` / `set-opaque-windows` handlers | No |
| `apps/desktop/src/main/index.ts` | Read opaque preference before `createWindow()` | No |
| `apps/desktop/src/preload/index.ts` | Expose opaque preference IPC methods | No |
| `apps/desktop/src/preload/api.d.ts` | Type definitions for new IPC methods | No |
| `apps/desktop/src/renderer/components/command-palette.tsx` | Restart prompt on transparency toggle | No |
| `apps/desktop/src/renderer/components/app-bar.tsx` | Add `data-slot="app-bar"`, remove hardcoded glass classes | No |
| `apps/desktop/src/renderer/components/sidebar.tsx` | Remove hardcoded `glass-sidebar` class (data-slot handles it) | No |
| `apps/desktop/src/renderer/components/chat/prompt-toolbar.tsx` | Add `data-slot="prompt-toolbar"` | No |

### Files to Revert (undo existing glass-related changes)

| File | What to Revert |
|---|---|
| `packages/ui/src/components/command.tsx` | Remove `backdrop-blur-md`, `glass-popover`, opacity changes. Keep `scrollbar-none overscroll-contain`. |
| `packages/ui/src/components/dialog.tsx` | Remove animation timing changes (those can go back via globals.css if desired) |

### Files with No Changes Needed

All other shadcn components (`dropdown-menu.tsx`, `popover.tsx`, `context-menu.tsx`, `tooltip.tsx`, `card.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `sheet.tsx`, `tabs.tsx`, etc.) — **zero changes**. Glass is applied entirely through CSS.

---

## Implementation Priority

| # | Task | Effort | Priority | Dependencies |
|---|---|---|---|---|
| 1 | Revert shadcn component glass changes | Small | P0 | — |
| 2 | Refine `useChromeTier()` — add `electron-vibrancy` class | Small | P0 | — |
| 3 | Replace globals.css glass section with `data-slot` rules (Phase 3) | Medium | P0 | #1 |
| 4 | Add glass opacity custom properties (Phase 2.1) | Small | P0 | — |
| 5 | Add `data-slot` to custom components (app-bar, prompt-toolbar) | Small | P0 | #3 |
| 6 | Wire up opaque preference IPC (Phase 1.1) | Medium | P1 | — |
| 7 | Restart prompt on toggle (Phase 1.2) | Small | P1 | #6 |
| 8 | Extend `ThemeDefinition` with glass config (Phase 4) | Small | P1 | #4 |
| 9 | Apply glass vars in `useThemeEffect()` (Phase 4.2) | Small | P1 | #8 |
| 10 | Superellipse corner radius support (Phase 2.2) | Small | P2 | — |
| 11 | Validate native module packaging (Phase 1.4) | Medium | P2 | — |
| 12 | Titlebar tint infrastructure (Phase 7) | Small | P3 | — |
| 13 | WCAG contrast audit for glass surfaces | Medium | P3 | #3 |

---

## Comparison with Codex Implementation

| Aspect | Codex | Palot |
|---|---|---|
| Glass CSS strategy | Inline classes on components | `data-slot` selectors from globals.css |
| shadcn modifications | N/A (not shadcn-based) | **Zero** |
| Theme system | VSCode-style `--vscode-*` tokens | shadcn CSS vars + Tailwind v4 `@theme` |
| Per-theme glass tuning | Not configurable | `ThemeDefinition.glass` overrides |
| State management | Custom global state store | Jotai atoms with localStorage |
| Tier distinction | `electron-transparent` / `electron-opaque` | Three classes: `electron-transparent` / `electron-vibrancy` / `electron-opaque` |
| Vibrancy CSS blur | Same as liquid glass (redundant blur) | Separate tier — no CSS blur (native handles it) |
| Superellipse corners | Implemented inline | Feature-detected via `@supports` |
| Dark mode class | `electron-dark` / `electron-light` | `.dark` (shadcn convention, already established) |
| Multiple window types | `primary` / `secondary` / `hud` | Single `primary` for now, extensible later |

---

## Testing Matrix

| Platform | Tier | Expected Behavior |
|---|---|---|
| macOS 26+ (Tahoe), Electron | 1 | Native glass, semi-transparent surfaces, CSS blur on floating panels |
| macOS 15 (Sequoia), Electron | 2 | Native vibrancy blur, semi-transparent surfaces, no CSS blur |
| macOS any, opaque pref on | 3 | Solid backgrounds, identical to current look |
| Windows 11, Electron | 3 | Opaque, standard title bar, no changes |
| Linux (X11/Wayland), Electron | 3 | Opaque, standard title bar, no changes |
| Browser mode (any OS) | 3 | Opaque, no `electron-*` class, glass CSS inert |

### Visual QA Checklist

- [ ] Traffic lights visible and correctly positioned on all macOS tiers
- [ ] Desktop wallpaper visible through sidebar (Tier 1)
- [ ] Command palette shows glass blur over content
- [ ] Dropdown menus show glass blur
- [ ] No readability issues in light mode with bright wallpapers
- [ ] Opaque toggle works and prompts restart
- [ ] Theme switching preserves correct glass treatment
- [ ] Dark ↔ light mode transitions don't flash
- [ ] No blur stacking artifacts (nested panels)
- [ ] Cards remain highly readable (92% opacity)
- [ ] Windows/Linux render identically to current build
- [ ] Browser dev mode renders identically to current build
- [ ] `prefers-reduced-motion` disables glass transitions
