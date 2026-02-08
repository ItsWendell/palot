# Interesting Patterns & Learnings from OpenCode

Beyond the feature gap analysis, OpenCode contains many interesting architectural decisions, clever patterns, and design insights worth understanding. These range from technical implementations to UX philosophy.

---

## 1. The 9-Strategy Fuzzy Edit Matcher

**File:** `packages/opencode/src/tool/edit.ts`

OpenCode's edit tool doesn't just do exact string matching — it cascades through 9 progressively fuzzier matching strategies to find the right location in a file:

1. **SimpleReplacer** — Exact string match
2. **LineTrimmedReplacer** — Whitespace-trimmed line-by-line comparison
3. **BlockAnchorReplacer** — Uses first/last lines as anchors, scores middle lines with Levenshtein similarity
4. **WhitespaceNormalizedReplacer** — Collapses all whitespace to single spaces
5. **IndentationFlexibleReplacer** — Strips all leading indentation before matching
6. **EscapeNormalizedReplacer** — Normalizes escaped characters
7. **TrimmedBoundaryReplacer** — Trims boundary lines for matching
8. **ContextAwareReplacer** — Uses context anchors with 50% similarity threshold for middle content
9. **MultiOccurrenceReplacer** — Replaces ALL exact occurrences (used as fallback)

**Why this matters:** AI models frequently introduce minor formatting differences (extra spaces, different indentation, escaped characters) when generating code edits. Rather than failing, OpenCode tries increasingly flexible matching. This dramatically reduces "oldString not found" errors.

**Lesson for Codedeck:** When building any AI-assisted editing features in the GUI, consider fuzzy matching over exact matching. The UI could even show confidence levels ("exact match" vs "fuzzy match — please verify").

---

## 2. Provider-Specific Message Transforms (Middleware Pattern)

**File:** `packages/opencode/src/provider/transform.ts` (829 lines)

Rather than having a single code path for all providers, OpenCode applies provider-specific transformations as middleware:

- **Anthropic:** Inserts ephemeral cache control headers on system prompts and recent messages for prompt caching (reduces cost significantly)
- **Google/Gemini:** Sanitizes JSON schemas (converts integer enums to strings, fixes empty `items` arrays) because Gemini's API rejects valid JSON Schema
- **Mistral:** Normalizes tool call IDs to 9-character alphanumeric strings (Mistral rejects longer IDs)
- **OpenAI/GPT-5:** Remaps stored `providerOptions.openai` to match SDK expectations
- **LiteLLM:** Injects a dummy `_noop` tool to prevent "no tools" errors

**Pattern:** Each transform is a pure function `(messages, options) => (messages, options)` composed in a pipeline. This keeps provider-specific quirks isolated from core logic.

**Lesson:** AI provider APIs are NOT uniform despite using similar patterns. Any system that talks to multiple providers needs a transform layer. Codedeck doesn't directly call providers (OpenCode does), but understanding this pattern helps when debugging provider-specific issues.

---

## 3. The Frecency Algorithm for File Autocomplete

**File:** `packages/opencode/src/cli/cmd/tui/component/prompt/frecency.tsx`

OpenCode doesn't just sort files alphabetically or by name match — it uses **frecency** (frequency + recency) scoring, the same algorithm Firefox uses for URL suggestions:

- Each file access is tracked with a timestamp
- Recent accesses are weighted more heavily than old ones
- Frequently accessed files bubble to the top
- Directory depth is used as a tiebreaker (shallow files preferred)
- The frecency store is persisted across sessions

**Why this matters:** In a large codebase, the same 10-20 files are referenced repeatedly. Frecency ensures these files appear first in autocomplete without explicit favoriting.

**Lesson for Codedeck:** If @file autocomplete is implemented, frecency scoring would make it dramatically more useful than basic fuzzy matching alone.

---

## 4. Prompt Stash (Git-Stash for Prompts)

**File:** `packages/opencode/src/cli/cmd/tui/component/prompt/stash.tsx`

OpenCode implements a git-stash-like system for prompt drafts:

- `stash` — saves current prompt text and clears the input
- `stash pop` — restores the most recent stashed prompt
- `stash list` — shows all stashed prompts for selection
- Persisted to `~/.local/state/opencode/prompt-stash.jsonl`
- Max 50 entries with FIFO eviction

**Use case:** You're writing a complex prompt, then realize you need to ask a quick question first. Stash your work, ask the question, then pop your original prompt back.

**Lesson for Codedeck:** This is a small feature with outsized utility. A simple "Save draft" / "Restore draft" in the prompt toolbar would be valuable and trivial to implement with localStorage.

---

## 5. Context Window Compaction Strategy

**File:** `packages/opencode/src/session/compaction.ts`

When the context window fills up, OpenCode doesn't just truncate — it has a sophisticated compaction strategy:

1. **Detection:** Monitors token usage during streaming. When approaching the limit, flags for compaction.
2. **Auto-continue:** After compaction, automatically sends "Continue if you have next steps" to keep the agent working.
3. **Selective pruning:** Large tool outputs (>40K tokens) are candidates. Protected minimum of 20K tokens.
4. **Protected outputs:** Skill tool outputs are NEVER pruned (they contain critical instructions).
5. **Compaction agent:** A dedicated "compaction" agent with its own system prompt summarizes the session history into a compressed form.
6. **Configurable:** `compaction.auto` (enable/disable auto-compaction), `compaction.prune` (enable/disable output pruning).

**Lesson for Codedeck:** The UI should surface compaction status:
- Show a "Context: 78% used" indicator that changes color at thresholds
- "Compact" button that appears when context is high
- Toast notification when auto-compaction occurs
- Visual indicator in chat when compacted content was summarized

---

## 6. Permission Arity Analysis for Bash Commands

**File:** `packages/opencode/src/permission/arity.ts`

OpenCode doesn't just ask "allow bash?" — it parses bash commands using **tree-sitter** to extract the specific operations being performed, then checks permissions against parsed command patterns.

For example, `git commit -m "fix"` is parsed to understand it's a `git commit` command, which might have different permission rules than `rm -rf /`.

**Pattern:** Uses `web-tree-sitter` with `tree-sitter-bash` grammar to parse bash commands into an AST, extracts the command name and arguments, then matches against permission patterns.

**Lesson:** Granular permission patterns (e.g., "allow all `git` commands but ask for `rm`") are more useful than binary allow/deny. Codedeck's permission UI could show the parsed command structure to help users make informed decisions.

---

## 7. The Shadow Git Snapshot System

**File:** `packages/opencode/src/snapshot/index.ts`

OpenCode maintains a hidden git repository per project at `~/.local/share/opencode/snapshot/<project-id>/` that tracks file state independently of the user's actual git repo:

- Before every edit/write operation, the current file state is committed to the shadow repo
- Each snapshot is a git tree hash, not a full commit (lightweight)
- `Snapshot.diff(hash)` compares current state against any snapshot
- `Snapshot.restore(hash)` reverts files to a snapshot state
- Periodic cleanup (hourly) prunes objects older than 7 days
- Uses git plumbing commands (`hash-object`, `mktree`, `read-tree`) for efficiency

**Why this is clever:** It provides undo/redo and revert capabilities without touching the user's actual git history. The user can freely experiment and revert without creating messy commits.

**Lesson for Codedeck:** When implementing file revert UI, understand that the data lives in this shadow repo, not in the user's git history. The `session.revert()` API call triggers snapshot restoration.

---

## 8. Event Bus Architecture with Typed Events

**File:** `packages/opencode/src/bus/`

OpenCode's event bus is elegantly typed:

```typescript
const SessionCreated = BusEvent.define<Session>("session.created")
Bus.publish(SessionCreated, session)
Bus.subscribe(SessionCreated, (session) => { ... })
```

Events are first-class values with type inference. The bus supports:
- `publish(event, payload)` — Fire event to all subscribers
- `subscribe(event, handler)` — Subscribe to specific event type
- `subscribeAll(handler)` — Subscribe to ALL events (for logging, forwarding)
- Global bus for cross-instance events (used by the server for SSE)

**46+ event types** covering: sessions, messages, parts, permissions, tools, providers, files, config, MCP, LSP, snapshots, worktrees, and more.

**Lesson:** The SSE stream that Codedeck consumes is just the external projection of this internal event bus. Understanding the full event taxonomy helps identify what data is available for UI features.

---

## 9. SolidJS for Terminal UI (Instead of React)

OpenCode uses **SolidJS** (not React) for its TUI, paired with a custom terminal rendering engine (`@opentui/core`). Key advantages:

1. **Fine-grained reactivity** — Only the exact terminal cells that changed are re-rendered. No virtual DOM diffing.
2. **No hook rules** — No "rules of hooks" to follow. Signals work anywhere.
3. **True reactivity** — `createMemo` recomputes only when its dependencies change, with no component-level re-renders.
4. **60 FPS target** — The TUI runs at 60 FPS with efficient terminal updates.

**Why this matters for Codedeck:** React 19's component-level re-rendering requires careful optimization (as documented in AGENTS.md with the Zustand infinite loop warning). SolidJS wouldn't have this problem because it tracks dependencies at the signal level, not the component level.

**Lesson:** Codedeck is committed to React, but the patterns used to optimize React (binary search inserts, structural sharing, memoized derived state) are direct compensations for React's rendering model. Consider using React Compiler or Signals RFC proposals when they mature.

---

## 10. Multi-Level Configuration with Deep Merge

**File:** `packages/opencode/src/config/config.ts` (1400+ lines)

OpenCode's config system is impressively layered:

1. Remote `.well-known/opencode` (org-level defaults)
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`opencode.json` in project root)
5. `.opencode/` directory config
6. Inline config (`OPENCODE_CONFIG_CONTENT` env var)
7. Managed config (`/etc/opencode/` — enterprise override)

Each level deep-merges with the previous, with arrays concatenated (not replaced) for plugins and instructions. Special syntax:
- `{env:API_KEY}` — environment variable interpolation
- `{file:~/.secrets/key}` — file content inclusion

**Enterprise pattern:** The managed config directory (`/etc/opencode/` on Linux, `/Library/Application Support/opencode` on macOS) allows IT admins to enforce configuration across an organization.

**Lesson:** Codedeck could benefit from a config layer for its own preferences (theme, layout, shortcuts), separate from OpenCode's config. A simple JSON file at `~/.config/codedeck/config.json` would suffice.

---

## 11. The "Doom Loop" Detection

OpenCode has a built-in permission check for `doom_loop` — a pattern where the agent gets stuck in an infinite cycle of retrying the same failed operation. When detected, the system asks the user for permission to continue, breaking the loop.

**Lesson:** Codedeck should display a visual indicator when an agent appears stuck (repeated tool calls, high retry count) and offer a "Stop and redirect" action.

---

## 12. Model Resolution Chain

**File:** `packages/opencode/src/provider/provider.ts`

When determining which model to use, OpenCode follows a 5-level fallback chain:

1. User's explicit selection (from UI)
2. Agent's configured model (from agent definition)
3. Config `model` field (from opencode.json)
4. Most recent model (from model.json state file)
5. Provider's default model

Codedeck implements this same chain in `resolveEffectiveModel()`, which is good. But the chain should be visible to users — show "Using X because [reason]" so users understand why a particular model was selected.

---

## 13. Paste Summarization

**File:** `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

When a user pastes 3+ lines or >150 characters, OpenCode collapses it to `[Pasted ~N lines]` as a visual extmark. The full content is still sent to the AI, but the prompt remains visually clean.

This can be disabled with `experimental.disable_paste_summary`.

**Lesson:** Large pastes in a GUI prompt input can be even more disruptive. Codedeck should collapse large pastes to a summary badge with an "Expand" option, keeping the prompt area readable.

---

## 14. Session Cost Tracking with Decimal.js

**File:** `packages/opencode/src/session/llm.ts`

OpenCode uses `decimal.js` for cost calculations rather than JavaScript's floating point. This prevents rounding errors that accumulate over many API calls.

Example: `0.1 + 0.2 = 0.30000000000000004` in JS, but `new Decimal("0.1").plus("0.2")` = `0.3` exactly.

**Lesson:** If Codedeck implements cost display, use proper decimal arithmetic or at least format to 4 decimal places to hide floating point artifacts.

---

## 15. Auto-Repair Tool Calls

**File:** `packages/opencode/src/session/llm.ts`

OpenCode uses Vercel AI SDK's `experimental_repairToolCall` to automatically fix malformed tool calls from the AI. When a model calls a tool with the wrong casing (e.g., `Read` instead of `read`), the system auto-corrects it rather than failing.

**Lesson:** AI models are imperfect. Every interface between AI output and system input should have a repair/normalization layer.

---

## 16. The Compaction Agent

OpenCode has a dedicated "compaction" agent (hidden from the UI) with its own system prompt specifically designed to summarize session history. It's a specialized AI agent whose only job is to compress other AI conversations.

The compaction prompt instructs the AI to:
- Preserve key decisions and rationale
- Maintain code references and file paths
- Keep error messages and solutions
- Summarize repetitive tool calls
- Retain the current task context

**Lesson:** Using AI to manage AI context is a meta-pattern worth adopting. Codedeck could show a "Compacting..." indicator with a brief summary of what was preserved.

---

## 17. Title and Summary Agents

Similar to compaction, OpenCode has hidden agents for:
- **Title generation** — AI generates concise session titles from the conversation
- **Summary generation** — AI creates session summaries for the session list

These run automatically and asynchronously, not blocking the main conversation.

**Lesson:** Codedeck already benefits from these (titles appear in the sidebar), but could expose summaries in the session list for better browsability.

---

## 18. The Worktree Naming System

**File:** `packages/opencode/src/worktree/index.ts`

Git worktree branches are auto-named using an adjective-noun pattern: `opencode/brave-canyon`, `opencode/swift-meadow`, etc. This is:
- Human-readable
- Unique enough to avoid collisions
- Easily recognizable as OpenCode-created branches

**Lesson:** When Codedeck adds worktree support, reuse this naming convention for consistency.

---

## 19. Prompt History Self-Healing

**File:** `packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx`

The prompt history JSONL file self-heals on load — if a line is corrupted, it's silently skipped rather than crashing. This is defensive persistence.

**Lesson:** Any persisted data (localStorage, IndexedDB, files) should handle corruption gracefully. Wrap JSON.parse in try/catch and silently discard corrupt entries.

---

## 20. The "Getting Started" Flow

OpenCode detects first-time users (`sessions.length === 0`) and new users (no paid providers connected) separately:

- **First-time users:** Tips are hidden (too confusing), provider connect dialog opens automatically
- **No paid providers:** Sidebar shows a "Getting Started" card with connect button
- **The card is dismissable** and the dismissal persists to KV store

**Lesson for Codedeck:** The first-run experience should be designed carefully:
1. Detect if OpenCode has any providers configured
2. If not, show a guided setup flow
3. If yes but no sessions exist, show onboarding tips
4. If returning user, go straight to the dashboard

---

## 21. The Command Template System

**File:** `packages/opencode/src/command/template/`

Custom commands in `.opencode/commands/*.md` support template interpolation:

```markdown
---
description: Review this PR
---
Review the changes in PR #${1:pr_number} focusing on ${2:focus_area}
```

The `${N:label}` syntax creates named parameters that are prompted when the command is invoked. This turns simple markdown files into parameterized prompt templates.

**Lesson:** Codedeck could offer a "Prompt Templates" feature — saved prompts with fillable parameters, stored per-project or globally.

---

## 22. Skills Compatible with Claude Code

**File:** `packages/opencode/src/skill/skill.ts`

OpenCode scans for skills in:
- `.opencode/skills/`
- `.claude/skills/` (Claude Code compatibility)
- `.agents/skills/` (emerging standard)

This cross-compatibility means skills written for Claude Code work in OpenCode (and vice versa). The format is simple: markdown files with YAML frontmatter (`name`, `description`) and content.

**Lesson:** If Codedeck ever adds skill management, it should respect all three paths for maximum compatibility.

---

## 23. Web Data from Multiple Sources

OpenCode's model discovery fetches from `https://models.dev/api.json` (a community model database), caches it locally, refreshes hourly, and falls back to a build-time snapshot if the network is unavailable.

**Pattern:** Remote data → local cache → built-in fallback. This three-tier approach ensures the app always works, even offline.

**Lesson:** Apply this pattern to any remote data Codedeck fetches. Always have a fallback.

---

## 24. The Experimental Feature Flag System

OpenCode uses environment variables as feature flags:
- `OPENCODE_EXPERIMENTAL` — enable ALL experimental features
- `OPENCODE_EXPERIMENTAL_*` — enable specific features
- Config `experimental` section for persistent flags
- Individual features check both env vars and config

**Lesson:** Codedeck should adopt a similar pattern for testing new features:
- URL parameter (`?experimental=true`)
- localStorage flag
- Config file option
- These can gate features that are built but not polished

---

## Summary of Top Patterns Worth Adopting

| # | Pattern | Effort | Impact |
|---|---------|--------|--------|
| 1 | Frecency scoring for autocomplete | LOW | HIGH |
| 2 | Provider-specific middleware transforms | N/A (handled by OpenCode) | N/A |
| 3 | UI preference persistence (KV/localStorage) | LOW | HIGH |
| 4 | Prompt stash (save/restore drafts) | LOW | MEDIUM |
| 5 | Paste summarization (collapse large pastes) | LOW | MEDIUM |
| 6 | Context window visual indicator | LOW | HIGH |
| 7 | Error toasts + inline error display | LOW | HIGH |
| 8 | Typed event taxonomy awareness | LOW | MEDIUM |
| 9 | First-run detection + onboarding | MEDIUM | HIGH |
| 10 | Command palette expansion | MEDIUM | HIGH |
| 11 | Prompt history with persistence | LOW | HIGH |
| 12 | Feature flags for experimental features | LOW | MEDIUM |
| 13 | Defensive persistence (self-healing JSON) | LOW | LOW |
| 14 | Decimal.js for cost display | LOW | LOW |
| 15 | Doom loop detection + visual indicator | MEDIUM | MEDIUM |
