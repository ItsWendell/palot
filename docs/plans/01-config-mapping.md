# Config Mapping: Claude Code -> OpenCode

> Detailed field-by-field mapping between Claude Code and OpenCode configuration files.

## Source Files (Claude Code)

| File | Purpose |
|------|---------|
| `~/.Claude/settings.json` | Global settings (model, permissions, env vars, hooks) |
| `~/.claude.json` | User state + per-project MCP/tools/trust |
| `<project>/.claude/settings.local.json` | Project-local permission overrides |
| `<project>/.mcp.json` | Project MCP server definitions |

## Target Files (OpenCode)

| File | Purpose |
|------|---------|
| `~/.config/opencode/opencode.json` | Global config (model, MCP, providers, permissions, everything) |
| `<project>/opencode.json` | Project-level config overrides |
| `~/.local/share/opencode/auth.json` | Provider authentication (manual setup) |

---

## Field Mapping: `~/.Claude/settings.json` -> `~/.config/opencode/opencode.json`

### Model

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `"model": "anthropic.claude-opus-4-6-v1:0:1m"` | `"model": "anthropic/claude-opus-4-6"` | Format differs: CC uses Bedrock ARN-style, OC uses `provider/model` |
| (no small model concept) | `"small_model": "anthropic/claude-sonnet-4-5"` | OC has dedicated small model; suggest a sensible default |

#### Model ID Translation Table

| Claude Code Model ID | OpenCode Model ID |
|---------------------|-------------------|
| `claude-sonnet-4-5-20250514` | `anthropic/claude-sonnet-4-5` |
| `claude-opus-4-5-20250410` | `anthropic/claude-opus-4-5` |
| `claude-opus-4-6` | `anthropic/claude-opus-4-6` |
| `anthropic.claude-opus-4-6-v1:0:1m` | `amazon-bedrock/anthropic.claude-opus-4-6-v1:0:1m` |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` | `amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` |
| `us.anthropic.claude-opus-4-6-v1:0:1m` | `amazon-bedrock/us.anthropic.claude-opus-4-6-v1:0:1m` |

**Translation logic**: 
1. If the model ID contains a `/`, it likely already has a provider prefix -> keep as-is
2. If it starts with `claude-`, prepend `anthropic/`
3. If it starts with `anthropic.` or `us.anthropic.`, prepend `amazon-bedrock/`
4. If the env has `CLAUDE_CODE_USE_BEDROCK=1`, default provider is `amazon-bedrock`
5. If the env has `CLAUDE_CODE_USE_VERTEX=1`, default provider is `google-vertex`

### Environment Variables

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `"env": { "KEY": "VAL" }` | No direct equivalent | CC injects env vars into all sessions; OC uses `{env:VAR}` interpolation or plugin `shell.env` hook |

**Migration strategy**: 
- `CLAUDE_CODE_USE_BEDROCK=1` -> set provider to `amazon-bedrock`
- `CLAUDE_CODE_USE_VERTEX=1` -> set provider to `google-vertex`
- `ANTHROPIC_API_KEY=...` -> add to `provider.anthropic.options.apiKey` (or suggest env var)
- Other env vars -> document as manual setup, suggest `{env:VAR}` interpolation

### Auto-Updates

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `"autoUpdatesChannel": "latest"` | `"autoupdate": true` | OC supports `true`, `false`, or `"notify"` |

### Permissions

See [06-permissions.md](./06-permissions.md) for detailed permission mapping.

### Hooks

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `"hooks": { ... }` | Plugin system | No direct mapping; generate plugin stubs |

**Migration strategy**: For each hook in Claude Code settings:
1. `PreToolUse` / `PostToolUse` -> Generate `.opencode/plugins/hooks.ts` with `tool.execute.before`/`tool.execute.after`
2. `SessionStart` -> No direct equivalent (could use plugin init)
3. `UserPromptSubmit` -> `chat.message` hook
4. `Stop` -> No direct equivalent

### Teammate Mode

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `"teammateMode": "tmux"` | `"experimental": { "agent_teams": true }` | Different concepts; CC uses tmux, OC uses built-in agent teams |

---

## Field Mapping: `~/.claude.json` (per-project entries)

The `~/.claude.json` file contains per-project entries under `projects[absolutePath]`. These need to be extracted and placed in project-level `opencode.json` files.

### Per-Project Fields

| Claude Code Field | OpenCode Equivalent | Notes |
|-------------------|---------------------|-------|
| `projects[path].mcpServers` | `opencode.json` -> `mcp` | Format conversion needed (see [02-mcp-migration.md](./02-mcp-migration.md)) |
| `projects[path].allowedTools` | `opencode.json` -> `permission` | Tool names need translation |
| `projects[path].ignorePatterns` | `opencode.json` -> `watcher.ignore` | Same glob pattern format |
| `projects[path].hasTrustDialogAccepted` | `opencode.json` -> `permission: { "*": "allow" }` | If trust accepted, map to permissive |
| `projects[path].enabledMcpjsonServers` | Keep `.mcp.json` as-is | OC doesn't read `.mcp.json` directly; need to merge into `opencode.json` |
| `projects[path].disabledMcpjsonServers` | `mcp[name].enabled = false` | Disable specific servers |
| `projects[path].lastCost` | Not migratable | CC-specific billing |
| `projects[path].lastSessionId` | Not migratable | Different session ID format |
| `projects[path].lastModelUsage` | Not migratable | Analytics data |

---

## Field Mapping: Project-Level `.claude/settings.local.json`

| Claude Code | OpenCode | Notes |
|-------------|----------|-------|
| `permissions.allow` | `permission: { tool: "allow" }` | Translate tool names |
| `permissions.deny` | `permission: { tool: "deny" }` | Translate tool names |
| `permissions.ask` | `permission: { tool: "ask" }` | Translate tool names |

---

## Provider Configuration

Claude Code doesn't have explicit provider configuration -- it relies on environment variables:

| CC Environment Variable | OC Provider Config |
|------------------------|-------------------|
| `ANTHROPIC_API_KEY` | `provider.anthropic.options.apiKey` or `{env:ANTHROPIC_API_KEY}` |
| `CLAUDE_CODE_USE_BEDROCK=1` | Set model prefix to `amazon-bedrock/` |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | `provider["amazon-bedrock"].options` |
| `CLAUDE_CODE_USE_VERTEX=1` | Set model prefix to `google-vertex/` |
| `GOOGLE_APPLICATION_CREDENTIALS` | `provider["google-vertex"].options` |

**Migration strategy**: Detect CC provider from env vars and model ID format, then generate appropriate `provider` block in `opencode.json`. Do NOT copy API keys -- use `{env:VAR}` references.

---

## UI Preferences (Low Priority)

| Claude Code (`~/.claude.json`) | OpenCode (`~/.local/state/opencode/kv.json`) |
|-------------------------------|---------------------------------------------|
| `theme: "dark-daltonized"` | `theme: "opencode"` (different theme names) |
| `showExpandedTodos: true` | No equivalent |

Not worth migrating -- these are personal preferences that users will set up themselves.

---

## Fields That Have No Equivalent

| Claude Code Field | Notes |
|-------------------|-------|
| `numStartups` | Usage counter, not migratable |
| `installMethod` | CC-specific |
| `tipsHistory` | CC-specific UI tips |
| `promptQueueUseCount` | CC-specific |
| `cachedStatsigGates` | Feature flags, CC-specific |
| `cachedDynamicConfigs` | Feature flags, CC-specific |
| `firstStartTime` | CC-specific |
| `userID` | CC-specific hash |
| `skillUsage` | Analytics, not migratable |
| `clientDataCache` | CC-specific |
| `githubRepoPaths` | CC-specific git mapping |
| `hasCompletedOnboarding` | CC-specific |
| `bypassPermissionsModeAccepted` | Map to `permission: { "*": "allow" }` |

---

## Migration Output Example

Given this Claude Code config:

**`~/.Claude/settings.json`**:
```json
{
  "env": { "CLAUDE_CODE_USE_BEDROCK": "1" },
  "permissions": { "allow": [], "deny": [], "defaultMode": "bypassPermissions" },
  "model": "anthropic.claude-opus-4-6-v1:0:1m",
  "autoUpdatesChannel": "latest"
}
```

**Generated `~/.config/opencode/opencode.json`**:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "amazon-bedrock/anthropic.claude-opus-4-6-v1:0:1m",
  "small_model": "amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0",
  "autoupdate": true,
  "permission": {
    "*": "allow"
  },
  "provider": {
    "amazon-bedrock": {
      "options": {}
    }
  }
}
```
