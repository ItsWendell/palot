# Feature Gap Analysis

A comprehensive side-by-side comparison of every significant feature in OpenCode and its presence (or absence) in Palot.

## Legend

- **Full** — Feature fully implemented in Palot
- **Partial** — Some aspects implemented, significant gaps remain
- **Display** — Palot displays the data but can't modify/interact with it
- **None** — Feature not present in Palot at all

---

## 1. Core Chat Experience

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Send messages | Yes | Yes | Full |
| Streaming responses | Yes (streamText) | Yes (SSE parts) | Full |
| Turn-based rendering | Yes | Yes | Full |
| Markdown rendering | tree-sitter + experimental `<markdown>` | Streamdown (streaming markdown) | Full |
| Code syntax highlighting | tree-sitter (full language support) | Shiki (full language support) | Full |
| Tool call display | Inline with details | Compact inline with expandable summary | Full |
| Tool call state (running/error/done) | Color-coded with icons | Color-coded with icons | Full |
| Auto-scroll | Yes | Yes (use-stick-to-bottom) | Full |
| Copy response | Yes (`<leader>y`) | Yes (copy button) | Full |
| Thinking/reasoning display | Toggle visibility, opacity control | ChainOfThought component | Partial |
| Code concealment | Toggle hiding code delimiters | None | None |
| Shimmer/loading animation | Spinner animation | Shimmer gradient animation | Full |
| Error display | Inline red boxes + toasts | None visible | None |
| Message timestamps | Toggleable via command | None | None |
| Tool detail level toggle | Toggleable via command | None | None |

## 2. Prompt Input

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Basic text input | Yes | Yes (PromptInput component) | Full |
| Multi-line input | Shift+Enter, Ctrl+Enter, Alt+Enter | Shift+Enter | Partial |
| `@file` autocomplete | Fuzzy search with frecency scoring | Supported via PromptInput | Partial |
| `/command` autocomplete | All registered commands | None | None |
| Shell mode (`!`) | Type `!` at start, runs shell commands | None | None |
| Prompt history | 50 entries, persisted to JSONL, Up/Down nav | None | None |
| Prompt stash | Git-stash-like draft saving/popping | None | None |
| Large paste collapse | 3+ lines collapsed to `[Pasted ~N lines]` | None | None |
| Image paste (Ctrl+V) | Clipboard image detection + base64 | Supported via PromptInput | Partial |
| File drag-and-drop | Image file path detection | Supported via PromptInput | Partial |
| SVG paste as text | Yes | Unknown | None |
| External editor (`$EDITOR`) | `<leader>e` opens editor for prompt | None | None |
| Agent selector | Dropdown in prompt footer | Dropdown in toolbar | Full |
| Model selector | Dialog with favorites, recents, fuzzy search | Searchable popover grouped by provider | Partial |
| Variant selector | `Ctrl+T` cycle | Dropdown in toolbar | Full |
| Keyboard submit | Enter | Enter / Ctrl+Enter (configurable) | Full |
| Agent/model display | Below prompt: agent name + model + provider | Toolbar above prompt | Full |

## 3. Session Management

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Create session | `/new` or `<leader>n` | New Chat screen with project picker | Full |
| List sessions | `<leader>l` — dialog with search, delete, rename | Sidebar list | Partial |
| Delete session | `Ctrl+D` in session list | Delete action in sidebar | Full |
| Rename session | `Ctrl+R` | None | None |
| Fork session | `/fork` — fork from any message in timeline | None | None |
| Undo message | `<leader>u` — reverts message + file changes | None | None |
| Redo message | `<leader>r` — re-applies undone changes | None | None |
| Compact session | `<leader>c` — compress context window | None | None |
| Share session | `/share` — public share link | None | None |
| Unshare session | `/unshare` | None | None |
| Export session | `<leader>x` — multiple format options | None | None |
| Import session | `opencode import` CLI | None | None |
| Copy transcript | `/copy` — full session transcript | None | None |
| Session timeline | `<leader>g` — jump to any message | None | None |
| Session search | Server-side text search in session list | None (basic filtering only) | None |
| Auto-title | AI-generated titles | Via OpenCode (displays result) | Display |
| Session summary | AI-generated summaries | None | None |
| Session cost | Per-message tokens, total cost ($), context % | None | None |
| Session slug | Human-readable IDs | Project slugs (name-id12) | Full |
| Continue last | `--continue` flag | Click session in sidebar | Full |

## 4. Sub-Agent / Task System

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Sub-agent sessions | Child sessions with parentID | Yes, with "Open" navigation | Full |
| Parent navigation | `<leader>up` | Breadcrumb "Back to parent" | Full |
| Sibling navigation | `<leader>right/left` | None | None |
| Sub-agent filtering | Hidden by default, toggleable | Toggle in sidebar | Full |
| Sub-agent read-only | Prompt hidden for child sessions | Prompt still shown (but functional) | Different |
| Sub-agent permissions | Aggregated across children | Per-session | Partial |

## 5. Permission System

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Permission prompts | Allow once / Always / Reject + message | Approve / Deny | Partial |
| Diff display in permission | Full syntax-highlighted split/unified diff | None | None |
| Fullscreen diff | `Ctrl+F` toggle | None | None |
| "Always" persistence | Stored per-session, auto-resolves future requests | None (one-time only) | None |
| Rejection with feedback | User can type correction message | None | None |
| Rule-based config | Per-agent, per-tool, wildcard pattern matching | None (passthrough) | None |

## 6. File Operations & Diffs

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| File diff display | Split/unified view, syntax-highlighted | None | None |
| Diff in tool output | Shown inline for edit/write/apply_patch | None | None |
| Git snapshots | Shadow .git for point-in-time restore | None | None |
| Snapshot revert | Restore files to any snapshot state | None | None |
| Session diff sidebar | Modified files with +/- counts | None | None |
| Format on save | Configurable formatter per extension | None (via OpenCode) | None |
| File watcher | @parcel/watcher for change detection | None | None |

## 7. Provider Management

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Provider list | Dialog with connect/disconnect | Passthrough (model selector shows providers) | Partial |
| Provider auth (API key) | Set via dialog | None | None |
| Provider auth (OAuth) | Full OAuth flow with callback | None | None |
| Provider connect | Dialog with Getting Started flow | None | None |
| Model discovery | models.dev integration, hourly refresh | Via OpenCode API | Display |
| Model favorites | Toggle favorite, dedicated section | None | None |
| Model recents | Auto-tracked, cycling with F2 | Reads model.json for recent | Partial |
| Model cycling (keyboard) | F2 / Shift+F2, favorite cycling | None | None |
| Free model badges | "Free" tag on OpenCode-provided models | None | None |
| Disabled model display | Greyed out in list | None | None |
| Reasoning variant display | Per-model variant selection | Variant selector in toolbar | Full |

## 8. MCP (Model Context Protocol)

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| MCP server list | Status view with connect/disconnect | None | None |
| MCP connect/disconnect | Dynamic management | None | None |
| MCP OAuth auth | Full OAuth 2.0 + dynamic client registration | None | None |
| MCP tool listing | Per-server tool list | None | None |
| MCP prompts | Exposed as slash commands | None | None |
| MCP resources | Accessible via @-mention + API | None | None |
| MCP status indicators | Green/red dots in footer | None | None |
| MCP hot reload | ToolListChangedNotification support | None | None |
| MCP configuration | Per-server config in opencode.json | None | None |

## 9. Configuration & Customization

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Config file support | JSONC, multi-level (global/project/managed) | None (reads OpenCode's config) | None |
| Environment variable interpolation | `{env:VAR}` in config values | None | None |
| File content inclusion | `{file:path}` in config values | None | None |
| Theme system | 33 built-in + custom JSON themes | Single dark theme | None |
| Theme live preview | Preview while navigating theme list | None | None |
| Dark/light mode toggle | Via command palette | None | None |
| Keybind customization | 65+ configurable keybinds | ~5 hardcoded | None |
| Custom agents | `.opencode/agents/*.md` with frontmatter | None | None |
| Custom commands | `.opencode/commands/*.md` | None | None |
| Custom tools | Via plugins | None | None |
| Custom skills | `.opencode/skills/`, remote URLs | None | None |
| UI preference persistence | KV store (15+ preferences) | None (resets on reload) | None |
| Username display | Configurable via config | None | None |

## 10. Git / VCS Integration

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Branch display | Header/footer, auto-detected | Status bar | Full |
| Branch change detection | File watcher integration | Polling (30s) | Partial |
| Git snapshots | Per-session shadow .git | None | None |
| Git worktrees | Create, manage, reset worktrees | None | None |
| Worktree startup scripts | Per-worktree start commands | None | None |
| Session revert (git-based) | Revert file changes per message | None | None |

## 11. Plugin & Extension System

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Plugin loading | `.opencode/plugins/*.{ts,js}` + npm packages | None | None |
| Plugin hooks | 8+ hook types (permission, shell, chat, config, auth, tool, event) | None | None |
| Built-in plugins | Anthropic auth, Codex auth, Copilot auth, GitLab auth | None | None |
| Skill system | `.opencode/skills/SKILL.md` with frontmatter | None | None |
| Remote skills | Download + cache from URLs | None | None |
| Skill tool | Agent can load skills on demand | None | None |
| Editor extensions | VS Code extension | N/A (different paradigm) | N/A |

## 12. Cost & Usage Tracking

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Per-message token count | Input + output tokens tracked | None | None |
| Session total cost | USD-formatted in header | None | None |
| Context % used | Percentage of context window consumed | None | None |
| Token estimation | `tokenlens` library | `tokenlens` in deps but unused | None |
| Cost calculation | `decimal.js` for precise math | None | None |
| Stats command | `opencode stats` — aggregate usage | None | None |

## 13. LSP Integration

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Auto-spawn LSP servers | Per file extension | None | None |
| Diagnostics in tool output | Errors fed back to edit/write results | None | None |
| Go-to definition | LSP tool (experimental) | None | None |
| Find references | LSP tool (experimental) | None | None |
| Workspace symbols | LSP tool (experimental) | None | None |
| LSP status display | Count + dot in footer | None | None |
| Custom LSP config | Per-language in opencode.json | None | None |

## 14. Multi-Project Support

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Multi-project dashboard | No (single project per instance) | Yes — sidebar with all projects | Palot advantage |
| Project discovery | N/A | Reads from OpenCode storage | Full |
| Project switching | Start new instance in different directory | Click project in sidebar | Palot advantage |
| Cross-project SSE | N/A | Single SSE stream, all projects | Palot advantage |
| Active session indicators | N/A | "Active Now" section in sidebar | Palot advantage |

## 15. Desktop Integration

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Native desktop app | Tauri (in packages/desktop/) | Planned (Tauri not yet integrated) | Partial |
| System tray | Unknown | Planned | None |
| Native notifications | Unknown | Planned | None |
| Keyboard shortcuts (global) | Terminal keybinds | Not yet | None |
| Clipboard integration | `clipboardy` npm package | Browser clipboard API | Full |

## 16. Miscellaneous

| Feature | OpenCode | Palot | Gap |
|---------|----------|----------|-----|
| Command palette | `Ctrl+P` — 50+ commands, fuzzy search | `Cmd+K` — sessions + "New Session" only | Partial |
| Random tips | 70+ tips with random rotation | None | None |
| ASCII logo | Animated logo with shadow effects | None | N/A |
| Debug commands | 8 subcommands (agent, config, file, lsp, etc.) | None | None |
| Self-update | `opencode upgrade` | None | None |
| Install/uninstall | Shell script + `opencode uninstall` | None | None |
| ACP support | Full Agent Client Protocol | None | None |
| PTY sessions | Pseudo-terminal via `bun-pty` | None | None |
| mDNS discovery | `bonjour-service` for LAN discovery | None | None |
| GitHub integration | `opencode github`, `opencode pr` | None | None |
| Slack integration | `packages/slack/` | None | None |
| Session attachments | File, image, PDF support | File attachments (in progress) | Partial |
