---
name: test-palot-desktop
description: Test Palot's native Electron renderer with preload, IPC, and OpenCode integration. Use when adding or running desktop E2E scenarios, interactively inspecting the native UI, checking accessibility, focus, or resizing, capturing screenshots, proving live hydration, or smoke-testing renderer/preload/IPC behavior. Use palot-performance for measurements and palot-desktop-dev for build and channel work.
---

# Test Palot Desktop

Use this skill for the native Electron client. A renderer-only Vite page does not prove the preload, IPC, or OpenCode connection.

Use repository-root `../../../docs/agent-development.md` for verification selection, launch, renderer attachment, artifact paths, and cleanup. Read `../../../docs/desktop-testing.md` when authoring scenarios or resolving test-architecture questions.

## Choose The Path

- Agent worktree: run the smallest matching `bun run test:e2e -- <scenario>`. The harness is hidden, credential-free, isolated, and self-cleaning.
- Deterministic visual review: add `--visible`.
- Renderer recording: add `--video` (requires `ffmpeg`, implies `--visible --keep`). Captures the explicit Electron renderer, not desktop chrome/audio. Retains `video.mp4` and `video.json`; recording adds overhead and is not compositor/FPS evidence. Inspect representative frames before presenting the private recording.
- Agent inspection: add `--inspect`, then run the exact `agent-browser connect '<renderer-websocket>'` command printed by the harness. Use the renderer target rather than browser-level CDP because Electron cannot create a new target. Stop the retained command with Ctrl-C.
- Real-provider behavior or requested live inspection: use the live workflow below. It connects to real user data.

List deterministic scenarios with `bun run test:e2e:list`. Failures retain available evidence under the primary checkout's `.local/desktop-e2e/`; report the absolute run path and which artifacts exist. Early setup failures may have no screenshot.

Complete only the selected path below. Running an isolated scenario does not require live inspection or a full shell smoke pass.

## Deterministic E2E

Use the scenario result as evidence for the behavior it asserts. Scripted data in an isolated OpenCode service is valid integration evidence; it does not prove live provider behavior. Inspect failures before widening the test scope.

Report the scenario command, result, unresolved failures, and retained artifact path when present. A passing nonvisual scenario needs neither real user data nor screenshots. For visual QA, also inspect the affected state and save a screenshot; use before/after images when both states are available.

## Live inspection

Use this path only for real-provider behavior or requested live inspection. Follow the live development and renderer attachment commands in `../../../docs/agent-development.md`. Reuse a healthy development terminal owned by this task when possible. Keep the terminal or spawned process identifier for cleanup.

Use `bun run dev` for hidden integration, `dev:visible` for visual inspection, or `dev:focus` when focus behavior matters. Use the development launcher rather than signed packaging. An unsigned package check requires the user's request.

Live Palot connects to the user's shared OpenCode 2 service. Start with read-only navigation. Create sessions, submit prompts, interrupt work, or answer requests only when the test scope authorizes those changes, and use a disposable test session.

### Private evidence

Run from the repository root. Resolve the primary checkout and create one QA directory:

```bash
primary_checkout="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
qa_stamp="$(date +%Y%m%d-%H%M%S)"
qa_dir="$primary_checkout/.local/desktop-qa/$qa_stamp"
mkdir -p "$qa_dir"
printf '%s\n' "$qa_dir"
```

Keep screenshots, copied logs, and notes in this directory. Do not put project names, session titles, prompt text, credentials, or tokens in artifact names. Inspect each screenshot for sensitive data before you show or attach it.

### Inspect the affected behavior

Attach to the exact renderer WebSocket returned by `dev:info`, as documented in the development guide. Confirm its URL matches `rendererUrl` before interacting. A refused connection means Electron is not ready; it does not justify browser auto-discovery or a browser-level CDP connection.

Preserve the launcher's `ELECTRON_RUN_AS_NODE` removal. If a diagnostic direct launch is necessary, remove that variable from the copied environment first.

Check that the renderer responds and has no main-process or preload error that invalidates the result. For hydration QA, verify loading ends and selecting a real session shows hydrated data, or report the specific empty/connection state. An empty state does not prove successful session hydration. A visible window is required for visual QA, not for hidden integration checks.

Inspect fresh accessibility state after each interaction. Prefer indexed accessibility actions. Use coordinates only when the accessibility tree cannot expose the control.

Test the affected interaction and its reverse state where relevant. Run the following full shell pass only for explicit shell smoke QA or changes that affect these surfaces together:

1. Project and session navigation update the selected content.
2. A hydrated transcript renders without a blank window, crash, clipped composer, or unreadable overlap.
3. The composer can receive focus. Sending is outside the baseline smoke pass unless a disposable session and prompt are in scope.
4. The inspector opens the selected file or diff when data exists, and it returns to its prior state.
5. Keyboard focus is visible for the controls used in the flow.
6. Resize the window to its minimum supported size, `920 x 640`, and check navigation, transcript, composer, and inspector for clipping or inaccessible content.
7. Return to the default window size and capture the state that proves the requested change.

For a visual change, capture before and after images when both builds or states are available. For motion or timing behavior, capture a short video if the available Computer Use surface supports it. Do not claim a native smoke pass from a renderer-only browser preview.

### Retain or stop the environment

Keep the dev terminal, Electron window, selected OpenCode state, and QA directory alive while the user may inspect the result or request another change. A response boundary does not end the QA lifecycle.

When the user confirms completion, or no review remains, send `Ctrl-C` to the retained terminal session. Confirm that the terminal process exited. Stop only that owned session or a process identifier captured when it started. Preserve the QA directory unless the user requests removal.

### Live inspection result

Report:

- The exact launch command and whether the dev process remains available.
- The tested behavior and, for hydration QA, the connected state without exposing sensitive prompt content.
- Any main, preload, renderer, or connection error that remains.
- For visual QA, the tested window sizes and absolute paths to screenshots or video.

State what the evidence proves and what remains unverified. A loading screen or mock data cannot establish live hydration; a renderer-only browser preview cannot establish native integration. Visual QA requires a saved native-client screenshot, but nonvisual checks do not.
