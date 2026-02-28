---
"@palot/desktop": patch
---

Fix stale sessions on server switch and amber banners invisible on light theme

**Stale sessions (#57):** When switching between local and VPS servers, the old server's
sessions could reappear in the sidebar after being cleared. Two root causes fixed:

1. The SSE event batcher's `dispose()` was flushing buffered events into the store even
   after `disconnect()` was called, re-adding stale session IDs that had just been cleared
   by `triggerServerSwitch()`. The batcher now discards pending events when the connection
   is stale instead of flushing them.

2. Per-project pagination state (`projectPaginationFamily`) was never reset on server
   switch. This caused expanded project directories to show as "loaded" on the new server,
   preventing a fresh session fetch. Pagination is now reset for all known directories
   during `triggerServerSwitch()`.

**Banner visibility (#61):** The automations permissions banner and the chat session revert
banner used hardcoded `text-amber-200` / `text-amber-300` shades which are near-white and
invisible on light theme backgrounds. Both banners now use `dark:` variants so they render
correctly on both light and dark themes.
