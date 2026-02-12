# Permission System Migration

> Detailed mapping between Claude Code's trust-based permission model and OpenCode's granular allow/deny/ask system.

## Conceptual Difference

### Claude Code: Trust-Based
- **Default**: Everything requires approval (ask)
- **Bypass mode**: `"defaultMode": "bypassPermissions"` skips all prompts
- **Allow lists**: Specific tool+pattern combinations pre-approved
- **Deny lists**: Specific tool+pattern combinations blocked
- **Per-project**: Stored in `~/.claude.json` under `projects[path].allowedTools`

### OpenCode: Granular Rule-Based
- **Default**: Configurable per-tool
- **Allow all**: `"*": "allow"` 
- **Per-tool**: Each tool can be `allow`, `deny`, or `ask`
- **Pattern matching**: Tool permissions support glob patterns for arguments
- **Per-agent**: Agents can override global permissions

---

## Source Locations (Claude Code)

### 1. Global Settings (`~/.Claude/settings.json`)
```json
{
  "permissions": {
    "allow": ["Bash(git *)"],
    "deny": ["Write(*.env)", "Bash(rm -rf *)"],
    "ask": [],
    "defaultMode": "default"
  }
}
```

### 2. Per-Project (`~/.claude.json`)
```json
{
  "projects": {
    "/path/to/project": {
      "allowedTools": [
        "Bash(bun run *)",
        "Bash(git *)",
        "Read(*)",
        "Edit(*)",
        "Write(*)"
      ]
    }
  }
}
```

### 3. Project Local (`.claude/settings.local.json`)
```json
{
  "permissions": {
    "allow": ["Bash(npm test)"],
    "deny": [],
    "ask": []
  }
}
```

---

## Target Format (OpenCode)

### Global (`opencode.json`)
```json
{
  "permission": {
    "*": "ask",
    "read": "allow",
    "grep": "allow",
    "glob": "allow",
    "edit": "ask",
    "write": "ask",
    "bash": {
      "git *": "allow",
      "bun run *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    },
    "webfetch": "allow",
    "task": "allow"
  }
}
```

### Per-Agent (in agent frontmatter)
```yaml
permission:
  read: allow
  edit: deny
  bash: ask
```

---

## Tool Name Translation

| Claude Code Tool | OpenCode Permission Key | Notes |
|-----------------|------------------------|-------|
| `Read(*)` | `read` | File reading |
| `Write(*)` | `write` | File creation |
| `Edit(*)` | `edit` | File modification |
| `MultiEdit(*)` | `edit` | Same as edit in OC |
| `Bash(*)` | `bash` | Shell execution |
| `Glob(*)` | `glob` | File search |
| `Grep(*)` | `grep` | Content search |
| `WebFetch(*)` | `webfetch` | URL fetching |
| `WebSearch(*)` | `websearch` | Web search |
| `Task(*)` | `task` | Sub-agent delegation |
| `TodoRead(*)` | `todoread` | Todo reading |
| `TodoWrite(*)` | `todowrite` | Todo writing |
| `Skill(*)` | `skill` | Skill loading |
| (no equivalent) | `list` | Directory listing |
| (no equivalent) | `lsp` | LSP integration |
| (no equivalent) | `codesearch` | Code search |
| (no equivalent) | `external_directory` | External dir access |
| (no equivalent) | `doom_loop` | Loop detection |

---

## Conversion Algorithm

### Step 1: Determine Default Mode

| CC `defaultMode` | OC Permission |
|-------------------|--------------|
| `"default"` | `{ "*": "ask" }` |
| `"bypassPermissions"` | `{ "*": "allow" }` |

### Step 2: Process Allow List

For each entry in CC `permissions.allow`:

```
"Bash(git *)" -> { bash: { "git *": "allow" } }
"Read(*)"     -> { read: "allow" }
"Edit(*)"     -> { edit: "allow" }
"Write(*.ts)" -> { write: { "*.ts": "allow" } }
```

**Parsing**: `ToolName(pattern)` -> tool name (lowercase) + pattern

### Step 3: Process Deny List

Same format:
```
"Write(*.env)"    -> { write: { "*.env": "deny" } }
"Bash(rm -rf *)"  -> { bash: { "rm -rf *": "deny" } }
```

### Step 4: Process Per-Project Allow Lists

The `allowedTools` array in `~/.claude.json` uses the same format:
```
"Bash(bun run *)" -> { bash: { "bun run *": "allow" } }
```

### Step 5: Merge Rules

Combine global + project-local + per-project rules with precedence:
1. Per-project (`~/.claude.json` allowedTools) overrides global
2. Project-local (`.claude/settings.local.json`) overrides per-project
3. Deny always wins over allow for the same pattern

### Step 6: Simplify

If all patterns for a tool are `allow` with wildcard `(*)`:
```
{ read: { "*": "allow" } } -> { read: "allow" }
```

If tool has mixed patterns, keep the detailed form:
```
{ bash: { "git *": "allow", "rm -rf *": "deny", "*": "ask" } }
```

---

## Pattern Translation

### Simple Cases (Direct Translation)
| CC Pattern | OC Pattern | Notes |
|-----------|-----------|-------|
| `Bash(*)` | `bash: "allow"` | Wildcard = allow all |
| `Read(*)` | `read: "allow"` | Same |
| `Edit(*)` | `edit: "allow"` | Same |

### Pattern Cases (Tool + Glob)
| CC Pattern | OC Pattern |
|-----------|-----------|
| `Bash(git *)` | `bash: { "git *": "allow" }` |
| `Bash(bun run *)` | `bash: { "bun run *": "allow" }` |
| `Write(*.env)` | `write: { "*.env": ... }` |
| `Edit(src/**)` | `edit: { "src/**": ... }` |

### Regex in CC Patterns
Claude Code supports regex-like patterns (e.g., `Bash(npm (test|lint))`). OpenCode uses glob patterns. These need special handling:

- Simple alternation `(a|b)` -> convert to multiple rules or use `{a,b}` glob syntax
- Complex regex -> flag for manual conversion in the migration report

---

## Full Conversion Example

### Input

**`~/.Claude/settings.json`**:
```json
{
  "permissions": {
    "allow": ["Bash(git *)"],
    "deny": ["Bash(rm -rf *)", "Write(*.env)"],
    "defaultMode": "default"
  }
}
```

**`~/.claude.json` (for project /app)**:
```json
{
  "projects": {
    "/app": {
      "allowedTools": [
        "Read(*)", "Edit(*)", "Bash(bun run *)", "Bash(bun test *)"
      ]
    }
  }
}
```

### Output

**Global `~/.config/opencode/opencode.json`** (permission section):
```json
{
  "permission": {
    "*": "ask",
    "bash": {
      "git *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    },
    "write": {
      "*.env": "deny",
      "*": "ask"
    }
  }
}
```

**Project `/app/opencode.json`** (permission section):
```json
{
  "permission": {
    "read": "allow",
    "edit": "allow",
    "bash": {
      "bun run *": "allow",
      "bun test *": "allow",
      "git *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    }
  }
}
```

---

## Edge Cases

### 1. `bypassPermissions` mode
If CC has `defaultMode: "bypassPermissions"`:
```json
{ "permission": { "*": "allow" } }
```
Simple and complete.

### 2. Empty allow/deny lists with default mode
If CC has `defaultMode: "default"` with empty lists:
```json
{ "permission": { "*": "ask" } }
```

### 3. Tool names not in OC
If CC has allowed tools that don't exist in OC (e.g., custom tool names from plugins):
- Log a warning
- Skip the rule
- Include in migration report

### 4. Overlapping patterns
If both allow and deny match the same pattern:
```
allow: "Bash(git *)"
deny: "Bash(git push --force)"
```
In OC:
```json
{
  "bash": {
    "git push --force": "deny",
    "git *": "allow"
  }
}
```
OpenCode evaluates most-specific-first, so this works correctly.

### 5. `ask` entries in CC
CC `permissions.ask` array is rarely used (default behavior is ask). Map these to explicit `"ask"` rules only if the default mode is something else.

---

## Validation

After conversion, verify:
1. Every CC allowed tool has an OC `allow` rule
2. Every CC denied tool has an OC `deny` rule
3. No OC permission keys are invalid (check against known tool list)
4. Pattern syntax is valid glob format
5. Deny rules are preserved exactly (security-critical)
