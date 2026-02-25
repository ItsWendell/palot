---
"@palot/desktop": patch
---

Platform and infrastructure improvements

- **Linux/Wayland**: resolved rendering issues that caused visual glitches on Wayland compositors
- **Linux tray icon**: added a dedicated tray icon for Linux so the app integrates properly with system trays on GNOME, KDE, and compatible desktops
- **mDNS discovery**: a new settings page lets you configure mDNS-based server discovery for finding OpenCode instances on your local network automatically
- **Provider icons**: provider icons are now fetched at runtime from models.dev rather than being bundled, keeping them up to date as new providers are added
- **Server lockfile**: the app now writes a lockfile when it owns the OpenCode server process, preventing multiple instances from fighting over the same server on startup
