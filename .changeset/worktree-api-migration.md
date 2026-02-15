---
"@palot/desktop": minor
---

Migrate worktree management from a custom Electron-based implementation to OpenCode's native worktree API. The legacy `worktree-manager.ts` in the main process has been removed and replaced with a renderer-side `worktree-service.ts` that calls the OpenCode SDK directly. Sandbox projects created from worktrees now merge into the parent project in the sidebar.
