# Feature Gaps: Codedeck vs OpenCode TUI & Desktop

> Features present in OpenCode TUI and/or OpenCode Desktop that Codedeck currently lacks.

## Critical Gaps (Blocking Core Workflows)

### 1. Session Operations

| Feature                            |            OpenCode TUI             |       OpenCode Desktop        |             Codedeck             |
| ---------------------------------- | :---------------------------------: | :---------------------------: | :------------------------------: |
| Fork session                       |      `/fork` + timeline picker      |            Dialog             |           **Missing**            |
| Undo/Redo messages                 | `/undo`, `/redo` with git snapshots |           Supported           |           **Missing**            |
| Compact/Summarize context          |      `/compact` auto + manual       |           Supported           |           **Missing**            |
| Share session (public URL)         |              `/share`               |           Supported           |           **Missing**            |
| Export session (Markdown)          |              `/export`              |           Supported           |           **Missing**            |
| Copy transcript                    |               `/copy`               |           Supported           |           **Missing**            |
| Session timeline / jump-to-message |             `/timeline`             | Scroll anchoring via URL hash |           **Missing**            |
| Continue last session              |          `--continue` flag          |         Sidebar click         | **Missing** (only sidebar click) |

**Impact:** Users cannot fork sessions to explore alternatives, cannot undo AI mistakes (critical for trust), and cannot export/share their work. These are table-stakes features for power users.

### 2. Diff & Code Review

| Feature                           |           OpenCode TUI           |     OpenCode Desktop      |    Codedeck    |
| --------------------------------- | :------------------------------: | :-----------------------: | :------------: |
| Unified diff view                 |     Native `<diff>` element      | Pierre-based diff worker  |  **Missing**   |
| Split (side-by-side) diff         |    Auto layout based on width    |       Configurable        |  **Missing**   |
| Session file changes summary      | Sidebar with additions/deletions | Review tab with file tree |  **Missing**   |
| Permission diff preview           | Full diff before approving edits |         Full diff         | **Title only** |
| Line-level comments on diffs      |               N/A                |         Supported         |  **Missing**   |
| Turn-level vs session-level diffs |               N/A                |   Toggle between views    |  **Missing**   |

**Impact:** Codedeck's permission system shows tool name + command but NOT the actual diff content. Users approve file edits blind. This is a major trust/safety issue. The session review panel with file diffs is one of OpenCode Desktop's strongest features that Codedeck completely lacks.

### 3. File & Code Viewing

| Feature                        |      OpenCode TUI       |         OpenCode Desktop         |  Codedeck   |
| ------------------------------ | :---------------------: | :------------------------------: | :---------: |
| File tree panel                |           N/A           | Collapsible tree with file icons | **Missing** |
| Syntax-highlighted code viewer | Tree-sitter in terminal |   Shiki-based viewer with tabs   | **Missing** |
| File tabs with drag-and-drop   |           N/A           |            Supported             | **Missing** |
| Selection-to-context           |           N/A           |   Select lines, add to prompt    | **Missing** |

**Impact:** Users cannot browse project files or review code changes. They must use an external editor alongside Codedeck, losing the "unified workspace" value prop.

### 4. Embedded Terminal

| Feature                |    OpenCode TUI     |       OpenCode Desktop        |  Codedeck   |
| ---------------------- | :-----------------: | :---------------------------: | :---------: |
| Embedded terminal      | N/A (IS a terminal) | Ghostty-web via WebSocket PTY | **Missing** |
| Multiple terminal tabs |         N/A         | Supported with drag-and-drop  | **Missing** |

**Impact:** Users must switch to a separate terminal. OpenCode Desktop's embedded terminal is one of its key differentiators as a "full workspace."

## Major Gaps (Degraded User Experience)

### 5. Theme & Visual Customization

| Feature                |     OpenCode TUI     |     OpenCode Desktop      |        Codedeck         |
| ---------------------- | :------------------: | :-----------------------: | :---------------------: |
| Built-in themes        |      34+ themes      | 15 themes with light/dark | **1 theme** (zinc dark) |
| Theme switching        |  `/themes` command   |      Command palette      |    **Not available**    |
| Dark/Light mode toggle | Auto-detect + manual |     System/Dark/Light     |      **Dark only**      |
| Custom themes          |   JSON theme files   |    registerTheme() API    |    **Not available**    |

**Impact:** Single dark zinc theme with no customization. Users who prefer light mode or specific color schemes are stuck. This is a polish issue but a significant one for daily driver adoption.

### 6. Keybinding & Navigation

| Feature                   |           OpenCode TUI            |     OpenCode Desktop     |                        Codedeck                        |
| ------------------------- | :-------------------------------: | :----------------------: | :----------------------------------------------------: |
| Configurable keybinds     | 70+ configurable in opencode.json | Custom keybind overrides |                  **Not configurable**                  |
| Command palette commands  |    30+ slash commands + custom    |  Full command registry   | **3 actions** (New Session, active/all session search) |
| Keyboard-first navigation |     Full vim-like navigation      | Comprehensive shortcuts  |                     **Cmd+K only**                     |
| Scroll navigation         |  PageUp/Down, half-page, jump-to  |     Mouse + keyboard     |                **Mouse + basic scroll**                |
| Message navigation        |     Jump to next/prev message     |       Alt+Up/Down        |                   **Not available**                    |

**Impact:** The command palette is skeletal compared to OpenCode's. Power users rely on keyboard shortcuts and commands for speed. The current Cmd+K palette only offers "New Session" and session search.

### 7. Prompt Input & Autocomplete

| Feature                         |          OpenCode TUI          | OpenCode Desktop |  Codedeck   |
| ------------------------------- | :----------------------------: | :--------------: | :---------: |
| `@` file mentions               | Fuzzy search with line ranges  |    Supported     | **Missing** |
| `@agent-name` mentions          |    Invoke subagents inline     |       N/A        | **Missing** |
| Slash command autocomplete      |   `/` triggers command list    |    Supported     | **Missing** |
| Shell mode `!`                  | `!command` runs shell directly |       N/A        | **Missing** |
| Prompt history (Up/Down)        |    Full history navigation     |    Supported     | **Missing** |
| External editor ($EDITOR)       |            Ctrl+X E            |       N/A        | **Missing** |
| Frecency-based file suggestions |    Usage-ranked suggestions    |       N/A        | **Missing** |

**Impact:** The prompt input in Codedeck is a plain textarea with file attachment support. No autocomplete, no command system, no file mentions. This is one of the highest-impact gaps because it directly affects every interaction.

### 8. Provider & MCP Management

| Feature                    |         OpenCode TUI         | OpenCode Desktop |           Codedeck            |
| -------------------------- | :--------------------------: | :--------------: | :---------------------------: |
| Provider connection wizard |   `/connect` guided setup    |   Dialog-based   |       **Not available**       |
| MCP server management      |  `/mcps` with toggle/status  |  Sidebar status  |       **Not available**       |
| LSP integration            | Auto-detected + configurable |    Supported     |       **Not available**       |
| Provider auto-detection    |  From environment variables  |    Supported     | **Relies on OpenCode config** |

**Impact:** Users cannot connect new providers or manage MCP servers from within Codedeck. They must configure everything externally via the OpenCode CLI first.

### 9. Internationalization

| Feature      | OpenCode TUI | OpenCode Desktop |     Codedeck     |
| ------------ | :----------: | :--------------: | :--------------: |
| i18n support | 16 languages |   16 languages   | **English only** |

**Impact:** Non-English speakers have a degraded experience. Both OpenCode interfaces support 16 languages including Arabic, Japanese, Korean, Chinese, and European languages.

### 10. Configuration & Settings

| Feature                  |                OpenCode TUI                 |       OpenCode Desktop        |             Codedeck             |
| ------------------------ | :-----------------------------------------: | :---------------------------: | :------------------------------: |
| Settings UI              | Dialog-based (themes, models, agents, etc.) |     Tabbed settings panel     |        **No settings UI**        |
| Font selection           |             N/A (terminal font)             |        12 font choices        |        **Not available**         |
| Sound effects            |                     N/A                     | Per-event configurable sounds |        **Not available**         |
| Notification preferences |                     N/A                     |       Per-event toggles       |        **Not available**         |
| Auto-update management   |                CLI `upgrade`                |       Built-in updater        | **Has updater** (Electron-based) |

## Minor Gaps (Nice-to-Have)

### 11. Session Sidebar Details

| Feature                      |       OpenCode TUI        | OpenCode Desktop |     Codedeck      |
| ---------------------------- | :-----------------------: | :--------------: | :---------------: |
| Context usage (tokens/%)     |     Header + sidebar      |  Session header  |   **Not shown**   |
| Cost tracking per session    |          Sidebar          |   Session view   |   **Not shown**   |
| Getting started guide        |     Home screen tips      |       N/A        | **Not available** |
| Todo list in sidebar         |      Sidebar section      |       N/A        | **In-chat only**  |
| File diff summary in sidebar | Additions/deletions count |   Review panel   |   **Not shown**   |

### 12. Miscellaneous

| Feature                   |        OpenCode TUI         | OpenCode Desktop |     Codedeck      |
| ------------------------- | :-------------------------: | :--------------: | :---------------: |
| Skills system             | Load specialized knowledge  |       N/A        | **Not available** |
| Plugins                   |   `.opencode/plugin/*.ts`   |       N/A        | **Not available** |
| Custom commands           |  `.opencode/command/*.md`   |       N/A        | **Not available** |
| GitHub PR creation        |        `opencode pr`        |       N/A        | **Not available** |
| Session tagging           |         Tag dialog          |       N/A        | **Not available** |
| Copy-on-select            | Mouse selection auto-copies |       N/A        | **Not available** |
| Timestamps toggle         |        `/timestamps`        |       N/A        | **Not available** |
| Thinking/reasoning toggle |         `/thinking`         |       N/A        | **Not available** |

## Summary: Gap Count by Priority

| Priority     | Count  | Examples                                                             |
| ------------ | ------ | -------------------------------------------------------------------- |
| **Critical** | 12     | Diff preview in permissions, undo/redo, fork, file viewer, terminal  |
| **Major**    | 15     | Themes, keybinds, `@` mentions, command palette, provider management |
| **Minor**    | 10     | i18n, cost tracking, context usage, skills, plugins                  |
| **Total**    | **37** |                                                                      |
