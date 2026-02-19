---
"@palot/desktop": minor
---

Redesign default chat display mode with grouped tool summaries

The default view now renders an interleaved stream of text, reasoning blocks, and grouped tool summaries instead of a pill-bar summary. Consecutive tool calls of the same category (explore, edit, run, etc.) are collapsed into a single inline chip (e.g. "Read 3 files", "Edited foo.tsx, bar.tsx") with a left-border color accent. Each group chip is clickable and expands inline to show the full tool cards for that group. Groups with only a single tool skip the summary row and render the full tool card directly. A "Show N steps" toggle reveals all tool cards at once in verbose style.
