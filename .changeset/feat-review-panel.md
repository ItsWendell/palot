---
"@palot/desktop": minor
---

Add review panel with diff viewer and inline diff comments

A new slide-in review panel lets you inspect all file changes produced by the current session without leaving the chat. The panel shows a full diff viewer powered by a background worker pool for fast rendering, alongside a running list of changes grouped by file.

Diff comments can be written directly from the review panel and are injected into the chat input — so you can ask the agent to revisit specific changes without manually copying file paths or line numbers. The panel slides in from the right and adapts the chat layout automatically so nothing is obscured.
