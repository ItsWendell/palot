# Contributing to Palot

Palot is pre-release software. Contributions are welcome, but interfaces and
product behavior can change without a compatibility period.

## Before starting

- Search [GitHub Issues](https://github.com/ItsWendell/palot/issues). GitHub
  [Discussions](https://github.com/ItsWendell/palot/discussions) are planned
  but currently disabled.
- Use an Issue for design questions or broad proposals until Discussions are
  enabled.
- Use an Issue for a reproducible bug or a scoped feature request.
- Do not open a public issue for a vulnerability. Follow
  [SECURITY.md](SECURITY.md).

For substantial UI, architecture, dependency, or OpenCode contract changes,
agree on the direction before investing in a large patch.

## Development setup

Follow the [source installation guide](docs/installation.md) for Linux or macOS
prerequisites, cloning, pinned Bun/Vite+ setup, `vp install --frozen-lockfile`, and
installing the CLI version read directly from the desktop manifest. Do not copy
an OpenCode version from old notes or select npm's `latest` tag.

Start the desktop app with `bun run dev` (hidden), `bun run dev:visible` (visible
without taking focus), or `bun run dev:focus` (foreground). Live development shares
OpenCode sessions, configuration, and credentials with other clients. Replacing or
restarting that service can interrupt active work; a separate Dev app data folder
does not isolate OpenCode.

See the [development loop](docs/agent-development.md) for worktrees and targeted
verification, [desktop testing](docs/desktop-testing.md) for isolated native E2E,
and the [runtime contract](docs/opencode-runtime.md) for bundled-runtime checks.
Apple Silicon packaging and interactive local signing have been verified on
macOS 26.6.2; see the installation guide for keychain requirements and the limits
of platform qualification before attempting local signing or packaging.

## Making changes

- Keep changes focused. Avoid unrelated refactors.
- Prefer official OpenCode 2 APIs and generated client contracts.
- Treat the OpenCode CLI, client, protocol, schema, and supported runtime as one
  exact-version unit.
- Do not add compatibility layers without a concrete shipped or persisted-data
  requirement.
- Preserve the existing Electron security boundary: main owns privileged work,
  preload exposes a narrow validated API, and the renderer stays sandboxed.
- Follow existing visual and interaction patterns. Check desktop and narrow
  window layouts for UI changes.
- Do not add telemetry, crash reporting, or external services without an
  explicit product and privacy decision.

## Validation

Format and check touched files first:

```sh
vp check --fix path/to/file.ts path/to/other-file.tsx
```

Then run the narrowest meaningful validation. Common commands are:

```sh
bun run typecheck
bun run test
bun run build
bun run check
```

Use native desktop E2E only when a change crosses renderer, preload, IPC, main,
OpenCode, focus, accessibility, or packaged-runtime boundaries.

For visible UI changes, include screenshots or a short recording when that
makes review easier. Include keyboard, reduced-motion, and narrow-window
evidence when the affected interaction needs it.

## Pull requests

A pull request should explain:

- the user or contributor problem;
- the chosen behavior and any important tradeoff;
- validation performed;
- known gaps or follow-up work;
- screenshots or recordings for visible changes.

Keep generated files and dependency changes in the same pull request only when
they are required by the change. Reviewers may ask for a smaller patch if the
scope makes behavior or risk hard to assess.

By contributing, you agree that your original contributions are licensed under
the repository's [MIT License](LICENSE). Third-party material must retain its
applicable license, copyright and modification notices; do not relabel it as
Palot-owned code.
