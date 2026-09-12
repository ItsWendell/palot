# Linux and Omarchy

For prerequisites, building, installation, updates, and removal, see the
[installation guide](installation.md). Linux x64 user-local Nightly installation
has been exercised on Arch/Omarchy. That does not qualify every distribution,
package format, architecture, or desktop integration.

## Desktop behavior

Palot selects native Wayland in a Wayland session. The compositor owns placement
and dimensions; Linux windows have no native minimum-size constraint. Palot does
not install window rules or rewrite Hyprland configuration. The application menu
is auto-hidden and the window has a Palot close button.

Choose **Task actions → Open in new window**, use the task's context menu, or drag
a task out of the window to open the same session separately. Windows share the
connection and appearance but navigate independently. Draft edits and clears
synchronize between windows; this is not collaborative text merging. Multi-window
layouts are not restored on relaunch. Closing the last Linux window quits Palot,
not the shared OpenCode service.

## Appearance

**Settings → Appearance → Theme → System** follows Omarchy's resolved palette
and light/dark mode when available. Other desktops use their system color mode.
Following Omarchy's monospace font is a separate preference. Theme reads are
bounded and event-driven; temporary replacement gaps retain the last valid theme.

The System theme can also read Hyprland's effective rounding for larger surfaces,
capped at 16px. Hyprland still owns the outer window border and corners.

**Window background opacity** changes backgrounds independently of text. Crossing
between opaque and translucent requires restart. **Reduce Transparency** restores
solid surfaces. Compositor opacity affects the whole window, including text; keep
it at 100% when using Palot's own background-opacity setting. Desktop blur remains
the compositor's responsibility.

Overlay scrollbar handles reveal during scrolling, hover, or keyboard focus.
**Always show scrollbars** keeps Palot-managed handles visible; it does not change
Ghostty's canvas scrollbar. App shortcuts leave AltGr/composition and terminal
control sequences to their owning input surface.

## Launch actions

```sh
palot-nightly --show
palot-nightly --new-task
palot-nightly --project '/home/user/project with spaces'
palot-nightly --task ses_123abc
palot-nightly --project "$PWD" --attach '/home/user/Pictures/screenshot.png'
```

Actions reuse the channel's running instance. Project actions create a task in
that directory; attachments enter its composer without being submitted.
`--attach` is repeatable and requires `--project`.

## Optional Omarchy integration

The optional widget is in `apps/desktop/resources/omarchy/palot.tasks`. Copy it to
`~/.config/omarchy/plugins/palot.tasks`, then explicitly enable it:

```sh
omarchy plugin validate ~/.config/omarchy/plugins/palot.tasks
omarchy plugin enable palot.tasks
```

Launch Palot with `PALOT_OMARCHY_STATUS=1` to publish an owner-readable presentation
snapshot at `$XDG_RUNTIME_DIR/palot/<app-id>.json`. The widget displays existing
attention data; it does not own tasks or store credentials. For a user-local
install, configure the widget's executable with its absolute path.

The optional capture script stages an interactive region screenshot in a new task:

```sh
PALOT_BIN=palot-nightly bash apps/desktop/resources/omarchy/palot-capture "$PWD"
```

No widget, capture shortcut, or compositor configuration is enabled by the installer.

## Diagnostics and qualification

```sh
bun run linux:doctor
palot-nightly --diagnostics
palot-nightly --ozone-platform=x11
bun run test:e2e -- linux-desktop --visible --keep
```

The X11 option is a diagnostic fallback, not a required GPU workaround. Native
testing requires a working display session; see [desktop testing](desktop-testing.md).

Fedora/Ubuntu desktop integration, ARM64 execution, AppImage/deb distribution,
package-manager upgrades/removal, mixed-DPI monitors, IME, portals, notifications,
and the widget's live shell behavior need platform-specific qualification. A
passing isolated scenario is not proof that all of those integrations work.
