# OpenCode Upstream Issues

Issues and missing features in the OpenCode server/SDK that affect Codedeck's UX.
Items are tracked here so we can contribute upstream or revisit when new releases land.

---

## Server

### 1. No `Access-Control-Max-Age` on CORS middleware

**Impact:** Every API call from a browser context triggers a CORS preflight OPTIONS request that cannot be cached.

The server's CORS config in `packages/opencode/src/server/server.ts` does not set `maxAge`. Without `Access-Control-Max-Age`, browsers send a fresh OPTIONS request before every non-simple request (POST with `application/json`, requests with custom headers). Adding `maxAge: 86400` would let browsers cache preflight responses for 24 hours.

**Workaround:** Codedeck sends the project directory as a `?directory=` query param instead of the `x-opencode-directory` header to avoid triggering preflights on GET requests. POST requests still trigger preflights due to `Content-Type: application/json`.

**Where:** `apps/desktop/src/renderer/services/opencode.ts`

### 2. No cursor pagination on the messages endpoint

**Impact:** "Load earlier messages" must fetch the entire session history in one request.

`GET /session/{sessionID}/message` supports `limit` but has no `before`, `after`, or `offset` parameter. When Codedeck initially loads the most recent 30 messages and the user wants to see older ones, the only option is to re-fetch without a limit (all messages). For long sessions with hundreds of messages this is wasteful.

**Ideal:** `GET /session/{id}/message?limit=30&before={messageID}` returning the 30 messages before the given ID.

**Where:** `apps/desktop/src/renderer/hooks/use-session-chat.ts`

### 3. No `tool-input-delta` streaming in SSE events

**Impact:** Tool call inputs appear all at once instead of streaming in progressively.

The SSE stream emits `message.part.updated` events for text and reasoning parts as they stream token-by-token, but tool call parts arrive as complete objects. The Anthropic API supports `input_json_delta` events for tool calls — if OpenCode forwarded these as incremental `tool-input-delta` SSE events, GUIs could show tool arguments being composed in real time (e.g., progressively revealing file paths, search queries, or code being written for a tool call).

### 4. No server-side SSE event batching/throttling

**Impact:** During streaming, the server sends one SSE event per token, creating thousands of events per second.

Codedeck implements a client-side event batcher with RAF-aligned flushing, event coalescing, and a separate streaming store with 50ms throttled notifications. This complexity exists entirely because the server sends events at token-level granularity. Server-side batching (e.g., buffering events for 16-50ms before flushing) would reduce network overhead and simplify all GUI clients.

**Where:** `apps/desktop/src/renderer/services/connection-manager.ts` (createEventBatcher), `apps/desktop/src/renderer/stores/streaming-store.ts`

### 5. No `session.retract` endpoint for cancelling queued messages

**Impact:** Once a message is sent via `promptAsync`, it cannot be retracted or edited.

If a user sends a follow-up message while the agent is busy, the message is queued server-side. There is no API to cancel or edit a queued message. A `DELETE /session/{id}/message/{messageId}` or `POST /session/{id}/retract` endpoint would enable "cancel pending message" and "edit queued message" UX patterns.

**Where:** `docs/plans/message-queueing.md`

### 6. No "resolved current model" API

**Impact:** GUI clients must replicate the TUI's 5-level model resolution chain.

The server has no concept of a "current model" — when `promptAsync` is called without a `model` field, it falls back to the first connected provider's default. The TUI resolves the model client-side using: CLI arg > config.model > recent models from `model.json` > first provider default. Codedeck must replicate this entire chain in `resolveEffectiveModel()`. A `GET /config/resolved-model` endpoint (or including the resolved model in the config response) would simplify this.

**Where:** `apps/desktop/src/renderer/hooks/use-opencode-data.ts` (resolveEffectiveModel)

---

## SDK

### 7. `x-opencode-directory` header triggers CORS preflights

**Impact:** Every project-scoped API call from a browser triggers an extra OPTIONS request.

The SDK's `createOpencodeClient({ directory })` sets `x-opencode-directory` as a custom HTTP header. Custom headers are not CORS-safelisted, so browsers must send a preflight OPTIONS request before every API call. The server already supports `?directory=` as a query parameter (which doesn't trigger preflights), but the SDK has no option to use query params instead of headers.

**Ideal:** `createOpencodeClient({ directory, directoryTransport: "query" })` or defaulting to query params.

**Workaround:** Codedeck accesses the SDK's `protected` `client` field at runtime to inject a request interceptor that moves the directory to a query param.

**Where:** `apps/desktop/src/renderer/services/opencode.ts`

### 8. SDK types don't match actual response shapes

**Impact:** Codedeck uses `as unknown as` type casts for most SDK responses.

The messages endpoint returns `Array<{ info: Message, parts: Part[] }>` but the SDK types suggest a flat response. Session timestamps are in milliseconds (not documented). The `data` property on responses is typed as the raw schema output, not the runtime shape. This forces consumers to use unsafe type assertions.

**Where:** `apps/desktop/src/renderer/hooks/use-session-chat.ts`, `use-session-messages.ts`, `new-chat.tsx`

### 9. Azure provider broken in browser context

**Impact:** Azure-configured providers cause `TypeError: sdk.responses is not a function` in browser environments.

Known upstream issue. No workaround other than avoiding the Azure provider when using OpenCode from a browser-based GUI.

**Where:** `AGENTS.md`
