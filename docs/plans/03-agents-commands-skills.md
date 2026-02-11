# Agents, Commands & Skills Migration

> Plan for migrating agent definitions, custom commands, and skills from Claude Code to OpenCode.

## Skills (Low Effort -- Mostly Handled)

### Current State
OpenCode **already reads** Claude Code skill directories natively:
- `~/.claude/skills/**/SKILL.md` (global)
- `.claude/skills/**/SKILL.md` (project-level)
- `~/.agents/skills/**/SKILL.md` (shared)

Both tools use the same `SKILL.md` format with YAML frontmatter (`name`, `description`).

### Migration Actions
1. **Verify compatibility** -- scan all skills and validate YAML frontmatter
2. **Fix invalid YAML** -- OpenCode has a fallback parser, but flag any issues
3. **Create symlinks** -- if skills exist only in `~/.Claude/skills/`, symlink to `~/.config/opencode/skills/`
4. **Optional**: Copy to `.opencode/skills/` for projects that want OpenCode-native paths

### Recommendation
Skills are the easiest category. The tool should:
- Scan and list all discovered skills
- Verify they parse correctly
- Report any that need manual fixes
- Optionally create symlinks in OpenCode paths

---

## Agents (Medium Effort -- Format Conversion Required)

### Source Locations (Claude Code)
- `~/.claude/agents/*.md` (global agents -- CC doesn't officially support this but some users create them here)
- `.claude/agents/*.md` (project-level agents)

### Target Locations (OpenCode)
- `~/.config/opencode/agents/*.md` (global agents)
- `.opencode/agents/*.md` (project-level agents)

### Format Differences

#### Claude Code Agent Format
```yaml
---
name: code-reviewer
description: Reviews code for quality and security
tools: Read, Grep, Bash, WebFetch
model: inherit
---
You are an expert code reviewer...
```

#### OpenCode Agent Format
```yaml
---
description: Reviews code for quality and security
mode: subagent
model: anthropic/claude-sonnet-4-5
temperature: 0.2
color: "#38A3EE"
steps: 50
permission:
  read: allow
  grep: allow
  bash: ask
  webfetch: allow
  edit: deny
  write: deny
---
You are an expert code reviewer...
```

### Conversion Rules

#### 1. Remove `name` field
OpenCode uses the filename as the identifier. The `name` field in CC frontmatter is ignored.

#### 2. Convert `tools` to `permission`
Map Claude Code tool names to OpenCode permission entries:

| CC Tool Name | OC Permission Key | Default Action |
|-------------|-------------------|----------------|
| `Read` | `read` | `allow` |
| `Write` | `write` | `allow` |
| `Edit` | `edit` | `allow` |
| `Bash` | `bash` | `ask` |
| `Glob` | `glob` | `allow` |
| `Grep` | `grep` | `allow` |
| `WebFetch` | `webfetch` | `allow` |
| `WebSearch` | `websearch` | `allow` |
| `Task` | `task` | `allow` |
| `TodoWrite` | `todowrite` | `allow` |
| `TodoRead` | `todoread` | `allow` |
| `Skill` | `skill` | `allow` |

**Logic**:
- Tools listed in CC `tools` -> set to `allow` in OC (except `Bash` which gets `ask` by default)
- Tools NOT listed -> set to `deny`
- If no `tools` field in CC -> set `"*": "allow"` (full access)

#### 3. Convert `model`
| CC Value | OC Value |
|----------|----------|
| `inherit` | Omit field (inherits from config) |
| `opus` | `anthropic/claude-opus-4-6` (or detect from global settings) |
| `sonnet` | `anthropic/claude-sonnet-4-5` |
| `claude-3-5-sonnet-20241022` | `anthropic/claude-3-5-sonnet-20241022` |

Use the same model translation logic from [01-config-mapping.md](./01-config-mapping.md).

#### 4. Infer `mode`
CC doesn't have an explicit mode concept. Heuristics:
- If the agent description mentions "sub", "helper", "assist" -> `subagent`
- If the agent name contains "plan", "review", "audit" -> `subagent`
- Default -> `primary`
- Always allow the user to override in the migration config

#### 5. Infer `temperature`
CC doesn't set temperature. Heuristics based on agent purpose:
- Code review/analysis agents -> `0.1-0.2`
- General coding agents -> `0.3-0.5`
- Creative/documentation agents -> `0.5-0.7`
- Default -> `0.3`

#### 6. Add `steps`
CC doesn't have this. Default: `50` for primary agents, `25` for subagents.

#### 7. Preserve prompt body
The markdown content below the frontmatter (system prompt) is copied as-is.

### Full Conversion Example

**Input: `.claude/agents/security-auditor.md`**
```yaml
---
name: security-auditor
description: OWASP-focused security code review
tools: Read, Grep, Bash
model: sonnet
---
You are a security auditor focused on OWASP Top 10.

## Approach
1. Identify vulnerabilities
2. Rate severity (critical/high/medium/low)
3. Provide specific fixes with code examples
```

**Output: `.opencode/agents/security-auditor.md`**
```yaml
---
description: OWASP-focused security code review
mode: subagent
model: anthropic/claude-sonnet-4-5
temperature: 0.1
steps: 25
permission:
  read: allow
  grep: allow
  bash: ask
  edit: deny
  write: deny
  glob: allow
---
You are a security auditor focused on OWASP Top 10.

## Approach
1. Identify vulnerabilities
2. Rate severity (critical/high/medium/low)
3. Provide specific fixes with code examples
```

---

## Commands (Medium Effort)

### Source Locations (Claude Code)
- `.claude/commands/*.md` (project-level)
- `~/.claude/commands/*.md` (global -- if user created them)

### Target Locations (OpenCode)
- `.opencode/commands/*.md` (project-level)
- `~/.config/opencode/commands/*.md` (global)

### Format Differences

#### Claude Code Command Format
```markdown
---
name: git-pr
description: Create a PR with conventional commit message
---
Create a PR for the current branch. Use conventional commit format.
Review all changes with `git diff main...HEAD`.
```

#### OpenCode Command Format
```markdown
---
description: Create a PR with conventional commit message
agent: build
model: anthropic/claude-sonnet-4-5
subtask: false
---
Create a PR for the current branch. Use conventional commit format.
Review all changes with `git diff main...HEAD`.
```

### Conversion Rules

1. **Remove `name`** -- OpenCode uses filename as command name
2. **Keep `description`** -- same field
3. **Add `agent`** -- default to `build` unless context suggests otherwise
4. **Add `subtask`** -- default to `false`
5. **Optional `model`** -- omit to inherit from config
6. **Template variables**: 
   - CC uses `$1`, `$2` for positional args
   - OC uses `$1`, `$2`, `$ARGUMENTS` for positional and all args
   - Compatible format -- no changes needed
7. **Shell execution**: 
   - CC commands may reference `Bash` tool usage in the prompt
   - OC supports `` !`command` `` syntax for inline shell execution in templates
   - Flag these for manual review

### Example

**Input: `.claude/commands/deploy.md`**
```markdown
---
name: deploy
description: Deploy to staging or production
---
Deploy the current branch to $1 environment.
First run the tests, then build, then deploy.
Use the deployment script at ./scripts/deploy.sh $1.
```

**Output: `.opencode/commands/deploy.md`**
```markdown
---
description: Deploy to staging or production
agent: build
subtask: false
---
Deploy the current branch to $1 environment.
First run the tests, then build, then deploy.
Use the deployment script at ./scripts/deploy.sh $1.
```

---

## Directory Structure Migration Summary

```
.claude/                        .opencode/
├── agents/                     ├── agents/
│   ├── code-reviewer.md   ->  │   ├── code-reviewer.md   (format converted)
│   └── security-auditor.md ->  │   └── security-auditor.md (format converted)
├── commands/                   ├── commands/
│   ├── deploy.md          ->  │   ├── deploy.md           (format converted)
│   └── git-pr.md          ->  │   └── git-pr.md           (format converted)
├── skills/                     ├── skills/
│   └── my-skill/               │   └── my-skill/
│       └── SKILL.md       ->  │       └── SKILL.md        (copy or symlink)
└── settings.local.json    ->  opencode.json (merged)
```

---

## Validation

After migration, validate:
1. **Agent files**: Parse YAML frontmatter, verify all required fields present
2. **Command files**: Parse YAML frontmatter, verify description exists
3. **Skills**: Verify `SKILL.md` files have `name` and `description` in frontmatter
4. **No orphaned references**: Ensure agent names referenced in commands exist

---

## Edge Cases

### 1. Agents with MCP tool references
CC agents might reference MCP tools in their prompt text. These won't work the same way in OC:
- CC: `/mcp__context7__resolve-library-id`
- OC: MCP tools available directly (e.g., `context7_resolve_library_id`)

**Action**: Flag in migration report, suggest updating prompt text.

### 2. Agents that reference `.claude/` paths
Some agent prompts reference files inside `.claude/`:
```
Read the guidelines from .claude/docs/coding-standards.md
```

**Action**: Update paths to `.opencode/` equivalents if the files were also migrated.

### 3. Commands with `$ARGUMENTS` vs positional args
CC commands may use `$1` and `$2` while OC also supports `$ARGUMENTS` (all args). The positional format is compatible.

### 4. Nested command directories
Both CC and OC support `commands/**/*.md` (recursive). Directory structure preserved.
