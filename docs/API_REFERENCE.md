# API Reference

Nexus Builder has two API surfaces:

1. Browser-mode HTTP routes in `apps/server`.
2. Electron IPC methods exposed to the renderer through `window.palot`.

OpenCode's own API is consumed through `@opencode-ai/sdk` and is not duplicated
here.

## Browser-Mode HTTP API

Base URL in local development: `http://127.0.0.1:3100`.

### `GET /health`

Returns server health.

Response:

```json
{
  "status": "ok",
  "timestamp": 1778600000000
}
```

### `GET /api/servers/opencode`

Ensures the single browser-mode OpenCode server is running and returns its URL.

Response:

```json
{
  "url": "http://127.0.0.1:4101"
}
```

Error response:

```json
{
  "error": "Failed to start OpenCode server"
}
```

### `GET /api/servers`

Legacy compatibility route. Returns the current managed OpenCode server if one
is running.

Response:

```json
{
  "servers": [
    {
      "id": "single",
      "url": "http://127.0.0.1:4101",
      "directory": "",
      "name": "opencode",
      "pid": null,
      "managed": true
    }
  ]
}
```

### `POST /api/servers/start`

Legacy compatibility route. Starts or returns the managed OpenCode server.

Response:

```json
{
  "server": {
    "id": "single",
    "url": "http://127.0.0.1:4101",
    "directory": "",
    "name": "opencode",
    "pid": 12345,
    "managed": true
  }
}
```

### `POST /api/servers/stop`

Stops the managed OpenCode server.

Response:

```json
{
  "stopped": true
}
```

### `GET /api/model-state`

Reads OpenCode model preference state from the managed server's state
directory.

Response:

```ts
interface ModelState {
  recent: Array<{ providerID: string; modelID: string }>
  favorite: Array<{ providerID: string; modelID: string }>
  variant: Record<string, string | undefined>
}
```

### `POST /api/model-state/recent`

Adds a model to the recent model list, deduplicates existing entries, and caps
the list at 10 entries.

Request:

```json
{
  "providerID": "openrouter",
  "modelID": "deepseek/deepseek-chat-v3.1"
}
```

Validation error:

```json
{
  "error": "providerID and modelID are required"
}
```

## Electron IPC Surface

Renderer code should call `apps/desktop/src/renderer/services/backend.ts`
instead of using `window.palot` directly. The canonical bridge contract is
`apps/desktop/src/preload/api.d.ts`.

Important IPC domains:

| Domain | Purpose |
| --- | --- |
| `server:*` | Start, stop, restart, and inspect managed OpenCode server state. |
| `settings:*` | Read and update desktop settings. |
| `dialog:*` | Native directory/project selection and creation. |
| `shell:*` | Open Finder/editor/terminal targets. |
| `git:*` | Review panel, branch, commit, push, and apply-to-local workflows. |
| `automation:*` | Automation CRUD, run history, scheduling, and review status. |
| `skills:*` | List, write, and delete OpenCode skill markdown files. |
| `migration:*` | Detect, preview, execute, and restore configuration migration. |
| `model-state:*` | Persist recent/favorite model selections. |

### Project Directory Creation

`createProjectDirectory(name)` opens a native parent-directory picker, then
creates a single child folder under the selected location. The main process
rejects empty names, `.` / `..`, and names containing path separators.

## Skills IPC

### `skills:list`

Returns all markdown skills in `~/.config/opencode/skills/`.

Response shape is shared through `apps/desktop/src/shared/skills.ts`:

```ts
interface ManagedSkill {
  filename: string
  name: string
  description: string
  tags: string[]
  author: string
  created: string
  content: string
  raw: string
}
```

### `skills:write`

Writes a skill markdown document. The filename is normalized in the main process
before writing.

Arguments:

```ts
filename: string
raw: string
```

Returns the normalized filename without `.md`.

### `skills:delete`

Deletes a skill markdown document after normalizing the filename.

Arguments:

```ts
filename: string
```

Returns `true` on success.

## Error Format

HTTP routes return JSON objects with an `error` string and an appropriate status
code. IPC calls throw errors to the renderer; UI code should catch them and show
a user-facing message.

Future API additions should prefer explicit request/response types and avoid
passing unstructured objects across process boundaries.
