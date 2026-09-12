# Poll-driven renders

When a small polling response coincides with a large React task, verify the trigger before moving transport work:

1. Use a profiling build and React Performance tracks to identify the rendered subtree.
2. Correlate the Scheduler update with the request start and response timestamps.
3. Inspect query-cache subscriptions above the subtree. Broad cache-key listeners can turn fetch lifecycle updates into global revision bumps even when query observers preserve `data` identity.
4. Check projection dependencies for remapped objects. Rebuilding a catalog can change nested identities such as `session.location` and invalidate expensive transcript projections.
5. Add an observable regression test showing that an unrelated cache update does not rerender the selected view.

Avoid tracing commands that focus the native window when focus intentionally triggers reconciliation. Treat those project and session refreshes as trace contamination, not idle polling cost.
