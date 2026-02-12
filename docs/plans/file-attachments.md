# File Attachments Support

## Status: Implemented

## Context

Palot needs to support file attachments (images, PDFs) in chat messages. The good news: **most of the infrastructure already exists** but isn't wired up.

### What already works

- **SDK types**: `FilePart` and `FilePartInput` are fully defined in `@opencode-ai/sdk`. The `promptAsync` endpoint accepts `FilePartInput` in its `parts` array.
- **Shared UI component**: `PromptInput` in `packages/ui` has complete attachment handling -- hidden file input, drag-and-drop, paste, blob-to-data-URL conversion, attachment context with add/remove/clear. It emits `{ text: string, files: FileUIPart[] }` on submit.
- **Backend (opencode)**: Already processes `FilePart` in messages, converts them to provider-specific formats, handles model capability checks, and falls back gracefully when a model doesn't support a modality.

### What doesn't work

- `sendPrompt` in `apps/desktop` only sends `[{ type: "text", text }]` -- file parts are ignored.
- `onSubmit` callbacks in `new-chat.tsx` and `chat-view.tsx` only use `message.text`, discarding `message.files`.
- Optimistic message creation only produces a `TextPart`, never a `FilePart`.
- No rendering of `FilePart` parts in `ChatTurnComponent`.
- No rendering of tool result `attachments` (e.g. when the read tool returns an image).

## Reference: How opencode handles attachments

Opencode's web app (SolidJS) was studied as the reference implementation.

### Data model

All binary attachments are **base64 data URLs** (`data:{mime};base64,{content}`). No separate blob storage.

```
FilePart { type: "file", mime: string, filename?: string, url: string, source?: FilePartSource }
```

The same `FilePart` type is used for user-uploaded images, tool-generated attachments (e.g. `read` tool reading an image file), and MCP resource blobs.

### Input methods (web app)

1. **Paste** (Ctrl+V) -- reads `clipboardData.items`, filters by accepted MIME types, converts via `FileReader.readAsDataURL()`
2. **Drag and drop** -- global `dragover`/`drop` listeners on `document`, visual overlay during drag
3. **@-mention file picker** -- `@filename` syntax opens a popover for workspace files/symbols

No `<input type="file">` button -- paste and drag-and-drop only for binary attachments.

### Accepted types

```typescript
ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]
```

### Rendering

- **User message attachments**: Filtered from `FilePart[]` by MIME type, rendered as a thumbnail grid. Images use `<img src={dataUrl} />`. PDFs show a placeholder icon. Click opens a full-size preview dialog.
- **Prompt input previews**: 64x64 thumbnails with filename overlay and remove button.
- **Tool result attachments**: `ToolStateCompleted.attachments` rendered inline with tool output.

### Provider compatibility

Each model declares `capabilities.input: { image, pdf, audio, video }`. When a model lacks support for a modality, the file part is replaced with an error message: `"ERROR: Cannot read {name} (this model does not support {modality} input)"`. For providers that don't support media in tool results (most OpenAI-compatible APIs), media is extracted and injected as a synthetic user message.

## Implementation Plan

### Phase 1: Wire up sending (Effort: LOW)

The shared `PromptInput` already emits files. We just need to forward them.

**Files to change:**

1. **`apps/desktop/src/hooks/use-server.ts`** -- `sendPrompt()`
   - Accept files parameter (or change signature to accept parts array)
   - Convert `FileUIPart[]` to `FilePartInput[]` (data URL + MIME type)
   - Include file parts alongside text part in `client.session.promptAsync({ parts: [...] })`

2. **`apps/desktop/src/components/chat/chat-view.tsx`** -- `handleSend()`
   - Pass `message.files` through to `sendPrompt` (currently only passes `message.text`)

3. **`apps/desktop/src/components/new-chat.tsx`** -- `handleLaunch()`
   - Same: forward files from the prompt input message

4. **`apps/desktop/src/stores/app-store.ts`** -- optimistic message creation
   - Create optimistic `FilePart` entries alongside the optimistic `TextPart`

### Phase 2: Render attachments in messages (Effort: LOW-MEDIUM)

**Files to change:**

1. **`apps/desktop/src/components/chat/chat-turn.tsx`** -- `ChatTurnComponent`
   - Filter `FilePart` parts from user message parts
   - Render image thumbnails (grid) above/below the text bubble
   - Add click-to-preview (dialog with full-size image)

2. **`apps/desktop/src/components/chat/chat-tool-call.tsx`** -- `ChatToolCall`
   - Render `ToolStateCompleted.attachments` when present
   - Show image thumbnails inline with tool output

3. **Consider a shared `AttachmentGrid` component** in `packages/ui` for reuse

### Phase 3: Polish input UX (Effort: MEDIUM)

The `PromptInput` shared component handles the basics. Desktop-specific polish:

1. **Attachment previews in the prompt area**
   - Ensure `PromptInput`'s built-in attachment preview (thumbnails with remove buttons) renders correctly with our styling
   - May need to pass `accept` prop to restrict to supported types

2. **Global drag-and-drop overlay**
   - `PromptInput` has drag-and-drop support built in
   - Verify it works correctly in the desktop app context (may need `globalDragDrop` enablement)

3. **Paste support verification**
   - `PromptInput` handles paste events
   - Test with screenshots, copied images from browsers, and file paste

4. **File size limits**
   - Configure `maxFileSize` prop on `PromptInput` (base64 encoding inflates size ~33%)
   - Reasonable default: 10MB per file, matching typical API limits

### Phase 4: Model capability awareness (Effort: LOW)

1. **Check model capabilities before sending**
   - The SDK exposes `modalities.input` on model definitions
   - If the selected model doesn't support images, either:
     - Disable the attachment button / show a tooltip
     - Show a warning when attachments are added
   - Don't block sending entirely -- the backend handles the fallback gracefully

### Out of scope (for now)

- **@-mention file picker** (workspace file references) -- complex feature, separate plan
- **Audio/video attachments** -- limited model support, low priority
- **Blob storage / externalized payloads** -- base64 inline is fine for now (opencode has the same approach with a noted TODO)
- **Tauri-specific file access** -- will need revisiting when Tauri integration lands

## Key Files Reference

| Concern | Path |
|---|---|
| SDK types (FilePart, FilePartInput) | `node_modules/@opencode-ai/sdk` |
| Shared PromptInput component | `packages/ui/src/components/ai-elements/prompt-input.tsx` |
| Send prompt logic | `apps/desktop/src/hooks/use-server.ts` |
| Chat view (submit handler) | `apps/desktop/src/components/chat/chat-view.tsx` |
| New chat (launch handler) | `apps/desktop/src/components/new-chat.tsx` |
| Chat turn rendering | `apps/desktop/src/components/chat/chat-turn.tsx` |
| Tool call rendering | `apps/desktop/src/components/chat/chat-tool-call.tsx` |
| Zustand store | `apps/desktop/src/stores/app-store.ts` |
| Session chat hook (turns) | `apps/desktop/src/hooks/use-session-chat.ts` |
