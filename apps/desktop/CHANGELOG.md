# @palot/desktop

## 0.4.1

### Patch Changes

- [`32dad30`](https://github.com/ItsWendell/palot/commit/32dad30e9f65e1991f344b606f591753d3739099) Thanks [@ItsWendell](https://github.com/ItsWendell)! - Fix "Add Project" for remote servers: show a path text input dialog instead of the native folder picker (which only shows the local filesystem). Also makes the automation dialog's project picker remote-aware with an inline path input.

## 0.4.0

### Minor Changes

- [`2a9d3de`](https://github.com/ItsWendell/palot/commit/2a9d3de3b529a6aa73b8ae574fb2a6f2084d73f9) Thanks [@ItsWendell](https://github.com/ItsWendell)! - ### Breaking: Require OpenCode >= 1.2.0

  Palot now requires OpenCode 1.2.0 or higher. Older versions will be blocked during the environment check.

  ### New Features

  - **Incremental streaming (message.part.delta)**: handle the new `message.part.delta` SSE event for incremental text/reasoning updates, replacing full part object replacements with efficient string delta appending
  - **Remote server support**: connect to remote OpenCode servers with authentication, mDNS discovery, and onboarding integration
  - **Update banner redesign**: floating toast card instead of full-width bar

  ### SDK Migration

  - Upgrade `@opencode-ai/sdk` from 1.1.x to 1.2.x across all packages
  - Migrate all SDK type imports from v1 to v2, gaining proper typed discriminated unions for all events
  - `Permission` type replaced by `PermissionRequest` (field `title` becomes `permission`)
  - `permission.updated` event replaced by `permission.asked`
  - Remove unnecessary type casts throughout the event processing pipeline

  ### Fixes

  - Fix CI release workflow to run builds in a single workflow run
  - Suppress hover background on macOS sidebar server indicator

### Patch Changes

- Updated dependencies [[`2a9d3de`](https://github.com/ItsWendell/palot/commit/2a9d3de3b529a6aa73b8ae574fb2a6f2084d73f9)]:
  - @palot/configconv@0.4.0

## 0.3.0

### Minor Changes

- [`594e4b7`](https://github.com/ItsWendell/palot/commit/594e4b7e299dee6ba507f990001f505f6afd22c5) Thanks [@ItsWendell](https://github.com/ItsWendell)! - ### New Features

  - **Session metrics**: comprehensive per-session work time, cost, tokens, model distribution, cache efficiency, and tool breakdown
  - **Per-turn metadata**: display model, duration, and cost after each response
  - **Live turn timer**: show elapsed time on submit button while agent is working
  - **Prompt toolbar selector**: enhanced model/provider selector UI
  - **OpenCode API integration**: replace disk-based discovery and messages with OpenCode server API

  ### Performance

  - **Per-session streaming**: scope streaming buffer and version notifications per session, eliminating cross-session re-renders (~20x/sec savings for inactive sessions)
  - **Decoupled volatile metrics from agent identity**: sidebar no longer re-renders on every metrics tick
  - **Lazy metrics for background sessions**: only the viewed session uses reactive atom subscriptions
  - **Granular sidebar subscriptions**: each project folder and session item subscribes independently

  ### UI/UX

  - **Base UI migration**: migrated shadcn components from Radix to Base UI
  - **Sidebar improvements**: stabilized sort order, relative last-active time, animated project folders
  - **New chat styling**: translucent backgrounds and subtle borders on suggestion cards
  - **Command dialog**: layout fix for better usability

  ### Fixes

  - Support OpenCode XML read output format in tool card parser
  - Migrate tooltips from Radix asChild to Base UI render prop pattern
  - Stabilize sidebar atom references to prevent cascading re-renders

### Patch Changes

- Updated dependencies [[`594e4b7`](https://github.com/ItsWendell/palot/commit/594e4b7e299dee6ba507f990001f505f6afd22c5)]:
  - @palot/ui@0.3.0

## 0.2.0

### Minor Changes

- [`d2d6f2b`](https://github.com/ItsWendell/palot/commit/d2d6f2b3013ad0fa3bb9ac08ad9b8ff91517ffc5) Thanks [@ItsWendell](https://github.com/ItsWendell)! - ### New Features

  - Add provider management with icons, catalog, and onboarding integration
  - Add git worktree backend with lifecycle management and UI
  - Add automations subsystem with database, scheduler, and IPC (hidden for now)

  ### Improvements

  - Improve Electron main process reliability
  - Improve command palette animation and chat UX
  - Increase spacing between expanded tool call items in chat turns

  ### Fixes

  - Upgrade hono to 4.11.9 to resolve security alerts
  - Resolve type errors in chat-input component

### Patch Changes

- Updated dependencies [[`d2d6f2b`](https://github.com/ItsWendell/palot/commit/d2d6f2b3013ad0fa3bb9ac08ad9b8ff91517ffc5)]:
  - @palot/ui@0.2.0
