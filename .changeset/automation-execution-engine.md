---
"@palot/desktop": minor
---

Add a real automation execution engine powered by the OpenCode SDK. Automations now create OpenCode sessions with configurable permission presets, model resolution, retry logic with exponential backoff, and live session tracking. Execution results are persisted to the SQLite database and automation storage follows XDG Base Directory conventions (`~/.config/palot/automations/`).
