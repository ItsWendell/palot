---
title: Engineering Decisions
tags: [decisions, architecture]
updated: 2026-05-13
---

# Engineering Decisions

| Date | Decision | Rationale | Status |
|------|----------|-----------|--------|
| 2026-05-13 | Sequential Architect → Builder → Reviewer pipeline | Avoids file ownership conflicts between agents writing to the same files simultaneously. Each stage depends on the previous stage's output. Parallel planning is safe; parallel writes are not. | Active |
| 2026-05-13 | SkillImporter safety-first approach | Skills are markdown files that agents execute as instructions. External GitHub content is an untrusted injection vector. Scanning for secrets, obfuscated code, remote installers, and prompt-injection patterns before showing a draft enforces a trust boundary. | Active |
| 2026-05-13 | Renderer localStorage for supervision events | No durable audit log requirement at this stage. `atomWithStorage` is the simplest approach that survives app restarts on the same device. Not suitable for cross-device audit or compliance use cases. | Active — see [[issues]] for limitations |
| 2026-05-13 | Fetch proxy through main process (`fetch:request` IPC) | Chromium limits HTTP/1.1 connections to 6 per origin. When many parallel SSE + API requests hit the OpenCode server, this causes severe queueing. Proxying through `net.fetch` in main bypasses the limit. | Active |
| 2026-05-13 | Preload bridge typed via `api.d.ts` | Single source of truth for the IPC surface. Renderer gets full TypeScript types without importing Electron. Avoids accidental Node.js leakage into the renderer. | Active |
| 2026-05-13 | `bun:test` as test runner | Matches the project's Bun runtime; faster than Jest for this monorepo size; no additional config needed. | Active |
| 2026-05-13 | Agent configs in both `.opencode/agents/` and `~/.config/opencode/agents/` | OpenCode reads only from `~/.config/`; the repo copy is for version control. Kept in sync manually. A future improvement could auto-sync on app launch. | Active — manual sync required |
