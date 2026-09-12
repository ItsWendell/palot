---
name: opencode-v2
description: Compare or align Palot's OpenCode 2 CLI, client, protocol/schema, and service version. Use for /oc2-check, read-only beta checks, published channel selection or upgrades, declared version changes, upstream feature availability, or CLI/client/service mismatches. Use opencode-coverage for product integration depth.
---

# OpenCode v2 alignment

Treat the CLI, generated client, protocol, schema, and Palot service contract as one versioned unit. A check ends with a recommendation, not an upgrade. Enter **Update** only when the user authorizes changes.

For read-only release or feature-availability questions, follow **Read-only comparison** and skip **Update** and **Verify alignment**. Load `palot-desktop-dev` only when changing the runtime or needing build, launch, or service-lifecycle guidance. Replacing the shared service can interrupt active turns.

## Select a release

Use Stable unless the user requests Beta. Verify that npm's `latest` tag resolves
to a V2 release for all four units before selecting it: the tag name alone does
not establish the API generation. Keep dependency pins exact even though Palot
accepts compatible stable 2.x services.

Package tags and runtime update feeds are distinct. Palot's user-facing channel
selector follows the official `opencode.ai/update/api/{latest|beta}/cli/opencode`
feed. Beta can lag Stable or offer a stable-numbered version while npm's `beta`
tag still points to a `0.0.0-beta-*` build. Report actual versions; never silently
substitute one channel mechanism for another.

Read the channel tags for every published unit:

```sh
npm view @opencode/cli dist-tags --json
npm view @opencode/client dist-tags --json
npm view @opencode/protocol dist-tags --json
npm view @opencode/schema dist-tags --json
```

An upgrade candidate is aligned only when the selected CLI, client, protocol, and schema tags resolve to the same exact version. Report tag skew rather than selecting one package's version as the candidate.

## Read-only comparison

Use this workflow for `/oc2-check` and release research. Leave dependencies, lockfiles, the global CLI, and the running service unchanged. Use registry/GitHub reads and isolated package downloads only; do not install packages, execute downloaded code, start Palot, or call service lifecycle/API commands that might start or replace the service. Store any downloaded evidence in a temporary directory or the primary checkout's private-artifact directories.

### 1. Establish both endpoints

- Read the exact client and protocol pins in `apps/desktop/package.json`, their resolved entries and transitive schema in `bun.lock`, and `SUPPORTED_OPENCODE_VERSION` in `apps/desktop/src/main/opencode-version.ts`. Record each value and flag disagreement or non-exact pins. An installed/global CLI version is not Palot's declared baseline.
- Resolve the four channel tags using **Select a release**. Capture the lookup timestamp, exact versions, per-version npm publication timestamps (`npm view <package> time --json`), dependency metadata, and tarball URLs (`npm view <package>@<version> version dependencies dist --json`). Use explicit versions for all subsequent reads so moving tags cannot change the comparison mid-run.
- If pins or tags disagree, report the mismatch and keep independently verified findings, but withhold an aligned-upgrade recommendation. If both endpoints are identical, report that there is no published delta; research a requested feature separately if needed.

### 2. Map published builds to source

For each endpoint, match its build suffix to the exact `run_number` in `anomalyco/opencode`'s `publish.yml` workflow, on branch `beta` by default:

```sh
gh api --paginate \
  'repos/anomalyco/opencode/actions/workflows/publish.yml/runs?branch=beta&per_page=100' \
  --jq '.workflow_runs[] | {run_number,head_branch,head_sha,status,conclusion,created_at,updated_at,html_url}'
```

Match `run_number` for numbered preview builds, not the Actions run database ID,
nearest date, newest successful run, or a bounded recent-run list. Stable versions
have no build suffix: establish the exact version from publish-run inputs and
release/version scripts instead of guessing a run number. Record the exact head
SHA, branch, run URL, and dates. A failed workflow can publish some packages: npm
establishes availability, while the run establishes provenance. If the mapping is
ambiguous, report it rather than substituting a branch tip. If the API caps
history, narrow by publication-date windows and paginate those windows.

Channel names are not source branch names. The npm `dev` tag is a V2 channel historically published from `v2`, not necessarily repository `dev`; verify the current workflow mapping for a requested alternative. Code on another branch is not evidence that the selected package contains it.

### 3. Compare the complete published range

With the verified endpoint SHAs as `BASE_SHA` and `HEAD_SHA`:

```sh
gh api --paginate \
  "repos/anomalyco/opencode/compare/$BASE_SHA...$HEAD_SHA?per_page=100" \
  --jq '.commits[] | {sha,html_url,commit}'
```

Read comparison status, ahead/behind counts, and `total_commits`; deduplicate collected SHAs and confirm the count matches. Handle identical, behind, or diverged endpoints explicitly instead of calling every result an upgrade range. Compare responses without pagination can truncate commits, and their changed-file list is capped independently. Inspect relevant commits/PRs and file diffs directly when that list is insufficient. Account for every commit in the range, grouping low-impact changes rather than summarizing only the first page or commit subjects. Report incomplete retrieval as a limitation.

### 4. Assess Palot impact against published contracts

Use exact npm tarballs for the baseline and candidate client, protocol, and schema to check relevant exports, generated types, request/response shapes, and event payloads. Download the registry's `dist.tarball` into isolated storage and unpack without installing or running scripts. Source diffs explain intent; the published contract determines availability. Trace changed surfaces to Palot callers and handlers, focusing on risks such as session/message hydration, event streaming, permissions, service discovery, and authentication when the range touches them. State which package symbols and Palot paths support each material finding.

Separate backend/client fixes Palot inherits from changes needing Palot integration and upstream-only CLI/web/desktop UI work. Upstream UI changes do not appear in Palot merely through a dependency bump. Use `opencode-coverage` when a finding requires a deeper operation/event adoption audit; keep this check read-only.

### 5. Report and stop

Return a concise summary with the checked-at date, baseline and candidate alignment, npm publication dates, exact publish-run/commit links, comparison link and verified commit count, grouped Palot-relevant changes, compatibility risks, and upstream-only items. Recommend **upgrade**, **wait**, or **already current**, with reasons, evidence gaps, and the smallest follow-up validation needed. Distinguish contract inspection from runtime testing that has not been performed. Confirm no dependency or service changes were made. Do not proceed into **Update** as part of the check.

## Update

Use this section for an authorized upgrade. A research result or dependency-only request does not authorize replacing the global CLI or restarting the shared service. Complete in-scope package work and report any remaining runtime mismatch.

Select an aligned release as above and set `VERSION` to its exact value, including its channel and build suffix:

```sh
command -v opencode2
realpath "$(command -v opencode2)"
type -a opencode2
(cd apps/desktop && vp add -D -E \
  "@opencode/client@$VERSION" \
  "@opencode/protocol@$VERSION")
```

Run the dependency command with `apps/desktop` as its working directory; the subshell above leaves the caller's directory unchanged. With the pinned Bun, `vp add --filter` is unsupported and can add dependencies to the root package instead. Use `-D` (or `--save-dev`), not `--dev`, and `-E` for exact pins.

When the authorized scope includes the global CLI, update the active installation with the package manager inferred from its resolved path, using the exact `VERSION`; avoid creating a parallel installation. A `~/.vite-plus/bin/opencode2` path is a Vite+ global shim, not an authoritative OpenCode installation: remove that package and select another existing installation. If the current method cannot install an exact version, use `bun add --global --trust "@opencode/cli@$VERSION"` as the fallback. Do not use `vp --global` for OpenCode because its shim can shadow the active binary.

Palot imports the client and protocol directly; the client resolves the matching schema package. Let Vite+ and Bun update `bun.lock`. Do not add schema directly unless Palot starts importing it.

Verify module resolution from `apps/desktop`, not just the root dependency listing. Bun can leave obsolete nested `apps/desktop/node_modules/@opencode` packages shadowing updated root packages, even after `vp install --force`. Resolve the client and protocol entrypoints with Node from that working directory, inspect their owning package versions, and resolve schema from the client's package context. Compare those paths and versions with the manifest and lockfile; `bun pm ls` alone does not prove what desktop imports. If stale nested packages shadow the intended installation, move only the confirmed obsolete entries into a uniquely named backup under the primary checkout's `.local/`, then repeat resolution checks. Preserve unrelated packages and avoid deleting the whole dependency tree.

Update `SUPPORTED_OPENCODE_VERSION` in `apps/desktop/src/main/opencode-version.ts` to the same exact value. Find the previous version with `rg` and update current runtime defaults and test fixtures. Review documentation matches individually: update documents that claim to describe the current contract, and preserve historical audit results.

Align the bundled runtime contract in `apps/desktop/src/main/opencode-runtime-release.ts` and its tests too. For both the macOS arm64 and x64-baseline npm packages, verify the exact package name/version and archive against npm's `dist.integrity` before trusting extracted bytes. Compute `sourceSha256` from the original npm executable and `binarySha256` from the executable after Palot's ad-hoc signing step; these are distinct artifacts, not interchangeable hashes. Follow `apps/desktop/scripts/stage-opencode-runtime.ts` and the current packaging/signing contract to reproduce the staged binary, and verify its architecture and version. Keep all four hashes aligned with the selected release; a version-string-only update leaves bundled runtime verification broken.

Do not add the legacy `@opencode-ai/sdk` package. Palot uses the V2 `@opencode/client` Promise and service entrypoints.

## Verify alignment

```sh
opencode2 --version
bun pm ls --all | rg '@opencode/(client|protocol|schema)'
rg 'SUPPORTED_OPENCODE_VERSION|@opencode/client' apps/desktop/package.json apps/desktop/src/main/opencode-version.ts
bun run --cwd apps/desktop typecheck --force
```

After dependency changes, force the desktop TypeScript build to recheck declarations (`tsc -b --force`, via the script above); an incremental pass can miss changed dependency contracts. Read `docs/agent-development.md` to select the remaining validation: format/lint touched files and run affected contract, service, and UI tests. Add a build for bundled-runtime or packaging changes and the smallest isolated native E2E scenario for migrated renderer/preload/IPC or service behavior. Do not substitute an unconditional repository-wide `check` for these targeted checks.

The bundled CLI, desktop-resolved client/protocol/schema, manifest and lockfile
pins, bundled runtime manifests, and `SUPPORTED_OPENCODE_VERSION` must agree.
Dependencies remain exact without `^`, `~`, or channel tags. The connected shared
service may deliberately differ: stable 2.x is supported, reviewed beta builds
are accepted, and unreviewed beta builds require version-scoped consent. Do not
replace a compatible service just to make its version equal the bundle. An API
added after the minimum supported runtime needs a feature-specific availability
gate when Palot adopts it, not a blanket connection failure.

Updating the global binary does not restart the running service. Keep the current task host stable while editing and building. After verification, allow Palot's lifecycle to replace an incompatible service, or run `opencode2 service restart` only when interrupting the shared service is safe. At that point, use `opencode2 api get /api/health` to confirm the connected health version matches the declared contract before reusing it; this API command can start a service and does not belong in the read-only check.
