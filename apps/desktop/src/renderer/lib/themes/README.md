# Built-in Palot themes

Palot manages theme selection, semantic palette expansion, and registration.
Theme names and IDs, including **Codex**, remain stable for saved preferences.

## Runtime boundaries

- `src/shared/appearance-contract.ts` defines app palettes, light/dark availability,
  terminal colors, and native treatments. `paletteVariant` expands compact colors
  into Palot's semantic surfaces.
- `builtin-code-themes.ts` contains synchronous descriptors and asynchronous
  loaders shared by the Pierre theme catalog and diff registration API.
- `syntax-data.ts` contains 20 local Shiki registrations in one lazy payload.
  Selecting one of these themes loads the group. Default Pierre themes, OpenCode,
  TanStack, and macOS do not need that payload. No theme is loaded from another
  installed application.
- OpenCode and TanStack have dedicated code-theme modules. The macOS module uses
  GitHub Default syntax with Palot's macOS editor/workbench color overrides.
  Other syntax themes come from the pinned Pierre/Shiki packages.

## Tests

Theme tests cover saved-selection round trips, independent color schemes,
catalog/diff resolution, syntax scopes, and terminal/native colors. Fingerprints
exclude descriptive copy; update them only when an intentional visual change
has been checked.
