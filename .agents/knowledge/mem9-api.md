---
title: Mem9 API Reference
description: Persistent memory for AI agents — REST API reference, OpenCode plugin, environment variables, and architecture for mem9 memory server.
source: github:mem9-ai/mem9
tags: mem9, memory, persistent, agents, go, rest-api, plugin
agents: architect, builder, reviewer
updated: 2026-05-15
---

# Mem9 — Persistent Memory for AI Agents

mem9 gives coding agents persistent, shared memory across sessions and machines. The core is a Go REST server backed by TiDB/MySQL, with plugins for OpenCode, Claude Code, OpenClaw, Codex, and Dify.

## Architecture

| Layer | Tech | Role |
|-------|------|------|
| API Server | Go + chi router | HTTP handlers, service layer, tenant provisioning |
| Storage | TiDB / MySQL / PostgreSQL | Memory storage, vector search (VEC_COSINE_DISTANCE), full-text search |
| Embedding | Client-side (OpenAI) or server-side (TiDB auto-embed) | Vector generation for semantic search |
| Plugins | TypeScript (OpenCode, Claude Code, Codex) | Hook-based recall, auto-ingest, memory tools |

### Server Structure

```
server/
  cmd/mnemo-server/main.go     — entrypoint
  internal/handler/handler.go  — HTTP router + error mapping
  internal/service/memory.go   — memory CRUD / search
  internal/service/ingest.go   — ingest pipeline
  internal/service/tenant.go   — tenant provisioning
  internal/repository/tidb/    — TiDB SQL repository
  internal/domain/             — domain types and errors
  schema.sql                   — database schema
```

### Architecture Rules

- Strict `handler -> service -> repository` boundary. No ORM — raw `database/sql` with parameter placeholders only.
- `embed.New()` and `llm.New()` may return `nil`; callers must branch correctly.
- Vector and keyword search each fetch `limit * 3` before RRF merge.
- `INSERT ... ON DUPLICATE KEY UPDATE` is the expected upsert pattern.
- Atomic version bump: `SET version = version + 1`.
- `X-Mnemo-Agent-Id` is the per-agent identity header for memory requests.

---

## API Reference

### Provisioning

```
POST /v1alpha1/mem9s
```
Auto-provisions a new TiDB-backed space. Accepts optional `utm_*` query params. Returns `{ "id" }`.

### Preferred API (v1alpha2) — Uses `X-API-Key` header

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha2/mem9s/memories` | Create memory |
| `GET` | `/v1alpha2/mem9s/memories` | Search memories |
| `GET` | `/v1alpha2/mem9s/memories/{id}` | Get memory by ID |
| `PUT` | `/v1alpha2/mem9s/memories/{id}` | Update memory |
| `DELETE` | `/v1alpha2/mem9s/memories/{id}` | Delete memory |
| `POST` | `/v1alpha2/mem9s/memories/batch-delete` | Batch delete |
| `POST` | `/v1alpha2/mem9s/imports` | Create async file import |
| `GET` | `/v1alpha2/mem9s/imports` | List imports |
| `GET` | `/v1alpha2/mem9s/imports/{id}` | Get import task |
| `GET` | `/v1alpha2/mem9s/session-messages` | List session messages |
| `GET` | `/v1alpha2/status` | Validate X-API-Key |
| `POST` | `/v1alpha2/space-chains` | Create space chain |
| `GET` | `/v1alpha2/space-chains/by-key` | Get space chain by key |
| `GET/PATCH/DELETE` | `/v1alpha2/space-chains/{chainID}` | CRUD space chain |
| `GET` | `/v1alpha2/space-chains/{chainID}/nodes` | List chain nodes |
| `PUT` | `/v1alpha2/space-chains/{chainID}/nodes` | Replace chain nodes |
| `GET` | `/v1alpha2/space-chains/{chainID}/bindings` | List bindings |
| `POST` | `/v1alpha2/space-chains/{chainID}/bindings` | Create binding |
| `PATCH` | `/v1alpha2/space-chains/{chainID}/bindings/{bindingID}` | Disable binding |

### Legacy Tenant-Path API (v1alpha1) — Uses `{tenantID}` in URL path

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1alpha1/mem9s/{tenantID}/memories` | Create memory |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories` | Search memories |
| `GET` | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Get memory |
| `PUT` | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Update memory (optional `If-Match` for version check) |
| `DELETE` | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Delete memory |
| `POST` | `/v1alpha1/mem9s/{tenantID}/imports` | Create import |
| `GET` | `/v1alpha1/mem9s/{tenantID}/imports` | List imports |
| `GET` | `/v1alpha1/mem9s/{tenantID}/imports/{id}` | Get import |
| `GET` | `/v1alpha1/mem9s/{tenantID}/session-messages` | List session messages |

### Health / Info

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check → `{ "status": "ok" }` |
| `GET` | `/versionz` | Version info → `{ "go_version": ..., "started_at": ... }` |
| `GET` | `/metrics` | Prometheus metrics |

### Error Mapping

| Domain Error | HTTP Status |
|-------------|-------------|
| `ErrNotFound` | 404 |
| `ErrWriteConflict` | 503 |
| `ErrConflict` | 409 |
| `ErrDuplicateKey` | 409 |
| `ErrValidation` | 400 |
| `ErrNotSupported` | 501 |
| Unhandled | 500 |

---

## Environment Variables

### Core Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_DSN` | Yes | — | Database connection string |
| `MNEMO_PORT` | No | `8080` | HTTP listen port |
| `MNEMO_DB_BACKEND` | No | `tidb` | Backend: `tidb`, `postgres`, or `db9` |
| `MNEMO_RATE_LIMIT` | No | `100` | Requests/sec per IP |
| `MNEMO_RATE_BURST` | No | `200` | Burst size |
| `MNEMO_UPLOAD_DIR` | No | `./uploads` | Upload directory |
| `MNEMO_WORKER_CONCURRENCY` | No | `5` | Async ingest workers |

### Embedding & Ingest

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMO_EMBED_AUTO_MODEL` | — | TiDB/db9 `EMBED_TEXT()` model name (takes precedence over client-side) |
| `MNEMO_EMBED_AUTO_DIMS` | `1024` | Vector dimensions for auto model |
| `MNEMO_EMBED_API_KEY` | — | Client-side embedding API key |
| `MNEMO_EMBED_BASE_URL` | `https://api.openai.com/v1` | Custom OpenAI-compatible endpoint |
| `MNEMO_EMBED_MODEL` | `text-embedding-3-small` | Client-side embedding model |
| `MNEMO_EMBED_DIMS` | `1536` | Client-side vector dimensions |
| `MNEMO_LLM_API_KEY` | — | LLM provider API key (smart ingest) |
| `MNEMO_LLM_BASE_URL` | `https://api.openai.com/v1` | Custom LLM endpoint |
| `MNEMO_LLM_MODEL` | `gpt-4o-mini` | LLM model for smart ingest |
| `MNEMO_LLM_TEMPERATURE` | `0.1` | LLM temperature |
| `MNEMO_INGEST_MODE` | `smart` | Ingest mode: `smart` or `raw` |
| `MNEMO_FTS_ENABLED` | `false` | Enable TiDB full-text search |

### Provisioning & Pooling

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMO_TIDB_ZERO_ENABLED` | `true` | Enable TiDB Zero auto-provisioning |
| `MNEMO_TIDBCLOUD_API_KEY` | — | TiDB Cloud Pool API key |
| `MNEMO_TIDBCLOUD_API_SECRET` | — | TiDB Cloud Pool API secret |
| `MNEMO_TENANT_POOL_MAX_IDLE` | `5` | Max idle tenant connections |
| `MNEMO_TENANT_POOL_MAX_OPEN` | `10` | Max open connections per tenant |
| `MNEMO_TENANT_POOL_CONNECT_TIMEOUT` | `3s` | Cold-connect timeout |
| `MNEMO_TENANT_POOL_IDLE_TIMEOUT` | `10m` | Idle timeout |
| `MNEMO_TENANT_POOL_TOTAL_LIMIT` | `200` | Total tenant handles allowed |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMO_ENCRYPT_TYPE` | `plain` | Encryption type: `plain`, `md5`, or `kms` |
| `MNEMO_ENCRYPT_KEY` | — | Encryption key or KMS key ID |

### Search Source Turns

| Variable | Default | Description |
|----------|---------|-------------|
| `MEM9_SOURCE_TURN_MIN_SCORE` | `2` | Minimum relevance score for source turn inclusion |
| `MEM9_SOURCE_TURN_PER_MEMORY_LIMIT` | `2` | Max source turns per memory |
| `MEM9_SOURCE_TURN_TOTAL_LIMIT` | `12` | Max source turns across all memories |

---

## OpenCode Plugin (@mem9/opencode)

### Installation

```bash
opencode plugin --global @mem9/opencode
```

Run `/mem9-setup` inside OpenCode for credential setup.

### Files

| File | Path |
|------|------|
| Credentials | `$MEM9_HOME/.credentials.json` (defaults to `~/.mem9/`) |
| User config | `~/.config/opencode/mem9.json` |
| Project config | `<project>/.opencode/mem9.json` |
| Debug logs | OpenCode state dir `plugins/mem9/log/YYYY-MM-DD.jsonl` |

### Hook Flow

| Hook | What mem9 does |
|------|----------------|
| `chat.message` | Captures latest user prompt, updates in-memory state |
| `experimental.chat.system.transform` | Searches mem9, injects `<relevant-memories>` block |
| `session.idle` | Background smart-ingest for recent transcript window |
| `experimental.session.compacting` | Compaction hint + background smart-ingest |

### Tools

The plugin registers five tools: `memory_store`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`.

### Config Schema

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "debug": false,
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

Runtime overrides: `MEM9_API_KEY`, `MEM9_API_URL`, `MEM9_DEBUG`, `MEM9_HOME`. Legacy: `MEM9_TENANT_ID` (treated as API key source).

### Plugin Architecture

- Package entrypoints: `"."` and `"./server"` load hooks+tools, `"./tui"` loads setup command.
- Fail-soft: missing runtime identity logs setup-pending warning and returns `{}`.
- Tool handlers return JSON strings with `{ ok, ... }` payloads.
- Known 404s return `null`/`false`; unexpected errors re-thrown.

---

## SQL / Storage Rules

- Tags are JSON arrays; store `[]`, never `NULL`.
- Filter tags with `JSON_CONTAINS`.
- Every vector search must include `embedding IS NOT NULL`.
- `VEC_COSINE_DISTANCE(...)` must match in `SELECT` and `ORDER BY` byte-for-byte.
- When `autoModel != ""`, do not write the `embedding` column; it is generated server-side.
- `MNEMO_EMBED_AUTO_MODEL` and `MNEMO_EMBED_API_KEY` represent different embedding modes (server-side vs. client-side).

## Go Style

- Format with `gofmt` only.
- Imports: stdlib, external, internal (three groups).
- `PascalCase` for exported names, `camelCase` for unexported.
- Acronyms stay all-caps: `tenantID`, `agentID`.
- Sentinel errors in `internal/domain/errors.go`; compare with `errors.Is()`.
- Wrap errors: `fmt.Errorf("context: %w", err)`.
- Validation: `&domain.ValidationError{Field: ..., Message: ...}`.
- HTTP/domain error mapping centralized in `internal/handler/handler.go`.

## Self-Hosting

```bash
# Build
make build

# Run (with TiDB)
cd server && MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server

# PostgreSQL backend
export MNEMO_DB_BACKEND=postgres

# Docker
make docker REGISTRY=local COMMIT=dev
docker run -e MNEMO_DSN="..." -e MNEMO_DB_BACKEND="tidb" -p 8080:8080 local/mnemo-server:dev
```

Apply the matching schema before first start: `server/schema.sql`, `server/schema_pg.sql`, or `server/schema_db9.sql`.
