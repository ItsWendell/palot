---
name: opencode-runtime
description: Check or update Palot's OpenCode CLI, client, protocol/schema and runtime contract. Use for release availability, Stable/Beta selection, dependency upgrades, version mismatches and runtime-specific feature gates. Use opencode for general upstream APIs and opencode-coverage for integration depth.
---

# OpenCode runtime alignment

Keep Palot's declared OpenCode dependencies aligned without replacing the user's
running service. Stable is the default; use Beta when requested. A release check
is read-only. A dependency upgrade authorizes workspace changes, not a global CLI
update, service restart, app installation or publication.

Use `opencode` for upstream API and architecture questions. Read
`../../../docs/opencode-runtime.md` for Palot's current runtime-selection and
compatibility contract. Public desktop packages acquire OpenCode separately;
they do not bundle its standalone executable.

## Read-only comparison

1. Establish Palot's baseline from `apps/desktop/package.json`, `bun.lock` and
   `SUPPORTED_OPENCODE_VERSION` in `apps/desktop/src/main/opencode-version.ts`.
   Distinguish these from the installed CLI and connected service versions.
2. Check npm tags for all four published units:

   ```sh
   npm view @opencode/cli dist-tags --json
   npm view @opencode/client dist-tags --json
   npm view @opencode/protocol dist-tags --json
   npm view @opencode/schema dist-tags --json
   ```

   A candidate is aligned only when the selected tags resolve to the same exact
   version. Verify that `latest` is a supported stable major; the tag alone is not
   a compatibility guarantee. Use that exact version for subsequent reads, and
   report tag skew instead of mixing releases.

3. If the question concerns the setup/settings channel selector, also check the
   official `opencode.ai/update/api/{latest|beta}/cli/opencode` feeds. These can
   differ from npm tags. Report each source separately; do not substitute one
   channel mechanism for another.
4. Read publication dates, release notes and published package dependencies/types.
   For a routine stable patch, inspect the changed contracts and relevant Palot
   callers. Identical contracts need no integration audit. Escalate to a deeper
   source comparison for a new minor/major, changed public surface, unreviewed
   beta, ambiguous release notes or a requested feature's availability.
5. Report the checked date, baseline/candidate, important inherited fixes versus
   changes needing Palot work, evidence gaps and a recommendation. Do not install
   packages, execute downloaded binaries or call APIs that can start a service as
   part of a read-only check.

For a deeper comparison, map both exact published builds to upstream source.
Use release tags or publish-run inputs; numbered betas map to publish workflow
`run_number`, not the run database ID or nearest timestamp. Do not infer a source
branch from a channel name. Paginate commit comparisons and state any incomplete
retrieval. Source explains intent; the published package establishes availability.
Use `opencode-coverage` only when operation/event adoption needs an audit.

## Authorized dependency update

1. Select an aligned exact version. Inspect relevant exports, request/response
   types and event unions before changing Palot callers. Stable 2.x compatibility
   is the existing product policy, not a reason to skip checking upstream changes.
2. Update directly imported client/protocol packages with the pinned toolchain:

   ```sh
   # Run with apps/desktop as the working directory; VERSION is the exact selection.
   vp add -D -E "@opencode/client@$VERSION" "@opencode/protocol@$VERSION"
   ```

   Let Vite+ and Bun update the lockfile. Schema stays transitive unless Palot
   starts importing it. Keep exact pins. Do not add the legacy `@opencode-ai/sdk`.

3. Align `SUPPORTED_OPENCODE_VERSION` and current runtime defaults, fixtures and
   verification metadata. Search for the old version and review each match;
   preserve reviewed-beta compatibility and historical evidence. Inspect retained
   runtime manifests, source/notice declarations and hash checks before changing
   them. An external-package policy is not permission to leave a used exact-version
   verifier stale, nor a reason to reintroduce bundled binaries.
4. Verify actual desktop module resolution for client/protocol, and schema from the
   client's context, against the lockfile. Bun can leave obsolete nested packages
   shadowing root packages. If proven, move only those obsolete entries into a
   unique primary-checkout `.local/` backup and recheck. Don't delete the whole
   dependency tree as a first response.
5. Force the desktop TypeScript build after dependency changes:

   ```sh
   bun run --cwd apps/desktop typecheck --force
   ```

   Format/lint touched files and run affected contract/service tests. Use
   `../../../docs/agent-development.md` to select native E2E or packaging checks.
   API-adoption changes may need a feature-specific runtime gate. Do not raise a
   blanket connection minimum just because a newer package adds an API.

If a used verifier needs new executable hashes, obtain the exact architecture's
official archive, verify registry integrity, then hash the original bytes. Follow
the current verifier's signature contract; do not blindly ad-hoc sign an upstream
signed executable. Test downloaded runtimes only in an owned isolated harness.

## Local CLI and service lifecycle

- Prefer the user's existing installation. If a global update was separately
  authorized, identify the real executable and its package manager first. Update
  that installation rather than creating another or using a Vite+ global shim.
- Updating an executable and restarting a service are separate actions. Keep a
  healthy compatible stable 2.x service running; an unreviewed beta requires
  exact-version consent. Do not replace the task host for dependency validation.
- Palot's official download flow prepares an app-private fallback only after an
  explicit action. Preparing/resetting it must not start or restart a service.
- With restart authorization, use the existing lifecycle workflow in
  `palot-desktop-dev` and verify the resulting service version. Commands such as
  `opencode2 api ...` can start a service, so they are not read-only diagnostics.

## Completion

An upgrade is complete when the manifest, lockfile, resolved modules and current
verification metadata agree, relevant checks pass, and remaining compatibility
limits are reported. Distinguish workspace changes from global CLI, running
service and installed-app state. Do not claim those were upgraded unless they
were separately authorized and verified.
