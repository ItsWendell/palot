---
"@palot/desktop": patch
---

Automation improvements: agent/model selection, minute-level schedules, and reliability

Automation configurations now support selecting a specific agent, model, and model variant — giving you the same control over automated runs as you have over manual sessions.

The schedule interval picker now accepts minutes in addition to hours and days, enabling sub-hourly automation schedules. The scheduler itself has been made async and now tracks next-run times in memory to avoid stale database reads. The automation executor has also been hardened with improved error logging and retry behaviour.
