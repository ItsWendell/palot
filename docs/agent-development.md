# Agent development loop

Use an isolated E2E scenario for desktop verification. Use live development only
when you need a real provider or the user wants to inspect the app. Live dev shares
the user's OpenCode sessions, configuration, and credentials.

## Set up a worktree

Keep the app hosting your task separate from the app you're changing. Installed
Palot Nightly can host the task while a worktree runs its own Dev or E2E instance.

```sh
git worktree add ../palot-my-change -b my-change
cd ../palot-my-change
vp install --frozen-lockfile
bun --version
node --version
```

A new worktree starts from committed code. Existing uncommitted edits stay in the
original checkout; choose the intended base before moving a task.

Use the Bun version pinned in the root `package.json` and Node 24 or later. Install
Vite+ using its [official setup instructions](https://viteplus.dev/guide/). On
macOS, `xcode-select -p` should resolve the Command Line Tools directory.

Install dependencies separately in each worktree. Don't symlink another checkout's
`node_modules` or `apps/desktop/out`. Builds write to `out`, so don't run a dev
supervisor and E2E build concurrently in the same worktree.

Read the required OpenCode version from the desktop manifest rather than copying
a version from old notes:

```sh
version="$(bun -p 'require("./apps/desktop/package.json").devDependencies["@opencode/client"]')"
opencode2 --version
printf 'Required OpenCode: %s\n' "$version"
```

If needed, install the matching CLI with
`bun add --global --trust "@opencode/cli@$version"`. Replacing the shared service can
interrupt other tasks. E2E uses a separate service and never needs to replace it.
`OPENCODE_BIN=/absolute/path/to/opencode2` lets E2E try a specific binary first.

## Choose verification by the change

| Change                                       | First useful check                                     |
| -------------------------------------------- | ------------------------------------------------------ |
| Pure logic, mapper, reducer                  | Run the affected test file                             |
| Types, imports, deleted exports              | Desktop typecheck and affected callers' tests          |
| Dev discovery or CLI                         | Focused script tests and actual help/error invocations |
| Renderer, preload, IPC, OpenCode interaction | Smallest matching native E2E scenario                  |
| Visual layout, keyboard or focus             | Matching visible E2E or native inspection              |
| Build configuration or preload bundling      | Build plus relevant bundle-contract tests              |

Run commands from the repository root unless noted:

```sh
vp check --fix apps/desktop/path/to/changed-file.ts
bun run --cwd apps/desktop test src/path/to/affected.test.ts
bun run typecheck
bun run test:e2e --help
bun run test:e2e:list
bun run test:e2e -- smoke
```

Don't use `bun test` here. The test script runs Vitest with the renderer aliases,
build constants, and DOM environment. Don't default to `bun run check` during each
edit either; it includes repository-wide checks and the whole unit suite.

Keep tests that catch a realistic behavioral regression. Tests that search source
text for classes or restate constants don't prove rendering or runtime behavior.
See [CODING_STANDARDS.md](../CODING_STANDARDS.md).

## Inspect isolated desktop state

```sh
bun run test:e2e -- smoke --inspect
bun run test:e2e -- composer-pending-edit-switch --inspect-on-failure
```

The command prints an `agent-browser connect '<renderer-websocket>'` command once
the scenario passes. `--inspect-on-failure` instead retains an attachable failed
renderer and its isolated service, and still exits nonzero after inspection.
Failures before renderer attachment retain evidence but cannot offer inspection.
Use that exact renderer target. Electron doesn't support the
new-target command that browser-level CDP connections may issue. Add `--visible`
to show the window without taking focus. Stop the retained command with Ctrl-C.

E2E uses the host display with a hidden window by default; it does not start a
private display server. `--visible` shows an inactive window and `--focus` also
requests keyboard focus. Visible windows may reflow a tiling desktop. Performance
and showcase modes also show the window; see [desktop testing](desktop-testing.md).

Failed runs and `--keep` runs retain artifacts under the primary checkout:

```sh
primary="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
printf '%s\n' "$primary/.local/desktop-e2e"
```

Each run gets an owner-only directory and an atomic `instance.json` before
prerequisite checks or builds. The manifest records the phase, result, runner and
owned process IDs, discovered ports, renderer WebSocket, and cleanup status.
`build.log` and `electron.log` retain combined stdout/stderr when those processes
start. Failures also try to save `failure.png` and `llm-requests.json`; app logs
live in `logs/`. Artifact-directory creation failures cannot leave a manifest.

SIGINT and SIGTERM use the same awaited cleanup path during setup, builds,
assertions, and inspection. Only owned child process groups and the isolated
service registration are stopped. Active scripted-model streams are cancelled.
The installed OpenCode SDK cannot cancel `Service.ensure()`, so an interruption
during service startup may wait for its 120-second deadline. If startup fails
before returning an endpoint, the public API cannot rule out an unregistered
contender surviving. The runner reports `cleanup.status: "uncertain"`, retains
`service-startup-error.log`, and exits nonzero instead of claiming full cleanup.
Do not work around this by stopping the shared service.

See [desktop-testing.md](desktop-testing.md) for scenario authoring.

## Inspect live development

Start one owned command with `bun run dev`. Use `dev:visible` for native visual QA
or `dev:focus` only when focus itself matters. Renderer edits use HMR; main and
preload rebuilds restart Electron through the supervisor.

```sh
bun run --silent dev:info
```

This checks supervisor health and finds the matching renderer before printing
JSON. It exits nonzero if the instance isn't ready, and never prints the control
token. Use its returned URLs and paths, not remembered ports or browser
auto-discovery:

```sh
info="$(bun run --silent dev:info)" &&
  agent-browser connect "$(printf '%s' "$info" | jq -er .pageWebSocketUrl)"
```

`logDirectory` locates app logs; build output stays in the retained terminal.
`dataRoot` identifies worktree-local dev files, not an isolated OpenCode account.
Keep durable notes and screenshots in the primary checkout's `.private/` and
`.local/` directories. Shut down only the dev process you started, never all
Electron or OpenCode processes.

## Remaining improvements

- Track the upstream SDK gap for cancellable service startup and contender
  cleanup. Palot cannot verify unregistered processes through the public API.
- Add a read-only setup doctor that checks pinned dependencies and native tooling
  without starting or replacing the shared service. Reuse the existing binary
  version checks rather than adding a second runtime-selection policy.
