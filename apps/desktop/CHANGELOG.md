# @palot/desktop

## 0.3.0

### Minor Changes

- [`0c44450`](https://github.com/ItsWendell/palot/commit/0c44450f8464e7fa87978e29dc53c59a7da98ea8) Thanks [@ItsWendell](https://github.com/ItsWendell)! - Add new Palot logo, app icons, favicons, brand assets, and comprehensive README

  - Design new logo: stacked terminal cards with >\_ prompt (V10a-1)
  - Generate all icon assets: 1024px PNG (macOS/Linux), multi-size ICO (Windows), favicons
  - Add favicon support to renderer HTML with light/dark mode
  - Set BrowserWindow icon for Linux/Windows dev mode
  - Create wordmark in Geist Mono (Black 900 "CODE" + Semibold 600 "DECK")
  - Generate horizontal and stacked logo lockups (light + dark variants)
  - Add icon generation scripts for future asset rebuilds
  - Rewrite README with logo, badges, alpha disclaimer, features, architecture, and contributing guide

## 0.2.0

### Minor Changes

- [#8](https://github.com/ItsWendell/palot/pull/8) [`95e12b0`](https://github.com/ItsWendell/palot/commit/95e12b00908f555820f93285a9db52049a34aa1b) Thanks [@ItsWendell](https://github.com/ItsWendell)! - Add auto-update support and overhaul release workflow

  - Integrate electron-updater for automatic app updates via GitHub Releases
  - Non-intrusive update banner with download progress and restart action
  - Overhaul CI/CD: draft release pattern prevents incomplete downloads
  - Changeset-driven releases with automated tag creation and changelog

### Patch Changes

- Updated dependencies [[`95e12b0`](https://github.com/ItsWendell/palot/commit/95e12b00908f555820f93285a9db52049a34aa1b)]:
  - @palot/ui@0.2.0

## 0.1.1

### Patch Changes

- Initial release with multi-platform Electron builds, shared UI component library, and development server

- Updated dependencies []:
  - @palot/ui@0.1.1
