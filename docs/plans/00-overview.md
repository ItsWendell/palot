# Migration Tool: Claude Code to OpenCode

> Comprehensive plan for building `cc2oc` -- a CLI tool that migrates Claude Code configurations, MCP servers, agents, commands, skills, permissions, memories, and optionally session history to OpenCode format.

## Problem Statement

Developers migrating from Claude Code to OpenCode face a tedious manual process:
- MCP server configs use incompatible formats and must be hand-translated
- Agent definitions need frontmatter rewriting (tool lists -> boolean flags + permissions)
- Custom commands need directory restructuring and format changes
- Global settings are scattered across `~/.claude.json` and `~/.Claude/settings.json`
- Permissions use different models (trust-based vs granular allow/deny/ask)
- Session history is stored in completely different formats

While OpenCode has native compatibility for `CLAUDE.md` files and `.claude/skills/`, everything else requires manual intervention.

## Existing Solutions

| Tool | Scope | Limitations |
|------|-------|-------------|
| **OpenCode native compat** | `CLAUDE.md`, `.claude/skills/` | No MCP, agents, commands, settings, history |
| **OpenPackage (`opkg`)** | Project-level `.claude/` dir | No global config, no MCP format conversion, no history |
| **Manual migration** | Everything | Error-prone, time-consuming, no validation |

Our tool fills the gap by providing a comprehensive, automated migration with validation and dry-run support.

## Tool Name: `cc2oc`

**Claude Code to OpenCode** migration CLI.

## Core Principles

1. **Non-destructive** -- never modifies Claude Code files; only writes to OpenCode locations
2. **Dry-run first** -- always show what will change before applying
3. **Incremental** -- can be run multiple times safely (idempotent)
4. **Validated** -- verify output against OpenCode's JSON schema
5. **Selective** -- migrate specific categories or everything at once

## Migration Categories

| # | Category | Priority | Complexity | Document |
|---|----------|----------|------------|----------|
| 1 | **Global Settings** (model, env, permissions) | P0 | Low | [01-config-mapping.md](./01-config-mapping.md) |
| 2 | **MCP Servers** (format conversion) | P0 | Medium | [02-mcp-migration.md](./02-mcp-migration.md) |
| 3 | **Agents, Commands, Skills** | P0 | Medium | [03-agents-commands-skills.md](./03-agents-commands-skills.md) |
| 4 | **Session History** (optional) | P2 | High | [04-history-sessions.md](./04-history-sessions.md) |
| 5 | **Tool Architecture** | -- | -- | [05-tool-architecture.md](./05-tool-architecture.md) |
| 6 | **Permissions** | P0 | Medium | [06-permissions.md](./06-permissions.md) |

## Package Architecture: Dual-Package in Monorepo

The tool is split into two workspace packages for reusability:

```
packages/cc2oc/          @codedeck/cc2oc     Pure library (scanner, converter, writer, validator)
packages/cc2oc-cli/      cc2oc               Thin CLI wrapper (arg parsing, terminal output)
```

**Why the split:**
- `@codedeck/cc2oc` is a **zero-CLI-dependency library** that Codedeck's desktop app imports directly via `workspace:*` to power an in-app migration wizard (scan via IPC, show results in UI, write on confirmation)
- `cc2oc` is a standalone CLI published to npm (`npx cc2oc migrate`) for users who want terminal-based migration
- The library's `convert()` function is **pure** (data in, data out, no I/O), making it testable and usable in any context

See [05-tool-architecture.md](./05-tool-architecture.md) for full package structure, types, and Codedeck integration patterns.

## High-Level Architecture

```
@codedeck/cc2oc (library)           cc2oc (CLI)
├── scan()      -> ScanResult       ├── cc2oc scan
├── convert()   -> ConversionResult ├── cc2oc plan (dry-run)
├── write()     -> WriteResult      ├── cc2oc migrate
├── validate()  -> ValidationResult ├── cc2oc validate
└── diff()      -> DiffResult       └── cc2oc diff

Codedeck Desktop (in-app migration wizard)
├── main process: import { scan, convert, write } from "@codedeck/cc2oc"
├── IPC handlers: cc2oc:scan, cc2oc:migrate
└── renderer: migration wizard UI showing scan results + conversion preview
```

## CLI Interface

```bash
# Full migration with dry-run
cc2oc plan

# Full migration
cc2oc migrate

# Selective migration
cc2oc migrate --only mcp,agents,config
cc2oc migrate --skip history

# Specific project
cc2oc migrate --project /path/to/project

# Global only
cc2oc migrate --global

# Validate existing config
cc2oc validate

# Show config diff
cc2oc diff
```

## Library Interface (for Codedeck)

```typescript
import { scan, convert, write, validate } from "@codedeck/cc2oc"
import type { ScanResult, ConversionResult } from "@codedeck/cc2oc/types"

const scanResult = await scan({ global: true, project: "/path/to/project" })
const converted  = await convert(scanResult, { categories: ["config", "mcp"] })
const validation = await validate(converted)
const written    = await write(converted, { dryRun: false, backup: true })
```

## Output

The tool produces:
1. **Migrated config files** written to OpenCode locations
2. **Migration report** (what was migrated, what was skipped, what needs manual attention)
3. **Validation results** (schema compliance check)

## Phases

### Phase 1: Core Config Migration (MVP)
- Global settings -> `opencode.json`
- MCP server format conversion
- Permission mapping
- Agent definition conversion
- Command migration
- Rules file handling (`CLAUDE.md` -> `AGENTS.md`)
- Dry-run and validation

### Phase 2: Project-Level Migration
- Per-project MCP configs from `~/.claude.json`
- Project-local settings from `.claude/settings.local.json`
- `.mcp.json` project files
- Project-specific agents/commands

### Phase 3: History & Advanced
- Session history conversion (JSONL -> JSON storage)
- Prompt history migration
- Hook -> plugin stub generation
- Provider auth migration suggestions

## Related Documents

- [WIP-LEARNINGS.md](./WIP-LEARNINGS.md) -- Ongoing research findings
- [01-config-mapping.md](./01-config-mapping.md) -- Detailed config field mapping
- [02-mcp-migration.md](./02-mcp-migration.md) -- MCP server migration details
- [03-agents-commands-skills.md](./03-agents-commands-skills.md) -- Agent/command/skill migration
- [04-history-sessions.md](./04-history-sessions.md) -- Session history migration
- [05-tool-architecture.md](./05-tool-architecture.md) -- Tool implementation plan
- [06-permissions.md](./06-permissions.md) -- Permission system migration
