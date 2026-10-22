import type { Theme } from "@pierre/highlights";
import { textMateToZedTheme, withEditorColors } from "../code-theme-convert";
import type { AppearanceColorScheme } from "../../../shared/appearance-contract";
import type { builtinSyntaxThemes } from "./syntax-data";

interface BuiltinCodeTheme {
  name: string;
  displayName: string;
  colorScheme: AppearanceColorScheme;
  /** The Zed theme `@pierre/highlights` renders with. */
  load: () => Promise<Theme>;
}

// Keep registration metadata synchronous; syntax is loaded only when requested by
// the official Pierre resolver or diff highlighter. The type-only import does not
// pull the static syntax payload into the initial renderer bundle.
const syntaxThemeNames = [
  "absolutely-dark",
  "absolutely-light",
  "codex-dark",
  "codex-light",
  "linear-dark",
  "linear-light",
  "lobster-dark",
  "matrix-dark",
  "notion-dark",
  "notion-light",
  "oscurange-dark",
  "proof-light",
  "raycast-dark",
  "raycast-light",
  "sentry-dark",
  "temple-dark",
  "vercel-dark",
  "vercel-light",
  "xcode-dark",
  "xcode-light",
] as const satisfies readonly (keyof typeof builtinSyntaxThemes)[];

/** One registration path for every locally supplied built-in code theme. */
export const builtinCodeThemes: readonly BuiltinCodeTheme[] = [
  {
    name: "opencode-light",
    displayName: "OpenCode Light",
    colorScheme: "light",
    load: async () =>
      textMateToZedTheme((await import("../opencode-code-themes")).opencodeCodeThemes.light),
  },
  {
    name: "opencode-dark",
    displayName: "OpenCode Dark",
    colorScheme: "dark",
    load: async () =>
      textMateToZedTheme((await import("../opencode-code-themes")).opencodeCodeThemes.dark),
  },
  {
    name: "tanstack-light",
    displayName: "TanStack Light",
    colorScheme: "light",
    load: async () =>
      textMateToZedTheme((await import("../tanstack-code-themes")).tanstackCodeThemes.light),
  },
  {
    name: "tanstack-dark",
    displayName: "TanStack Dark",
    colorScheme: "dark",
    load: async () =>
      textMateToZedTheme((await import("../tanstack-code-themes")).tanstackCodeThemes.dark),
  },
  {
    name: "macos-code-light",
    displayName: "macOS Light",
    colorScheme: "light",
    load: async () =>
      withEditorColors(
        (await import("@pierre/highlights/themes/github-light-default")).default,
        "macos-code-light",
        "#ffffff",
        "#1d1d1f",
      ),
  },
  {
    name: "macos-code-dark",
    displayName: "macOS Dark",
    colorScheme: "dark",
    load: async () =>
      withEditorColors(
        (await import("@pierre/highlights/themes/github-dark-default")).default,
        "macos-code-dark",
        "#1e1e1e",
        "#f5f5f7",
      ),
  },
  ...syntaxThemeNames.map((name): BuiltinCodeTheme => ({
    name,
    displayName: name,
    colorScheme: name.endsWith("-light") ? "light" : "dark",
    load: async () =>
      textMateToZedTheme((await import("./syntax-data")).builtinSyntaxThemes[name], name),
  })),
];
