import type { ThemeRegistration } from "shiki";
import type { AppearanceColorScheme } from "../../../shared/appearance-contract";
import type { builtinSyntaxThemes } from "./syntax-data";

interface BuiltinCodeTheme {
  name: string;
  displayName: string;
  colorScheme: AppearanceColorScheme;
  load: () => Promise<ThemeRegistration>;
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
    load: async () => (await import("../opencode-code-themes")).opencodeCodeThemes.light,
  },
  {
    name: "opencode-dark",
    displayName: "OpenCode Dark",
    colorScheme: "dark",
    load: async () => (await import("../opencode-code-themes")).opencodeCodeThemes.dark,
  },
  {
    name: "tanstack-light",
    displayName: "TanStack Light",
    colorScheme: "light",
    load: async () => (await import("../tanstack-code-themes")).tanstackCodeThemes.light,
  },
  {
    name: "tanstack-dark",
    displayName: "TanStack Dark",
    colorScheme: "dark",
    load: async () => (await import("../tanstack-code-themes")).tanstackCodeThemes.dark,
  },
  {
    name: "macos-code-light",
    displayName: "macOS Light",
    colorScheme: "light",
    load: async () => (await import("./macos-code-themes")).macOSCodeThemes.light,
  },
  {
    name: "macos-code-dark",
    displayName: "macOS Dark",
    colorScheme: "dark",
    load: async () => (await import("./macos-code-themes")).macOSCodeThemes.dark,
  },
  ...syntaxThemeNames.map((name): BuiltinCodeTheme => ({
    name,
    displayName: name,
    colorScheme: name.endsWith("-light") ? "light" : "dark",
    load: async () => (await import("./syntax-data")).builtinSyntaxThemes[name],
  })),
];
