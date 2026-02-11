# WIP Learnings: Claude Code to OpenCode Migration Tool

> This document captures ongoing research findings, gotchas, and insights discovered during the deep research phase. Updated continuously.

## Key Discovery: OpenCode Already Has Claude Code Compatibility

OpenCode has a **deliberate, well-engineered compatibility layer** with Claude Code built directly into its source code (`packages/opencode/src/`). Rather than requiring a migration tool for everything, it reads many Claude Code files natively. However, several areas **require manual conversion** -- and that's where our migration tool adds value.

### What OpenCode Reads Natively (No Migration Needed)
1. **`CLAUDE.md`** -- read as fallback when no `AGENTS.md` exists (project + global `~/.claude/CLAUDE.md`)
2. **`.claude/skills/`** -- scanned for `SKILL.md` files at project and global level
3. **`~/.agents/skills/`** -- shared skill directory (symlinks work for both tools)
4. **Lenient YAML parsing** -- handles Claude Code's permissive frontmatter format

### What Requires Manual Migration (Tool Adds Value)
1. **MCP server configurations** -- completely different format (`mcpServers` vs `mcp`, `command`+`args` vs `command[]`, `env` vs `environment`)
2. **Agent definitions** -- different frontmatter schema (tool names vs boolean flags, no mode/temperature in CC)
3. **Custom commands** -- different directory structure and frontmatter format
4. **Permissions** -- Claude Code uses trust-based tool lists, OpenCode uses granular allow/deny/ask
5. **Session history** -- completely different storage formats (JSONL vs JSON file tree)
6. **Global settings** -- `~/.Claude/settings.json` vs `~/.config/opencode/opencode.json`
7. **Hooks** -- Claude Code has 5 hook types (PreToolUse, PostToolUse, etc.); OpenCode has a plugin system instead
8. **Project-level tool allowlists** -- stored in `~/.claude.json` per-project, needs mapping to OpenCode permissions

---

## Filesystem Layout Comparison

### Claude Code
```
~/.claude.json                          # Global user state + per-project MCP/tools
~/.Claude/settings.json                 # Global settings (model, permissions, env)
~/.Claude/history.jsonl                 # Prompt history
~/.Claude/projects/<mangled-path>/      # Session transcripts (.jsonl)
~/.Claude/projects/*/sessions-index.json # Session metadata
~/.Claude/file-history/                 # File snapshots for undo
~/.Claude/shell-snapshots/              # ZSH env captures
~/.Claude/skills/                       # Symlinks to ~/.agents/skills/
~/.Claude/plugins/                      # Plugin marketplace
~/.Claude/plans/                        # Plan-mode outputs
~/.Claude/todos/                        # Per-agent todos
~/.Claude/tasks/                        # Background task state
~/.Claude/stats-cache.json              # Usage analytics
~/.Claude/statsig/                      # Feature flags
~/.Claude/paste-cache/                  # Clipboard cache
~/.local/share/Claude/versions/         # Installed binaries
~/.local/state/Claude/locks/            # Update locks
<project>/.claude/settings.local.json   # Project permission overrides
<project>/.mcp.json                     # Project MCP definitions
<project>/CLAUDE.md                     # Project instructions
<project>/AGENTS.md                     # Agent instructions (also read by CC)
```

### OpenCode
```
~/.config/opencode/opencode.json        # Main config (model, MCP, providers, permissions)
~/.config/opencode/AGENTS.md            # Global agent instructions
~/.config/opencode/skills/              # Global skills (symlinks to ~/.agents/skills/)
~/.config/opencode/commands/            # Custom slash commands
~/.config/opencode/plugins/             # Custom plugins (TypeScript)
~/.config/opencode/package.json         # Plugin dependencies
~/.local/state/opencode/kv.json         # UI preferences
~/.local/state/opencode/model.json      # Model history + favorites
~/.local/state/opencode/frecency.jsonl  # File frecency tracking
~/.local/state/opencode/prompt-history.jsonl # Prompt history
~/.local/state/opencode/tui             # TUI state (TOML)
~/.local/share/opencode/auth.json       # Provider auth tokens
~/.local/share/opencode/storage/        # Sessions/messages/parts/todos (JSON)
~/.local/share/opencode/snapshot/       # Git snapshots per project
~/.local/share/opencode/log/            # Server logs
~/.local/share/opencode/bin/            # Bundled tools (gopls, rg, LSPs)
~/.local/share/opencode/tool-output/    # Truncated tool output
<project>/.opencode/skills/             # Project skills
<project>/.opencode/agents/             # Project agents
<project>/.opencode/commands/           # Project commands
<project>/.opencode/plugins/            # Project plugins
<project>/opencode.json                 # Project config
<project>/AGENTS.md                     # Project instructions
```

---

## MCP Format Differences (Critical)

| Aspect | Claude Code | OpenCode |
|--------|------------|----------|
| Config key | `mcpServers` | `mcp` |
| Config location | `~/.claude.json` (per-project) or `.mcp.json` | `opencode.json` |
| Command format | `"command": "npx"` + `"args": ["-y", "pkg"]` | `"command": ["npx", "-y", "pkg"]` |
| Env vars key | `"env"` | `"environment"` |
| Type discriminator | Implicit (has command = local, has url = remote) | Explicit `"type": "local"` or `"type": "remote"` |
| Enable/disable | Not supported | `"enabled": true/false` |
| Timeout | Not configurable | `"timeout": 30000` (ms) |
| SSE type | `"type": "sse"` | `"type": "remote"` |
| HTTP type | `"type": "http"` | `"type": "remote"` |
| OAuth | Not supported | Full RFC 7591 support |

### Conversion Formula
```
Claude Code local:
  { command: "cmd", args: ["a", "b"], env: { K: "V" } }
  
OpenCode local:
  { type: "local", command: ["cmd", "a", "b"], environment: { K: "V" }, enabled: true }

Claude Code remote (SSE):
  { type: "sse", url: "https://..." }
  
OpenCode remote:
  { type: "remote", url: "https://..." }
```

---

## Agent Format Differences

### Claude Code Agent Frontmatter
```yaml
---
name: my-agent
description: What this agent does
tools: Read, Edit, Write, Grep, Bash
model: inherit
---
System prompt content here
```

### OpenCode Agent Frontmatter
```yaml
---
description: What this agent does
mode: primary  # or subagent, all
model: anthropic/claude-sonnet-4-5
temperature: 0.3
color: "#38A3EE"
steps: 50
permission:
  edit: allow
  bash: ask
  read: allow
---
System prompt content here
```

### Key Translation Points
- `name` in CC -> filename in OC (no name field needed)
- `tools: Read, Edit` in CC -> `permission: { read: allow, edit: allow }` in OC
- `model: inherit` in CC -> omit `model` in OC (inherits from config)
- CC has no `mode`, `temperature`, `color`, `steps` equivalents
- CC has no per-agent permission granularity

---

## Existing Tools Found

### 1. OpenPackage (`opkg`)
- **URL**: https://github.com/enulus/OpenPackage
- **What it does**: Universal config management across AI coding tools
- **Migration flow**: `opkg add .claude/` -> `opkg install --platforms opencode`
- **Limitation**: Focused on project-level config (`.claude/` dir), doesn't handle global config, history, MCP format conversion, or session migration
- **Status**: ~200 GitHub stars, actively maintained

### 2. No Official Migration Tool
- OpenCode has no `opencode migrate` or `opencode import-claude-config` command
- The `opencode import` command only imports OpenCode session data or share URLs
- Migration is expected to happen through the compatibility layer + manual config

---

## Session/History Format Differences

### Claude Code Sessions
- **Index**: `~/.Claude/projects/<mangled-path>/sessions-index.json`
- **Transcripts**: `<session-uuid>.jsonl` (one JSON per line, full message history)
- **Sub-agents**: `<session-uuid>/subagents/agent-<hash>.jsonl`
- **Tool results**: `<session-uuid>/tool-results/toolu_bdrk_<id>.json`
- **Path mangling**: `/Users/foo/bar` -> `-Users-foo-bar`

### OpenCode Sessions
- **Projects**: `~/.local/share/opencode/storage/project/<projectID>.json`
- **Sessions**: `~/.local/share/opencode/storage/session/<projectID>/<sessionID>.json`
- **Messages**: `~/.local/share/opencode/storage/message/<sessionID>/<messageID>.json`
- **Parts**: `~/.local/share/opencode/storage/part/<messageID>/<partID>.json`
- **Diffs**: `~/.local/share/opencode/storage/session_diff/<sessionID>.json`
- **Todos**: `~/.local/share/opencode/storage/todo/<sessionID>.json`

Key difference: Claude Code uses flat JSONL per session; OpenCode uses a normalized file-per-entity storage with separate files for messages, parts, and session metadata.

---

## Permission System Differences

### Claude Code
- Global: `~/.Claude/settings.json` -> `permissions: { allow: [], deny: [], ask: [], defaultMode: "..." }`
- Per-project: `~/.claude.json` -> `projects[path].allowedTools: ["Bash(*)"]`
- Project-local: `<project>/.claude/settings.local.json` -> `permissions: { allow: [], deny: [], ask: [] }`
- Tool names: `"Bash(*)"`, `"Read(*)"`, `"Edit(*)"`, etc. (with glob patterns)

### OpenCode
- Global: `opencode.json` -> `permission: { "*": "allow", "bash": "ask", "edit": { "*.env": "deny" } }`
- Per-agent: Agent frontmatter `permission` block
- Tool names: lowercase (`bash`, `edit`, `read`, `grep`, `glob`, `write`, `task`, `webfetch`, etc.)
- Supports nested glob patterns per tool

### Translation
```
Claude Code: permissions.allow = ["Bash(*)"] 
OpenCode:    permission.bash = "allow"

Claude Code: permissions.deny = ["Write(*.env)"]
OpenCode:    permission.edit = { "*.env": "deny" }

Claude Code: permissions.defaultMode = "bypassPermissions"
OpenCode:    permission = { "*": "allow" }
```

---

## Hooks vs Plugins

### Claude Code Hooks
5 lifecycle events: `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, `Stop`
Configured in `~/.Claude/settings.json` or project `.claude/settings.local.json`:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{ "type": "command", "command": "eslint --fix \"$CLAUDE_FILE_PATH\"" }]
    }]
  }
}
```

### OpenCode Plugins
TypeScript modules with 15+ hook points. Not directly convertible from CC hooks but can replicate behavior:
- `tool.execute.before` / `tool.execute.after` -> similar to PreToolUse/PostToolUse
- `chat.message` -> similar to UserPromptSubmit
- Custom tools via `tool()` helper

**Migration approach**: Generate plugin stubs from Claude Code hook definitions.

---

## Provider Configuration Differences

### Claude Code
- Model set in `~/.Claude/settings.json` as a single string: `"model": "anthropic.claude-opus-4-6-v1:0:1m"`
- Provider configured via env vars: `CLAUDE_CODE_USE_BEDROCK=1`, `ANTHROPIC_API_KEY`, etc.
- Single provider at a time (Claude-only for Anthropic, Bedrock, or Vertex)

### OpenCode
- Multiple providers configurable simultaneously in `opencode.json`
- Model format: `"provider/model"` (e.g., `"amazon-bedrock/global.anthropic.claude-opus-4-6-v1"`)
- 20+ bundled providers with per-provider options, whitelist/blacklist
- Auth tokens in `~/.local/share/opencode/auth.json`

---

## Variable Interpolation

### Claude Code
- No config variable interpolation (env vars set in `settings.json` -> `env` block)

### OpenCode
- `{env:VAR_NAME}` -- from environment
- `{file:path}` -- reads file content inline
- Useful for secrets: `"apiKey": "{env:ANTHROPIC_API_KEY}"`

---

## Things That Cannot Be Migrated

1. **Statsig feature flags** -- internal to Claude Code, no equivalent
2. **IDE connection state** -- runtime-only
3. **Shell snapshots** -- ZSH environment captures specific to CC sandbox
4. **File history / undo snapshots** -- CC uses content-hash snapshots, OC uses git-based snapshots
5. **Update locks and binary versions** -- platform-specific
6. **Paste cache** -- ephemeral clipboard content
7. **Plugin marketplace state** -- CC uses Anthropic's official marketplace; OC uses npm packages
8. **GitHub repo path mappings** -- `~/.claude.json` -> `githubRepoPaths` (CC-specific)

---

## Architecture Decision: Dual-Package in Monorepo

After analyzing the Codedeck monorepo structure, the chosen approach is **dual-package**:

1. **`packages/cc2oc`** (`@codedeck/cc2oc`) -- pure library, zero CLI deps. Exports `scan()`, `convert()`, `write()`, `validate()`, `diff()`. All conversion logic is pure functions (data in, data out). Only `scan()` and `write()` do filesystem I/O.

2. **`packages/cc2oc-cli`** (`cc2oc`) -- thin CLI using `citty` + `consola`. Imports everything from the library. Published to npm for standalone use.

**Why this works for Codedeck:**
- `apps/desktop` adds `"@codedeck/cc2oc": "workspace:*"` as a dependency
- Main process imports `scan`, `convert`, `write` and exposes via IPC handlers
- Renderer can show a migration wizard UI with scan results, let user pick what to migrate, then trigger write
- No CLI deps pollute the desktop app bundle
- Follows the same pattern as `@codedeck/ui` (source-level exports, `workspace:*` linking)

**Key insight from monorepo analysis:**
- `@codedeck/ui` uses direct source file exports (no build step) -- `@codedeck/cc2oc` can follow the same pattern
- TypeScript uses `moduleResolution: "bundler"` everywhere -- import from source works
- Biome config is shared at root -- no per-package lint config needed
- `tsgo --noEmit` for type checking (same as other packages)

---

## Open Questions
- Should we migrate Claude Code session history into OpenCode's storage format? (complex, low ROI for most users -- leaning toward opt-in P2)
- Should hooks be converted to plugin stubs or just documented as manual migration? (leaning toward stub generation)
- How to handle provider auth migration (CC uses env vars, OC uses auth.json)? (leaning toward `{env:VAR}` references, never copy secrets)
- Should the CLI support Node.js or be Bun-only? (leaning toward Bun-primary with `bun build --target=node` for Node compat)
