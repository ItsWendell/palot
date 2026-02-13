# ChatInput Selectors: Agent, Model & Variant Preferences

How the prompt toolbar selectors in ChatView work, how preferences are stored and loaded, and how defaults are resolved.

## Overview

The ChatView component (`apps/desktop/src/renderer/components/chat/chat-view.tsx`) contains three selectors in the prompt toolbar:

1. **Agent Selector** -- which OpenCode agent to use (e.g. `build`, `ask`)
2. **Model Selector** -- which provider/model combination to use (e.g. `anthropic/claude-opus-4-6`)
3. **Variant Selector** -- which model variant to use (e.g. `thinking`), only shown when the effective model supports variants

These are rendered by the `PromptToolbar` component in `apps/desktop/src/renderer/components/chat/prompt-toolbar.tsx`.

## Architecture Diagram

```
User clicks selector
        |
        v
PromptToolbar (prompt-toolbar.tsx)
  - AgentSelector    --> onSelectAgent  --> setSelectedAgent (local state)
  - ModelSelector    --> onSelectModel  --> handleModelSelect (local state + addRecentModel)
  - VariantSelector  --> onSelectVariant --> setSelectedVariant (local state)
        |
        v
ChatView (chat-view.tsx) -- local useState for all three
        |
        |-- resolveEffectiveModel() computes what model is actually used
        |
        v (on message send)
   1. Persist to projectModelsAtom (localStorage)
   2. Persist to model.json via addRecentModel (IPC/HTTP)
   3. Send model + agent + variant with the prompt to OpenCode server
```

## State Management

All three selectors use **local React `useState`** in ChatView, not Jotai atoms:

```
chat-view.tsx:513-515

const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)
```

These local states represent the **user's explicit override** for the current session. When `null`/`undefined`, the system falls through to defaults.

## Loading: How Selectors Are Initialized

When a session is opened (or the user navigates between sessions), the selectors are initialized in two phases. The ChatView component stays mounted across session switches, so initialization is tracked with refs.

### Phase 1: Project-level preferences (immediate)

On session switch, the selectors are immediately seeded from `projectModelsAtom` -- a Jotai atom backed by `localStorage` under the key `palot:projectModels`.

```
chat-view.tsx:525-542

Source: atoms/preferences.ts:84-87
  projectModelsAtom = atomWithStorage<Record<string, PersistedModelRef>>("palot:projectModels", {})

Shape: Record<directory, PersistedModelRef>
  where PersistedModelRef = { providerID, modelID, variant?, agent? }
```

The lookup key is `agent.directory` (the project directory path). If a stored entry exists for that directory, its `providerID`/`modelID`, `variant`, and `agent` are set into the local state. Otherwise, everything resets to `null`/`undefined`.

This phase happens synchronously on session switch, preventing a flash of empty selectors while messages load.

### Phase 2: Session history override (async)

Once session messages are loaded (from the Jotai `messagesFamily` atom), the component iterates **backwards** through the message list looking for the last **user** message. If found, its metadata overrides the project-level defaults:

```
chat-view.tsx:548-591

Scans for:
  - msg.model    -> { providerID, modelID } -- overrides selectedModel
  - msg.variant  -> string                  -- overrides selectedVariant (or clears it)
  - msg.agent    -> string                  -- overrides selectedAgent
```

This ensures that returning to an existing session restores exactly what the user last used in *that session*, not whatever they last used globally.

**Precedence**: Session history > Project preferences > null (fall through to defaults)

### Tracking refs

Two refs prevent re-initialization:

- `resetForSessionRef` -- tracks which session we've done Phase 1 for
- `initializedForSessionRef` -- tracks which session we've done Phase 2 for

## Default Resolution: The Effective Model

The model actually sent to the server is computed by `resolveEffectiveModel()` in `hooks/use-opencode-data.ts:85-116`. This function applies a priority chain:

```
Priority (highest to lowest):
1. selectedModel       -- explicit user selection in the UI
2. agent.model         -- the active OpenCode agent's bound model
3. config.model        -- the project's .opencode/config.json "model" field
4. recentModels*       -- most recently used model from model.json (NOT used for existing sessions)
5. providerDefaults    -- the default model for the first available provider
```

*Important: `recentModels` are intentionally NOT passed to `resolveEffectiveModel()` in ChatView (line 607-616). For existing sessions, the model comes from session history (Phase 2 above). The `recentModels` list is only used to populate the "Last used" section in the ModelSelector dropdown UI.*

### Agent influence on model

Changing the agent can implicitly change the effective model. If the user hasn't explicitly selected a model (`selectedModel` is null), the system falls through to `agent.model`, which may differ per agent. The `activeOpenCodeAgent` is derived from:

```
chat-view.tsx:597-600

const activeOpenCodeAgent = useMemo(() => {
  const agentName = selectedAgent ?? config?.defaultAgent
  return openCodeAgents?.find((a) => a.name === agentName) ?? null
}, [selectedAgent, config?.defaultAgent, openCodeAgents])
```

### Variant validation

After computing the effective model, a `useEffect` validates the selected variant against the model's available variants. If the variant is no longer valid (e.g. model was changed and the new model doesn't have that variant), it is cleared:

```
chat-view.tsx:622-632

useEffect(() => {
  if (!selectedVariant || !effectiveModel || !providers) return
  const available = getModelVariants(...)
  if (!available.includes(selectedVariant)) {
    setSelectedVariant(undefined)
  }
}, [selectedVariant, effectiveModel, providers])
```

Additionally, `handleModelSelect` always resets the variant when the model changes:

```
chat-view.tsx:643-650

const handleModelSelect = useCallback((model: ModelRef | null) => {
  setSelectedModel(model)
  setSelectedVariant(undefined)      // <-- always reset
  if (model) addRecentModel(model)
}, [addRecentModel])
```

## Persistence: How Preferences Are Saved

Preferences are persisted at two points, in two separate storage locations.

### 1. On model selection: model.json (global recent list)

When the user picks a model in the ModelSelector, `handleModelSelect` calls `addRecentModel()` from the `useModelState` hook. This does two things:

**a) Optimistic cache update** (`use-opencode-data.ts:363-377`):
Updates the TanStack Query cache in-memory, prepending the model, deduplicating, capping at 10.

**b) Persistent write** (`use-opencode-data.ts:379-381`):
Calls `updateModelRecent(model)` which routes through the backend service layer:

```
services/backend.ts:86-95

Electron mode:  window.palot.updateModelRecent(model)
                  -> IPC "model-state:update-recent"
                  -> main/model-state.ts:updateModelRecent()
                  -> writes ~/.local/state/opencode/model.json

Browser mode:   POST /api/model-state/recent
                  -> apps/server route
                  -> same file write
```

The `model.json` file lives at `{OpenCode state dir}/model.json` and has this shape:

```json
{
  "recent":   [{ "providerID": "anthropic", "modelID": "claude-opus-4-6" }, ...],
  "favorite": [...],
  "variant":  { "anthropic/claude-opus-4-6": "thinking" }
}
```

The state directory is resolved by querying the running OpenCode server at `http://127.0.0.1:4101/path`, falling back to `~/.local/state/opencode/`.

### 2. On message send: projectModelsAtom (per-project localStorage)

When the user actually sends a message, `handleSend` persists the full selector state to localStorage:

```
chat-view.tsx:744-753

if (effectiveModel && agent.directory) {
  appStore.set(setProjectModelAtom, {
    directory: agent.directory,
    model: {
      ...effectiveModel,
      variant: selectedVariant,
      agent: selectedAgent || undefined,
    },
  })
}
```

This writes to `localStorage` under `palot:projectModels`, keyed by the project directory. The persisted shape is:

```typescript
interface PersistedModelRef {
  providerID: string
  modelID: string
  variant?: string
  agent?: string
}
```

This is the value that seeds Phase 1 initialization when the user opens a new session for the same project.

**Key distinction**: The `model.json` write happens on model *selection* (user picks from dropdown). The `projectModelsAtom` write happens on message *send* (user hits Enter). This means browsing models without sending doesn't persist to the project preference.

## Data Fetching: Where Options Come From

### Agents

Fetched via `useOpenCodeAgents` hook (`use-opencode-data.ts:297-341`):
- Calls OpenCode SDK: `client.app.agents()`
- Filtered to `mode === "primary" || mode === "all"` and `!hidden`
- Query key: `["agents", directory]`
- Passed to ChatView as `openCodeAgents` prop

### Providers & Models

Fetched via `useProviders` hook (`use-opencode-data.ts:157-207`):
- Calls OpenCode SDK: `client.config.providers()`
- Returns `{ providers: SdkProvider[], defaults: Record<string, string> }`
- Query key: `["providers", directory]`
- Each provider contains a `models` map with model capabilities (reasoning, variants, input types)

### Config (default model, default agent)

Fetched via `useConfig` hook (`use-opencode-data.ts:209-257`):
- Calls OpenCode SDK: `client.config.get()`
- Returns `{ model?: string, smallModel?: string, defaultAgent?: string }`
- Query key: `["config", directory]`
- `config.model` is the project's `.opencode/config.json` "model" field (e.g. `"anthropic/claude-opus-4-6"`)
- `config.defaultAgent` is the project's configured default agent name

### Recent Models

Fetched via `useModelState` hook (`use-opencode-data.ts:343-404`):
- Electron: IPC `model-state` -> reads `model.json`
- Browser: HTTP GET `/api/model-state`
- Query key: `["modelState"]`
- Returns `ModelRef[]` sorted most-recent-first
- Used for the "Last used" group in ModelSelector (up to 3 shown)

## Selector Cascading Behavior

| User Action | selectedModel | selectedVariant | selectedAgent | Side Effects |
|---|---|---|---|---|
| Pick agent | unchanged | unchanged | updated | Effective model may change if selectedModel is null |
| Pick model | updated | **reset to undefined** | unchanged | `addRecentModel` writes to model.json |
| Pick variant | unchanged | updated | unchanged | none |
| Send message | unchanged | unchanged | unchanged | Persist all three to `projectModelsAtom` |
| Switch session | re-seeded from project prefs, then overridden by session history | same | same | -- |

## File Reference

| File | Purpose |
|---|---|
| `renderer/components/chat/chat-view.tsx` | Orchestration: local state, initialization, persistence, `handleSend` |
| `renderer/components/chat/prompt-toolbar.tsx` | UI: `AgentSelector`, `ModelSelector`, `VariantSelector`, `PromptToolbar` |
| `renderer/atoms/preferences.ts` | `projectModelsAtom` (localStorage), `PersistedModelRef` type, `setProjectModelAtom` |
| `renderer/hooks/use-opencode-data.ts` | `resolveEffectiveModel()`, `useProviders`, `useConfig`, `useOpenCodeAgents`, `useModelState`, `getModelVariants` |
| `renderer/services/backend.ts` | `fetchModelState()`, `updateModelRecent()` -- Electron/browser routing layer |
| `renderer/services/palot-server.ts` | HTTP implementations for model state (browser mode) |
| `main/model-state.ts` | `readModelState()`, `updateModelRecent()` -- reads/writes `model.json` on disk |
| `main/ipc-handlers.ts` | Registers IPC channels `model-state` and `model-state:update-recent` |
| `preload/index.ts` | Exposes `getModelState` and `updateModelRecent` on `window.palot` bridge |
