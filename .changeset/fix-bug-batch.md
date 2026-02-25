---
"@palot/desktop": patch
---

Bug fixes

- **Subagent sessions not found on VPS**: navigating to a subagent session that isn't in the local store (e.g. after a reconnect or when the initial batch load excluded it) now falls back to a direct server fetch instead of showing a dead "not found" screen
- **@ mention on new sessions**: fixed a silent failure where typing `@` on the new session screen showed nothing because the file search had no directory to query against
- **Slash command race condition**: fixed an issue where selecting a slash command from the popover sometimes sent stale text (e.g. `/un` instead of `/undo`) due to a `setText + setTimeout` race with React's async batching. Popover keyboard delegation also no longer drops the first keypress due to a stale closure on `slashOpen`/`mentionOpen`
- **OAuth provider loop**: fixed an infinite authorize loop and missing device code display for OAuth-based providers — thanks to [@YoruAkio](https://github.com/YoruAkio) for the fix!
- **Native module packaging**: switched to the hoisted linker to fix packaging failures for native Node modules on all platforms
- **Session and turn error deduplication**: error messages that appeared multiple times in the chat due to duplicate SSE events are now deduplicated
- **Worktree settings API calls**: fixed excessive API requests being fired on the worktree settings page when no worktree was active
- **Sidebar project sort order**: project order in the sidebar no longer jumps around between renders
- **Session title width**: prevented the session title in the app bar from stretching to full width on wide windows
- **Horizontal overflow**: resolved a layout issue causing content to overflow horizontally at narrow window widths
