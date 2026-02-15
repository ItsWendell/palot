---
"@palot/desktop": patch
---

Resolve the shell environment asynchronously at startup. The window now opens immediately while the login shell spawns in the background, removing a blocking delay on macOS and Linux.
