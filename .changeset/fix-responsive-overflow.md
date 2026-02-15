---
"@palot/desktop": patch
"@palot/ui": patch
---

Fix horizontal overflow and clipping in the desktop app at narrow window widths. Add `min-w-0` and `overflow-hidden` throughout the flex layout chain (SidebarInset, content area, conversation container, chat view, prompt toolbar) and make the session app bar collapse responsively with Tailwind breakpoints.
