---
title: MCP Server Design Patterns
description: Patterns for building Model Context Protocol servers — stdio and HTTP transports, tool design, error handling.
source: palot-knowledge
tags: mcp, tools, typescript, stdio, server
agents: mcp-developer, fullstack-developer, architect-reviewer
updated: 2026-05-16
---

## MCP Protocol Basics

MCP servers expose **tools**, **resources**, and **prompts** to LLM clients via JSON-RPC 2.0.

```
Client (LLM/Claude)  ←→  MCP Server (stdio or HTTP+SSE)
  initialize
  tools/list
  tools/call { name, arguments }
  resources/list
  resources/read { uri }
```

## Stdio Transport (Palot Pattern)

```ts
// scripts/my-mcp-server.ts
import { createInterface } from "node:readline"

const TOOLS = [
  {
    name: "tool_name",
    description: "What this tool does. Be specific — the LLM uses this to decide when to call it.",
    inputSchema: {
      type: "object",
      properties: {
        param: { type: "string", description: "What this param is for" },
      },
      required: ["param"],
    },
  },
]

// Serialize all requests to prevent race conditions on concurrent calls
let requestQueue = Promise.resolve()
let pending = 0
let inputClosed = false

function checkExit() {
  if (inputClosed && pending === 0) process.exit(0)
}

function send(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
}

function sendError(id: unknown, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`)
}

async function handleLine(line: string, isNotification: boolean): Promise<void> {
  if (!line.trim()) {
    if (!isNotification) { pending--; checkExit() }
    return
  }
  let msg: { id?: unknown; method: string; params?: unknown }
  try { msg = JSON.parse(line) } catch {
    sendError(null, -32700, "Parse error")
    if (!isNotification) { pending--; checkExit() }
    return
  }
  const { id, method, params } = msg
  try {
    switch (method) {
      case "initialize":
        send(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "my-server", version: "1.0.0" },
        })
        break
      case "tools/list":
        send(id, { tools: TOOLS })
        break
      case "tools/call": {
        const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> }
        const content = await callTool(name, args)
        send(id, { content })
        break
      }
      case "ping":
        send(id, {})
        break
      default:
        sendError(id, -32601, `Method not found: ${method}`)
    }
  } catch (e) {
    sendError(id, -32603, e instanceof Error ? e.message : String(e))
  } finally {
    if (!isNotification) { pending--; checkExit() }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on("line", (line) => {
  if (!line.trim()) return
  let isNotification = true
  try {
    const parsed = JSON.parse(line) as { id?: unknown }
    isNotification = parsed.id === undefined || parsed.id === null
  } catch { /* handleLine will emit parse error */ }
  // Increment BEFORE queuing — checkExit can fire on rl "close"
  if (!isNotification) pending++
  requestQueue = requestQueue.then(() => handleLine(line, isNotification))
})
rl.on("close", () => { inputClosed = true; checkExit() })
```

## Tool Design Principles

### Good tool descriptions
```ts
// BAD — too vague
{ name: "read", description: "Read something" }

// GOOD — specific, tells the LLM exactly when to call it
{
  name: "brain_read",
  description: "Read a shared brain memory file by slug. Use for tasks, decisions, run-history, issues, or any cross-agent knowledge.",
}
```

### Schema design
```ts
// Be specific in property descriptions — they guide parameter filling
inputSchema: {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description: "File slug without .md extension (e.g. 'tasks', 'decisions')",
    },
  },
  required: ["slug"],
}
```

### Return format
```ts
// Tools return an array of content blocks
type TextContent = { type: "text"; text: string }

async function callTool(name: string, args: Record<string, unknown>): Promise<TextContent[]> {
  const result = await doWork(args)
  return [{ type: "text", text: JSON.stringify(result, null, 2) }]
}
```

## Path Safety for File Tools

```ts
function safePath(root: string, userInput: string): string {
  const normalized = String(userInput).trim().replace(/\.md$/i, "")
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error(`Invalid slug: ${userInput}`)
  const resolved = path.resolve(root, `${normalized}.md`)
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Path traversal blocked")
  return resolved
}
```

## Registering in OpenCode

```json
// opencode.json (project-local) OR ~/.config/opencode/opencode.json (global)
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["bun", "scripts/my-mcp-server.ts"],
      "environment": { "MY_VAR": "value" },
      "timeout": 10000
    }
  }
}
```

## Testing MCP Servers

```bash
# Manual smoke test via stdin
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' | bun scripts/my-mcp-server.ts

# Test tool call
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brain_list","arguments":{}}}' | bun scripts/my-mcp-server.ts
```

## Common Errors

| Error | Code | Meaning |
|---|---|---|
| Parse error | -32700 | Malformed JSON |
| Method not found | -32601 | Unknown method |
| Invalid params | -32602 | Bad tool arguments |
| Internal error | -32603 | Tool threw an exception |

## Checklist

- [ ] Request serialization queue prevents race conditions
- [ ] `pending` incremented BEFORE queuing (not inside async body)
- [ ] Path traversal prevention for all file-system tools
- [ ] Graceful degradation for optional external services (API keys)
- [ ] `ping` handler implemented
- [ ] `notifications/initialized` handled (no response needed)
- [ ] Error messages are user-readable, not stack traces
