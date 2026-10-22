/**
 * Converts Palot's TextMate code themes into the Zed format `@pierre/highlights` reads.
 *
 * Highlights colors tree-sitter-style token names (`keyword`, `function.method`), while
 * TextMate themes color scope selectors (`keyword.control`, `entity.name.function`). Each
 * token name probes representative TextMate scopes in order and takes the most specific
 * matching rule, the way a TextMate engine would color that scope. Token names Highlights
 * does not find fall back to their parent (`keyword.control` uses `keyword`), so only
 * names with a match are written.
 */

import type { Theme, ThemeStyle, ThemeSyntaxSettings } from "@pierre/highlights";

export interface TextMateRule {
  name?: string;
  scope?: string | readonly string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

/** The TextMate theme shape Palot's local themes use (VS Code compatible). */
export interface TextMateTheme {
  name?: string;
  displayName?: string;
  type?: "light" | "dark" | string;
  fg?: string;
  bg?: string;
  colors?: Record<string, string>;
  tokenColors?: readonly TextMateRule[];
  settings?: readonly TextMateRule[];
  /** VS Code fields that Highlights has no equivalent for. */
  semanticTokenColors?: Record<string, unknown>;
  semanticHighlighting?: boolean;
  $schema?: string;
}

/** Zed token name → TextMate scopes to probe, most representative first. */
const TOKEN_SCOPES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["comment", ["comment.line.double-slash", "comment.block", "comment"]],
  ["comment.doc", ["comment.block.documentation"]],
  ["string", ["string.quoted.double", "string.quoted", "string"]],
  ["string.escape", ["constant.character.escape"]],
  ["string.regex", ["string.regexp"]],
  ["string.special", ["string.other", "constant.other.symbol"]],
  ["string.special.symbol", ["constant.other.symbol"]],
  ["string.template", ["string.template"]],
  ["number", ["constant.numeric.decimal", "constant.numeric"]],
  ["boolean", ["constant.language.boolean", "constant.language"]],
  ["constant", ["variable.other.constant", "constant.other", "constant.language", "constant"]],
  ["constant.color", ["constant.other.color"]],
  ["keyword", ["keyword.control", "storage.type", "keyword"]],
  ["keyword.operator", ["keyword.operator"]],
  ["keyword.directive", ["keyword.control.directive", "meta.preprocessor"]],
  ["keyword.important", ["keyword.other.important"]],
  ["operator", ["keyword.operator"]],
  ["function", ["entity.name.function", "support.function"]],
  ["function.method", ["entity.name.function.member", "entity.name.function"]],
  ["function.builtin", ["support.function"]],
  ["function.call", ["entity.name.function", "support.function"]],
  ["type", ["entity.name.type", "support.type", "storage.type"]],
  ["type.builtin", ["support.type.primitive", "support.type"]],
  ["type.class", ["entity.name.type.class", "entity.name.class"]],
  ["class", ["entity.name.type.class", "entity.name.class"]],
  ["constructor", ["entity.name.function.constructor", "entity.name.type.class"]],
  ["enum", ["entity.name.type.enum", "entity.name.type"]],
  ["variant", ["variable.other.enummember"]],
  ["variable", ["variable.other.readwrite", "variable.other", "variable"]],
  ["variable.builtin", ["variable.language"]],
  ["variable.language", ["variable.language"]],
  ["variable.parameter", ["variable.parameter"]],
  ["variable.member", ["variable.other.property", "variable.other.object.property"]],
  ["variable.special", ["variable.language"]],
  [
    "property",
    ["variable.other.property", "support.type.property-name", "meta.object-literal.key"],
  ],
  ["property.css", ["support.type.property-name.css", "support.type.property-name"]],
  ["property.custom", ["variable.css", "variable.argument.css"]],
  ["attribute", ["entity.other.attribute-name"]],
  ["tag", ["entity.name.tag"]],
  ["namespace", ["entity.name.namespace", "entity.name.type.module"]],
  ["label", ["entity.name.label"]],
  ["decorator", ["entity.name.function.decorator", "meta.decorator"]],
  ["selector", ["meta.selector", "entity.name.tag.css"]],
  [
    "selector.class",
    ["entity.other.attribute-name.class.css", "entity.other.attribute-name.class"],
  ],
  ["selector.id", ["entity.other.attribute-name.id.css", "entity.other.attribute-name.id"]],
  [
    "selector.pseudo",
    ["entity.other.attribute-name.pseudo-class.css", "entity.other.attribute-name.pseudo-class"],
  ],
  ["number.unit", ["keyword.other.unit"]],
  ["unit", ["keyword.other.unit"]],
  ["punctuation", ["punctuation"]],
  ["punctuation.bracket", ["punctuation.section.block", "meta.brace", "punctuation.section"]],
  ["punctuation.delimiter", ["punctuation.separator", "punctuation.terminator"]],
  [
    "punctuation.special",
    ["punctuation.definition.template-expression", "punctuation.section.embedded"],
  ],
  ["punctuation.list_marker", ["punctuation.definition.list.begin.markdown", "markup.list"]],
  ["embedded", ["meta.embedded"]],
  ["preproc", ["meta.preprocessor", "keyword.control.directive"]],
  ["title", ["markup.heading", "entity.name.section"]],
  ["markup.heading", ["markup.heading", "entity.name.section"]],
  ["markup.bold", ["markup.bold"]],
  ["emphasis.strong", ["markup.bold"]],
  ["markup.italic", ["markup.italic"]],
  ["emphasis", ["markup.italic"]],
  ["markup.strikethrough", ["markup.strikethrough"]],
  ["markup.link.url", ["markup.underline.link"]],
  ["link_uri", ["markup.underline.link"]],
  ["markup.link.text", ["string.other.link", "markup.link"]],
  ["link_text", ["string.other.link", "markup.link"]],
  ["markup.quote", ["markup.quote"]],
  ["markup.list", ["markup.list"]],
  ["markup.raw", ["markup.inline.raw", "markup.raw"]],
  ["text.literal", ["markup.inline.raw", "markup.raw"]],
  ["diff.plus", ["markup.inserted"]],
  ["diff.minus", ["markup.deleted"]],
  ["diff.delta", ["markup.changed"]],
];

interface Selector {
  scope: string;
  specificity: number;
  rule: TextMateRule;
}

function selectors(rules: readonly TextMateRule[]): Selector[] {
  return rules.flatMap((rule) => {
    const scopes = typeof rule.scope === "string" ? rule.scope.split(",") : (rule.scope ?? []);
    return scopes.flatMap((raw) => {
      const scope = raw.trim();
      // Descendant and exclusion selectors only apply in a context Highlights cannot see.
      if (!scope || /[\s>]/.test(scope) || scope.startsWith("-")) return [];
      return [{ scope, specificity: scope.split(".").length, rule }];
    });
  });
}

/** The rule a TextMate engine applies to `scope`, using the longest matching selector. */
function ruleFor(scope: string, all: readonly Selector[]): TextMateRule | undefined {
  let best: Selector | undefined;
  for (const selector of all) {
    if (scope !== selector.scope && !scope.startsWith(`${selector.scope}.`)) continue;
    // Later rules win ties, as in TextMate.
    if (!best || selector.specificity >= best.specificity) best = selector;
  }
  return best?.rule;
}

function syntaxSetting(rule: TextMateRule): string | ThemeSyntaxSettings | undefined {
  const { foreground, fontStyle } = rule.settings;
  if (!foreground && !fontStyle) return undefined;
  const style = fontStyle?.split(/\s+/) ?? [];
  const settings: ThemeSyntaxSettings = {
    ...(foreground ? { color: foreground } : {}),
    ...(style.includes("italic") ? { font_style: "italic" } : {}),
    ...(style.includes("bold") ? { font_weight: 700 } : {}),
  };
  return Object.keys(settings).length === 1 && settings.color ? settings.color : settings;
}

export function textMateToZedTheme(source: TextMateTheme, name = source.name ?? "custom"): Theme {
  const rules = source.tokenColors ?? source.settings ?? [];
  const global = rules.find((rule) => rule.scope === undefined)?.settings;
  const colors = source.colors ?? {};
  const background = colors["editor.background"] ?? source.bg ?? global?.background;
  const foreground =
    colors["editor.foreground"] ?? source.fg ?? global?.foreground ?? colors.foreground;
  const all = selectors(rules);

  const syntax: Record<string, string | ThemeSyntaxSettings> = {};
  for (const [token, scopes] of TOKEN_SCOPES) {
    for (const scope of scopes) {
      const rule = ruleFor(scope, all);
      const setting = rule && syntaxSetting(rule);
      if (setting) {
        syntax[token] = setting;
        break;
      }
    }
  }

  const style: ThemeStyle = {
    ...(background ? { background, "editor.background": background } : {}),
    ...(foreground ? { text: foreground, foreground, "editor.foreground": foreground } : {}),
    ...(colors["editor.lineHighlightBackground"]
      ? { "editor.active_line.background": colors["editor.lineHighlightBackground"] }
      : {}),
    ...(colors["editor.findMatchBackground"]
      ? { "search.match_background": colors["editor.findMatchBackground"] }
      : {}),
    ...(colors["editorCursor.foreground"] || colors["editor.selectionBackground"]
      ? {
          players: [
            {
              ...(colors["editorCursor.foreground"]
                ? { cursor: colors["editorCursor.foreground"] }
                : {}),
              ...(colors["editor.selectionBackground"]
                ? { selection: colors["editor.selectionBackground"] }
                : {}),
            },
          ],
        }
      : {}),
    ...(colors["gitDecoration.addedResourceForeground"]
      ? { created: colors["gitDecoration.addedResourceForeground"] }
      : {}),
    ...(colors["gitDecoration.deletedResourceForeground"]
      ? { deleted: colors["gitDecoration.deletedResourceForeground"] }
      : {}),
    ...(colors["gitDecoration.modifiedResourceForeground"]
      ? { modified: colors["gitDecoration.modifiedResourceForeground"] }
      : {}),
    ...(colors["editorError.foreground"] ? { error: colors["editorError.foreground"] } : {}),
    ...(colors["editorWarning.foreground"] ? { warning: colors["editorWarning.foreground"] } : {}),
    ...(colors["editorInfo.foreground"] ? { info: colors["editorInfo.foreground"] } : {}),
    syntax,
  };
  return { name, appearance: source.type === "light" ? "light" : "dark", style };
}

/** A bundled Zed theme with Palot's own editor background and foreground. */
export function withEditorColors(
  source: Theme,
  name: string,
  background: string,
  foreground: string,
): Theme {
  return {
    ...source,
    name,
    style: {
      ...source.style,
      background,
      text: foreground,
      "editor.background": background,
      "editor.foreground": foreground,
    },
  };
}
