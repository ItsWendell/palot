---
"@palot/desktop": patch
---

Fix unstable sidebar project sort order caused by volatile server-side `project.time.updated` timestamps. Projects now use a tiered sort: active agents first (by recency), idle sessions next (by recency), then sessionless projects alphabetically. Ties are broken by name for fully deterministic ordering.
