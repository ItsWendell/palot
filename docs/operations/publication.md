# Publication checklist

Passing CI is necessary, not sufficient, for publishing source or binaries. This
checklist records release requirements, not a claim that they have been met.

## Public source

- Review the exact snapshot for credentials, personal data, internal plans, and
  unlicensed third-party material. Scan Git history too if it will be published.
- Verify the exact source revision and destination before publishing. Repository
  visibility changes and shared-history rewrites require separate approval.
- Keep `.private/` archives ignored, untracked, and excluded from published source
  and artifacts.
- Run `bun apps/desktop/scripts/check-public-docs.ts`. Public setup and guidance
  must work without internal archives or generated local artifacts.
- Preserve applicable [third-party notices](../../apps/desktop/resources/licenses/THIRD_PARTY_NOTICES.md)
  and license texts in the source and any distributed artifacts.
- Run the full contributor checks from a clean checkout and review unresolved
  failures. A changed baseline requires an actual review, not automatic acceptance.
- Confirm the README's support policy, security contact, installation commands,
  contribution process, and trademark policy match what maintainers can support.
- Verify that the destination repository's private vulnerability reporting is
  enabled before advertising GitHub's private advisory form. Do not substitute a
  public issue for a confidential security-reporting channel.

## Binary candidates

- Follow [release operations](release.md); keep build and publication separate.
- Run `bun apps/desktop/scripts/generate-dependency-licenses.ts --check` and resolve
  missing license files or metadata reported by the dependency-license inventory.
- Attach package verification, deterministic smoke, checksums, SBOM, and source
  revision evidence for the exact artifact. Failed jobs must not promote artifacts.
- Qualify each advertised OS, architecture, and package format. Linux x64 testing
  does not certify Linux ARM64, Fedora, Ubuntu, AppImage, deb, or RPM.
- Verify the [macOS runtime manifests](../opencode-runtime.md) on a Mac when their
  pins change. Local ad-hoc or self-signed builds are not Developer ID signed or notarized.
- Keep installation, updates, rollback, and removal documented without deleting
  OpenCode user data or stopping unrelated services.
- Require explicit maintainer approval before publishing a GitHub Release or
  enabling any automatic distribution/update channel.

The workflows intentionally produce engineering artifacts rather than publish
releases. Local self-signing instructions are not a substitute for the provenance
and platform qualification steps above.
