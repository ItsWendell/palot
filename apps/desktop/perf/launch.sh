#!/usr/bin/env bash
# strobe command target: runs this variant's built Palot (scripts/build.ts output). Run from apps/desktop.
# Electron prints "DevTools listening on", which is where strobe attaches.
# With `--wayland`, strobe runs a headless sway per launch and sets WAYLAND_DISPLAY (nothing on your desktop);
# without it, Palot opens on the session's X server (Xwayland), visible on your screen while it runs.
set -euo pipefail

# Resolved without node: strobe gives the app its own HOME, where version-manager shims find no config.
electron_package="$(cd ../.. && pwd)/node_modules/electron"
electron="$electron_package/dist/$(cat "$electron_package/path.txt")"
unset ELECTRON_RUN_AS_NODE

# strobe's own compositor gives the socket's absolute path; your desktop's is a bare name such as wayland-1.
if [[ "${WAYLAND_DISPLAY:-}" == /* ]]; then
  exec "$electron" . --ozone-platform=wayland
fi
exec "$electron" . --ozone-platform=x11
