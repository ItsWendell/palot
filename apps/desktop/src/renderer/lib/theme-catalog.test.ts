import { describe, expect, it } from "vitest";
import { resolveTheme } from "@pierre/diffs";
import { APPEARANCE_THEMES } from "../../shared";
import { codeThemeCatalog, prepareCodeThemes, resolveCodeTheme } from "./theme-catalog";
import { DEFAULT_APPEARANCE_PREFERENCES } from "../../shared";
import { builtinCodeThemes } from "./themes/builtin-code-themes";

describe("code theme catalog", () => {
  it("registers every code theme used by an app theme", () => {
    for (const theme of Object.values(APPEARANCE_THEMES)) {
      for (const variant of [theme.light, theme.dark]) {
        if (!variant) continue;
        expect(codeThemeCatalog.hasTheme(variant.codeTheme), variant.codeTheme).toBe(true);
      }
    }
  });

  it.each(builtinCodeThemes)(
    "loads $name through both official theme consumers",
    async ({ name, colorScheme }) => {
      await expect(resolveTheme(name)).resolves.toMatchObject({ name, type: colorScheme });
      const theme = await resolveCodeTheme(name);
      expect(theme).toMatchObject({ name, type: colorScheme });
      expect(theme.colors?.["editor.background"]).toBeTruthy();
      expect(theme.colors?.["editor.foreground"]).toBeTruthy();
      // The official resolver, rather than a parallel Palot cache, owns warm reads.
      expect(await resolveCodeTheme(name)).toBe(theme);
    },
  );

  it("prepares independent light/dark selections and explicit code overrides", async () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      lightTheme: "proof" as const,
      darkTheme: "codex" as const,
    };
    await expect(prepareCodeThemes(preferences)).resolves.toBeUndefined();
    await expect(resolveCodeTheme("proof-light")).resolves.toMatchObject({ name: "proof-light" });
    await expect(resolveCodeTheme("codex-dark")).resolves.toMatchObject({ name: "codex-dark" });
    await expect(
      prepareCodeThemes({ ...preferences, lightCodeTheme: "min", darkCodeTheme: "github" }),
    ).resolves.toBeUndefined();
  });

  it("uses GitHub Default highlighting on native macOS editor surfaces", async () => {
    await expect(resolveTheme("macos-code-light")).resolves.toMatchObject({
      name: "macos-code-light",
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1d1d1f",
      },
    });
    await expect(resolveTheme("macos-code-dark")).resolves.toMatchObject({
      name: "macos-code-dark",
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#f5f5f7",
      },
    });
  });
});
