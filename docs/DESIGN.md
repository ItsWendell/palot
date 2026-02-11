# Palot Design Document

> **Status:** Draft v1 — For Review
> **Date:** February 7, 2026
> **Authors:** TBD

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Technology Stack](#4-technology-stack)
5. [OpenCode Integration](#5-opencode-integration)
6. [Execution Environments](#6-execution-environments)
7. [Agent Mobility — Environment Migration](#7-agent-mobility--environment-migration)
8. [User Experience](#8-user-experience)
9. [Data Model](#9-data-model)
10. [API Design](#10-api-design)
11. [Cloudflare Container Backend](#11-cloudflare-container-backend)
12. [Local VM Backend](#12-local-vm-backend)
13. [Security & Permissions](#13-security--permissions)
14. [Implementation Plan](#14-implementation-plan)
15. [Open Questions](#15-open-questions)

---

## 1. Problem Statement

Managing multiple coding agents across projects today requires juggling terminals, tmux sessions, worktrees, and mental context. There is no unified, open-source tool that lets you:

- **See all running agents** across all projects in one view
- **Choose where agents run** — local worktree, local VM, or cloud container
- **Move agents between environments** — start in cloud, continue locally (or vice versa)
- **Give agents full dev environments** — with browser access, port forwarding, package installation
- **Manage the full lifecycle** — spawn, monitor, steer, review, merge, clean up

The closest existing solutions are:
- **Codex App** — proprietary, OpenAI-only, macOS-only
- **Claude Squad** — community tool, tmux-only, no cloud, no VM support
- **VS Code Agent HQ** — IDE-locked, limited to VS Code ecosystem

None of these are open-source, agent-agnostic (within OpenCode's provider support), and support the full spectrum of local + cloud execution with mobility between them.

---

## 2. Goals & Non-Goals

### Goals

1. **Unified agent dashboard** — One app to see, manage, and interact with all agents across all projects and environments
2. **Three execution tiers** — Local worktrees, local VMs/containers, and Cloudflare Containers as first-class environments
3. **Agent mobility** — Move agents between cloud and local (and back) with state preserved
4. **Full dev environments** — Agents in VMs/containers can install packages, run dev servers, test frontends via headless browser
5. **OpenCode-native** — Built on top of OpenCode's SDK and server API, not as a plugin
6. **Desktop app** — Tauri + React + shadcn/ui for a native experience
7. **Real-time monitoring** — Stream agent output, diffs, tool calls, and status in real-time via SSE

### Non-Goals (for v1)

- Supporting agent runtimes other than OpenCode (no raw Claude Code CLI, Codex CLI, etc.)
- Mobile app
- Collaborative/multi-user agent management
- Built-in code editor (agents edit code; users review diffs and use their own editor)
- Automated scheduling/cron (Codex-style automations — future consideration)
- Billing/usage management beyond displaying token counts and costs

---

## 3. Architecture Overview

### Key Architectural Decision: No Plugin Required

OpenCode's own desktop app is proof that a standalone Tauri app works on top of the OpenCode server. Their architecture is:

```
Tauri (Rust) → spawns `opencode serve` → connects via HTTP/SSE → frontend uses @opencode-ai/sdk
```

We follow the exact same pattern. **Palot is a standalone desktop app that manages one or more OpenCode server instances.** No plugin, no fork, no extension needed. The entire OpenCode API is available externally:

- Session CRUD, prompting, aborting, forking, reverting
- Real-time SSE event streams (all bus events)
- File browsing, search, diffs
- PTY/terminal via WebSocket
- Config and provider management
- Worktree path resolution

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Palot Desktop App (Tauri v2)              │
│  ┌────────────────────────────────────┐  ┌────────────────────┐  │
│  │         React Frontend             │  │   Rust Backend     │  │
│  │  (Vite + shadcn/ui + Zustand)      │  │   (Tauri core)     │  │
│  │                                    │  │                    │  │
│  │  ┌─────────┐ ┌──────┐ ┌────────┐  │  │  Process Manager   │  │
│  │  │Dashboard │ │Detail│ │Terminal│  │  │  (spawn/kill OC    │  │
│  │  │  View    │ │Panel │ │ View   │  │  │   servers)         │  │
│  │  └─────────┘ └──────┘ └────────┘  │  │                    │  │
│  │                                    │  │  Environment       │  │
│  │  SSE streams ← @opencode-ai/sdk → │  │  Manager           │  │
│  │                                    │  │  (worktree, VM,    │  │
│  └────────────────────────────────────┘  │   cloud lifecycle)  │  │
│                                          │                    │  │
│                                          │  Migration Engine  │  │
│                                          │  (state transfer   │  │
│                                          │   between envs)    │  │
│                                          └────────────────────┘  │
└──────────────┬──────────────┬──────────────┬─────────────────────┘
               │              │              │
    ┌──────────┴───┐  ┌──────┴──────┐  ┌────┴──────────────┐
    │ OpenCode     │  │ OpenCode    │  │ OpenCode          │
    │ Server       │  │ Server      │  │ Server            │
    │ (Project A)  │  │ (Project B) │  │ (in CF Container) │
    │              │  │             │  │                   │
    │ Worktree or  │  │ Worktree or │  │ Cloud environment │
    │ Local VM     │  │ Local VM    │  │                   │
    └──────────────┘  └─────────────┘  └───────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **React Frontend** | UI rendering, user interaction, SSE stream consumption, state management |
| **Rust Backend (Tauri)** | Process lifecycle (spawn/kill OpenCode servers), filesystem operations, VM/container management, migration orchestration |
| **OpenCode Server** | Agent execution, LLM interaction, tool execution, session management — we don't reinvent any of this |
| **@opencode-ai/sdk** | Typed API client for OpenCode server communication |

### Why This Architecture

1. **Zero duplication** — All agent intelligence, tool execution, and LLM interaction lives in OpenCode. We only build the management layer.
2. **Automatic updates** — When OpenCode adds features (new tools, better agents, new providers), Palot gets them for free via the API.
3. **Multi-server** — Each project can have its own OpenCode server instance, or a single server can handle multiple projects via the `x-opencode-directory` header.
4. **Clean separation** — Palot manages WHERE agents run. OpenCode manages WHAT agents do.

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop framework | **Tauri v2.10** | Small binary (~10MB vs Electron's 100MB+), Rust backend for process/VM management, native OS integration |
| Frontend bundler | **Vite** | Fast HMR, official Tauri support, standard React tooling |
| UI framework | **React 18+ / TypeScript** | shadcn/ui compatibility, largest ecosystem |
| Component library | **shadcn/ui** | All needed components (DataTable, Sidebar, Command, Resizable, Tabs, etc.), dark mode, customizable source code |
| State management | **Zustand** | Minimal boilerplate, excellent for real-time streaming updates, supports external updates from SSE listeners |
| Server state | **TanStack Query** | For REST API calls (session history, config), with Zustand for real-time streams |
| Terminal display | **@xterm/xterm** | Full ANSI escape code support, works in Tauri webview |
| Diff viewer | **react-diff-view** or custom | Unified/split diff rendering with syntax highlighting |
| OpenCode client | **@opencode-ai/sdk** | Auto-generated typed client for full API access |
| Process management | **Tauri Shell plugin** | Spawn/manage OpenCode server child processes |
| File system | **Tauri FS plugin** | Read project configs, manage worktree directories |

### Key Dependencies

```json
{
  "dependencies": {
    "@opencode-ai/sdk": "latest",
    "@tauri-apps/api": "^2.10",
    "@tauri-apps/plugin-shell": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "@xterm/xterm": "^5",
    "@xterm/addon-fit": "^0.10",
    "react": "^18",
    "zustand": "^5",
    "@tanstack/react-query": "^5",
    "tailwindcss": "^4"
  }
}
```

---

## 5. OpenCode Integration

### Server Lifecycle

Palot manages OpenCode server instances. For each project that has active agents:

```typescript
import { createOpencode } from "@opencode-ai/sdk"

// Spawn an OpenCode server for a project
const { client, server } = await createOpencode({
  hostname: "127.0.0.1",
  port: 0,  // auto-select available port
  cwd: "/path/to/project",
})

// server.url = "http://127.0.0.1:XXXX"
// server.close() to stop
```

Alternatively, from the Rust backend via Tauri's Shell plugin (for more control over process lifecycle):

```rust
use tauri_plugin_shell::ShellExt;

let (rx, child) = app.shell()
    .command("opencode")
    .args(["serve", "--hostname", "127.0.0.1", "--port", &port.to_string()])
    .envs([
        ("OPENCODE_SERVER_PASSWORD", &password),
        ("OPENCODE_SERVER_USERNAME", "palot"),
    ])
    .spawn()?;
```

### Multi-Project Strategy

**Option A: One server per project** (recommended for v1)
- Simplest mental model
- Each server has clear ownership
- Process isolation — one crashing doesn't affect others
- Slightly higher resource usage

**Option B: Single server, multiple directories**
- Use `x-opencode-directory` header to switch project context per request
- Lower resource usage
- More complex error handling

**Decision: Option A for v1.** One OpenCode server per project with active agents. Server is spawned lazily when the first agent is created for a project and stopped when the last agent finishes (with a configurable idle timeout).

### Session Mapping

Each "agent" in Palot maps 1:1 to an OpenCode session:

| Palot Concept | OpenCode Concept |
|-----------------|-----------------|
| Agent | Session |
| Agent output stream | SSE events for session |
| Agent prompt | `session.prompt()` or `session.promptAsync()` |
| Agent status | Session status (from `session.status()`) |
| Agent diff | `session.diff()` |
| Agent history | `session.messages()` |
| Sub-agent | Child session (via `session.children()`) |

### Event Subscription

```typescript
// Subscribe to all events for a project
const eventSource = new EventSource(`${serverUrl}/event`, {
  headers: { 'x-opencode-directory': projectPath }
})

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)
  // Route to appropriate handler based on event type
  switch (data.type) {
    case 'session.updated': handleSessionUpdate(data)
    case 'message.part.updated': handleMessageStream(data)
    case 'permission.requested': handlePermission(data)
    // ... etc
  }
}
```

---

## 6. Execution Environments

### Three Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXECUTION ENVIRONMENTS                      │
├───────────────────┬───────────────────┬─────────────────────────┤
│  LOCAL WORKTREE   │  LOCAL VM         │  CLOUD CONTAINER        │
│                   │                   │                         │
│  Git worktree in  │  Docker/OrbStack  │  Cloudflare Container   │
│  project repo     │  container or     │  via Sandbox SDK        │
│                   │  Cloud Hypervisor │                         │
│  No isolation     │  microVM          │  Full VM isolation      │
│  Instant start    │                   │  2-3s cold start        │
│  Shared deps      │  Full isolation   │  Global edge network    │
│                   │  ~200ms-2s start  │  Scale to zero          │
│  Best for:        │  Full dev env     │                         │
│  Quick tasks,     │                   │  Best for:              │
│  familiar git     │  Best for:        │  Long-running tasks,    │
│  workflow         │  Testing servers, │  offloading from local, │
│                   │  browser testing, │  team/CI integration    │
│                   │  full isolation   │                         │
├───────────────────┼───────────────────┼─────────────────────────┤
│  OpenCode runs    │  OpenCode runs    │  OpenCode runs          │
│  on host, pointed │  inside the VM/   │  inside the container   │
│  at worktree dir  │  container        │                         │
├───────────────────┼───────────────────┼─────────────────────────┤
│  Palot spawns  │  Palot spawns  │  Palot provisions    │
│  `opencode serve` │  VM, then starts  │  CF Container via API,  │
│  with worktree    │  `opencode serve` │  OpenCode runs inside   │
│  as working dir   │  inside it        │  with exposed HTTP port │
└───────────────────┴───────────────────┴─────────────────────────┘
```

### Runtime Backend Interface

All three environments implement the same interface:

```typescript
interface RuntimeBackend {
  /** Unique identifier for this backend type */
  type: "worktree" | "vm" | "cloud"

  /** Provision a new environment for an agent */
  provision(config: EnvironmentConfig): Promise<Environment>

  /** Start the environment (if not already running) */
  start(envId: string): Promise<void>

  /** Stop the environment (pause/sleep) */
  stop(envId: string): Promise<void>

  /** Destroy the environment (cleanup all resources) */
  destroy(envId: string): Promise<void>

  /** Get the OpenCode server URL for this environment */
  getServerUrl(envId: string): Promise<string>

  /** Get environment status */
  getStatus(envId: string): Promise<EnvironmentStatus>

  /** Get resource usage (CPU, memory, disk) — only relevant for VM/cloud */
  getResources(envId: string): Promise<ResourceUsage | null>

  /** Export environment state for migration */
  exportState(envId: string): Promise<MigrationManifest>

  /** Import state from another environment */
  importState(envId: string, manifest: MigrationManifest): Promise<void>
}

interface EnvironmentConfig {
  projectPath: string
  branch?: string          // Git branch to work on
  setupScript?: string     // Script to run after provisioning
  dockerfile?: string      // For VM/cloud: container image definition
  resources?: {            // For VM/cloud
    cpu?: number
    memoryMb?: number
    diskMb?: number
  }
}

interface Environment {
  id: string
  type: "worktree" | "vm" | "cloud"
  serverUrl: string        // OpenCode server URL
  serverPassword: string   // Auth credential
  directory: string        // Working directory (local path or container path)
  branch: string           // Git branch
  createdAt: Date
}

type EnvironmentStatus =
  | "provisioning"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "destroyed"
```

### Worktree Backend

The simplest backend. Uses git worktrees for filesystem isolation:

```typescript
class WorktreeBackend implements RuntimeBackend {
  type = "worktree" as const

  async provision(config: EnvironmentConfig): Promise<Environment> {
    // 1. Create a git worktree
    const branchName = config.branch || `palot/${generateName()}`
    const worktreePath = path.join(
      await getPalotDataDir(),
      "worktrees",
      projectId,
      slugify(branchName)
    )

    await exec(`git worktree add -b ${branchName} ${worktreePath}`, {
      cwd: config.projectPath
    })

    // 2. Run setup script if provided
    if (config.setupScript) {
      await exec(config.setupScript, { cwd: worktreePath })
    }

    // 3. Spawn OpenCode server pointed at the worktree
    const { url, password } = await spawnOpenCodeServer(worktreePath)

    return { id: generateId(), type: "worktree", serverUrl: url, ... }
  }

  async destroy(envId: string): Promise<void> {
    // Stop OpenCode server
    // git worktree remove <path>
    // git branch -d <branch> (if merged)
  }
}
```

### VM Backend (v2)

Uses Docker (via OrbStack on macOS) or Cloud Hypervisor (on Linux) for full isolation:

```typescript
class VmBackend implements RuntimeBackend {
  type = "vm" as const

  async provision(config: EnvironmentConfig): Promise<Environment> {
    // 1. Build or pull container image
    //    Base image includes: OpenCode, Node.js, Python, Chromium, agent-browser
    // 2. Start container with project mounted (or cloned)
    // 3. Start OpenCode server inside the container
    // 4. Expose server port via port mapping
    // 5. Return connection info
  }
}
```

### Cloud Backend (v2-v3)

Uses Cloudflare Containers via the Sandbox SDK:

```typescript
class CloudBackend implements RuntimeBackend {
  type = "cloud" as const

  async provision(config: EnvironmentConfig): Promise<Environment> {
    // 1. Call Cloudflare API to create container
    //    Image includes: OpenCode, dev tools, browser
    // 2. Clone repo inside container
    // 3. Checkout branch
    // 4. Run setup script
    // 5. Start OpenCode server
    // 6. Return WebSocket/HTTP connection info
  }
}
```

---

## 7. Agent Mobility — Environment Migration

### The Core Insight

Agent state decomposes into layers with different transfer mechanisms:

| Layer | What | Transfer Mechanism |
|-------|------|-------------------|
| **Code state** | File changes, new/deleted files | Git (commit + push/pull or patch) |
| **Git state** | Branch, commits, staged changes | Git operations |
| **Conversation state** | LLM messages, tool call history, todo list | OpenCode session export/import |
| **Environment state** | Installed packages, env vars, config | Declarative setup scripts (idempotent) |
| **Process state** | Running dev server, database, watchers | Reconstruction from manifest (NOT migrated live) |

### Migration Protocol

```
Source Environment                          Destination Environment
┌──────────────┐                           ┌──────────────┐
│ 1. Pause     │                           │              │
│    agent     │                           │              │
│              │                           │              │
│ 2. Commit    │──── git push ────────────>│ 4. Pull /    │
│    all work  │                           │    checkout  │
│              │                           │              │
│ 3. Export    │──── manifest.json ───────>│ 5. Import    │
│    session   │                           │    session   │
│    state     │                           │              │
│              │                           │ 6. Run setup │
│              │                           │    script    │
│              │                           │              │
│              │                           │ 7. Resume    │
│              │                           │    agent     │
│              │                           │              │
│ 8. Cleanup   │                           │              │
│    source    │                           │              │
└──────────────┘                           └──────────────┘
```

### Migration Manifest

```typescript
interface MigrationManifest {
  version: 1
  timestamp: string
  source: {
    type: "worktree" | "vm" | "cloud"
    environmentId: string
  }

  // Git state
  git: {
    remote: string              // e.g., "origin"
    remoteUrl: string           // e.g., "git@github.com:user/repo.git"
    branch: string              // e.g., "palot/brave-falcon"
    commitSha: string           // HEAD commit after committing all work
    baseBranch: string          // e.g., "main"
    uncommittedPatch?: string   // If there were uncommitted changes, the patch
  }

  // Conversation state
  session: {
    id: string
    messages: SessionMessage[]  // Full or summarized message history
    summary?: string            // AI-generated summary of conversation so far
    todoList?: TodoItem[]       // Current todo state
    currentPhase?: string       // What the agent was working on
  }

  // Environment reconstruction
  environment: {
    setupScript?: string        // Script to run after checkout
    envVars?: Record<string, string>  // Non-secret env vars
    runningProcesses?: Array<{  // What was running (for reconstruction)
      command: string
      cwd: string
      port?: number
    }>
  }
}
```

### Migration Flows

#### Cloud → Local Worktree

1. **Pause** the cloud agent (`session.abort()`)
2. **Commit** all changes in the cloud container: run `git add . && git commit -m "WIP: migration checkpoint"` via the cloud OpenCode's shell API
3. **Push** the branch to remote
4. **Export** session state from cloud OpenCode server (messages, todos, summary)
5. **Create** local worktree: `git worktree add -b <branch> <path>`
6. **Pull** the branch in the worktree
7. **Spawn** local OpenCode server pointed at the worktree
8. **Import** session: create new session with conversation context injected as system message + recent messages replayed
9. **Resume** the agent with context like: "You were previously working in a cloud environment. Here's your progress so far: [summary]. Continue from where you left off."
10. **Destroy** the cloud container

#### Local Worktree → Cloud

1. **Pause** the local agent
2. **Commit** all changes
3. **Push** to remote
4. **Export** session state
5. **Provision** cloud container
6. **Clone** and checkout branch in container
7. **Run** setup script (install deps, etc.)
8. **Start** OpenCode server in container
9. **Import** session state
10. **Resume** agent
11. **Cleanup** local worktree (optional — user might want to keep it)

#### Worktree → Local VM

1. **Pause** agent
2. **Commit** all changes
3. **Provision** VM/container with project image
4. **Mount** or **clone** the repo in the VM
5. **Start** OpenCode server inside VM
6. **Import** session state
7. **Run** setup script (install deps, start dev server)
8. **Resume** agent — it now has full isolation and can run servers, test browsers, etc.

### UX for Migration

Migration is presented as a **simple environment switch**, not a complex operation:

```
┌──────────────────────────────────────────┐
│ Move "Add auth flow" to a new environment│
│                                          │
│ Currently: ☁ Cloud Container             │
│                                          │
│ Move to:                                 │
│ ○ 💻 Local Worktree                      │
│     Fastest. Creates git worktree at     │
│     ~/palot/worktrees/auth-flow       │
│     No process isolation.                │
│                                          │
│ ○ 🐳 Local VM                            │
│     Full dev environment in container.   │
│     Can run servers, test in browser.    │
│     ~5s to provision.                    │
│                                          │
│ What will happen:                        │
│ 1. Agent pauses (current work committed) │
│ 2. Code synced via git                   │
│ 3. Conversation context preserved        │
│ 4. Agent resumes in new environment      │
│                                          │
│ ⚠ Running processes (dev server on :3000)│
│   will be restarted in the new env.      │
│                                          │
│          [Cancel]  [Move Agent]          │
└──────────────────────────────────────────┘
```

---

## 8. User Experience

### Layout: Three-Column Dashboard

```
┌──────────────┬────────────────────────────┬──────────────────────────┐
│   SIDEBAR    │      AGENT LIST            │     DETAIL PANEL         │
│   (220px)    │      (flexible)            │     (420px, collapsible) │
│   fixed      │                            │                          │
├──────────────┼────────────────────────────┼──────────────────────────┤
│              │                            │                          │
│ [+ Agent]    │ Filter ▼  Sort ▼  Search   │  Agent: "Add auth flow"  │
│              │                            │                          │
│ PROJECTS     │ ● "Add auth"    12m  ☁    │  ● Running · ☁ Cloud     │
│  palot(3) │   reading files...         │  12m 34s · 45.2k tokens  │
│  api-srv (1) │                            │  Branch: agent/auth-flow │
│  frontend(2) │ ● "Fix CI"      3m  💻   │                          │
│              │   running tests            │  ┌──────────────────────┐│
│ ENVIRONMENTS │                            │  │[Activity][Diff][Term]││
│  ☁ Cloud (4) │ ✓ "Update deps"  8m  ☁   │  │                      ││
│  💻 Local(2) │   completed                │  │ 12:34 📖 Reading     ││
│              │                            │  │        auth.ts       ││
│ STATUS       │ ✕ "Refactor DB" 15m 💻   │  │ 12:35 🔍 Searching   ││
│  ● Run  (3)  │   failed: OOM             │  │        "handler"     ││
│  ✓ Done (5)  │                            │  │ 12:36 ✏️  Editing    ││
│  ✕ Fail (1)  │                            │  │        middleware.ts ││
│              │                            │  │        +24 -3        ││
│ TODAY        │                            │  │                      ││
│ $2.34        │                            │  └──────────────────────┘│
│ 1.2M tokens  │                            │                          │
│              │                            │  [Send message...]       │
│              │                            │  [⏸ Pause] [⏹ Stop]     │
└──────────────┴────────────────────────────┴──────────────────────────┘
```

### Design Principles

1. **List-first, not board-first.** Lists scale to dozens of agents. Kanban is an alternative view toggle.
2. **Structured over raw.** Show tool calls as structured events (icon + verb + target + summary), not raw terminal. Terminal is one tab away.
3. **Detail is a panel, not a page.** Never lose sight of the agent list. Panel slides in from the right.
4. **Three-action completion.** Every completed agent: `Create PR` | `Apply Locally` | `Request Changes`.
5. **Keyboard-native.** Every action via keyboard. `Cmd+K` command palette for everything else.
6. **Environment as a property.** Cloud/local/VM is a badge you can change, not a separate UI section.
7. **Failed agents surface automatically.** Sorted to top, notification toast, red highlight.
8. **Git is a first-class citizen.** Branch, diff, PR status always visible.

### Agent Status System

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| Running | `●` (pulsing) | Green | Agent is actively working |
| Waiting | `⏳` | Yellow | Waiting for user approval/input |
| Paused | `⏸` | Gray | Manually paused, can resume |
| Completed | `✓` | Blue | Finished successfully |
| Failed | `✕` | Red | Error occurred |
| Migrating | `↗` | Purple | Moving between environments |

### Key UX Flows

#### Spawning a New Agent

Single dialog — no wizard. Minimize friction:

```
┌─────────────────────────────────────────────┐
│  NEW AGENT                                  │
│                                             │
│  Project:     [palot              ▼]     │
│  Environment: [☁ Cloud] [💻 Local] [🐳 VM]  │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ What should this agent work on?     │    │
│  │                                     │    │
│  │ "Add OAuth2 login with Google and   │    │
│  │  GitHub providers"                  │    │
│  │                                     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ▸ Advanced (model, branch, permissions)    │
│                                             │
│              [Cancel]  [Launch]              │
└─────────────────────────────────────────────┘
```

- Project defaults to last used or auto-detected from current directory
- Environment defaults to Cloud (recommended) or last used
- Prompt field is the largest element — most important input
- Advanced options collapsed: model selection, base branch, auto-approve toggle, max token budget
- Launch → agent appears in list immediately with "provisioning" status

#### Reviewing Completed Agent Work

```
┌──────────────────────────────────────────────────┐
│ ✓ COMPLETED: "Add OAuth2 login flow"             │
│ 12 min · 67.4k tokens · $0.18                   │
│                                                  │
│ SUMMARY                                          │
│ Added Google and GitHub OAuth2 providers with    │
│ session management. Created login/callback       │
│ routes and auth middleware.                       │
│                                                  │
│ FILES CHANGED (4)                                │
│ + src/auth/oauth.ts           (+142)  new        │
│ ~ src/middleware/auth.ts      (+24 -3)           │
│ + src/routes/login.ts         (+67)   new        │
│ ~ src/config/env.ts           (+8 -0)            │
│                                                  │
│ [Inline Diff Viewer]                             │
│ ─────────────────────────────────────            │
│ --- a/src/middleware/auth.ts                      │
│ +++ b/src/middleware/auth.ts                      │
│ @@ -12,6 +12,27 @@                               │
│ +export const oauthMiddleware = async (req) => { │
│ +  const token = req.headers.get("Authorization")│
│  ...                                             │
│                                                  │
│ [Create PR]  [Apply Locally]  [Request Changes]  │
│ [Open in Editor]  [Archive]                      │
└──────────────────────────────────────────────────┘
```

#### Environment Migration

Dropdown on the environment badge:

```
Environment: [☁ Cloud ▾]
  ┌────────────────────────────────┐
  │ ☁ Cloud (current)              │
  │ 💻 Move to Local Worktree      │
  │ 🐳 Move to Local VM            │
  └────────────────────────────────┘
```

Selecting a new environment shows a confirmation with what will happen (see Section 7 UX).

### Command Palette (`Cmd+K`)

```
> new agent palot "fix the auth bug"
> stop agent "Add auth flow"
> move "Fix CI" to cloud
> show failed agents
> archive all completed
> open diff "Update deps"
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Command palette |
| `Cmd+N` | New agent |
| `J / K` | Navigate agent list |
| `Enter` | Open agent detail |
| `Escape` | Close detail panel |
| `Cmd+Shift+P` | Switch project |
| `D` | View diff (selected agent) |
| `R` | Retry failed agent |
| `Cmd+.` | Stop running agent |
| `Cmd+Shift+M` | Move agent to different environment |

### Notifications

- **In-app**: Bell icon (top-right) with badge count. Shows completed, failed, waiting-for-input.
- **Desktop**: Native OS notifications for completed/failed agents (opt-in).
- **Sound**: Subtle chime on completion, error tone on failure (configurable, off by default).

### Activity Stream (Detail Panel)

Structured events, not raw terminal output:

```
12:34:02  📖 Reading src/auth/oauth.ts (L1-L45)
12:34:05  🔍 Grep: "login handler" → 3 results
12:34:08  ✏️  Editing src/middleware/auth.ts (+24 -3)
12:34:12  🏃 Running: npm test -- auth.test.ts
12:34:18  ✅ 4/4 tests passed
12:34:20  ✏️  Creating src/routes/login.ts (+67 lines)
```

- Each line is clickable to expand full details (file contents, test output, full diff)
- Auto-scroll with "pin to bottom" toggle
- Failed operations auto-expand
- Terminal tab available for raw output (via xterm.js connected to OpenCode PTY API)

### Multi-Agent Overview (No Agent Selected)

When no agent is selected, the detail panel shows an overview:

```
┌──────────────────────────────────────────┐
│ OVERVIEW                    6 agents     │
│                                          │
│ ●●● Running: 3  ✓✓ Done: 2  ✕ Fail: 1 │
│ Cost today: $2.34    Tokens: 1.2M       │
│                                          │
│ ⚠ Needs attention:                      │
│   "Refactor DB layer" failed 2m ago     │
│   Error: OOM  [View] [Retry] [Delete]   │
│                                          │
│ Recent completions:                      │
│   ✓ "Update deps" — 8m ago              │
│     +45 -12 across 3 files              │
│     [View Diff] [Create PR]             │
│                                          │
│   ✓ "Fix typos" — 23m ago              │
│     +8 -8 across 2 files               │
│     [View Diff] [Create PR]             │
└──────────────────────────────────────────┘
```

---

## 9. Data Model

Palot maintains its own lightweight data layer alongside OpenCode's session storage. This tracks environment assignments, migration history, and UI state that OpenCode doesn't know about.

### Palot State (persisted locally)

```typescript
// Stored in ~/.local/share/palot/state.json (or Tauri app data dir)

interface PalotState {
  version: 1
  projects: ProjectConfig[]
  agents: AgentRecord[]
  migrations: MigrationRecord[]
  preferences: UserPreferences
}

interface ProjectConfig {
  id: string
  path: string                    // Absolute path to project root
  name: string                    // Display name (from package.json or dirname)
  serverPort?: number             // Assigned OpenCode server port
  serverPassword?: string         // Auth credential
  defaultEnvironment: "worktree" | "vm" | "cloud"
  setupScript?: string            // Path to setup script for new environments
  lastAccessed: string            // ISO timestamp
}

interface AgentRecord {
  id: string                      // Palot's ID
  sessionId: string               // OpenCode session ID
  projectId: string               // Which project
  environmentId: string           // Which environment it's running in
  environmentType: "worktree" | "vm" | "cloud"
  prompt: string                  // Original prompt (for display)
  branch: string                  // Git branch
  status: AgentStatus
  createdAt: string
  completedAt?: string
  cost?: { tokens: number, usd: number }
  migrationHistory: string[]      // IDs of migrations this agent went through
}

interface MigrationRecord {
  id: string
  agentId: string
  fromEnv: { type: string, id: string }
  toEnv: { type: string, id: string }
  manifest: MigrationManifest     // The full migration state
  status: "pending" | "in_progress" | "completed" | "failed"
  startedAt: string
  completedAt?: string
  error?: string
}

interface UserPreferences {
  theme: "light" | "dark" | "system"
  defaultModel?: string
  defaultEnvironment: "worktree" | "vm" | "cloud"
  notifications: {
    desktop: boolean
    sound: boolean
    completedAgents: boolean
    failedAgents: boolean
  }
  archiveAfterHours: number       // Auto-archive completed agents (default: 24)
  layout: {
    sidebarWidth: number
    detailPanelWidth: number
    detailPanelOpen: boolean
  }
}
```

---

## 10. API Design

Palot itself doesn't expose a public API (it's a desktop app). But it has internal interfaces between its Rust backend and React frontend.

### Tauri Commands (Rust → JS)

```rust
// Server management
#[tauri::command]
async fn start_project_server(project_path: String) -> Result<ServerInfo, Error>;

#[tauri::command]
async fn stop_project_server(project_id: String) -> Result<(), Error>;

// Environment management
#[tauri::command]
async fn provision_environment(
    project_id: String,
    env_type: String,  // "worktree" | "vm" | "cloud"
    config: EnvironmentConfig
) -> Result<Environment, Error>;

#[tauri::command]
async fn destroy_environment(env_id: String) -> Result<(), Error>;

// Migration
#[tauri::command]
async fn migrate_agent(
    agent_id: String,
    target_env_type: String,
    target_config: EnvironmentConfig
) -> Result<MigrationRecord, Error>;

// State
#[tauri::command]
async fn get_state() -> Result<PalotState, Error>;

#[tauri::command]
async fn update_preferences(prefs: UserPreferences) -> Result<(), Error>;

// Git operations
#[tauri::command]
async fn create_pr(agent_id: String, title: String, body: String) -> Result<String, Error>;
```

### Frontend → OpenCode (via SDK)

All agent interaction goes directly from the React frontend to the OpenCode server using `@opencode-ai/sdk`. The Tauri backend is not in the data path for LLM interactions — it only manages infrastructure (servers, environments, migrations).

```
React Frontend ─── @opencode-ai/sdk ──→ OpenCode Server (HTTP/SSE)
                                              ↕
React Frontend ─── Tauri Commands ────→ Rust Backend (infra management)
```

This keeps the data path simple and avoids double-proxying.

---

## 11. Cloudflare Container Backend

### Architecture

```
┌─────────────────────┐         ┌──────────────────────────────┐
│   Palot App      │         │   Cloudflare Edge            │
│                     │  HTTPS  │                              │
│   Cloud Backend ────┼────────>│   Worker (router)            │
│                     │  WSS    │     │                        │
│                     │<────────┤     ▼                        │
│                     │         │   Durable Object             │
└─────────────────────┘         │     │                        │
                                │     ▼                        │
                                │   Container (VM)             │
                                │   ┌────────────────────────┐ │
                                │   │ Ubuntu + OpenCode      │ │
                                │   │ + Node.js + Python     │ │
                                │   │ + Chromium + git        │ │
                                │   │                        │ │
                                │   │ opencode serve         │ │
                                │   │   :8080 ──────────────>│ │
                                │   └────────────────────────┘ │
                                └──────────────────────────────┘
```

### Worker Code (manages containers)

```typescript
import { Container, getContainer } from '@cloudflare/containers'

export class AgentContainer extends Container {
  defaultPort = 8080          // OpenCode server port
  sleepAfter = '30m'          // Keep alive for 30 min of inactivity
  enableInternet = true       // Agents need to fetch packages, access APIs
  
  get envVars() {
    return {
      OPENCODE_SERVER_PASSWORD: this.ctx.storage.get('password'),
      OPENCODE_SERVER_USERNAME: 'palot',
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const agentId = url.pathname.split('/')[2] // /agent/{id}/...
    
    // Route to specific agent container
    const container = getContainer(env.AGENT_CONTAINER, agentId)
    
    // Forward request (including WebSocket upgrades for PTY)
    const agentPath = '/' + url.pathname.split('/').slice(3).join('/')
    return container.fetch(new Request(
      `http://container${agentPath}`,
      request
    ))
  }
}
```

### Container Image

```dockerfile
FROM ubuntu:24.04

# System deps
RUN apt-get update && apt-get install -y \
    curl git build-essential python3 python3-pip \
    chromium-browser fonts-noto-color-emoji

# Bun (for OpenCode)
RUN curl -fsSL https://bun.sh/install | bash

# OpenCode
RUN bun install -g opencode

# agent-browser (for frontend testing)
RUN npm install -g agent-browser

# Entrypoint: start OpenCode server
ENTRYPOINT ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "8080"]
```

### Resource Configuration

For coding agents, `standard-1` (0.5 vCPU, 4 GiB RAM, 8 GB disk) is the recommended starting point. Bump to `standard-2` for projects with large `node_modules` or compilation needs.

### Workspace Persistence

Since Cloudflare Container disk is ephemeral:

1. **Git as persistence**: All meaningful work is committed to git. On container wake, clone fresh and checkout branch.
2. **R2 FUSE mount** (optional): Mount an R2 bucket for `node_modules` caching or large workspace persistence.
3. **Session state in Durable Object SQLite**: Store the migration manifest and session metadata in the DO's built-in SQLite.

---

## 12. Local VM Backend

### v1: Docker (via OrbStack on macOS, native on Linux)

```typescript
class DockerVmBackend implements RuntimeBackend {
  async provision(config: EnvironmentConfig): Promise<Environment> {
    const containerName = `palot-${generateId()}`
    const port = await findAvailablePort()
    const password = generateUUID()

    // Start container
    await exec(`docker run -d \
      --name ${containerName} \
      -p ${port}:8080 \
      -v ${config.projectPath}:/workspace \
      -e OPENCODE_SERVER_PASSWORD=${password} \
      -e OPENCODE_SERVER_USERNAME=palot \
      palot/agent-env:latest \
      opencode serve --hostname 0.0.0.0 --port 8080`, {
        cwd: config.projectPath
    })

    // Wait for server to be ready
    await waitForHealth(`http://127.0.0.1:${port}`)

    return {
      id: containerName,
      type: "vm",
      serverUrl: `http://127.0.0.1:${port}`,
      serverPassword: password,
      directory: "/workspace",
      branch: config.branch || "main",
      createdAt: new Date(),
    }
  }
}
```

### v2: Cloud Hypervisor (Linux, for full VM isolation with virtiofs)

For users who need stronger isolation than Docker provides (e.g., running untrusted agent code), Cloud Hypervisor provides VM-level isolation with virtiofs for shared filesystem access.

---

## 13. Security & Permissions

### OpenCode Server Auth

Every OpenCode server instance is protected with HTTP Basic Auth:
- Palot generates a UUID password per server instance
- Stored in Palot's encrypted state (via Tauri's secure storage)
- Passed to `@opencode-ai/sdk` client configuration

### Cloud Container Security

- Cloudflare Containers run in individual VMs (strong isolation)
- `enableInternet` can be set to `false` for sandboxed execution
- Communication between Palot and cloud containers is over HTTPS/WSS
- Container-to-container communication is not possible (each is isolated)

### Local VM Security

- Docker containers run with default security profile
- Consider AppArmor/SELinux profiles for production
- Volume mounts are read-write to project directory only

### Permission Delegation

OpenCode's built-in permission system handles tool-level permissions (bash commands, file edits, etc.). Palot adds environment-level permissions:

- Which projects can use cloud environments (may involve cost)
- Whether agents can access the network
- Resource limits per agent (CPU, memory, token budget)

---

## 14. Implementation Plan

### Phase 1: Foundation (Effort: HIGH)

**Goal:** Working desktop app with local worktree agents.

1. **Scaffold Tauri + Vite + React + shadcn/ui project**
   - Set up monorepo structure
   - Configure Tailwind, dark mode, base layout components
   - Implement three-column layout shell

2. **OpenCode server management**
   - Rust backend: spawn/stop OpenCode servers via Shell plugin
   - Health checking and auto-restart
   - Multi-project server registry

3. **Agent CRUD via OpenCode SDK**
   - Create sessions, send prompts
   - SSE event subscription and routing
   - Session status polling

4. **Dashboard UI**
   - Agent list with status indicators
   - Sidebar with project filtering
   - Detail panel with Activity, Diff, Terminal tabs
   - Agent creation dialog
   - Command palette (Cmd+K)

5. **Worktree backend**
   - Create/destroy git worktrees
   - Spawn OpenCode servers in worktree directories
   - Branch management

**Deliverable:** You can create agents in local worktrees, monitor them in real-time, review diffs, and archive completed work.

### Phase 2: Cloud Agents (Effort: HIGH)

**Goal:** Agents can run in Cloudflare Containers.

1. **Cloudflare infrastructure**
   - Worker + Container definition
   - Agent container Docker image
   - Deployment pipeline (wrangler)

2. **Cloud backend implementation**
   - Provision/destroy containers via Cloudflare API
   - WebSocket/HTTPS proxy for OpenCode server access
   - Container status monitoring

3. **Workspace persistence**
   - Git-based workspace restore on container start
   - R2 FUSE mount for dependency caching (optional)

4. **UI integration**
   - Cloud environment option in agent creation
   - Resource monitoring display (CPU, memory, disk)
   - Cost tracking per cloud agent

**Deliverable:** You can create agents in the cloud, monitor them alongside local agents, and see resource usage.

### Phase 3: Agent Mobility (Effort: VERY HIGH)

**Goal:** Move agents between environments with state preserved.

1. **Migration engine**
   - Migration manifest generation and parsing
   - Git state transfer (commit, push, pull, patch)
   - Session state export/import

2. **Session continuity**
   - Conversation summarization for context transfer
   - Session reconstruction in new environment
   - Running process manifest and reconstruction

3. **Migration UI**
   - Environment switcher dropdown
   - Migration progress indicator
   - Error handling and rollback

**Deliverable:** You can move a cloud agent to a local worktree (or vice versa) with code, conversation context, and environment state preserved.

### Phase 4: Local VM Backend (Effort: MEDIUM)

**Goal:** Full dev environment isolation locally.

1. **Docker-based VM backend**
   - Container lifecycle management
   - Port mapping for OpenCode server + dev server
   - Volume mounting for project files

2. **Dev environment features**
   - Pre-built images with common dev tools
   - Browser testing support (Chromium + agent-browser)
   - Port forwarding for testing web apps

3. **UI integration**
   - VM environment option
   - Resource monitoring
   - Browser preview tab (iframe to forwarded port)

**Deliverable:** Agents can run in full local containers with browser testing capability.

### Phase 5: Polish & Advanced Features (Effort: MEDIUM)

1. **PR creation** from completed agents (via `gh` CLI or GitHub API)
2. **Bulk operations** (archive all completed, stop all cloud agents)
3. **Agent templates** (reusable prompts per project)
4. **Cost budgets** and alerts
5. **Team notifications** (Slack/Discord webhook)
6. **Auto-archive** for completed agents after configurable duration

---

## 15. Open Questions

### Architecture

1. **Single server vs. multi-server for multi-project**: We default to one server per project. Should we support a single-server mode for resource-constrained machines?

2. **How to handle OpenCode version mismatches**: If the user's installed OpenCode version doesn't match what Palot expects, how do we handle API incompatibilities? Pin a minimum version and check on startup?

3. **Should Palot bundle OpenCode?** Or require it as a prerequisite? Bundling (as a Tauri sidecar) ensures version compatibility but increases app size and complicates updates.

### Agent Mobility

4. **How much conversation context to transfer?** Full message history (expensive, may exceed context window) vs. AI summary (lossy but compact). Configurable per migration?

5. **What happens to child sessions (subagents) during migration?** Transfer them too, or let the agent re-create them?

6. **Should we support "live" migration (without pausing)?** Much harder technically but better UX. Git-based approach requires a pause. Could we do incremental sync?

### Cloud

7. **Multi-region container placement**: Should users choose where their cloud agent runs, or let Cloudflare auto-place?

8. **Persistent cloud environments**: Should we support "always-on" cloud environments for specific projects, or always ephemeral + scale-to-zero?

9. **Shared container images**: Can multiple agents share a base image to reduce cold start? Or does each need its own?

### UX

10. **When to default to cloud vs. local?** Cloud is more isolated and doesn't consume local resources, but has cold start and cost. Local is instant and free. What should the default be?

11. **Agent grouping**: By project (current design) or by task type? Or both?

12. **Maximum useful agents**: Research suggests ~5 parallel agents is the human attention limit. Should we enforce or warn about this?

### Discovery & Onboarding

13. **Auto-detect existing OpenCode projects and sessions**: Instead of requiring manual "Connect Server", Palot could auto-discover:
    - **Running servers**: OpenCode supports `--mdns` for mDNS service discovery. Palot could listen for `_opencode._tcp` services on the local network.
    - **Port scanning**: Scan common ports (4096, or read from OpenCode's state files) for running servers.
    - **OpenCode state directory**: Read `~/.opencode/` (or `$XDG_STATE_HOME/opencode/`) to find known projects, their directories, and last-used ports. OpenCode stores project configs with `projectID` hashes — Palot could map these to directories and auto-connect.
    - **Process detection**: On startup, scan running processes for `opencode serve` instances and extract their `--port` and working directory.
    - This would make the first-run experience seamless: open Palot, and it already shows your projects and sessions.

14. **Auto-spawn servers for known projects**: When Palot detects a project directory but no running server, should it auto-spawn `opencode serve` for that project? This would eliminate the need to manually start servers, but introduces lifecycle management complexity (who owns the process? what happens on app quit?).

---

*End of Design Document*
