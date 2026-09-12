# Release operations

This Palot v2 rewrite does not currently publish supported binaries. These instructions produce
engineering candidates for review. macOS candidates are ad-hoc signed, not
Developer ID signed or Apple-notarized. Local certificate signing is documented
in the [installation guide](../installation.md) and does not confer public trust.

## Release policy

- The root `package.json` owns Palot's base release version; the desktop manifest
  mirrors it and `release:verify-config` rejects drift. **Palot v2** describes the
  product generation, not SemVer `2.0.0` or the OpenCode runtime version.
- The current base version is **0.12.0**, with stable tag **`v0.12.0`**. Release
  versions must increase according to SemVer. This checkout does not implement a
  Palot auto-updater; candidate packaging does not publish or replace update feeds.
- Public releases come from explicit SemVer tags, not branch pushes.
- Build, verification, and publication remain separate steps.
- The checked-in workflow uploads an Actions artifact only. It does not create a
  GitHub Release or update an installed app.
- Linux x64 directory bundles and Apple Silicon on macOS 13 Ventura or later are
  candidate targets, not fully qualified public distributions. The macOS floor
  follows [Electron 44's upstream platform floor](https://github.com/electron/electron/blob/v44.0.0/README.md#platform-support).
  Do not run
  an x64 package smoke test on Apple Silicon because macOS will treat Palot as an
  Intel application and show a Rosetta compatibility warning.
- `--publish never` remains mandatory until signing, notarization, and release
  approval are implemented.

## Local candidate

Start from a clean checkout with the pinned toolchain:

```sh
vp install --frozen-lockfile
bun run release:verify-config
bun apps/desktop/scripts/check-public-docs.ts
bun run check
bun apps/desktop/scripts/generate-dependency-licenses.ts --check
```

The dependency-license inventory writes a report and exits nonzero for missing
license files or metadata. Resolve these findings before packaging and follow the
[publication checklist](publication.md).

For Linux, build and verify the directory package:

```sh
bun run package:nightly:linux
bun run package:verify:linux
```

For macOS, run `bun run package:mac` with the
[verified runtime manifests](../opencode-runtime.md). Packaging performs its
own build with the correct channel metadata; do not substitute an unrelated dev
build with `--skip-build`.

Verify the Apple Silicon application explicitly:

```sh
bun apps/desktop/scripts/release-verification.ts \
  stable ./apps/desktop/release/mac-arm64/Palot.app
```

Add `--smoke` only when the host architecture matches the application
architecture. Static package verification covers identity, fuses, licenses,
native-module ESM/CommonJS importability, packaged resources, and source-map
exclusion. Package smoke explicitly starts the bundled OpenCode runtime through
the official SDK using a disposable registration and HOME/XDG directories. It
requires a useful renderer, working preload, and the exact owned runtime PID and
version, then stops only that registration. It never replaces the shared service.
Failed runs retain private evidence under `.local/release-smoke/`; a failed SDK
startup reports cleanup uncertainty rather than claiming unregistered contenders
were stopped. Smoke requires a logged-in macOS GUI session even over SSH.

Apple Silicon ad-hoc package smoke and native integration have been tested on
macOS 26.6.2. Local certificate signing and replacement passed strict signature
verification and isolated runtime/renderer/Liquid Glass smoke on that platform.
Signing may require interactive keychain access; an SSH session alone may fail
with `errSecInternalComponent` or “User interaction is not allowed.”
To verify a separately signed local copy, pass
`--local-signing-identity="Palot Local Development"` to the verifier explicitly;
the default still requires an ad-hoc signature. Keep the copy beneath the same
candidate root as its release metadata, preserve the original artifacts, and use
`--smoke` for an isolated launch rather than opening it against real user data.
This is not Developer ID signing, notarization, a clean-machine trust check, or
qualification of a real-data installation/upgrade.

Non-directory packaging generates `SHA256SUMS`, a release manifest, a CycloneDX
SBOM, and an unsigned provenance statement under `apps/desktop/release/`. The Linux
directory-candidate workflow currently provides a tarball and checksum, not this
full metadata set or a publisher attestation.

## Candidate workflow

The `Unsigned release candidate` GitHub workflow is manual-only. Choose Linux,
macOS, or both. It checks source and license inventory before packaging, retains
failure diagnostics for seven days, and retains successful candidate artifacts
for 14 days. It never creates a GitHub Release or triggers on a tag push.

The macOS job packages and verifies an arm64 candidate, including package smoke.
The Linux job verifies the bundled runtime and desktop identity, then archives the
x64 directory preserving modes and symlinks. It is not an RPM, deb, AppImage, or
Arch publication; packaged Linux GUI behavior is not smoke-tested in that job.
Normal CI separately runs source checks/build and isolated native smoke on Linux
and macOS. Hosted-run results are needed before claiming either job is qualified.

Stable tags use `vMAJOR.MINOR.PATCH`; prereleases use
`vMAJOR.MINOR.PATCH-nightly.NUMBER`, `vMAJOR.MINOR.PATCH-beta.NUMBER`, or
`vMAJOR.MINOR.PATCH-rc.NUMBER` (the beta channel). Numeric identifiers may be
dot-separated. Tags must match both the source base version and packaging
channel, and the tag's complete SemVer becomes the packaged app version.
Untagged Nightly and beta builds derive `BASE-CHANNEL.YYYYMMDDHHMMSS[.BUILD]`
from UTC time and an optional numeric `PALOT_BUILD_NUMBER`/`GITHUB_RUN_NUMBER`.
The renderer, packaged manifest, artifact filenames, SBOM, and provenance all
use that same resolved version; do not bump source manifests for each prerelease.
All `0.12.0` prereleases sort above `0.11.0` and below stable `0.12.0`.
Channels have separate application identities and are not an automatic
cross-channel promotion path. After stable publication, bump the base before
starting the next prerelease train.

For example, after matching the base manifests, a beta candidate can be built
with `PALOT_RELEASE_TAG=v0.12.0-beta.1 bun apps/desktop/scripts/package.ts beta --mac --arm64`.
This still uses `--publish never`; creating a tag or publishing a release is a
separate, explicitly approved operation. The existing manual candidate workflow
builds the stable channel and therefore must not be dispatched on a prerelease
tag.

Dev builds are local and mutable,
Nightly is an unsupported rolling build, beta is for qualified testers, and a
stable channel cannot be promoted until every non-deferred release gate has
evidence attached to the exact commit.

Before using a candidate outside the release review group, attach evidence for:

- the source commit and workflow run;
- `bun run check` and build results;
- packaged application verification;
- deterministic Electron smoke;
- dependency audit and license inventory;
- checksums, SBOM, manifest, and provenance;
- known issues and the exact supported OpenCode version.

## Public signing requirements

Do not remove the unsigned labels until all of these exist:

- Apple Developer Program membership;
- protected Developer ID and notarization credentials;
- reviewed hardened-runtime entitlements;
- notarization and stapling in the release workflow;
- `codesign --verify` and `spctl --assess` gates on a clean machine;
- an owner-approved publication and rollback procedure.

## Rollback

Unsigned candidates are disposable and must not replace a supported install.
Once supported releases begin, retain the previous trusted installer and its
checksums before promoting a new version. A failed candidate is deleted or left
as an expired Actions artifact. It is never relabeled as stable.
