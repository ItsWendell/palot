# Rich Input Rework: Slash Commands & @Mentions

> **Goal:** Replace the plain `<textarea>` with a lightweight rich input that supports inline `/` command autocomplete, `@file`/`@agent` mention pills, and cursor-aware popovers — while keeping the bundle small and migration risk low.

---

## Current State

| Aspect | Status |
|--------|--------|
| Input element | Plain `<textarea>` via `PromptInputTextarea` in `packages/ui` |
| Slash commands | Working. Detected via `inputText.startsWith("/")`, rendered in a Radix Popover + cmdk Command list (`slash-command-popover.tsx`) |
| @mentions | **Not implemented.** `findFiles()` service exists but is never called from UI |
| Styled tokens | Impossible — `<textarea>` cannot render inline DOM nodes |
| Cursor tracking | None — popover is anchored to the textarea element, not the caret |

### Pain Points

1. **No inline tokens** — cannot render `@file.ts` as a styled pill inside a `<textarea>`
2. **No cursor-position popovers** — the slash command popup floats at a fixed position above the textarea, not near the `/` or `@` trigger character
3. **Slash detection is naive** — only works when `/` is at position 0 of the entire input; no mid-text support
4. **Duplicated input setup** — `new-chat.tsx` and `chat-view.tsx` each assemble their own `PromptInputProvider` + toolbar
5. **SlashCommandBridge is a hack** — mutable ref + useEffect to escape the provider boundary

---

## Reference: How OpenCode TUI Does It

OpenCode uses **raw `contenteditable` with zero editor library dependencies** (~3kB of custom DOM helpers in `editor-dom.ts`). Key patterns:

- **Data model**: `Prompt = ContentPart[]` where each part has `start`/`end` offsets and a type (`text`, `file`, `agent`, `image`)
- **Pill insertion**: `<span contenteditable="false" data-type="file" data-path="...">` elements inside the editable div
- **Cursor management**: Custom `getCursorPosition()` / `setCursorPosition()` that walk text nodes, pills, and `<br>` elements
- **Popover switching**: Single `PromptPopover` component that shows either `@` suggestions or `/` commands based on trigger detection
- **Trigger detection**: `@(\S*)$` at cursor position (anywhere in text), `^\/(\S*)$` for slash (start of input only)
- **Fuzzy search**: `fuzzysort` library for filtering commands and files
- **Mirror flag**: Prevents DOM↔model sync loops during programmatic updates

**Strengths**: Zero dependencies, tiny, full control.
**Weaknesses**: `contenteditable` cross-browser fragility, no undo stack, ~1200 lines of custom DOM code, no React (SolidJS-specific).

---

## Library Evaluation

We evaluated 7 candidates. The core question: **do we need a full rich-text editor, or just a textarea with decoration + autocomplete?**

We need:
- Styled inline tokens (pills) for `@file` and `@agent`
- Cursor-position-aware autocomplete popover
- Enter to submit (not newline by default)
- IME composition support
- Paste handling (text + files)
- Auto-resize
- React 19 compatible
- Small bundle impact

We do **NOT** need:
- Bold/italic/heading formatting
- Block-level editing
- Collaborative editing of the input
- Markdown rendering in the input
- Tables, images, or embeds

### Tier 1: Lightweight (recommended range)

#### `rich-textarea` — ~3kB gzipped
- **Approach**: Transparent `<textarea>` overlaid on a styled `<div>` mirror. Decoration via a render prop that maps regex matches to styled spans.
- **Mentions support**: Has a `createRegexRenderer()` that can highlight `@file` patterns, and exposes caret position via `useSelectionPosition()` for popover anchoring.
- **Pros**: Drop-in textarea replacement, native selection/undo/IME/paste all preserved, tiny bundle, React 19 compatible, MIT license.
- **Cons**: Tokens are visual-only (styled text in the background div, not interactive DOM nodes). Cannot render true "chips" with delete buttons. Popover positioning requires extra work.
- **Verdict**: Best lightweight option. Gets us 80% of the UX for 3kB.

#### `react-mentions` — ~12kB gzipped
- **Approach**: Hidden textarea + visible styled `<div>` (similar mirroring pattern). Built-in `@`-trigger detection, data fetching, and suggestion dropdown.
- **Mentions support**: First-class. Define `<Mention trigger="@" data={fetchFn} />` children inside `<MentionsInput>`.
- **Pros**: Built specifically for mentions. Handles trigger detection, suggestion list, keyboard navigation, and token insertion out of the box. Used in production at Signavio.
- **Cons**: Last published June 2023 (somewhat stale). Styling is done via inline styles or CSS modules (awkward with Tailwind). The suggestion dropdown is built-in (harder to replace with our existing cmdk/Popover components). Doesn't support `/` slash commands natively — would need a second trigger. No TypeScript-first.
- **Verdict**: Purpose-built for mentions but opinionated about the dropdown UI. Stale maintenance is a concern.

#### Custom `contenteditable` (OpenCode approach) — 0kB deps
- **Approach**: Port OpenCode's `editor-dom.ts` pattern to React. Raw `<div contenteditable>` with `<span contenteditable="false">` pills.
- **Pros**: Zero deps, full control, true interactive pills, cursor tracking built-in.
- **Cons**: Significant effort to port from SolidJS reactivity to React 19. `contenteditable` cross-browser bugs (IME, paste, undo). Estimated 800-1200 lines of custom code. Ongoing maintenance burden.
- **Verdict**: Most powerful but highest risk. Only justified if `rich-textarea` proves insufficient.

### Tier 2: Medium-weight

#### Tiptap — ~45kB gzipped (core + mention + suggestion)
- **Approach**: ProseMirror wrapper with extension system. `@tiptap/extension-mention` provides pill nodes. `@tiptap/suggestion` provides trigger detection + popover anchoring.
- **Pros**: First-class mention extension with styled, deletable token nodes. Built-in suggestion framework (handles trigger detection, keyboard nav, popup positioning). Active maintenance, huge community (22k+ stars). MIT license. Framework-agnostic core with React package.
- **Cons**: 15x the bundle of `rich-textarea`. Requires replacing `PromptInputProvider`'s text state with Tiptap's own editor state. ProseMirror schema model is overkill for a prompt input. Learning curve for advanced customization.
- **Verdict**: The "right" choice if we ever need a full editor. Overkill for a chat prompt input, but offers the most complete mention/command UX.

#### Lexical — ~35kB gzipped (core + react + mention nodes)
- **Approach**: Facebook's editor. Tree of typed nodes with React bindings via `LexicalComposer`.
- **Pros**: Meta-backed, active development. React-first. Has `@lexical/react` with plugin system. Custom nodes for mentions.
- **Cons**: No pure decorations (node insertion for inline content modifies document). Pre-1.0 — API still changing. Inserting a link/mention in the middle of text requires manual node splitting (the very issue linked in the brief — facebook/lexical#3013). Heavier than Tiptap core.
- **Verdict**: Not recommended. The node-splitting issue is exactly the pain point for mention insertion, and the lack of pure decorations adds complexity.

### Tier 3: Not recommended

| Library | Why Not |
|---------|---------|
| **Novel** | Wrapper around Tiptap — adds opinionated Notion-like UI we don't need. Better to use Tiptap directly if going that route. |
| **ProseMirror (raw)** | Tiptap exists specifically to avoid ProseMirror's boilerplate. No reason to go lower-level. |
| **draft-js-plugins** | Built on Draft.js which Facebook deprecated in favor of Lexical. No longer maintained. |

---

## Recommendation

### Phase 1: `rich-textarea` + custom popovers (Recommended)

**Why**: Smallest migration, smallest bundle, preserves native textarea behavior, lowest risk. We already have `Popover` + `Command` (cmdk) components that work well — we just need cursor position to anchor them.

**What changes**:

1. **Replace `<Textarea>` with `<RichTextarea>`** in `PromptInputTextarea`
   - Use `createRegexRenderer()` to style `@file` and `/command` text
   - Expose caret coordinates via the library's selection API

2. **Upgrade `SlashCommandPopover`** to anchor at caret position instead of above the textarea
   - Detect `/` anywhere the cursor is (not just `startsWith`)
   - Use caret coordinates from `rich-textarea` for Radix Popover's `virtualRef`

3. **Build `MentionPopover`** for `@` trigger
   - Detect `@` followed by non-whitespace at cursor position
   - Fetch file results via `client.find.files({ query })` with debounce
   - Show agents from `useAgents()`
   - On selection: replace `@query` text with `@filename` (visually styled via the regex renderer)
   - Track mentions in a parallel data structure (not in the textarea text)

4. **Parts collection on submit**
   - Parse the text for `@`-mention tokens (matched by the same regex)
   - Convert to `FilePart[]` / `AgentPart[]` alongside the text
   - Send via `client.session.prompt({ parts })` or `client.session.command()`

**Estimated bundle impact**: +3kB gzipped
**Estimated effort**: Medium (1-2 weeks)

### Phase 2: Upgrade to Tiptap (only if needed)

**When**: If we need true interactive pills (clickable, deletable, hoverable) or richer input features (inline images, formatted text, drag-and-drop reordering of pills).

**What changes**:
1. Replace `PromptInputTextarea` with a Tiptap editor using `@tiptap/extension-mention` and `@tiptap/suggestion`
2. Create a custom Tiptap extension for `/` slash commands
3. Migrate text state from `PromptInputProvider` to Tiptap's editor instance
4. Update `DraftSync` to serialize/deserialize Tiptap JSON for draft persistence

**Estimated bundle impact**: +45kB gzipped
**Estimated effort**: Large (2-3 weeks)

---

## Phase 1 Implementation Plan

### Step 1: Install and integrate `rich-textarea`

**Files**:
- `packages/ui/package.json` — add `rich-textarea` dependency
- `packages/ui/src/components/ai-elements/prompt-input.tsx` — replace `InputGroupTextarea` usage with `RichTextarea`
- `packages/ui/src/components/input-group.tsx` — add `RichTextarea` variant or leave as-is if prompt-input handles it directly

**Approach**:
```tsx
import { RichTextarea, createRegexRenderer } from "rich-textarea"

const renderer = createRegexRenderer([
  [/@[\w./\-#]+/g, { color: "var(--color-syntax-property)" }],  // file mentions
  [/^\/\S*/gm, { color: "var(--color-syntax-type)" }],           // slash commands
])

<RichTextarea
  value={text}
  onChange={handleChange}
  onKeyDown={handleKeyDown}
  autoHeight
  style={{ width: "100%" }}
>
  {renderer}
</RichTextarea>
```

### Step 2: Cursor-aware popover anchoring

**Files**:
- `apps/desktop/src/renderer/components/chat/slash-command-popover.tsx` — use caret position from `rich-textarea`
- `apps/desktop/src/renderer/components/chat/mention-popover.tsx` — **new** file

**Approach**: `rich-textarea` doesn't directly expose caret coordinates, but we can use `getCaretCoordinates()` from the textarea's DOM element (standard technique, ~30 lines). Feed these into Radix Popover's `virtualRef`:

```tsx
const virtualRef = {
  getBoundingClientRect: () => ({
    top: caretCoords.top,
    left: caretCoords.left,
    bottom: caretCoords.top + caretCoords.height,
    right: caretCoords.left,
    width: 0,
    height: caretCoords.height,
  }),
}
```

### Step 3: Upgrade slash command detection

**Files**:
- `apps/desktop/src/renderer/components/chat/slash-command-popover.tsx`

**Changes**:
- Detect `/` at cursor position, not just `startsWith("/")`
- Extract the partial command text between `/` and cursor
- Filter commands using fuzzy search (add `fuzzysort` — 1.5kB gzipped)

### Step 4: Build @mention autocomplete

**Files**:
- `apps/desktop/src/renderer/components/chat/mention-popover.tsx` — **new**
- `apps/desktop/src/renderer/hooks/use-file-search.ts` — **new**
- `apps/desktop/src/renderer/components/chat/chat-view.tsx` — integrate mention popover

**Approach**:
1. Detect `@` trigger: regex `@(\S*)$` at cursor position
2. Fetch files via `client.find.files({ query })` with 150ms debounce
3. Show agents from `useAgents()` (non-hidden, non-primary)
4. Combine into grouped list: agents > recent files > search results (cap at 10)
5. On selection: replace `@query` with `@path/to/file` in text, add to mention tracking array
6. On Backspace into a mention: remove the entire `@mention` token

### Step 5: Parts collection & submit

**Files**:
- `apps/desktop/src/renderer/components/chat/chat-view.tsx` — update `handleSend`

**Changes**:
- Before sending, scan text for tracked `@` mentions
- Build `FilePart[]` and `AgentPart[]` from the mention tracking array
- Pass parts alongside text to `client.session.prompt()` or `client.session.command()`

### Step 6: Unify input between `chat-view.tsx` and `new-chat.tsx`

**Files**:
- `apps/desktop/src/renderer/components/chat/prompt-card.tsx` — **new** extracted component
- `apps/desktop/src/renderer/components/chat/chat-view.tsx` — use `PromptCard`
- `apps/desktop/src/renderer/components/new-chat.tsx` — use `PromptCard`

**Changes**: Extract the shared `PromptInputProvider` + textarea + toolbar + attachment assembly into a single reusable component. Both views consume it with different config (chat-view adds slash commands + undo/redo, new-chat is simpler).

---

## Data Model

Following OpenCode's pattern, we model the prompt as a typed part array:

```typescript
interface TextPart {
  type: "text"
  text: string
}

interface FileMention {
  type: "file"
  path: string
  displayName: string  // e.g., "utils.ts" or "utils.ts#10-20"
  lineRange?: { start: number; end: number }
  // Position in the textarea text where @mention appears
  textOffset: number
  textLength: number
}

interface AgentMention {
  type: "agent"
  name: string
  displayName: string
  textOffset: number
  textLength: number
}

type PromptMention = FileMention | AgentMention

// Tracked alongside the textarea text
interface PromptState {
  text: string
  mentions: PromptMention[]
  attachments: FileAttachment[]
}
```

On submit, `mentions` are converted to SDK `FilePart[]` / `AgentPart[]` and sent alongside the text.

---

## Migration Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `rich-textarea` doesn't support React 19 | Check compatibility before starting. If broken, fall back to custom `contenteditable` or patch the library. |
| Caret position calculation is inaccurate | Use `textarea-caret-position` npm package (battle-tested, 1kB) as fallback |
| `rich-textarea` regex renderer is too limited for complex styling | The tokens are styled text only (no chips). Acceptable for Phase 1. Phase 2 (Tiptap) adds real nodes. |
| Mention tracking array gets out of sync with text edits | Recalculate mention offsets on every text change by re-scanning for `@` patterns. Keep mention metadata in a Map keyed by display name. |
| IME composition breaks mention detection | Disable trigger detection during composition (check `isComposing` flag, already handled in current textarea) |

---

## Open Questions

1. **Line range syntax**: Should we support `@file.ts#10-20` for line ranges (like OpenCode), or defer to a separate UI?
2. **Directory expansion**: Should Tab on a directory `@src/` expand its children in the suggestion list (like OpenCode)?
3. **MCP resources**: Should `@` also surface MCP server resources? The OpenCode TUI supports this.
4. **Mention removal UX**: When the user backspaces into a mention token, should it delete the whole token at once or character-by-character?
5. **Rich-textarea vs react-mentions**: `react-mentions` has more built-in mention logic but is stale and opinionated about its dropdown. `rich-textarea` is smaller and more flexible but requires us to build more. Recommendation: `rich-textarea`.

---

## Appendix: Bundle Size Comparison

| Library | Gzipped Size | What You Get |
|---------|-------------|--------------|
| `rich-textarea` | ~3kB | Styled textarea with decoration renderer |
| `react-mentions` | ~12kB | Full mention system with triggers + suggestions |
| `fuzzysort` | ~1.5kB | Fuzzy string matching for filtering |
| Tiptap (core + mention + suggestion) | ~45kB | Full ProseMirror editor with mention nodes |
| Lexical (core + react) | ~35kB | Facebook's editor framework |
| Novel | ~80kB+ | Tiptap + opinionated Notion-like UI |
| Draft.js + plugins | ~60kB | **Deprecated** — do not use |

**Phase 1 total addition**: ~4.5kB gzipped (`rich-textarea` + `fuzzysort`)
**Phase 2 total addition**: ~45kB gzipped (Tiptap replaces `rich-textarea`)
