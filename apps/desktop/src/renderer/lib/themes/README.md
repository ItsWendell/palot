# Built-in Palot themes

Palot manages theme selection, semantic palette expansion, and registration.
Theme names and IDs, including **Codex**, remain stable for saved preferences.

## Runtime boundaries

- `src/shared/appearance-contract.ts` defines app palettes, light/dark availability,
  terminal colors, and native treatments. `paletteVariant` expands compact colors
  into Palot's semantic surfaces.
- Code is highlighted by `@pierre/highlights`, which reads Zed themes. Every code
  view, worker pool, patch preview and Markdown code block uses it
  (`../code-highlighter.ts`); `@pierre/diffs` allows only one highlighter type.
- `builtin-code-themes.ts` contains synchronous descriptors and asynchronous Zed
  loaders shared by the Pierre theme catalog and diff registration API.
- `syntax-data.ts` contains 20 local TextMate themes in one lazy payload.
  `../code-theme-convert.ts` converts them, and the OpenCode, TanStack and Omarchy
  TextMate themes, to Zed when loaded. Selecting one of these themes loads the
  group. No theme is loaded from another installed application.
- The macOS themes use the bundled Highlights GitHub Default themes with Palot's
  macOS editor colors. Curated syntax themes load by name from the bundled
  Highlights catalog.

## Tests

Theme tests cover saved-selection round trips, independent color schemes,
catalog/diff resolution, syntax scopes, and terminal/native colors. Fingerprints
exclude descriptive copy; update them only when an intentional visual change
has been checked.
