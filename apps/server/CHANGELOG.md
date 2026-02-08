# @codedeck/server

## 0.2.0

### Minor Changes

- [#8](https://github.com/ItsWendell/codedeck/pull/8) [`95e12b0`](https://github.com/ItsWendell/codedeck/commit/95e12b00908f555820f93285a9db52049a34aa1b) Thanks [@ItsWendell](https://github.com/ItsWendell)! - Add auto-update support and overhaul release workflow

  - Integrate electron-updater for automatic app updates via GitHub Releases
  - Non-intrusive update banner with download progress and restart action
  - Overhaul CI/CD: draft release pattern prevents incomplete downloads
  - Changeset-driven releases with automated tag creation and changelog

## 0.1.1

### Patch Changes

- Initial release with multi-platform Electron builds, shared UI component library, and development server
