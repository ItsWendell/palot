---
name: palot-desktop-dev
description: Operate Palot's Electron build and channel lifecycle. Use for main, preload, or lifecycle changes; dev supervisor or launcher work; native dependencies or generated binaries; Dev/Nightly channel configuration; packaging or installation; and start, restart, build, or channel failures. Use test-palot-desktop for native UI QA.
---

# Palot Desktop Development

Keep the OpenCode task host stable while the development client changes.

## Choose The Loop

- Use installed Palot Nightly as the host when changing Palot itself.
- In agent worktrees, default to the smallest matching `bun run test:e2e -- <scenario>`. Add `--visible` only when the user wants to watch it.
- Use `bun run dev` for live integration. It connects to the shared user OpenCode service and starts hidden so it does not cover or focus another app.
- Use `bun run dev:visible` when rendering, interaction, accessibility, screenshots, or visual inspection require a visible native window. It does not take keyboard focus.
- Use `bun run dev:focus` only when focus behavior matters or the user explicitly asks for a foreground launch.
- Build Nightly and Dev against the exact declared `@opencode/client` version.
  Reuse healthy compatible stable 2.x services and reviewed beta services; an
  unreviewed beta needs exact-version consent. A different patch version is not
  permission to replace a service. Service replacement can interrupt active turns.
- Existing user-installed OpenCode is preferred for confirmed local startup;
  packaged/app-cached binaries are fallbacks or an explicit user preference.
  Delegate confirmed package-manager updates to the official CLI, and keep
  executable updates separate from service restarts. Never update the task host
  as a side effect of implementing or testing these controls.

Read repository-root `../../../docs/desktop-testing.md` before adding an E2E scenario or using real credentials.

## Iterate

1. Start the supervisor with `bun run dev` from the repository root for background integration. Use `bun run dev:visible` when the QA evidence requires a visible window, and `bun run dev:focus` only for focus-specific behavior or an explicitly requested foreground launch.
2. Run `bun run dev:info` in that worktree to get its renderer URL, Electron PID, CDP port, and data root.
3. Let Vite HMR apply renderer-only changes. Let the supervisor restart Electron after main or preload builds.
4. After native dependency or generated-binary changes, run `bun run dev:restart -- "reason"` as the final tool call.
5. After supervisor or control-script changes, stop its terminal with Ctrl-C and start it again. A running supervisor cannot replace itself.

Each live worktree gets dynamic renderer and CDP ports plus separate Palot state and logs. OpenCode sessions, config, auth, and models remain shared. Use only the ports returned by `dev:info` and target the owned terminal session for shutdown.

## Install Nightly

- Run `bun run package:nightly:mac` to create channel-specific artifacts.
- Run `bun run install:nightly:mac` to build, ad-hoc sign, verify, install, and launch `/Applications/Palot Nightly.app`.
- A successful routine install is complete when that command exits successfully. Trust its release and signature verification; report the installed path without repeating bundle, process, log, or UI checks.
- Inspect identity, icon, signature, replacement behavior, launch, or OpenCode connection only when the related packaging code changed, the command failed, or the user requested package QA.
- Leave any previous Nightly installation moved to Trash available for recovery.

## Verify

- Keep validation proportional to the changed behavior. Use focused checks before broad `bun run check` or full builds.
- For desktop integration behavior, run the smallest matching E2E scenario.
- For supervisor changes, confirm restart success, a new Electron PID, a live Vite process, native Liquid Glass, and restored task state.
- Load `test-palot-desktop` only for native UI inspection, screenshots, or explicit smoke QA. Keep live QA read-only unless the user approved a disposable test task.
