# Nexus Builder

**Nexus Builder** is an open-source Electron desktop application that gives [OpenCode](https://opencode.ai) a full visual interface. OpenCode is a powerful terminal-based AI coding agent; Nexus Builder wraps it with a GUI so you can manage multiple projects and sessions from a single window, review file changes in a dedicated diff panel, schedule automated agent runs, and coordinate multi-agent orchestration pipelines.

Nexus Builder spawns and manages the OpenCode server automatically, streams responses in real time, and renders tool calls with syntax-highlighted diffs, file previews, and terminal output.

> **Alpha Software** -- Nexus Builder is under active development. Expect breaking changes, missing features, and rough edges.

---

## Features

### Chat and Agent Interaction

- **Multi-project workspace** -- Manage AI sessions across all your projects from a single window. OpenCode is scoped to one project per instance; Nexus Builder lifts that limitation.
- **Full chat interface** -- Conversational UI with real-time SSE streaming, Markdown rendering, auto-scroll, lazy-load pagination, and draft persistence across session switches.
- **Undo and redo** -- `Cmd+Z` to revert the agent's last turn (including file changes), `Shift+Cmd+Z` to redo.
- **Slash commands** -- Type `/` to invoke server-side commands like `/compact` and `/help` directly from the chat input.
- **File and context mentions** -- Use `@` to reference files or specific context, giving the agent precise scope.
- **Rich tool call visualization** -- Every tool call is rendered inline: file reads with line numbers and syntax highlighting, edits as inline diffs, bash commands with ANSI-colored terminal output, search results with matched patterns, web fetches with URL and content preview, and task lists with real-time progress tracking.
- **Model and agent selector** -- Searchable model picker across all connected providers (Anthropic, OpenAI, Google, and more), with reasoning variant support, a recently-used section, and favorites.
- **Permission management** -- Inline approve/deny UI for agent permission requests, with allow-once and allow-always options.
- **Session compaction** -- Summarize long conversations to reclaim context window tokens, manually or automatically. Goals and blockers are saved to the Brain before compaction and restored after.

### Multi-Agent Orchestration (Hive Mind)

- **Lead Agent pipeline** -- A Lead Agent decomposes tasks into a sequential Architect → Builder → Reviewer pipeline. Each phase runs as an independent OpenCode session.
- **Hive Mind sidebar** -- Live sub-agent status panel with activity lines, token and cost totals, heartbeat indicators, progress bars, and budget mode badge (NORMAL / FRUGAL / EMERGENCY).
- **Agent activity timeline** -- Collapsible list of the last five tool calls per agent, updated in real time.
- **Supervision policy** -- Enforces cost budget, agent count limits, and context thresholds. Produces warn/throttle/block/stop decisions surfaced inline.
- **Agent spawning** -- Spawn named agents from a roster or a preset team template (Frontend, Backend, Full-Stack, Research, QA).
- **Brain memory system** -- Per-project structured memory (goals, decisions, lessons, file-relationships) that agents read and write during sessions. Brain context is automatically injected before the first message and saved as a compaction snapshot on context overflow.
- **Model routing** -- Heuristic-based model selection by task complexity (low/medium/high) and role (architect/builder/reviewer) to minimize cost without sacrificing quality.
- **Supervisor state** -- Persistent cross-session milestone tracking for long-running workflows.

### Review and Git Workflow

- **Review panel** -- Dedicated, collapsible side panel showing all file changes from the current session. Powered by virtualized rendering and off-thread syntax highlighting.
- **Diff commenting** -- Click any line in the diff viewer to leave a comment. Comments are collected and injected into the chat input so you can send feedback to the agent in one action.
- **Commit and push** -- Integrated dialog to create branches, commit changes, push to remotes, and open a GitHub Pull Request.
- **Smart diff gates** -- Auto-collapses generated files (lockfiles, etc.) and very large diffs.

### Automations

- **Scheduled agent runs** -- Define recurring tasks with RRule-based scheduling. Nexus Builder runs the agent in the background and queues the results for review.
- **Human-in-the-loop review** -- Automation runs land in a `pending_review` state so you can inspect changes before accepting or archiving them.
- **Auto-archiving** -- Runs with no actionable changes are automatically archived to keep the inbox clean.
- **Retry with backoff** -- Configurable execution retries with exponential backoff.

### Migration and Onboarding

- **Migrate from Claude Code and Cursor** -- A guided wizard detects existing configurations and chat history. It converts settings, MCP servers, custom agents, commands, rules, and hooks to the OpenCode format.
- **History import** -- Convert past sessions from Cursor and Claude Code into OpenCode format.
- **Backup and restore** -- Automatic backups before any migration with a one-click restore option.

### Desktop and OS Integration

- **Liquid Glass (macOS 26+)** -- Native `NSGlassEffectView` window chrome on macOS Tahoe, with vibrancy fallback on older versions.
- **System tray** -- Runs in the background with a tray icon including a Linux variant.
- **Secure credential storage** -- Encrypts server passwords and API keys using Electron's `safeStorage`.
- **mDNS server discovery** -- Automatically scans the local network for OpenCode servers.
- **Command palette** -- `Cmd+K` to search sessions, switch projects, toggle feature flags, and run commands.
- **Auto-updates** -- Built-in update mechanism with download progress and one-click restart.

---

## Download

| Platform | Architectures | Formats |
|----------|---------------|---------|
| macOS | Apple Silicon, Intel | DMG, ZIP |
| Windows | x64, ARM64 | NSIS installer |
| Linux | x64 | AppImage, DEB, RPM |

### macOS: unsigned app warning

Nexus Builder is not yet code-signed or notarized. macOS Gatekeeper will block the app on first launch. To bypass:

**Option A** -- Right-click the app in Finder and select **Open**, then click **Open** in the dialog.

**Option B** -- Remove the quarantine attribute:

```bash
xattr -cr /Applications/NexusBuilder.app
```

---

## Getting Started

### From a release

1. Download and install from the Releases page
2. Make sure [OpenCode CLI](https://opencode.ai) is installed (`~/.opencode/bin/opencode`)
3. Nexus Builder will automatically manage the OpenCode server

OpenCode needs at least one AI provider configured (Anthropic, OpenAI, Google, etc.). Run `opencode` in a terminal once to complete initial setup.

### Coming from Claude Code or Cursor?

On first launch, Nexus Builder offers a guided migration wizard that detects your existing config and history. You can also trigger it later from Settings.

### From source

**Prerequisites:** [Bun](https://bun.sh) 1.3.8+ and [OpenCode CLI](https://opencode.ai)

```bash
git clone <repo-url>
cd palot
bun install

# Run the Electron app
cd apps/desktop && bun run dev
```

#### Browser-only mode (no Electron)

For frontend development without Electron:

```bash
# Terminal 1: Start the backend
cd apps/server && bun run dev     # port 3100

# Terminal 2: Start the renderer
cd apps/desktop && bun run dev:web  # port 1420
```

---

## Architecture

```
apps/
  desktop/       Electron 40 + Vite + React 19 desktop app
  server/        Bun + Hono backend (browser-mode dev only)
packages/
  ui/            Shared shadcn/ui component library (@palot/ui)
  configconv/    Universal agent config converter (@palot/configconv)
  configconv-cli/ CLI wrapper for the config converter
```

The desktop app has three runtime contexts:

- **Main process** (Node.js) -- Window management, IPC handlers, OpenCode server lifecycle, automation scheduler, SQLite persistence
- **Preload** -- Secure bridge exposing `window.palot` API via `contextBridge`
- **Renderer** (Chromium) -- React app with components, hooks, services, and Jotai atoms

Note: Internal package scopes (`@palot/ui`, `@palot/configconv`) and the preload API name (`window.palot`) retain the original `palot` prefix. These are implementation identifiers and do not affect the app's user-facing name.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 40, electron-vite |
| Frontend | React 19, Vite 6, TypeScript |
| Styling | Tailwind CSS v4 |
| State | Jotai |
| Routing | TanStack Router |
| UI components | shadcn/ui, Base UI, cmdk |
| Code highlighting | Shiki |
| Diff rendering | @pierre/diffs |
| Virtualization | TanStack Virtual |
| AI integration | @opencode-ai/sdk |
| Monorepo | Turborepo + Bun workspaces |
| Linting | Biome |
| Packaging | electron-builder |
| Versioning | Changesets |

---

## Commands

```bash
# Development (run from apps/desktop)
bun run dev              # Electron dev mode
bun run dev:web          # Browser-only dev mode (needs apps/server running)

# Build and package
bun run build            # Production build
bun run package          # Package for current platform
bun run package:all      # Package for all platforms

# Quality (run from root)
bun run lint             # Lint with Biome
bun run lint:fix         # Lint and auto-fix
bun run check-types      # Type-check all packages

# Testing
cd packages/configconv && bun test

# Versioning
bun changeset            # Add a changeset
bun run version-packages # Apply changesets and bump versions
```

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) -- Process boundaries, data flow, automation, skills, and known risks
- [Development Guide](docs/DEVELOPMENT_GUIDE.md) -- Coding standards, naming conventions, IPC rules, and contribution workflow
- [Design System](docs/DESIGN_SYSTEM.md) -- Visual design tokens, component patterns, and Tailwind conventions
- [AI Continuation Guide](docs/AI_CONTINUATION.md) -- Guide for AI models contributing to this codebase
- [API Reference](docs/API_REFERENCE.md) -- Browser-mode HTTP routes and Electron IPC domains
- [Database Schema](docs/DATABASE_SCHEMA.md) -- Automation tables, indexes, relationships, and migration rules
- [Engineering Audit](docs/ENGINEERING_AUDIT.md) -- Technical debt, completed refactors, and remaining recommendations
- [Handoff Notes](docs/CODEX_HANDOFF.md) -- Current implementation status, known gaps, and next steps

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run quality checks: `bun run lint && bun run check-types`
5. Add a changeset: `bun changeset`
6. Open a pull request

See [AGENTS.md](AGENTS.md) for code style conventions, naming patterns, and architectural notes. See [docs/AI_CONTINUATION.md](docs/AI_CONTINUATION.md) for a structured guide aimed at AI contributors.

---

## Acknowledgments

Built on top of [OpenCode](https://github.com/opencode-ai/opencode). Communicates with the OpenCode server via the [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk) package. UI components from [shadcn/ui](https://ui.shadcn.com/), [Base UI](https://base-ui.com/), and [Tailwind CSS](https://tailwindcss.com/).

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for a full list of third-party dependencies and their licenses.

---

## License

[MIT](LICENSE)
