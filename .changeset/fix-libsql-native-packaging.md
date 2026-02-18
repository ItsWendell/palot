---
"@palot/desktop": patch
---

Fix native module packaging by switching Bun to hoisted installs, resolving the `Could not find module '@libsql/darwin-x64'` crash on macOS x64 builds
