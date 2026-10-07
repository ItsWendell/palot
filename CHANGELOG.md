# Changelog

Palot uses [Semantic Versioning](https://semver.org/) for public releases. This
file records user-visible changes. Internal refactors belong in Git history
unless they change behavior, compatibility, security, privacy, or release
operations.

## Unreleased

### Changed

- Pinned OpenCode dependencies and the release-smoke runtime to 2.0.24. The
  supported stable connection minimum remains 2.0.7.

## 0.16.0

This remains an experimental pre-release, not a supported stable release.

### Added

- A searchable project/device destination picker, grouped by server with project
  paths and explicit offline/disabled states.
- `/btw` side questions in separate persisted tabs, without normal transcript
  turns or tool execution. Closing a pending tab cancels its request.
- Browser element comments with page previews and prompt context. Saved drafts
  and restored messages retain descriptions, not live element references.
- Missing-workspace recovery on the original connection, using another directory
  or a new worktree from the project's saved checkout.
- Clickable session IDs that open on their originating connection.
- A unified running-work menu for subagents, commands and terminals, with
  open/stop controls for agents and commands.

### Changed

- New-task navigation defaults to the local device instead of inheriting an
  unrelated remote selection. Explicit destinations retain their owner.
- Response metadata shows the actual model variant used.
- Adjacent plain file reads are grouped more compactly.
- Pinned OpenCode dependencies and the release-smoke runtime to 2.0.23. The
  supported stable connection minimum remains 2.0.7.

### Testing

- Added native scenarios for transient side questions and missing-workspace
  recovery, plus multi-connection destination checks and running-command stops.
- Browser scenarios cover element comments, live references across snapshots,
  child-frame replacement, and paired HTTP transport.

## 0.15.0

This remains an experimental pre-release, not a supported stable release.

### Added

- Opt-in, task-scoped browser tabs with agent tools, managed popups, page recovery,
  saved tab restoration and explicit task-browser data clearing. Traffic uses the
  connected OpenCode server; per-site approval is not available.
- Workspace file browsing/search and image, Markdown, PDF and supported audio/video previews.
- Diff-line review comments that can be edited, removed and sent with a prompt,
  plus a separate view of changes from a completed turn.
- Usage comparisons with the previous period.

### Changed

- Pinned the OpenCode client, protocol, schema, browser plugin and release-smoke
  runtime to 2.0.19. The supported stable connection minimum remains 2.0.7.
- Added one-time pairing links for stable services from 2.0.17, retaining explicit
  legacy credential import for older compatible services.
- Retained live session metadata and project activity, linked background shell
  results to their originating activity, and kept delegated-work anchors visible
  in folded activity groups.
- Improved workbench resizing, expansion, tab navigation, composer framing,
  connection status presentation and usage refresh behavior.

### Testing

- Added isolated native scenarios for workspace previews, review comments and
  turn changes, workbench resizing, browser audits/popups/recovery and HTTP profiles,
  plus usage-comparison assertions. Linux E2E defaults to a private Weston display.
- Browser scenarios do not qualify SSH browser transport,
  external-network OAuth/HTTPS login or cross-window stress behavior.

## 0.12.0 rewrite baseline

The source-only Palot v2 rewrite introduced **0.12.0** (`v0.12.0`), continuing the
public release sequence after [0.11.0](https://github.com/ItsWendell/palot/releases/tag/v0.11.0).
The product generation and independently versioned OpenCode runtime do not reset
Palot's Semantic Versioning sequence.

### Added

- Public contributor, security, privacy, support, accessibility, and trademark
  documentation.
- Pull request CI and an unsigned macOS release-candidate workflow.
- Startup recovery, database backups, scoped reset controls, and redacted
  support-bundle export.
- Release build identity, Electron fuse verification, packaged license notices,
  checksums, SBOM generation, and unsigned provenance metadata.

### Changed

- Hardened renderer CSP, privileged IPC authorization, temporary attachment
  handling, external URL policy, permissions, and production logging.
- Removed the Pets feature from the current product.

### Security

- Renderer processes now use a strict script policy and deny unapproved Electron
  permissions.
- Local attachment previews require main-process grants rather than arbitrary
  renderer-provided file paths.

## Internal rewrite baseline (0.1.0)

Initial internal version of this rewrite, not a successor to the original
Palot's public releases. No supported public binary of this rewrite was published.
