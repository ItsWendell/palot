# Palot Agent Instructions

- Prefer official OpenCode 2 APIs and client contracts. Surface API gaps before adding custom alternatives.
- Backward compatibility is optional in this pre-production product. Skip costly compatibility layers unless explicitly required.
- Use Vite+ with the pinned Bun toolchain: `vp install/add/remove` for dependencies and existing `bun run` or `vp run` scripts for validation.
- OpenCode auto-formats matching files after native edits. Finish the planned file edits, then batch validation across all touched files rather than checking after each edit: `vp check --no-fmt <files>` for lint, or `vp check --fix <files>` when lint autofixes are needed. Format shell/CLI edits explicitly; keep final formatting checks, typechecks, and relevant tests as described below.
- For worktree setup, choosing verification, or attaching debug tools, read [docs/agent-development.md](docs/agent-development.md).
