# Codedeck

A web-based GUI for [OpenCode](https://opencode.ai) — browse projects, manage sessions, and chat with AI coding agents from the browser.

> **Status:** Early development. Surfaces ~30% of OpenCode's features. Desktop (Tauri) packaging is planned but not yet implemented.

## Architecture

```
apps/desktop    Vite + React 19 frontend         (port 1420)
apps/server     Bun + Hono backend                (port 3100)
packages/ui     Shared shadcn/ui component library
```

The **server** manages a single `opencode serve` process (port 4101), discovers projects/sessions from disk, and proxies filesystem operations the browser can't do directly. The **frontend** talks to both the Codedeck server (REST/RPC) and the OpenCode server (SDK + SSE) for real-time streaming.

## Prerequisites

| Tool | Notes |
| --- | --- |
| [Bun](https://bun.sh) 1.3.8+ | Runtime and package manager |
| [OpenCode CLI](https://opencode.ai) | Must be installed at `~/.opencode/bin/opencode` |

OpenCode needs at least one AI provider configured (Anthropic, OpenAI, etc.). Run `opencode` once in a terminal to go through initial setup if you haven't already.

## Getting Started

```bash
# Install dependencies
bun install

# Generate server types (needed for frontend type inference)
cd apps/server && bun run build:types && cd ../..

# Start the backend (also spawns the OpenCode server on port 4101)
cd apps/server && bun run dev

# In a second terminal, start the frontend
cd apps/desktop && bun run dev
```

Open **http://localhost:1420** in your browser.

## Available Commands

From the repository root:

```bash
bun run dev           # Start all apps via Turborepo
bun run build         # Production build
bun run lint          # Lint with Biome
bun run lint:fix      # Lint and auto-fix
bun run format        # Format with Biome
bun run check-types   # Type-check all packages
bun run clean         # Remove dist/node_modules/.turbo
```

Per-app:

```bash
# apps/server
bun run dev           # Hot-reload dev server (port 3100)
bun run build:types   # Regenerate .d.ts (required after adding routes)

# apps/desktop
bun run dev           # Vite dev server (port 1420)
bun run check-types   # Type-check with tsgo
```

To add a shadcn/ui component:

```bash
cd packages/ui && bunx shadcn@latest add <component>
```

## Project Layout

```
apps/
  desktop/          Frontend (Vite + React 19, TanStack Router, Zustand)
  server/           Backend (Bun + Hono, manages OpenCode process)
packages/
  ui/               Shared UI components (shadcn/ui, Tailwind v4)
docs/               Design docs, research, and feature plans
```

## Tech Stack

- **Runtime:** Bun
- **Frontend:** React 19, Vite 6, Tailwind CSS v4, Zustand, TanStack Router + Query
- **Backend:** Hono (HTTP + RPC)
- **UI:** shadcn/ui (new-york style, zinc palette)
- **Tooling:** Turborepo, Biome, tsgo
- **AI integration:** OpenCode SDK (`@opencode-ai/sdk`)
