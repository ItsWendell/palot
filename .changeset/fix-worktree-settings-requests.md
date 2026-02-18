---
"@palot/desktop": patch
---

Fix excessive API requests on the worktree settings page. The worktree list was re-fetched for every connected project on each session update because the effect depended on volatile fields (`agentCount`, `lastActiveAt`). Now the fetch is gated on a stable directory key that only changes when projects are added or removed.
