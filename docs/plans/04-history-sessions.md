# Session History Migration

> Plan for optionally migrating Claude Code session history to OpenCode format.

## Priority: P2 (Nice-to-Have)

Session history migration is complex and low-ROI for most users. Most people starting fresh with OpenCode don't need old Claude Code sessions. However, for power users with valuable conversation history, this feature is useful.

## Source Format (Claude Code)

### Session Index
**Location**: `~/.Claude/projects/<mangled-path>/sessions-index.json`
**Path mangling**: `/Users/foo/project` -> `-Users-foo-project`

```json
{
  "version": 1,
  "entries": [
    {
      "sessionId": "abc-123-uuid",
      "fullPath": "/Users/foo/.Claude/projects/-Users-foo-project/abc-123-uuid.jsonl",
      "fileMtime": 1768991455480,
      "firstPrompt": "Help me fix the login bug",
      "summary": "Fixed authentication issue in login flow",
      "messageCount": 45,
      "created": "2026-01-13T10:53:14.848Z",
      "modified": "2026-01-13T10:54:12.202Z",
      "gitBranch": "fix/login-bug",
      "projectPath": "/Users/foo/project",
      "isSidechain": false
    }
  ],
  "originalPath": "/Users/foo/project"
}
```

### Session Transcript
**Location**: `~/.Claude/projects/<mangled-path>/<session-uuid>.jsonl`
**Format**: JSONL (one JSON per line)

Each line is a message object (structure varies by message type):
```json
{"role": "user", "content": "Fix the login bug", "timestamp": 1768991455000}
{"role": "assistant", "content": "I'll help fix that...", "timestamp": 1768991456000, "model": "claude-opus-4-6"}
{"role": "tool_use", "name": "Read", "input": {"filePath": "/app/auth.ts"}, "timestamp": 1768991457000}
{"role": "tool_result", "content": "file contents...", "tool_use_id": "toolu_123"}
```

### Sub-Agent Transcripts
**Location**: `<session-uuid>/subagents/agent-<hash>.jsonl`
Same JSONL format, separate conversation thread.

### Tool Results
**Location**: `<session-uuid>/tool-results/toolu_bdrk_<id>.json`
Cached tool outputs (file contents, command output, etc.)

---

## Target Format (OpenCode)

### Project Entity
**Location**: `~/.local/share/opencode/storage/project/<projectID>.json`
```json
{
  "id": "f912843e-hash-of-worktree",
  "worktree": "/Users/foo/project",
  "vcs": "git",
  "sandboxes": [],
  "time": { "created": 1770571196322, "updated": 1770721182641 }
}
```
**Project ID**: SHA hash of the worktree path.

### Session Entity
**Location**: `~/.local/share/opencode/storage/session/<projectID>/<sessionID>.json`
```json
{
  "id": "ses_imported_abc123",
  "slug": "fix-login-bug",
  "version": "imported",
  "projectID": "f912843e...",
  "directory": "/Users/foo/project",
  "title": "Fixed authentication issue in login flow",
  "time": {
    "created": 1768991455000,
    "updated": 1768991500000
  },
  "summary": {
    "additions": 0,
    "deletions": 0,
    "files": 0
  }
}
```

### Message Entity
**Location**: `~/.local/share/opencode/storage/message/<sessionID>/<messageID>.json`
```json
{
  "id": "msg_001",
  "sessionID": "ses_imported_abc123",
  "role": "user",
  "time": { "created": 1768991455000, "updated": 1768991455000 }
}
```

### Part Entity
**Location**: `~/.local/share/opencode/storage/part/<messageID>/<partID>.json`
```json
{
  "id": "part_001",
  "messageID": "msg_001",
  "type": "text",
  "content": "Fix the login bug"
}
```

---

## Conversion Algorithm

### Step 1: Create/Update Project Entity
1. Hash the project path to get `projectID`
2. Check if project already exists in OC storage
3. If not, create the project entity

### Step 2: Convert Sessions
For each entry in `sessions-index.json`:
1. Generate an OC session ID: `ses_imported_<first8chars_of_cc_uuid>`
2. Create session entity with:
   - `title` from CC `summary` or `firstPrompt`
   - `slug` from slugified title
   - `version` = `"imported"`
   - `time.created` from CC `created` (convert ISO to epoch ms)
   - `time.updated` from CC `modified`

### Step 3: Convert Messages
Parse each JSONL session file:
1. For each line, determine the message type
2. Create message + part entities
3. Map CC roles to OC roles:
   - `"user"` -> `"user"`
   - `"assistant"` -> `"assistant"` 
   - `"tool_use"` -> combine with assistant message as a tool-call part
   - `"tool_result"` -> tool-result part on the assistant message

### Step 4: Handle Sub-Agents
Sub-agent transcripts can be:
- **Option A**: Imported as separate sessions with `parentID` linking
- **Option B**: Flattened into the main session (simpler but loses structure)
- **Recommendation**: Option A for fidelity, with a flag to flatten

---

## Prompt History Migration

### Source
**Location**: `~/.Claude/history.jsonl`
```json
{"display": "Fix the login bug", "timestamp": 1768991455000, "project": "/Users/foo/project"}
```

### Target
**Location**: `~/.local/state/opencode/prompt-history.jsonl`
```json
{"input": "Fix the login bug", "parts": [], "mode": "normal"}
```

### Conversion
Simple field rename:
- `display` -> `input`
- Add empty `parts` and `mode: "normal"`
- Note: OC prompt history doesn't include timestamps or project associations

---

## Limitations

1. **Tool results**: CC stores full tool output inline in JSONL; OC stores in separate part files. Large tool outputs may need truncation.
2. **Model metadata**: CC tracks which model generated each response; OC stores this differently.
3. **Session IDs**: Generated IDs won't match CC format -- sessions are effectively new entities.
4. **File snapshots**: CC's `file-history/` snapshots cannot be converted to OC's git-based snapshots.
5. **Sub-agent context**: The full context window of sub-agents (tool results, intermediate thinking) may not map cleanly.
6. **No incremental sync**: This is a one-time import, not an ongoing sync.

---

## Implementation Recommendations

1. **Make this opt-in** (`cc2oc migrate --include-history`)
2. **Import read-only** -- imported sessions should be browsable but not continuable
3. **Mark as imported** -- use `version: "imported"` to distinguish from native sessions
4. **Limit scope** -- offer `--since=2026-01-01` to limit how far back to import
5. **Skip large sessions** -- offer `--max-messages=500` to skip extremely long conversations
6. **Progress bar** -- this could take minutes for users with many sessions

---

## Complexity Estimate

| Component | Effort |
|-----------|--------|
| JSONL parsing | Low |
| Session index reading | Low |
| Message/Part entity creation | Medium |
| Sub-agent handling | Medium |
| Tool result conversion | Medium |
| Prompt history | Low |
| Testing with real data | High |
| **Total** | **~3-4 days** |
