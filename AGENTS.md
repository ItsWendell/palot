# Palot Agent Instructions

- Prefer official OpenCode 2 APIs and client contracts. Surface API gaps before adding custom alternatives.
- Backward compatibility is optional in this pre-production product. Skip costly compatibility layers unless explicitly required.
- Use Vite+ with the pinned Bun toolchain: `vp install/add/remove` for dependencies, `vp check --fix <files>` for touched files, and existing `bun run` or `vp run` scripts for validation.
- For worktree setup, choosing verification, or attaching debug tools, read [docs/agent-development.md](docs/agent-development.md).
