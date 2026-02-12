# MCP Server Migration: Claude Code -> OpenCode

> Detailed plan for converting MCP server configurations between the two tools.

## Why This Is the Highest-Value Migration

MCP servers are the most painful to migrate manually because:
1. The config format is fundamentally different (not just renaming keys)
2. Users often have multiple MCP servers across multiple projects
3. A single typo breaks the entire MCP connection
4. OpenCode does NOT auto-read any Claude Code MCP config

## Source Locations (Claude Code)

MCP servers in Claude Code can be defined in **three places**:

### 1. Global per-project in `~/.claude.json`
```json
{
  "projects": {
    "/Users/foo/project": {
      "mcpServers": {
        "brightdata": {
          "type": "sse",
          "url": "https://mcp.brightdata.com/sse?token=abc&groups=scraping"
        }
      }
    }
  }
}
```

### 2. Project-level `.mcp.json`
```json
{
  "mcpServers": {
    "stripe": {
      "type": "http",
      "url": "https://mcp.stripe.com"
    }
  }
}
```

### 3. Claude Desktop config (not CLI, but users may reference it)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/foo/safe-dir"]
    }
  }
}
```

## Target Format (OpenCode)

All MCP servers go into `opencode.json` under the `"mcp"` key:

```json
{
  "mcp": {
    "server-name": { ... }
  }
}
```

---

## Conversion Rules

### Rule 1: Local Stdio Servers

**Claude Code:**
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": { "API_KEY": "secret" }
}
```

**OpenCode:**
```json
{
  "type": "local",
  "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "environment": { "API_KEY": "secret" },
  "enabled": true
}
```

**Algorithm:**
1. Set `type` to `"local"`
2. Merge `command` and `args` into a single array: `[command, ...args]`
3. Rename `env` to `environment`
4. Add `enabled: true`
5. If `command` is already an array (some CC configs), use as-is

### Rule 2: SSE/Remote Servers

**Claude Code:**
```json
{
  "type": "sse",
  "url": "https://mcp.brightdata.com/sse?token=abc"
}
```

**OpenCode:**
```json
{
  "type": "remote",
  "url": "https://mcp.brightdata.com/sse?token=abc",
  "enabled": true
}
```

**Algorithm:**
1. Set `type` to `"remote"` (regardless of whether CC says `"sse"` or `"http"`)
2. Copy `url` as-is
3. Add `enabled: true`
4. If CC has headers, copy to `headers`

### Rule 3: HTTP Servers

**Claude Code:**
```json
{
  "type": "http",
  "url": "https://mcp.stripe.com"
}
```

**OpenCode:**
```json
{
  "type": "remote",
  "url": "https://mcp.stripe.com",
  "enabled": true
}
```

**Algorithm:** Same as SSE -- both become `"remote"` in OpenCode.

### Rule 4: No Type Specified (Implicit Local)

**Claude Code:**
```json
{
  "command": "uvx",
  "args": ["mcp-server-fetch"]
}
```

**Algorithm:** If no `type` is present but `command` exists, treat as local. If `url` exists, treat as remote.

---

## Deduplication Strategy

Since MCP servers can be defined in multiple places (global `~/.claude.json` per-project, project `.mcp.json`), the tool must:

1. **Scan all sources** for the target project
2. **Detect duplicates** by server name
3. **Merge intelligently**:
   - If same name + same config -> deduplicate
   - If same name + different config -> warn user, prefer per-project config
4. **Place correctly**:
   - Servers used across all projects -> global `~/.config/opencode/opencode.json`
   - Servers specific to one project -> project-level `opencode.json`

## Sensitive Data Handling

MCP configs often contain tokens/API keys in URLs or env vars:

1. **URL tokens**: Detect `?token=` or `?key=` in URLs
   - **Option A**: Migrate as-is (user's existing secret, already in CC config)
   - **Option B**: Extract to env var and use `{env:MCP_TOKEN}` interpolation
   - **Default**: Migrate as-is with a warning in the report

2. **Env vars with secrets**: Copy `env`/`environment` values as-is
   - Suggest using `{env:VAR}` interpolation in the migration report

---

## Edge Cases

### 1. Disabled MCP servers
Claude Code tracks disabled servers in `~/.claude.json`:
```json
{
  "projects": {
    "/path": {
      "disabledMcpjsonServers": ["unused-server"]
    }
  }
}
```
**Migration**: Add `"enabled": false` to the converted server config.

### 2. `.mcp.json` files not in project root
Claude Code discovers `.mcp.json` by walking up directories.
**Migration**: Only process `.mcp.json` files found in the project root or detected by the scan phase.

### 3. MCP servers with OAuth
Claude Code doesn't support OAuth for MCP. If we detect a server URL that requires OAuth (e.g., Sentry MCP), add a placeholder:
```json
{
  "type": "remote",
  "url": "https://mcp.sentry.dev/mcp",
  "oauth": {},
  "enabled": true
}
```
And note in the report that the user should run `opencode mcp auth <name>`.

---

## Validation

After conversion, validate each MCP entry against OpenCode's schema:

```typescript
// Pseudocode
const McpLocal = z.object({
  type: z.literal("local"),
  command: z.array(z.string()).min(1),
  environment: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().optional()
})

const McpRemote = z.object({
  type: z.literal("remote"),
  url: z.string().url(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  oauth: z.union([McpOAuth, z.literal(false)]).optional(),
  timeout: z.number().optional()
})
```

---

## Full Example: Multi-Source Migration

**Input (`~/.claude.json` excerpt):**
```json
{
  "projects": {
    "/Users/foo/my-project": {
      "mcpServers": {
        "brightdata": { "type": "sse", "url": "https://mcp.brightdata.com/sse?token=abc" }
      },
      "enabledMcpjsonServers": ["stripe"],
      "disabledMcpjsonServers": ["old-server"]
    }
  }
}
```

**Input (`/Users/foo/my-project/.mcp.json`):**
```json
{
  "mcpServers": {
    "stripe": { "type": "http", "url": "https://mcp.stripe.com" },
    "old-server": { "command": "npx", "args": ["-y", "old-mcp-pkg"] },
    "filesystem": { "command": "npx", "args": ["-y", "@mcp/filesystem", "/safe"] }
  }
}
```

**Output (`/Users/foo/my-project/opencode.json`):**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "brightdata": {
      "type": "remote",
      "url": "https://mcp.brightdata.com/sse?token=abc",
      "enabled": true
    },
    "stripe": {
      "type": "remote",
      "url": "https://mcp.stripe.com",
      "enabled": true
    },
    "old-server": {
      "type": "local",
      "command": ["npx", "-y", "old-mcp-pkg"],
      "enabled": false
    },
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@mcp/filesystem", "/safe"],
      "enabled": true
    }
  }
}
```

**Migration Report:**
```
MCP Migration Summary:
  - brightdata: Converted SSE -> remote (from ~/.claude.json per-project)
  - stripe: Converted HTTP -> remote (from .mcp.json, was enabled)
  - old-server: Converted local (from .mcp.json, marked disabled)
  - filesystem: Converted local (from .mcp.json)
  
  WARNING: brightdata URL contains embedded token. Consider using {env:BRIGHTDATA_TOKEN} interpolation.
```
