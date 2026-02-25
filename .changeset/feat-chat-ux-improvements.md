---
"@palot/desktop": patch
---

Chat UX improvements: elapsed time, @ mentions on new sessions, bash streaming, and more

- Running tool calls and sub-agent cards now show a live elapsed time counter (e.g. "12s", "1m 4s") that ticks every second, so you always know how long a tool has been active without waiting for it to finish
- @ file and agent mentions now work on the new session input screen — you no longer need to create a session first before tagging files
- A **New Session** button has been added to the sidebar navigation for quick access from anywhere in the app
- Bash tool cards stream live stdout/stderr output as it arrives during execution, matching the behaviour of the OpenCode TUI
- Tool calls nested inside reasoning blocks are now grouped inside the collapsible reasoning section rather than appearing loose in the chat
