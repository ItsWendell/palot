---
version: alpha
name: Palot
description: A focused native workspace for long-running OpenCode tasks.
omitted:
  - section: colors
    reason: Palot ships a runtime theme catalog rather than one normative palette.
  - section: typography
    reason: Font families and sizes are user-configurable and resolved against local system fonts.
  - section: spacing
    reason: Layout rhythm is owned by Tailwind and shared component primitives rather than a separate exported scale.
  - section: rounded
    reason: Shape values are owned by the active theme and shared component primitives.
  - section: components
    reason: Palot's stateful desktop components exceed the alpha component-token schema; their contracts are documented below.
---

# Palot Design

## Overview

Palot should feel like a focused native workspace for long-running OpenCode tasks. The interface is quiet by default, dense where the work benefits from density, and consistent enough that people can move between tasks, settings, and workbench panes without relearning the UI.

Themes may change the visual character substantially. These rules define relationships and behavior, not one fixed palette.

## Colors

### Theme Semantics

- Components use semantic tokens such as `background`, `foreground`, `card`, `muted`, `accent`, `border`, and their sidebar equivalents. Product code should not recreate theme colors locally.
- Light and dark themes are independent. A theme only appears in a color mode it actually supports.
- Code, terminal, and diff colors may follow the app theme or use a separate registered code theme.
- Contrast strengthens or softens the relationships between surfaces, borders, controls, icons, and secondary text. It should not replace the theme's accent or semantic status colors.

## Typography

- The configured interface size drives the Tailwind type scale and shared component primitives.
- Product UI uses the named `text-sm`, `text-compact`, `text-meta`, `text-micro`, and `text-tag` roles. Compact, metadata, and micro text keep bounded offsets from the configured interface size; tag text stays tightly capped for compact badges.
- Icons that form a label with UI text use bounded semantic icon sizes. Window chrome, toolbar controls, status glyphs, and geometry-bound icons remain fixed.
- Large product headings use named responsive roles such as `text-page-title` and `text-hero`, not one-off arbitrary sizes.
- Sidebar items, group labels, captions, content, and headings derive from named theme size tokens. Avoid fixed pixel sizes in reusable navigation and settings components.
- Monospace content uses `text-code` or `text-code-compact`. Terminal, diff, and file tree sizes remain independently derived from the configured monospace size where density matters.
- Font size changes should be visible across navigation, settings, controls, content, and previews, not only on the document body.
- User-selected fonts must retain a robust platform fallback stack. Cell-grid surfaces must resolve to a monospace face.

## Layout

- App-shell surfaces fill their allocated panel with `h-full` and `min-h-0`. Viewport-sized primitives should not create extra space inside Electron's fixed root.
- Reusable surfaces respond to allocated space. Establish the query owner with Tailwind's [`@container`](https://tailwindcss.com/docs/responsive-design#container-queries) utility, name nested owners such as `@container/workbench`, and style descendants with variants such as `@sm/workbench:` or an arbitrary container breakpoint. Use viewport variants such as `sm:` only for app-shell behavior tied to the Electron window.
- Choose responsive breakpoints from child and sibling minimum sizes and interaction constraints, not device categories.
- Overlay docks reserve exactly the space their content needs. Avoid decorative bottom padding that reads as an empty border or gap.
- Headers across chat, settings, and workbench panes share the same height, border ownership, and material behavior.

## Elevation & Depth

- Native window material and renderer translucency are separate controls.
- Liquid Glass uses documented native options only. Private or unstable material variants are not part of the appearance contract.
- Sidebar, content, composer, inspector, popover, and workbench opacity are derived from shared preferences instead of local alpha values.
- Reduce Transparency always wins. Every translucent surface must have a solid, readable fallback.
- Main content translucency should reveal material without making transcript text, code, inputs, or selected states hard to read.
- Prefer tonal separation, borders, and native material over heavy decorative shadows.

## Shapes

- Shared primitives own radii, borders, and control geometry. Call sites should not create a competing shape language.
- Compact navigation and controls use restrained radii. Larger surfaces may be softer when the extra containment has a real purpose.
- Pills are reserved for badges, statuses, and controls whose shape communicates their role.

## Components

### Sidebars

- Navigation sidebars share one compact menu item language: consistent height, horizontal padding, radius, icon size, typography, selected state, and focus ring.
- Pinned and Inbox task entries retain their richer multi-line cards: project/status, task title, and branch or location context. Use the shared rich density for these cards; adding connection scope must not replace them with compact Projects rows. Snoozed and Settled keep their existing compact shelves.
- Extend the existing Inbox filter/view toolbar and collapsible sections instead of introducing separate multi-connection navigation chrome. Server visibility belongs in the filter menu; monitoring and connection management belong in options. Preserve empty-section rules, section counts, and expand/collapse controls.
- Section chevrons share the rich cards' right metadata inset. Project headers use the same count/chevron treatment, with the new-task action separate from the collapse button and titles aligned to the left content edge.
- Session rows retain the shared right-click menu and drag-out-to-new-window gesture in every sidebar mode and density. Multi-connection rows must target their own connection, including when it is not the focused one; offline rows must never fall back to another server.
- Group labels use the same size and spacing in projects, inbox, and settings. Uppercase labels are reserved for data that is genuinely categorical, not routine navigation groups.
- Use spacing to separate adjacent navigation groups. Dividers are for real structural boundaries such as a persistent footer, not every list section.
- Compact actions use simple icons. A plus means add; richer folder imagery belongs in empty states or content where the object needs explanation.
- Settings navigation may have a different information structure, but should still use the shared sidebar item and group-label styles.

### Shared Controls

- Composer approvals sit with attachments and the agent on the left. Model and reasoning share one trigger and popover immediately before context and submission on the right. Toolbar labels and icons use the shared compact composer button sizing.
- Approval presets reflect authoritative session rules: Defaults clears session overrides; Full access is an explicitly confirmed wildcard allow. Other rules display Custom. New independent drafts never inherit a locally remembered Full access choice, and pending requests are never silently answered by the selector.
- Questions, forms, and permissions from descendant sessions surface in the parent request area with the originating sub-agent identified. Replies and dismissals retain the original session and request ownership. Needs input takes priority over Working; summary cards use request/lifecycle events, not transcript previews, to show that state.

- Composer connection context belongs beside the project/branch controls, not in a separate input row. Hide connected local destinations; show a compact green-cloud badge for remote destinations and an explicit warning when the execution connection is offline.

- Prefer the local shadcn/ui primitives and improve the primitive when several callers need the same behavior.
- Component variants own typography and visual states. Call-site classes should mainly describe layout or a genuinely unique product state.
- Focus, hover, selected, disabled, loading, empty, and error states use the same semantic treatment wherever the interaction is equivalent.
- Controls use plain labels that describe what changes. Avoid exposing internal implementation terms when a user-facing material, pane, or task concept is available.

## Do's and Don'ts

- Do verify surfaces in light, dark, high-contrast, translucent, opaque, and Reduce Transparency modes.
- Do verify that changing interface size visibly affects a component without breaking its layout.
- Do reuse shared tokens and primitives for color, typography, dividers, radii, and opacity.
- Do match equivalent navigation and control patterns elsewhere in Palot.
- Do test reusable panes at their minimum supported width and height.
- Do preserve keyboard focus, readable contrast, and clear selected states.
- Don't add local styling that duplicates a shared token or component variant.
- Don't use viewport assumptions inside a component that should respond to its allocated pane.
