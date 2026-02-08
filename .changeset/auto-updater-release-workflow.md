---
"@codedeck/desktop": minor
"@codedeck/ui": minor
"@codedeck/server": minor
---

Add auto-update support and overhaul release workflow

- Integrate electron-updater for automatic app updates via GitHub Releases
- Non-intrusive update banner with download progress and restart action
- Overhaul CI/CD: draft release pattern prevents incomplete downloads
- Changeset-driven releases with automated tag creation and changelog
