# Palot's vendored anti-slop rules

- Source: <https://github.com/dmmulroy/anti-slop>
- Revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (skill-pinned, not a claim of latest).
- Copied path: `skills/install-anti-slop/assets/anti-slop/`.
- Source Git tree: `a7831feb0c097943ac813ddcb1367e26eef52da5`.
- Destination/entry point: `tools/oxlint/anti-slop/index.ts`.
- Installed with the pinned revision's copy script into a previously absent directory.
- Root MIT license is retained beside this file; nested ESLint Stylistic license and provenance remain under `vendor/eslint-stylistic/`.

## Project policy

The repository owns this copy and the policy in root `vite.config.ts`.
`bun run lint` and `vp check` load it through Vite+'s existing Oxlint integration;
there is no separate linter installation or runtime application dependency.

Enabled as errors:

- `anti-slop/no-reduce-accumulator-copy`
- `anti-slop/no-widen-then-assert`
- `anti-slop/no-chained-type-assertions`
- Native companion `oxc/no-accumulating-spread`

Chained assertions remain allowed in `*.test.*`, `*.spec.*`, and the desktop's
`test/` tree to preserve intentional partial SDK/native test doubles and
browser instrumentation. All other generic rules remain
disabled. The Effect entry point is not registered. Boundary validation,
module-mocking, naming, spacing, and Effect architecture policies are unchanged.
These are AST/scope checks, not TypeScript cross-file proofs or performance guarantees.

## Toolchain and local changes

- Vite+: `0.3.1`, with bundled Oxlint `1.81.0` (`vp exec -- oxlint --version`).
- Root development dependency `@oxlint/plugins`: exactly `1.81.0`, matched to that
  Oxlint runtime; Vite+'s own transitive plugin-helper version is left untouched.
- Upstream implementations are unmodified. Only this provenance file and the
  upstream root license were added to the copied tree.
- This directory is excluded from application lint and formatting so updates
  remain comparable with upstream. Owned application/scripts remain covered.

For updates, stage the incoming immutable revision separately and compare it
against this pristine base and the local copy. Preserve local policy, licenses,
and any later rule changes; never overwrite the destination with `--force`.

## Verification

`apps/desktop/scripts/anti-slop.test.ts` exercises accepted/rejected examples
through the actual configured Vite+ CLI, including the test-file exception and
the native spread rule. The four integration tests passed on installation.
The copied implementations match the pinned asset tree byte-for-byte; the root
license also matches upstream. No modified rule implementation needs a separate
local-fork regression suite.

Run the focused installation test alongside normal lint and type checks when
updating the plugin or toolchain:

```sh
bun run --cwd apps/desktop test scripts/anti-slop.test.ts
bun run lint
bun run typecheck
```

On Node 26 without a configured webstorage path, the existing renderer test
environment needs `NODE_OPTIONS=--no-experimental-webstorage`. This is unrelated
to plugin loading.
