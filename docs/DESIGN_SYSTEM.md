# Design System

This document describes the visual design system, component conventions, and Tailwind CSS patterns used in Nexus Builder. It is intended as a reference for contributors and AI models extending the UI.

---

## Foundations

### Color System

The app uses Tailwind CSS v4 with CSS custom property tokens. All colors are semantic — use token names, not raw hex values.

**Background layers** (dark to light, roughly):

| Token | Usage |
|-------|-------|
| `bg-background` | Root page background |
| `bg-card` | Card and panel surfaces |
| `bg-muted` | Subtle fills, hover states, inactive tabs |
| `bg-muted/50` | Dimmed fills (50% opacity variant) |
| `bg-popover` | Dropdowns, popovers, tooltips |

**Foreground (text):**

| Token | Usage |
|-------|-------|
| `text-foreground` | Primary body text |
| `text-foreground/85` | Slightly dimmed labels |
| `text-muted-foreground` | Secondary/helper text |
| `text-muted-foreground/65` | Tertiary text, hints |
| `text-muted-foreground/45` | Timestamps, micro-metadata |

**Status colors:**

| Token | Usage |
|-------|-------|
| `text-emerald-400` / `bg-emerald-400` | Running, active, success |
| `text-amber-400` / `bg-amber-400` | Waiting, stalled, warning |
| `text-red-400` / `bg-red-400` | Failed, error, critical |
| `text-muted-foreground/50` | Idle, completed, neutral |

**Border:**

| Token | Usage |
|-------|-------|
| `border-border` | Default border |
| `border-border/40` | Subtle/hover border |
| `border-border/30` | Very subtle structural border |
| `border-transparent` | Default no-border state that shows border on hover |

**Accent:**

| Token | Usage |
|-------|-------|
| `text-primary` / `bg-primary` | Primary actions, active states |
| `text-primary-foreground` | Text on primary backgrounds |

### Typography

- **Body**: `text-sm` (0.875rem) for most content
- **Labels and meta**: `text-xs` (0.75rem) for sidebar rows, session metadata
- **Micro-meta**: `text-[11px]` to `text-[10px]` for timestamps, token counts
- **Headings**: `text-xl font-semibold` for settings section headers, `text-base font-medium` for panel headers
- **Code/mono**: `font-mono text-xs` or `font-mono text-sm` for paths, identifiers, skill content
- **Tabular numbers**: `tabular-nums` on any numeric column (token counts, costs, durations)
- **Tracking**: `tracking-wide uppercase` for small badge labels and section headers

Font family defaults to Geist (loaded via `@fontsource/geist-mono` for mono contexts). The CSS variable `--font-sans` points to the system UI font stack.

### Spacing and Sizing

- Use Tailwind spacing utilities (`px-2`, `py-1.5`, `gap-2`, etc.)
- Prefer `space-y-*` over manual margin chains for vertical stacks
- Icon sizes: `size-3` (micro), `size-3.5` (small), `size-4` (standard), `size-5` (medium)
- Avoid fixed pixel widths on interactive elements; use `min-w-0 flex-1 truncate` for text that must truncate

### Border Radius

- `rounded-md` -- cards, inputs, popovers, buttons
- `rounded-full` -- badges, status dots, progress bars
- `rounded-sm` -- tight chip elements
- Do not mix `rounded-lg` or `rounded-xl` with existing UI — the design intentionally avoids large radii

---

## Component Patterns

### Sidebar Rows

Every sidebar list item follows this pattern:

```tsx
<div className="group/agent w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/40 hover:bg-muted/45">
  <div className="flex items-center gap-2">
    <span className="size-1.5 rounded-full bg-emerald-400" />      {/* status dot */}
    <Icon className="size-3 shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">
      Label
    </span>
    <Badge />
  </div>
  <div className="truncate pl-5 text-[11px] leading-tight text-muted-foreground/65">
    Secondary line
  </div>
</div>
```

Rules:
- `pl-5` aligns secondary content under the icon column
- `min-w-0 flex-1 truncate` on the label prevents overflow
- `border-transparent` + `hover:border-border/40` creates a subtle interactive border on hover
- Group hover variants (`group/agent`) allow child elements to respond to parent hover

### Badges

Status badges in the sidebar use a consistent chip pattern:

```tsx
<span className={cn(
  "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none tracking-wide",
  getAgentStatusBadgeClass(status),
)}>
  {status === "running" && (
    <span className="mr-1 inline-block size-1.5 rounded-full bg-current align-middle animate-pulse" />
  )}
  LABEL
</span>
```

The pulse dot only appears on running/active states. Completed and idle states show no dot.

### Section Headers

```tsx
<SidebarGroupLabel className="flex items-center justify-between px-2 py-1">
  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
    Section Title
  </span>
  <ActionButton />
</SidebarGroupLabel>
```

### Status Banners

Inline warning/error banners use a bordered box with color-coded text:

```tsx
<div className="ml-5 rounded-md border px-2 py-1 text-[10px] border-amber-400/30 bg-amber-400/10 text-amber-200">
  <div className="flex items-center justify-between gap-2">
    <span className="font-semibold uppercase tracking-wide">STALLED</span>
    <span className="tabular-nums">5m idle</span>
  </div>
</div>
```

Color variants:
- Warning (amber): `border-amber-400/30 bg-amber-400/10 text-amber-200`
- Error (red): `border-red-400/30 bg-red-400/10 text-red-200`
- Info (muted): `border-border/40 bg-muted/30 text-muted-foreground`

### Progress Bars

```tsx
<div className="ml-5 h-1 overflow-hidden rounded-full bg-muted/50">
  <div
    className={cn(
      "h-full rounded-full transition-all duration-500",
      status === "failed" ? "bg-red-400/70" : status === "waiting" ? "bg-amber-400/70" : "bg-emerald-400/70",
    )}
    style={{ width: `${progress}%` }}
  />
</div>
```

Always use `transition-all duration-500` on progress bars for smooth animation. Minimum width `4%` prevents zero-width bars from being invisible.

### Tooltips

Use `@radix-ui/react-tooltip` via Base UI (`Tooltip`, `TooltipTrigger`, `TooltipContent`).

```tsx
<Tooltip>
  <TooltipTrigger render={<div role="button" />}>
    {content}
  </TooltipTrigger>
  <TooltipContent side="right">
    <p className="font-medium">Title</p>
    <p className="text-muted-foreground">Description</p>
  </TooltipContent>
</Tooltip>
```

`TooltipContent` side defaults: `right` for sidebar items, `top` for inline actions, `bottom` for toolbar items.

### Settings Rows

```tsx
<SettingsRow
  label="Feature Name"
  description="Optional helper text"
>
  <ActionComponent />
</SettingsRow>
```

`SettingsRow` renders a horizontal flex layout with the label/description on the left and the action on the right. Use `SettingsSection` to group related rows with an optional title.

### Empty States

```tsx
<div className="flex flex-col items-center justify-center py-8 text-center">
  <Icon className="mb-2 size-8 text-muted-foreground/30" />
  <p className="text-sm font-medium text-muted-foreground">Nothing here yet</p>
  <p className="mt-1 text-xs text-muted-foreground/60">Helper text explaining what to do</p>
</div>
```

### Loading States

Inline spinners use `Loader2Icon` from `lucide-react` with `animate-spin`:

```tsx
<Loader2Icon aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
```

Full-screen loading uses the same pattern centered in the container.

---

## Icon Usage

All icons come from `lucide-react`. Always set `aria-hidden="true"` on decorative icons. Size classes:

| Context | Class |
|---------|-------|
| Sidebar row icon | `size-3 shrink-0` |
| Inline action | `size-3.5` |
| Button icon | `size-4` |
| Empty state / hero | `size-8` |

Never set both `width` and `height` on lucide icons — use the `size-*` utility which sets both.

---

## Animation

- `animate-spin` -- loading spinners
- `animate-pulse` -- status dots on running/waiting states
- `transition-colors` -- hover color transitions on interactive elements
- `transition-all duration-500` -- progress bar width changes

Avoid adding new animations beyond these. The UI should feel responsive but not distracting.

---

## Accessibility

- All icon-only buttons must have a visible `aria-label` or be wrapped in a `Tooltip`
- Status indicators that use color alone must also use text or a symbol (`●` / `○` / `✕`)
- Use `role="button"` and `tabIndex={0}` with `onKeyDown` handlers for div-based interactive elements
- Aria-hidden on purely decorative icons and SVGs

---

## Tailwind CSS v4 Notes

This project uses Tailwind v4 with the Vite plugin (`@tailwindcss/vite`). Key differences from v3:

- Config is in `apps/desktop/src/renderer/index.css` via `@theme` blocks, not `tailwind.config.ts`
- Arbitrary values use the same syntax: `text-[11px]`, `bg-muted/45`
- Dark mode is handled via CSS variables — no `dark:` variant needed in most places
- `cn()` from `@palot/ui/lib/utils` is the standard class merge utility (clsx + tailwind-merge)

---

## Component Library

Components in `packages/ui/src/components/` are shadcn-style: copied source with local customization. Do not import from `shadcn/ui` directly — always use `@palot/ui`.

When adding new shared components:
```bash
cd packages/ui && bunx shadcn@latest add <component-name>
```

Then customize to match the design system tokens above before using.
