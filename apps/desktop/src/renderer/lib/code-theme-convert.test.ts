import { describe, expect, it } from "vitest";
import { textMateToZedTheme, type TextMateTheme } from "./code-theme-convert";
import { opencodeCodeThemes } from "./opencode-code-themes";
import { tanstackCodeThemes } from "./tanstack-code-themes";
import { builtinSyntaxThemes } from "./themes/syntax-data";

describe("TextMate to Zed code themes", () => {
  it("colors each token like a TextMate engine would color its representative scope", () => {
    const theme = textMateToZedTheme({
      name: "sample",
      type: "light",
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#111111",
        "editor.selectionBackground": "#00000022",
        "gitDecoration.addedResourceForeground": "#00aa00",
      },
      tokenColors: [
        { settings: { foreground: "#111111" } },
        { scope: "keyword", settings: { foreground: "#aa0000" } },
        { scope: "keyword.operator", settings: { foreground: "#0000aa" } },
        { scope: ["comment", "string"], settings: { foreground: "#888888", fontStyle: "italic" } },
        { scope: "entity.name.function", settings: { fontStyle: "bold" } },
        // Context-dependent selectors cannot apply without scope context.
        { scope: "source.js keyword", settings: { foreground: "#ff00ff" } },
        { scope: "string.quoted, -string.quoted.single", settings: { foreground: "#008800" } },
      ],
    });

    expect(theme).toMatchObject({
      name: "sample",
      appearance: "light",
      style: {
        "editor.background": "#ffffff",
        "editor.foreground": "#111111",
        players: [{ selection: "#00000022" }],
        created: "#00aa00",
      },
    });
    const syntax = theme.style.syntax!;
    expect(syntax.keyword).toBe("#aa0000");
    // The more specific selector wins for operators.
    expect(syntax["keyword.operator"]).toBe("#0000aa");
    expect(syntax.comment).toEqual({ color: "#888888", font_style: "italic" });
    // `string.quoted` beats the shared `string` rule; the exclusion is ignored.
    expect(syntax.string).toBe("#008800");
    expect(syntax.function).toEqual({ font_weight: 700 });
    // Child scopes inherit their parent's rule, as in TextMate.
    expect(syntax["string.regex"]).toEqual({ color: "#888888", font_style: "italic" });
    // Tokens without a match are omitted so Highlights falls back to the parent name.
    expect(syntax.tag).toBeUndefined();
  });

  it("falls back to theme-level and global rule colors for the editor", () => {
    const theme = textMateToZedTheme({
      name: "legacy",
      settings: [{ settings: { foreground: "#eeeeee", background: "#101010" } }],
    });
    expect(theme.appearance).toBe("dark");
    expect(theme.style).toMatchObject({
      "editor.background": "#101010",
      "editor.foreground": "#eeeeee",
    });
  });

  const sources: [string, TextMateTheme][] = [
    ...Object.entries(builtinSyntaxThemes),
    ["opencode-light", opencodeCodeThemes.light],
    ["opencode-dark", opencodeCodeThemes.dark],
    ["tanstack-light", tanstackCodeThemes.light],
    ["tanstack-dark", tanstackCodeThemes.dark],
  ];

  it.each(sources)("keeps the core syntax colors of %s", (name, source) => {
    const theme = textMateToZedTheme(source, name);
    expect(theme.name).toBe(name);
    expect(theme.style["editor.background"]).toBeTruthy();
    expect(theme.style["editor.foreground"]).toBeTruthy();
    for (const token of ["comment", "string", "keyword"]) {
      expect(theme.style.syntax?.[token], `${name} ${token}`).toBeTruthy();
    }
  });
});
