---
"@palot/configconv": minor
---

Migrate history writer to SQLite for OpenCode v1.2.0+. Sessions, messages, and parts are now written directly to the SQLite database at `~/.local/share/opencode/opencode.db`. Falls back to legacy flat-file JSON storage when no database exists.
