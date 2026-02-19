---
"@palot/desktop": patch
---

Remove compact display mode

The "Compact" display mode has been removed. The display mode type is now `"default" | "verbose"` only. Existing users with `compact` persisted in localStorage are automatically migrated to `default` on next launch.
