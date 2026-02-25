---
"@palot/desktop": minor
---

Lazy session loading, pagination, and project search

The sidebar now loads sessions lazily per project rather than fetching everything on startup. A "Load more" button in each project section pages through sessions in batches, dramatically reducing initial load time on large workspaces.

Project search lets you filter the sidebar by name in real time. Session metrics (token counts, cost, duration) have moved into a compact popover on the session header to reduce visual clutter. Tool call durations now use a client-side first-seen timestamp for accuracy instead of relying solely on server-reported times.
