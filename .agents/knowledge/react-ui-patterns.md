---
title: React UI Patterns & Tailwind/shadcn System
description: Component patterns, design system conventions, and Tailwind v4 usage for Palot and similar apps.
source: palot-knowledge
tags: react, tailwind, shadcn, ui, components, typescript
agents: frontend-developer, fullstack-developer, architect-reviewer
updated: 2026-05-16
---

## Component Structure

```tsx
// Named exports only — no default exports
// Props: named interface for complex components, inline for tiny ones

interface CardProps {
  title: string
  description?: string
  className?: string
  children: React.ReactNode
}

export function Card({ title, description, className, children }: CardProps) {
  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}
```

## shadcn/ui Usage

```bash
# Add components to packages/ui
cd packages/ui && bunx shadcn@latest add button dialog select
```

Import from the shared package — NEVER re-install in the app:
```tsx
import { Button } from "@palot/ui/components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@palot/ui/components/dialog"
import { cn } from "@palot/ui/lib/utils"
```

## Tailwind v4 Conventions

### Color tokens (semantic, not raw)
```tsx
// DO: semantic tokens
className="bg-background text-foreground border-border"
className="bg-muted text-muted-foreground"
className="bg-primary text-primary-foreground"

// DON'T: raw colors in components
className="bg-slate-900 text-white"
```

### Responsive
```tsx
// Mobile-first — add breakpoints for larger screens
className="flex flex-col gap-2 md:flex-row md:gap-4"
```

### Dark mode
```tsx
// dark: prefix — but prefer semantic tokens which handle dark automatically
className="bg-background dark:bg-background"  // redundant with semantic tokens
```

### Critical: @source directive
`packages/ui/src/styles/globals.css` MUST contain:
```css
@source "../components";
```
Without it, classes used only in UI components won't generate CSS.

## Performance Patterns

### Memoization
```tsx
// Only memoize when:
// 1. Component renders frequently and
// 2. Props are stable references

export const AgentRow = memo(function AgentRow({ agent }: { agent: Agent }) {
  return <div>{agent.name}</div>
})
```

### Stable references with useCallback
```tsx
const handleClick = useCallback(() => {
  doSomething(id)
}, [id])  // Only deps that change should be listed
```

### Lists — key on stable ID, not index
```tsx
// DO
{items.map((item) => <Row key={item.id} item={item} />)}

// DON'T
{items.map((item, i) => <Row key={i} item={item} />)}
```

## State Patterns (Jotai)

```tsx
// atoms/feature.ts
import { atom, atomFamily } from "jotai"

export const featureAtom = atom<Feature | null>(null)
export const featureFamily = atomFamily((id: string) => atom<Feature | null>(null))

// In components
const feature = useAtomValue(featureAtom)           // read-only
const setFeature = useSetAtom(featureAtom)          // write-only
const [feature, setFeature] = useAtom(featureAtom) // read+write
```

Do NOT use Zustand — the codebase has migrated to Jotai.

## Form Patterns

```tsx
// Controlled form with validation
const [value, setValue] = useState("")
const [error, setError] = useState<string | null>(null)

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault()
  if (!value.trim()) { setError("Required"); return }
  onSubmit(value)
}

return (
  <form onSubmit={handleSubmit}>
    <Input
      value={value}
      onChange={(e) => { setValue(e.target.value); setError(null) }}
      aria-invalid={!!error}
      aria-describedby={error ? "field-error" : undefined}
    />
    {error && <p id="field-error" className="text-xs text-destructive mt-1">{error}</p>}
  </form>
)
```

## Accessibility Checklist

- [ ] Decorative icons: `aria-hidden="true"`
- [ ] Interactive icons without text: `aria-label` on the button
- [ ] Form fields: `htmlFor` on label, matching `id` on input
- [ ] Error messages: `aria-describedby` on input, `role="alert"` or `aria-live="polite"` on container
- [ ] Focus management: modals restore focus to trigger on close
- [ ] Color: never use color as the only signal (also use text/icon/shape)
- [ ] Keyboard: all interactive elements reachable and operable via keyboard

## Common Patterns

### Loading skeleton
```tsx
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />
}
```

### Empty state
```tsx
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
```

### Error boundary pattern
```tsx
// In React 19, use the error boundary component
// For server components, use error.tsx in the route
// For client-side, wrap in try/catch and set error state
```
