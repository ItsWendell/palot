# Palot Cloud: Architecture & Strategy Plan

> **Status**: Research & Scoping (Feb 2026)
> **Last updated**: Feb 11, 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Infrastructure: Cloudflare Workers + Containers + Durable Objects](#3-infrastructure)
4. [Agent Runtime: OpenCode Serve](#4-agent-runtime)
5. [Database: Neon Postgres + Drizzle ORM](#5-database)
6. [Authentication: GitHub OAuth + Arctic](#6-authentication)
7. [Security Model](#7-security-model)
8. [File System Persistence](#8-file-system-persistence)
9. [Local-to-Cloud Data Sync](#9-data-sync)
10. [MCP Servers in the Cloud](#10-mcp-servers)
11. [Billing & Metering](#11-billing)
12. [Multi-Tenant Isolation & Abuse Prevention](#12-abuse-prevention)
13. [UX Differentiation vs Competitors](#13-ux-differentiation)
14. [The Unknown Unknowns](#14-unknown-unknowns)
15. [Database Schema](#15-database-schema)
16. [Cost Projections](#16-cost-projections)
17. [Implementation Roadmap](#17-roadmap)
18. [REVISED: Hosting & Runtime Recommendations](#18-hosting-runtime)

---

## 1. Executive Summary

Palot Cloud extends the desktop Electron app with cloud-hosted coding agent sessions. Users can:
- Run agents in the cloud when they don't have local compute
- "Push" long-running tasks to the cloud and walk away
- "Pull" cloud work back to local seamlessly
- Monitor and steer agents from any device (mobile, tablet, browser)
- Share agent sessions with teammates

### Core Technology Decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Edge/API** | Cloudflare Workers | Global edge, sub-ms routing, native WebSocket/SSE |
| **Agent Runtime** | OpenCode `serve` in CF Containers | Open-source, REST+SSE API, multi-provider, Docker image available |
| **State Coordination** | Durable Objects | Per-session state, WebSocket hibernation, container lifecycle |
| **Database** | Neon Postgres + Drizzle ORM | Serverless Postgres, CF Workers native driver, type-safe ORM |
| **Auth** | GitHub App + Arctic v3 | Fine-grained permissions, short-lived tokens, edge-native |
| **Secrets** | Envoy sidecar credential proxy | Zero secrets in container, JWT-based identity |
| **Persistence** | Git + JuiceFS (R2 backend) | Code via git, caches/config via JuiceFS FUSE mount |
| **Billing** | Stripe Meters API + CF Analytics Engine | Real-time metering, transparent pricing, hard spend caps |
| **Sync** | Append-only event log + REST API | Simple, no CRDTs needed, single-writer model |

### Positioning

> **"The coding agent you can actually collaborate with."**
>
> Not fire-and-forget. Not an outsourcing firm you hope gets it right. A real-time
> collaborator that streams its work, accepts your corrections mid-flight, and
> never surprises you with the bill.

---

## 2. Architecture Overview

```
                                    User's Browser / Desktop App
                                              |
                                         HTTPS / WSS
                                              |
                              +===============================+
                              |     CF Worker (Edge)           |
                              |   - Auth (JWT validation)      |
                              |   - Rate limiting              |
                              |   - Session routing            |
                              |   - Static assets (free)       |
                              |   - REST API endpoints         |
                              +===============+===============+
                                              |
                                   getContainer(env.AGENT, sessionId)
                                              |
                              +===============================+
                              |   Durable Object (per session) |
                              |   - Session state (SQLite 10GB)|
                              |   - Container lifecycle mgmt   |
                              |   - WebSocket hibernation      |
                              |   - Conversation persistence   |
                              |   - Health monitoring / alarms |
                              +===============+===============+
                                              |
                                    ctx.container.start()
                                              |
                    +=========================================+
                    |   CF Container (Firecracker microVM)     |
                    |   standard-2: 1 vCPU, 6 GiB, 12 GB disk |
                    |                                          |
                    |  +----------------+ +------------------+ |
                    |  | OpenCode serve | | Envoy Sidecar    | |
                    |  | (port 4096)    | | (credential      | |
                    |  | - REST + SSE   | |  proxy)          | |
                    |  | - Tool exec    | | - Injects auth   | |
                    |  | - Git ops      | |   headers        | |
                    |  +----------------+ | - Egress filter  | |
                    |                     +------------------+ |
                    |  +----------------+ +------------------+ |
                    |  | JuiceFS mount  | | MCP Gateway      | |
                    |  | /persist (R2)  | | (mcp-proxy)      | |
                    |  | - Dep caches   | | - GitHub MCP     | |
                    |  | - User config  | | - Slack MCP      | |
                    |  +----------------+ | - Custom servers | |
                    |                     +------------------+ |
                    +=========================================+
                         |              |              |
                    +----+----+   +----+----+   +----+----+
                    | CF R2    |   | Neon    |   | Upstash |
                    | (blobs,  |   | Postgres|   | Redis   |
                    |  caches) |   | (data)  |   | (JuiceFS|
                    +----------+   +---------+   |  meta)  |
                                                 +---------+
```

---

## 3. Infrastructure

### Cloudflare Workers

V8 isolate-based serverless at 330+ edge locations. Handles all incoming requests.

| Resource | Free | Paid ($5/mo) |
|----------|------|-------------|
| Requests | 100K/day | 10M/mo included, then $0.30/M |
| CPU time | 10ms | 5 min/HTTP, 15 min/Cron |
| Memory | 128 MB | 128 MB |
| Script size | 3 MB | 10 MB |

Workers handle: auth, routing, rate limiting, static assets. They do NOT run the agent.

### Cloudflare Containers (Public Beta, June 2025)

Full Linux containers (Docker, `linux/amd64`) in Firecracker microVMs. This is where the agent runs.

| Instance | vCPU | Memory | Disk | Cost/hr (approx) |
|----------|------|--------|------|-------------------|
| lite | 1/16 | 256 MiB | 2 GB | ~$0.003 |
| basic | 1/4 | 1 GiB | 4 GB | ~$0.01 |
| standard-1 | 1/2 | 4 GiB | 8 GB | ~$0.06 |
| **standard-2** | **1** | **6 GiB** | **12 GB** | **~$0.13** |
| standard-3 | 2 | 8 GiB | 16 GB | ~$0.22 |
| standard-4 | 4 | 12 GiB | 20 GB | ~$0.38 |

**Key properties:**
- Scale-to-zero: containers sleep after configurable timeout, billing stops
- Cold start: 2-3 seconds
- Ephemeral disk: wiped on restart (persistence via R2/JuiceFS)
- No inbound TCP/UDP: all traffic through Workers (HTTP/WebSocket only)
- `enableInternet` flag: can disable outbound internet per container
- Account limits (beta): 400 GiB memory, 100 vCPU, 2 TB disk total

**Container class extends Durable Object** — lifecycle management is built-in:

```ts
export class AgentContainer extends Container {
  defaultPort = 4096       // OpenCode serve port
  sleepAfter = "5m"        // Sleep after 5 min idle
  // enableInternet = true  // outbound access (gated by trust tier)
}
```

### Durable Objects

Globally unique, single-threaded JS objects with strong consistency. One per session.

- SQLite-backed storage: **10 GB per DO** (paid plan)
- WebSocket Hibernation API: charges only per incoming message when idle
- Alarms for scheduled cleanup/timeout

**Role**: Session state, conversation persistence, container lifecycle, WebSocket relay.

### Prior Art

[ghostwriternr/claude-code-containers](https://github.com/ghostwriternr/claude-code-containers) demonstrates exactly this pattern: CF Container running Claude Code, triggered by GitHub issues. Referenced in CF's official blog.

---

## 4. Agent Runtime

### OpenCode Serve Mode

OpenCode is a TypeScript/Bun monorepo with a Go TUI frontend. The `serve` command exposes a complete HTTP API.

```bash
opencode serve --hostname 0.0.0.0 --port 4096
```

**API surface** (OpenAPI 3.1 spec at `/doc`):

| Category | Key Endpoints |
|----------|--------------|
| Sessions | `POST /session`, `GET /session/:id`, `DELETE /session/:id` |
| Messaging | `POST /session/:id/message` (sync), `POST /session/:id/prompt_async` (async) |
| Events | `GET /event` (SSE), `GET /global/event` (global SSE) |
| Files | `GET /file/content?path=`, `GET /file/status`, `GET /find?pattern=` |
| Providers | `GET /provider`, `PUT /auth/:id` |
| MCP | `GET /mcp`, `POST /mcp` |
| Config | `GET /config`, `PATCH /config` |

**Transport**: REST + SSE (no WebSocket). Single-tenant by design (one instance = one project).

**SDK**: `@opencode-ai/sdk` (npm) for programmatic access.

**Docker image**: `ghcr.io/anomalyco/opencode:latest`

**Container config**:

```dockerfile
FROM ghcr.io/anomalyco/opencode:latest
WORKDIR /workspace
ENV OPENCODE_PERMISSION='{"bash":"allow","write":"allow","edit":"allow","read":"allow"}'
ENV OPENCODE_DISABLE_AUTOUPDATE=true
EXPOSE 4096
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
```

**Key advantage over Claude Code server**: OpenCode is provider-agnostic (Anthropic, OpenAI, Google, local), open source (MIT), has a published OpenAPI spec, and a proper SDK. Claude Code's server mode is proprietary with an undocumented SSE protocol.

---

## 5. Database

### Why Neon Postgres (not PlanetScale)

| Factor | Neon | PlanetScale |
|--------|------|------------|
| Free tier | Generous (100 CU-hrs) | None (removed Mar 2024) |
| CF Workers driver | `@neondatabase/serverless` (native HTTP) | `@planetscale/database` |
| SQL dialect | Postgres (JSONB, pgvector, extensions) | MySQL (Vitess) |
| Branching | Copy-on-write DB branches | Schema-only branches |
| HA pricing | Usage-based, no minimum | $39/mo minimum |
| Financial backing | Acquired by Databricks | Independent |

### Drizzle ORM (not Prisma)

| Factor | Drizzle | Prisma |
|--------|---------|--------|
| Bundle size | ~50-80 KB | 2-4 MB+ |
| CF Workers | Native, zero binaries | Requires Accelerate proxy |
| Cold start | Minimal | Heavy (engine init) |
| SQL closeness | "If you know SQL, you know Drizzle" | Abstracted API |
| Type safety | Full inference from TS schema | Generated from `prisma generate` |

### Connection Strategy

- **HTTP mode** (`drizzle/neon-http`): For single queries — fastest, no connection overhead
- **WebSocket mode** (`drizzle/neon-serverless`): For transactions — multi-statement support
- **Cloudflare Hyperdrive**: Connection pooling at the edge, warm pools for near-zero connect time

### Cost Projection

| Stage | Users | Neon Cost/mo |
|-------|-------|-------------|
| Dev | 1-5 | $0 (free tier) |
| Launch | 100 | $10-30 |
| Growth | 1,000 | $50-150 |
| Scale | 10,000+ | $300-1,000 |

---

## 6. Authentication

### GitHub App (not OAuth App)

A GitHub App provides fine-grained permissions, short-lived tokens (1hr), refresh tokens, and bot identity. Users select specific repos to grant access to.

**Required permissions**: Contents (R/W), Pull Requests (R/W), Issues (R/W), Metadata (R), Email (R).

### Auth Stack

| Layer | Technology |
|-------|-----------|
| OAuth client | **Arctic v3** (Fetch-native, zero deps, CF Workers compatible) |
| HTTP framework | **Hono** (already in `apps/server`) |
| Session storage | **CF KV** (signed JWT cookie + full session in KV) |
| User database | **Neon Postgres** via Drizzle |
| Secret encryption | **Web Crypto API** (AES-256-GCM, native to Workers) |

### Session Model

Hybrid JWT + KV:
- Short-lived signed JWT in HttpOnly cookie (session ID + user ID, 1hr expiry)
- Full session data (encrypted GitHub tokens, refresh tokens) in CF KV (30-day TTL)
- Token refresh handled proactively (5min buffer before expiry)

### What NOT to Use

- **Better Auth**: Too many CF Workers friction points (D1 binding issues)
- **Lucia Auth**: Deprecated (March 2025)
- **Auth0/Clerk**: Unnecessary cost for a dev tool where GitHub IS the identity

---

## 7. Security Model

### Threat Landscape

AI coding agents are uniquely dangerous: they have shell access, filesystem access, network access, and hold user credentials. Every platform that stores secrets as environment variables is vulnerable (Devin demonstrated full credential theft via `curl`, browser navigation, and markdown image rendering).

### Defense-in-Depth Architecture

```
Layer 0: CF Edge       — DDoS protection, WAF, rate limiting
Layer 1: Worker        — Auth, session routing, spend cap enforcement
Layer 2: Durable Object — Container lifecycle, JWT issuance
Layer 3: Firecracker VM — Hardware-isolated microVM per session
Layer 4: Envoy Sidecar — Credential injection, egress filtering
Layer 5: Monitoring    — Syscall audit, network logging, anomaly detection
```

### The Envoy Sidecar Credential Proxy (Critical)

**Zero secrets in the container.** The agent process cannot read API keys.

```
Agent Process               Envoy Sidecar              Credential Resolver
  |                            |                            |
  |-- HTTP to localhost:8001 ->|                            |
  |   (no auth headers)        |-- ext_authz + JWT ------->|
  |                            |<-- auth headers ----------|
  |                            |-- request + auth -------> Anthropic API
  |<-- response ---------------|
```

- Container gets a signed JWT (identity only, no secrets)
- Envoy intercepts outbound requests, injects auth headers
- Agent literally cannot see credentials (`env | grep KEY` returns nothing)
- All credential usage logged with tenant ID and timestamp

### Network Security

Default-deny egress. Allowlist only:
- `api.anthropic.com` (via Envoy proxy only)
- `github.com` (via Envoy proxy)
- `registry.npmjs.org`, `pypi.org` (direct)
- Internal services

### Supply Chain Mitigations

The 2025 npm supply chain attacks (8 malicious Nx releases, 40+ trojanized packages) show agents will install compromised packages automatically.

- Lock file enforcement (reject `npm install` without lockfile)
- Read-only base filesystem (only `/workspace` and `/tmp` writable)
- No persistent shell config (`.bashrc`, `.npmrc` read-only from image)
- Outbound domain allowlisting at network level

### GDPR/Compliance

- Region-aware container scheduling (EU users → EU data centers)
- Data stored in region-appropriate R2 buckets
- Right to deletion: conversation history deletable via API, containers ephemeral
- LLM calls use zero-retention mode (no training on user data)

---

## 8. File System Persistence

### The Problem

CF Containers have ephemeral disk — wiped on restart/sleep. But coding agents need persistent repos, node_modules, build caches.

### R2 FUSE is Too Slow Alone

Benchmarks for 1KB objects (typical source files):

| Metric | Raw R2 | With JuiceFS |
|--------|--------|-------------|
| Read latency (p50) | **606 ms** | **2 ms** |
| Write latency (p50) | **197 ms** | **2 ms** |
| Small file reads/s | ~2 | **10,280** |
| Small file writes/s | ~2 | **1,320** |

Raw R2 FUSE is 100-500x too slow for coding. JuiceFS adds a local cache layer + separate metadata engine that makes it usable.

### Recommended 3-Tier Architecture

```
Tier 1: Ephemeral Local Disk (8-20 GB)
  - /workspace (active project files, cloned from git)
  - /workspace/node_modules (hot cache)
  - Full-speed local I/O

Tier 2: JuiceFS FUSE Mount -> R2
  - /persist (user dotfiles, dep caches, snapshots)
  - Upstash Redis for metadata, R2 for data chunks
  - Local disk as read/write cache -> ~2ms latency

Tier 3: Git Remote (source of truth for code)
  - git clone on start, git push on sleep
  - Patches for uncommitted changes
```

### Container Lifecycle

**On Start** (target: <15s):
1. JuiceFS mounts `/persist` (instant — metadata from Redis)
2. `git clone --depth 1` repo to `/workspace` (1-5s)
3. Apply workspace patch from `/persist/snapshots/` if exists
4. Restore cached node_modules from JuiceFS

**On Sleep** (SIGTERM, 15-min window):
1. `git stash` → push stash to remote branch
2. Save workspace patch to `/persist/snapshots/`
3. Tar critical caches to JuiceFS
4. JuiceFS flushes dirty pages to R2

**Background** (every 60s during operation):
- Incremental workspace backup via `rclone sync` to R2

### Implementation Phases

| Phase | Approach | Wake Time |
|-------|----------|-----------|
| 1 (MVP) | Git clone + tar snapshots to R2 | 15-45s |
| 2 | Add JuiceFS for caches/config | 8-20s |
| 3 | Turborepo remote cache on R2 + smart pre-warming | 5-15s |
| 4 | Custom FUSE filesystem (Replit-style) | <5s |

---

## 9. Data Sync

### Why NOT CRDTs

CRDTs are for multi-writer concurrent editing. Palot Cloud's sync is:
- **Single-writer, multi-location**: One user moving between local and cloud
- **Sequential, not concurrent**: Never editing from two places simultaneously
- **Append-only data**: Conversation history is an ordered log of immutable messages

CRDTs add complexity that buys nothing here.

### Sync Model: "Git for Code, Postgres for State, API for Writes"

| Data Type | Strategy |
|-----------|----------|
| Conversation history | Append-only event log in Neon (POST to API) |
| Code changes | Git (push to branch, apply patches) |
| Agent config | LWW via API, stored in Neon |
| MCP server list | LWW per-item via API |

### Session Handover Protocol

**Local -> Cloud ("Push to cloud"):**
1. Serialize conversation event log
2. `git push` committed work to branch
3. Transfer `git diff` for uncommitted changes
4. POST session state to cloud API
5. Cloud provisions container, clones repo, applies patch, restores conversation

**Cloud -> Local ("Pull to local"):**
1. Push code changes to branch
2. Update session event log in Neon
3. Desktop app fetches branch, applies changes, loads conversation

This mirrors Claude Code's `&` (push) and `/teleport` (pull) patterns.

### Phased Implementation

| Phase | What |
|-------|------|
| 1 | Cloud storage for conversation history (always online) |
| 2 | Session handover (push/pull between local and cloud) |
| 3 | Offline-first local (SQLite queue, sync when online) |
| 4 | Real-time awareness (ElectricSQL shapes for live updates) |

---

## 10. MCP Servers

### The Challenge

Locally, MCP servers run as stdio child processes. In the cloud, the container doesn't have the user's local services/credentials.

### Server Classification

| Tier | Type | Examples | Cloud Strategy |
|------|------|----------|----------------|
| 1 | Cloud-native (API-based) | GitHub, Slack, Linear, Sentry | Run directly in container |
| 2 | Adaptable (filesystem) | filesystem, git, SQLite | Works on container's checkout |
| 3 | Needs proxy (private network) | Local PostgreSQL, internal APIs | Bridge via desktop app tunnel |
| 4 | Cannot work in cloud | Desktop apps, hardware | Gracefully unavailable |

### In-Container MCP Gateway

Use `mcp-proxy` (2.2k GitHub stars) as an aggregator inside the container:

```bash
mcp-proxy --host 127.0.0.1 --port 8787 \
  --named-server-config /tmp/mcp-servers.json
```

The agent connects via Streamable HTTP to `localhost:8787/servers/{name}/mcp`.

### Local Bridge (Desktop as MCP Proxy)

For Tier 3 servers, the Palot desktop app acts as a bridge:

```
Desktop App (user's machine)
  └── mcp-proxy (SSE→stdio mode)
       └── Local PostgreSQL MCP
       └── Internal API MCP

  Secure WebSocket tunnel
       |
       v

Cloud Container
  └── mcp-remote (stdio→HTTP adapter)
       └── Connects to tunnel endpoint
```

### MCP Management UI

- **Browser/Marketplace**: Pull from official MCP Registry (8,240+ servers)
- **Per-project config**: Visual editor for MCP servers per project
- **Credential management**: Per-server secret config with visual status indicators
- **Health monitoring**: Connection status, available tools, error logs

### Security for Third-Party MCP Servers

- Per-server env var scoping (GitHub MCP only gets `GITHUB_TOKEN`, not `SLACK_TOKEN`)
- Network egress allowlists per server
- Supply chain: pin versions, verify checksums
- User consent: first-time tool use requires approval

---

## 11. Billing & Metering

### What Went Wrong at Competitors

- **Devin**: Opaque "ACU" unit. `git status` costs 8 cents. Users can't predict costs.
- **Cursor**: Switched to credits, users got surprise $1,000+ bills. CEO had to apologize.
- **Augment**: Credit system confused users. Reddit: "opaque and confusing."

### Palot Cloud Pricing Model

```
FREE               $0/mo
  - 50 sessions/month, Sonnet 4 only (our key)
  - 30-min max session, 1 concurrent
  - $5 usage included (hard cap, no overage)

PRO                $30/mo
  - $30 usage credit included
  - All models, 2-hour max, 3 concurrent
  - BYOK option (use own API keys, $0 for inference)
  - Overage: at-cost + 20%, default hard cap at $50/mo

TEAM               $50/user/mo
  - $50 usage credit per user
  - 5 concurrent sessions, shared persistence
  - Admin spend controls, usage dashboard

ENTERPRISE         Custom
  - Volume discounts, SSO/SAML, dedicated pools
```

**Key principles:**
- **No invented units** — costs shown in dollars with token breakdown
- **Hard cap by default** — user must explicitly raise spending limit
- **BYOK first-class** — power users bring own keys, pay $0 for inference
- **Transparent margin** — users see they're paying near-API rates

### Metering Architecture

```
OpenCode SSE events → CF Worker captures token counts
                          |
                    CF Analytics Engine (fast path, real-time queries)
                          |
                    CF Queue → Neon Postgres (authoritative billing ledger)
                          |
                    5-min cron → Stripe Meters API (batched usage reports)
```

### "Taxi Meter" UX

```
Session Cost: $0.47
  LLM (Sonnet 4):     $0.42
    Input:  12,340 tokens ($0.04)
    Output: 25,120 tokens ($0.38)
  Compute:             $0.04
  Network:             $0.01

Monthly Budget: $12.47 / $30.00  [======-----] 42%
Est. remaining: ~14 sessions like this
```

### Spend Cap Enforcement

- Check budget BEFORE every LLM inference
- In-memory cache (30s refresh) for hot path
- Authoritative query to Neon for near-cap decisions
- Warnings at 80%, banner at 95%, pause at 100%

---

## 12. Abuse Prevention

### Why Cloud Agent Platforms Are Uniquely Vulnerable

Unlike CI/CD: agents run long-lived sessions, have interactive shell access, require internet access, and run untrusted code by design. Every platform with a free tier got burned by crypto mining (Heroku eliminated free plans entirely).

### Trust Tier System

```
Tier 0 (Unverified)   — Email only. No container access.
Tier 1 (Verified)     — Payment method validated. lite instance, 15 min, no net, 3/day.
Tier 2 (Trusted)      — Clean history 7+ days. basic instance, 2 hours, limited net, 10/day.
Tier 3 (Premium)      — Active subscription + 30d clean. standard-2, 24 hours, full net, 50/day.
```

**Trust scoring**: GitHub account age/activity (15pts), payment method (25pts), active subscription (30pts), IP reputation (10pts), account age with activity (10pts).

### Detection Signals

| Abuse | Signal | Detection |
|-------|--------|-----------|
| Crypto mining | Sustained 100% CPU >5 min | CPU metrics + process name monitoring |
| DDoS | Burst outbound to single target | Egress proxy logging |
| Data exfiltration | >500MB egress in 10 min, session <30 min | Volume anomaly alert |
| Account farming | Same device fingerprint, disposable email | Registration analysis |

### Network Controls

- `enableInternet = false` for Tier 0/1 (most powerful single defense)
- All outbound through egress proxy Worker (logging + domain allowlist)
- Block known mining pool domains/IPs
- Rate limit outbound HTTP per container

---

## 13. UX Differentiation

### Competitive Pain Points (Every Competitor)

| Pain Point | Who Suffers | Palot Opportunity |
|------------|-------------|---------------------|
| **Can't steer mid-task** | Codex queues msgs, Devin is autonomous | Real-time streaming + interrupt + redirect |
| **Opaque costs** | Devin ACUs, Cursor credits, Augment credits | Live taxi meter, pre-session estimates, hard caps |
| **No local-cloud transition** | All competitors are one or the other | Same app, push/pull seamlessly |
| **Poor diff review** | Most dump walls of changes | Per-hunk approve/reject, inline comments |
| **Error compounding** | Universal: agent loops, context drift | Test gates, drift detection, decisions log |
| **Platform lock-in** | Codex (macOS), Cursor (their IDE), Devin (web) | Web + Electron on all platforms |

### Priority UX Features

**P0 (Launch):**
- Real-time streaming of agent actions with interrupt capability
- Transparent cost display (taxi meter)
- Seamless local-to-cloud push/pull
- Shareable session URLs for team collaboration
- AGENTS.md injection for project memory

**P1 (V2):**
- Per-hunk change approval with inline agent-readable comments
- Mobile-responsive web app (PWA) for status monitoring
- Slack integration for approve/reject
- REST API for programmatic triggers / GitHub webhooks
- Session summaries and manual memory management

**P2 (Later):**
- Multi-agent orchestration with visual dashboard
- Auto-pattern detection and learning across sessions
- Event-based triggers (CI failure → auto-debug)
- Collaborative session steering (multiplayer)

---

## 14. The Unknown Unknowns

### Things You Didn't Think About

**SSE Heartbeat (Critical):** Cloudflare Workers have a 100-second default timeout on SSE connections. Claude's extended thinking can be 30-60s of silence. Without heartbeat events every 15s, long-running agent sessions will appear to "hang" and disconnect.

**Git Checkpointing (Critical):** Container crashes will happen. If 30 minutes of agent work exists only in ephemeral disk, it's gone. The agent must commit to git after every significant change batch — not just at the end.

**Conversation Persistence (Critical):** Persist to Neon after every message exchange, not batched at session end. A crash should lose at most the current in-flight message, not the entire session.

**Mobile UX:** Developers will kick off agents and check from their phone. Don't build a full mobile diff viewer — build status cards, AI-generated change summaries, and one-tap approve/reject. Cursor already shipped mobile agents at `cursor.com/agents`.

**Agent Observability:** When the agent produces garbage, users need to understand why. Build a collapsible tool-call timeline from day one. Full Langfuse-style tracing can come later, but always log the complete prompt chain server-side.

**Webhook Rate Limiting:** One misconfigured GitHub webhook triggering agent runs on every commit will burn through the API budget in hours. Rate limiting on triggers is non-negotiable from day one.

**Self-Hosted Architecture Decision:** CF Workers/Containers can't run on-prem. If you hardcode CF primitives into business logic, you're locked out of the enterprise self-hosted market. Abstract the infrastructure layer now, even if self-hosted is years away.

**Legal: AI-Generated Code Ownership:** No settled case law. AI-generated outputs without "sufficient human authorship" may not be copyrightable (US Copyright Office, Jan 2025). Terms of Service must clearly state users own outputs with appropriate disclaimers. Don't offer IP indemnification at launch.

**Agent Memory Curation:** Auto-appending learnings to AGENTS.md after every session creates bloat. Most teams get 80% of value from a manually curated ~200-line file. Auto-generated memories should be human-reviewable before persisting.

**Disaster Recovery:** Neon PITR retention should be 7+ days. Implement SSE reconnection with last-event-id tracking. Show clear "agent disconnected / reconnecting" UI states. Container health monitoring should auto-restart from last git checkpoint.

---

## 15. Database Schema

```typescript
// Drizzle schema outline (packages/cloud/src/db/schema.ts)

// Users & Auth
users: { id, email, name, avatarUrl, githubId, stripeCustomerId, createdAt }
apiKeys: { id, userId, name, keyHash, keyPrefix, lastUsedAt, expiresAt }

// Organizations
organizations: { id, name, slug, plan, stripeSubscriptionId }
orgMembers: { id, orgId, userId, role }

// Projects
projects: { id, orgId, name, slug, gitUrl, defaultBranch, agentConfig(jsonb) }

// Sessions & Messages
sessions: { id, projectId, userId, title, status, model, totalInputTokens,
            totalOutputTokens, totalCostCents, location, deviceId }
messages: { id, sessionId, role, content, toolCalls(jsonb), toolResults(jsonb),
            inputTokens, outputTokens, durationMs }

// File Snapshots (metadata — blobs in R2)
fileSnapshots: { id, sessionId, filePath, r2Key, sizeBytes, snapshotType }

// Usage Ledger (append-only)
usageEvents: { id, orgId, userId, sessionId, eventType, inputTokens,
               outputTokens, costCents, metadata(jsonb), idempotencyKey }
```

**Design decisions:**
- UUIDs for distributed-friendly IDs
- JSONB for agent config (fast-changing schema)
- File blobs in R2 (cheap storage, same CF network)
- Usage events append-only with idempotency keys (exactly-once billing)
- Cost stored in cents (integer) to avoid floating-point money bugs

---

## 16. Cost Projections

### Per-Session Cost (standard-2, 1 hour)

| Component | Cost |
|-----------|------|
| Container CPU (1 vCPU, 3600s) | $0.072 |
| Container Memory (6 GiB, 3600s) | $0.054 |
| LLM tokens (typical session) | $0.50-5.00 |
| R2 storage + operations | ~$0.01 |
| Neon DB | ~$0.001 |
| **Total per session** | **$0.64-5.14** |

LLM inference is 80-95% of total cost.

### Monthly Infrastructure (by scale)

| Users/day | Container Cost | Neon | R2 | Workers | Total |
|-----------|---------------|------|-----|---------|-------|
| 10 | ~$40 | $0 | $1 | $5 | **~$46** |
| 100 | ~$390 | $30 | $5 | $5 | **~$430** |
| 1,000 | ~$3,900 | $150 | $50 | $5 | **~$4,100** |

(Excludes LLM API costs — those are pass-through or BYOK)

---

## 17. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

- [ ] CF Worker with Hono: auth (GitHub App + Arctic), session routing
- [ ] CF Container class: OpenCode serve in Docker, basic lifecycle
- [ ] Neon + Drizzle: users, sessions, messages schema + migrations
- [ ] GitHub OAuth flow: login, session management in KV
- [ ] Basic web UI: session list, create session, chat interface
- [ ] SSE streaming from container through Worker to browser
- [ ] Git clone on container start, git push on sleep
- [ ] Conversation persistence to Neon after every message
- [ ] Hard spend cap enforcement (check before every LLM call)
- [ ] Trust tier 0/1 (no free containers without payment method)

### Phase 2: Core UX (Weeks 5-8)

- [ ] Taxi meter cost display (real-time via SSE)
- [ ] Session handover: push-to-cloud / pull-to-local
- [ ] Envoy sidecar credential proxy (zero secrets in container)
- [ ] MCP server support (Tier 1: cloud-native API servers)
- [ ] AGENTS.md injection into every session
- [ ] Shareable session URLs for team viewing
- [ ] SSE heartbeat (15s) + client reconnection
- [ ] Git checkpointing mid-session (auto-commit on significant changes)
- [ ] Stripe integration: subscription + Meters API for usage
- [ ] BYOK support (user's own API keys)

### Phase 3: Persistence & Polish (Weeks 9-12)

- [ ] JuiceFS integration for cache persistence across container sleep/wake
- [ ] Egress proxy Worker for network monitoring + domain allowlisting
- [ ] Abuse detection: CPU anomaly, mining pool domains, volume alerts
- [ ] Mobile-responsive PWA with status cards + push notifications
- [ ] REST API for programmatic agent triggers
- [ ] GitHub webhook handler (issue/PR events trigger agents)
- [ ] Session summaries + manual memory management
- [ ] Agent observability: collapsible tool-call timeline
- [ ] Team billing with per-user budgets

### Phase 4: Differentiation (Month 4+)

- [ ] Mid-task steering: interrupt + redirect agent mid-execution
- [ ] Per-hunk change approval with inline comments
- [ ] Slack bot integration (`@palot fix the failing test`)
- [ ] MCP local bridge (desktop as tunnel for local MCP servers)
- [ ] MCP marketplace / browser UI
- [ ] Multi-agent dashboard (parallel agents with visual status)
- [ ] Event-based triggers (CI failure → auto-debug)
- [ ] Infrastructure abstraction for future self-hosted option
- [ ] Turborepo remote cache on R2

---

## Appendix A: Key Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| CF Containers still beta | Feature gaps, limits change | Build abstraction layer; maintain fallback |
| No persistent disk on CF | Complex workspace management | JuiceFS + git + R2 hybrid approach |
| 100s SSE timeout on CF Workers | Agent sessions appear to hang | 15s heartbeat events |
| LLM costs dominate | Thin margins on managed key model | BYOK as primary, managed as convenience |
| Crypto mining abuse | Billing explosion, IP reputation | Trust tiers, `enableInternet=false`, payment verification |
| Legal uncertainty on AI code | Liability risk | Clear ToS, no indemnification at launch, lawyer review |
| Supply chain attacks via agents | Compromised packages installed | Egress allowlisting, lockfile enforcement, read-only base FS |
| Container cold start (2-3s) | UX friction on new sessions | Pre-warming, loading states, progressive enhancement |

## Appendix B: Technology Quick Reference

| Need | Tool | Why |
|------|------|-----|
| Edge routing | CF Workers | Global, sub-ms, native SSE |
| Session state | CF Durable Objects | Strong consistency, SQLite, WebSocket hibernation |
| Agent runtime | OpenCode in CF Container | Open source, REST+SSE API, multi-provider |
| Database | Neon Postgres | Serverless, branching, CF-native driver |
| ORM | Drizzle | 50KB bundle, CF Workers native, type-safe |
| Auth library | Arctic v3 | Fetch-native, GitHub App support |
| HTTP framework | Hono | Already in codebase, CF Workers native |
| Object storage | CF R2 | Same network as Workers, S3-compatible |
| Cache/config persistence | JuiceFS → R2 | FUSE mount, 5000x faster than raw R2 |
| JuiceFS metadata | Upstash Redis | Serverless, per-request pricing |
| Billing | Stripe Meters API | Usage-based, idempotent, batched reporting |
| Metering (fast path) | CF Analytics Engine | Native, append-only, sub-ms writes |
| MCP aggregation | mcp-proxy | Proven, Docker image, named server config |
| Secrets | Envoy sidecar proxy | Zero secrets in container |
| Container images | `ghcr.io/anomalyco/opencode` | Official, maintained |

## Appendix C: Research Sources

Research conducted Feb 11, 2026 across 18 parallel deep-dive investigations covering:
- Cloudflare Workers, Containers, Durable Objects architecture and pricing
- OpenCode serve mode API surface, SDK, and containerization
- Neon Postgres vs PlanetScale comparison, Drizzle ORM integration
- GitHub OAuth on CF Workers with Arctic v3
- Local-to-cloud sync patterns (CRDTs, event sourcing, PowerSync, ElectricSQL)
- Competitor UX analysis (Codex App, Devin, Cursor, Windsurf, Augment, Copilot Workspace)
- Container security model (Devin breaches, Envoy sidecar, supply chain attacks)
- Billing/metering architecture (Stripe Meters, competitor pricing failures)
- MCP server management in cloud containers (remote MCP, proxy patterns)
- File system persistence (R2 FUSE benchmarks, JuiceFS, git-based persistence)
- Multi-tenant isolation and abuse prevention (trust tiers, crypto mining defense)
- Unknown unknowns (mobile UX, observability, disaster recovery, legal, analytics)
- Container hosting comparison (Fly.io, Railway, Render, Hetzner, Cloud Run, Fargate)
- Bun runtime production stability and benchmarks
- Backend framework comparison (Hono, ElysiaJS, Fastify, tRPC, Nitro)
- Self-hosted orchestration (Coolify, Kamal, Dokku, Docker API, K3s)
- OpenCode real-world deployment patterns (Netclode, Cloud Code, community Dockerfiles)
- Fly.io Machines API deep dive (pricing, TypeScript client, volumes, networking)

---

## 18. REVISED: Hosting & Runtime Recommendations

> This section was added after deeper research into the practical hosting question.
> It revises some of the original CF-centric architecture based on real-world constraints.

### The Big Picture Decision

After researching 6 container platforms, 6 backend frameworks, 8 orchestration tools, and multiple real-world OpenCode deployments, here's the revised recommendation:

```
CONTROL PLANE (API server)          AGENT CONTAINERS
  Bun + Hono                          Fly.io Machines
  Deployed on Fly.io                  One per user session
  (or Hetzner for cost)               Firecracker microVMs
                                      OpenCode serve inside
```

### Why Fly.io Machines Over Cloudflare Containers

| Factor | Fly.io Machines | CF Containers |
|--------|----------------|---------------|
| **Persistent volumes** | NVMe, $0.15/GB/mo | None (R2 FUSE only, 600ms latency) |
| **Machine sizes** | Up to 16 vCPU, 128GB | Max 4 vCPU, 12GB (beta) |
| **Cold start** | ~300ms | ~2-3s |
| **Maturity** | Production since 2022 | Beta since June 2025 |
| **SSH/exec** | Yes | No |
| **API** | Comprehensive REST, OpenAPI spec | Workers bindings (limited) |
| **Region control** | 35+ regions, you choose | Automatic (no choice) |
| **GPU** | Yes (A10, L40S, A100) | No |
| **Per-user blueprint** | Official docs + reference impl | Community examples only |
| **Stopped billing** | Only rootfs + volumes | Only storage |

CF Containers' killer weakness is **no persistent volumes**. Coding agents need workspace persistence between sessions. On Fly, you get local NVMe volumes. On CF, you'd need JuiceFS over R2 (complex, adds latency, requires Redis for metadata). That complexity alone tilts the decision.

**CF Containers is still valuable** for the edge API/routing layer (Workers + Durable Objects for auth, rate limiting, SSE proxying). But the agent containers should run on Fly.

### Why Bun + Hono (Don't Switch)

**Runtime: Bun** (already in the monorepo at v1.3.8)
- Anthropic acquired Bun (Dec 2025) — Claude Code runs on it at $1B ARR scale
- Docker images 5-8x smaller than Node.js (112MB vs 970MB)
- Native TypeScript, faster cold starts, better DX
- Risk: memory leaks in long-running processes — mitigate with monitoring + process recycling
- Escape hatch: avoid Bun-specific APIs (`Bun.file()`, `Bun.serve()`), use `node:*` stdlib — swapping to Node is a one-line Dockerfile change

**Framework: Hono** (already in `apps/server`)
- Best SSE streaming support (`streamSSE()` helper) — this is the core job
- ElysiaJS was considered but has a **10x SSE performance regression** (GitHub issue #1369) and bus factor of 1
- Hono's built-in RPC gives typed client-server communication (you already use this)
- Runs unchanged on Bun, Node, Cloudflare Workers, Deno — deployment optionality
- 26k stars, 200+ contributors, backed by Cloudflare ecosystem

**What NOT to switch to:**
- ElysiaJS: SSE is 10x slower than Hono, single maintainer
- Fastify: Node.js-centric, polyfill tax on Bun, no built-in SSE
- tRPC: unnecessary layer on top of Hono's RPC, doesn't support SSE in RPC mode
- Nitro: meta-framework overhead for a simple API server

### Container Hosting Comparison (100 sessions/day, 1hr each)

| Provider | Monthly Cost | Cold Start | Persistent Volumes | Fit |
|----------|-------------|------------|-------------------|-----|
| **Fly.io Machines** | **~$47-213** | **~300ms** | **NVMe ($0.15/GB)** | **Best** |
| Hetzner (Docker) | $37-216 | <1s (Docker) | Local disk | Good (DIY) |
| Railway | ~$162 | 500ms-5s | $0.15/GB, 3K IOPS | Okay |
| AWS Fargate | ~$224 | 30-90s | EFS ($0.30/GB) | Over-engineered |
| Google Cloud Run | ~$308 | 500ms-5s | None | 60-min timeout kills it |
| Render | $375-2,500 | 1-5min | $0.25/GB | No scale-to-zero |
| CF Containers | ~$47 compute | 2-3s | None | No persistence |

### Self-Hosted Scale Path

| Scale | Approach | Cost |
|-------|----------|------|
| MVP (10-50 sessions) | Fly.io Machines | ~$50-200/mo |
| Growth (50-200) | Fly.io Machines + reservations | ~$200-800/mo |
| Scale (200-500) | Hetzner + K3s (or Fly) | ~$200-600/mo |
| Large (500+) | Hetzner + K3s, multi-node | ~$600-2000/mo |

**Phase 1 (MVP):** Fly.io Machines. Zero ops overhead, per-second billing, ~300ms cold start, NVMe volumes. Use the Machines REST API from your Hono backend to create/start/stop/destroy agent machines.

**Phase 2 (Scale optimization):** If costs justify it, migrate to Hetzner + K3s. Same Docker images, same OpenCode config. The container is portable — only the orchestration layer changes. K3s on Hetzner is ~3-5x cheaper than Fly at 500+ concurrent sessions.

### Revised Architecture

```
User Browser / Desktop App
        |
   HTTPS / WSS
        |
+==================================+
|  Fly.io Machine (Control Plane)   |
|  Bun + Hono API Server            |
|  - Auth (GitHub App + Arctic)     |
|  - Session management             |
|  - SSE proxy to agent machines    |
|  - Billing / metering             |
|  - Fly Machines API client        |
+==============+===================+
               |
    Fly Private Network (6PN/WireGuard)
               |
+==================================+
|  Fly.io Machine (Agent Session)   |
|  1-2 vCPU, 2-4 GB RAM            |
|  OpenCode serve (port 4096)       |
|  NVMe volume at /workspace        |
|  - git clone, bash, file ops      |
|  - SSE streaming to control plane |
|  - Auto-destroy on exit           |
+==================================+
        |               |
   Neon Postgres    Fly Volume
   (user data,      (workspace,
    sessions,        node_modules,
    billing)         git repos)
```

### OpenCode Container Config (Production)

```dockerfile
FROM ghcr.io/anomalyco/opencode:latest

# Install additional tools
RUN apt-get update && apt-get install -y \
    git curl fzf ripgrep fd-find gh \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with sudo
RUN useradd -m -s /bin/bash agent \
    && echo "agent ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/agent

USER agent
WORKDIR /workspace

# Pre-warm ssh known hosts
RUN mkdir -p ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts

# Configure for headless cloud operation
ENV OPENCODE_PERMISSION='{"bash":"auto","write":"auto","edit":"auto","mcp":"auto"}'
ENV OPENCODE_DISABLE_AUTOUPDATE=true
ENV OPENCODE_DISABLE_LSP_DOWNLOAD=true

EXPOSE 4096

CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
```

### Fly Machine Creation (TypeScript)

```typescript
const fly = new FlyMachinesClient(env.FLY_API_TOKEN)

const machine = await fly.createMachine("palot-agents", {
  name: `agent-${sessionId}`,
  region: "iad",
  config: {
    image: "registry.fly.io/palot-agent:latest",
    guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
    env: {
      SESSION_ID: sessionId,
      OPENCODE_SERVER_PASSWORD: generateSessionPassword(),
      // API keys injected via secret proxy or env
    },
    mounts: [{
      volume: userVolumeId,
      path: "/workspace",
    }],
    auto_destroy: true,
    restart: { policy: "no" },
    services: [{
      protocol: "tcp",
      internal_port: 4096,
      // Private only — no public routing
    }],
    checks: {
      health: {
        type: "http", port: 4096,
        path: "/global/health",
        interval: "15s", timeout: "10s",
      },
    },
  },
})

await fly.waitForState("palot-agents", machine.id, "started", 60)
// Agent reachable at: {machine.id}.vm.palot-agents.internal:4096
```

### Key Risk Mitigations for Bun

| Risk | Mitigation |
|------|-----------|
| SSE regression in Bun update | Pin Bun versions, integration tests on upgrade |
| Memory leak in long sessions | Monitor RSS, recycle processes every 4-6hrs |
| npm package incompatibility | Test deps in CI on Bun |
| Need to escape to Node.js | Use `node:*` APIs, not `Bun.*` APIs — one-line Dockerfile swap |

### Real-World OpenCode Resource Requirements

From Netclode (production deployment):
- **Comfortable per session**: 4 vCPUs, 4GB RAM
- **Minimum per session**: 2 vCPUs, 2GB RAM (sluggish for complex tasks)
- **Container image**: ~2GB (with all SDK runtimes)
- **Known issue**: Memory grows unbounded in long sessions — implement rotation
- **Max concurrent**: Default 5 active (oldest auto-pauses)

### Updated Tech Stack Summary

| Layer | Original Plan | Revised Plan | Why Changed |
|-------|--------------|-------------|-------------|
| **Agent hosting** | CF Containers | **Fly.io Machines** | Persistent NVMe volumes, maturity, larger sizes |
| **API hosting** | CF Workers | **Fly.io Machine** (or CF Workers for edge) | Co-locate with agents on Fly private network |
| **Runtime** | Bun (confirmed) | **Bun** (confirmed) | Already in monorepo, Anthropic-backed |
| **Framework** | Hono (confirmed) | **Hono** (confirmed) | Best SSE, already in codebase, portable |
| **Database** | Neon (confirmed) | **Neon** (confirmed) | Best serverless Postgres |
| **ORM** | Drizzle (confirmed) | **Drizzle** (confirmed) | Tiny, type-safe, CF/Bun native |
| **Auth** | Arctic v3 (confirmed) | **Arctic v3** (confirmed) | Fetch-native GitHub OAuth |
| **Orchestration** | CF Durable Objects | **Fly Machines API** | Direct REST API, simpler than DO lifecycle |
| **Persistence** | JuiceFS → R2 | **Fly NVMe Volumes** | Local disk, no FUSE complexity |
| **Scale path** | CF only | **Fly → Hetzner + K3s** | Cost optimization at scale |
