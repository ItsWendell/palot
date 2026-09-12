# Release operations

Palot 0.12.0 is a source release. Desktop downloads are available only when a
release has attached installers; an Actions artifact is not a published release.

## Version and channel policy

- Root `package.json` owns the base version; the desktop manifest mirrors it.
  `bun run release:verify-config` rejects drift. Palot v2 is the product generation,
  not SemVer 2.0.0 or the OpenCode runtime version.
- Stable tags are immutable `vMAJOR.MINOR.PATCH` tags matching the source manifests.
  Packaging changes after 0.12.0 use the **0.12.1** train; do not replace 0.12.0.
- Nightly resolves `BASE-nightly.YYYYMMDDHHMMSS.BUILD` once for the entire matrix.
  It has a separate app ID, Linux package name, executable, and data directory.
  Bump the base version after stable publication before the next Nightly train.
- Desktop builds always use `electron-builder --publish never`. Publication is a
  separate job; it never runs from a pull request.
- Palot updates are manual. OpenCode runtime updates are independent. Do not upload
  legacy `latest*.yml` feeds or silently migrate Palot 0.11 installations.

## Desktop release workflow

`.github/workflows/desktop-release.yml` supports:

```sh
# Build and verify the current main revision, without publishing.
gh workflow run desktop-release.yml --ref main -f channel=nightly -F publish=false

# Publish a Nightly only after all checks pass.
gh workflow run desktop-release.yml --ref main -f channel=nightly -F publish=true

# A stable tag push starts the same gated pipeline.
git tag -a v0.12.1 -m 'Palot 0.12.1'
git push origin v0.12.1

# Or rerun an existing tag from the main workflow.
gh workflow run desktop-release.yml --ref main -f channel=stable -f tag=v0.12.1 -F publish=true
```

The plan fixes the source SHA, version, channel, and build number. Both native
jobs check that exact checkout with pinned Bun/Node/Vite+ and a frozen lockfile.
The required matrix is:

| Target              | Packages                   | Verification                                                                                                                 |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Linux x64           | AppImage, DEB, RPM, tar.gz | Extract every format, verify app/channel/runtime; install the DEB on Ubuntu, run isolated non-root renderer smoke, uninstall |
| macOS Apple Silicon | DMG, ZIP                   | Verify app, native modules, fuses and signatures; isolated packaged runtime/renderer smoke                                   |

All source checks and the dependency-license inventory must pass. Assembly rejects
missing formats, duplicate names, mixed revisions, dirty builds, unexpected files,
or changed hashes. Each platform retains its manifest, checksums, CycloneDX SBOM,
and unsigned build statement. The SBOM describes the pinned workspace lockfile,
not a claim that every dependency ships. A combined `SHA256SUMS` also covers the
metadata and `release.json`.

Only the final job receives release-write/OIDC permissions. It verifies transferred
bytes, creates GitHub artifact attestations, creates a **draft**, uploads files,
downloads and compares them, and only then promotes it. Nightly is a prerelease
and never becomes GitHub's latest stable release. Existing releases are refused;
there is no `--clobber`, tag movement, or automatic replacement on retry.

An interrupted upload remains a draft. Inspect its run, commit and assets before
removing that unpublished draft and retrying. Never delete/recreate a published
version to replace its bytes. Fix a published defect with a new patch release.

Nightly is manual initially; there is no scheduled publication. Windows, Intel
Mac and Linux ARM64 are not in the publishing matrix. Native Wayland behavior on
Fedora and portable-package sandboxing under restricted Ubuntu policies require
separate environment checks; the Ubuntu DEB test does not prove those cases.

## Local packaging

Start from a clean checkout with the pinned toolchain:

```sh
vp install --frozen-lockfile
bun run release:verify-config
bun apps/desktop/scripts/check-public-docs.ts
bun run check
bun apps/desktop/scripts/generate-dependency-licenses.ts --check

# Native Linux x64: all four formats.
bun apps/desktop/scripts/package.ts nightly --linux --x64
bun apps/desktop/scripts/linux-distribution.ts verify nightly \
  apps/desktop/release/*.AppImage apps/desktop/release/*.deb \
  apps/desktop/release/*.rpm apps/desktop/release/*.tar.gz

# Native Apple Silicon.
bun apps/desktop/scripts/package.ts nightly --mac --arm64
bun apps/desktop/scripts/release-verification.ts nightly \
  'apps/desktop/release/mac-arm64/Palot Nightly.app' --smoke
```

Linux extraction needs `dpkg-deb`, `rpm`, `bsdtar` and `tar`; AppImage extraction
executes its runtime, so use only trusted local builds. `linux-distribution.ts
smoke-plan <stable.deb> <nightly.deb>` prints a separate destructive co-install /
removal test for a fresh disposable VM. It never runs the plan on the developer
host. RPM pairs use the same command with `.rpm` files. Containers cannot validate
the host's AppArmor policy.

Packaging performs its own build with the correct identity. Do not substitute a
development build with `--skip-build`. Mac smoke requires a logged-in GUI session
and matching architecture; it starts only an isolated bundled OpenCode service.
Failed smoke evidence remains under `.local/`; it never replaces the user service.

## Signing and download verification

macOS artifacts are **ad-hoc signed**, not Developer ID signed or notarized.
See the [installation guide](../installation.md) for local signing and macOS
security prompts. Ad-hoc signatures and checksums do not confer Apple trust.
Do not label builds notarized without Developer ID signing, notarization/stapling,
and clean-machine Gatekeeper checks.

```sh
sha256sum --check SHA256SUMS  # Linux; download the files listed in the checksum set
shasum -a 256 -c SHA256SUMS  # macOS
gh attestation verify ./Palot-<artifact> --repo ItsWendell/palot
```

The older manual `release-candidate.yml` remains an Actions-only diagnostic path.
Its Linux directory archive is not a substitute for the desktop release matrix.
Keep previous installers/checksums for rollback; do not relabel Nightly as stable.
