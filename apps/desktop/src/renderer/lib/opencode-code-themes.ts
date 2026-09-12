const light = {
  name: "opencode-light",
  type: "light" as const,
  colors: {
    "editor.background": "#fafafa",
    "editor.foreground": "#1a1a1a",
    "editor.selectionBackground": "#3b7dd830",
    "editor.lineHighlightBackground": "#f5f5f5",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#8a8a8a" } },
    { scope: ["keyword", "storage", "entity.name.tag"], settings: { foreground: "#d68c27" } },
    { scope: ["string", "markup.inline.raw"], settings: { foreground: "#3d9a57" } },
    {
      scope: ["constant.numeric", "constant.language", "support.constant", "entity.name.function"],
      settings: { foreground: "#3b7dd8" },
    },
    { scope: ["variable", "variable.other"], settings: { foreground: "#d1383d" } },
    {
      scope: ["variable.other.property", "support.type.property-name", "keyword.operator"],
      settings: { foreground: "#318795" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#b0851f" },
    },
  ],
};

const dark = {
  name: "opencode-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#0a0a0a",
    "editor.foreground": "#eeeeee",
    "editor.selectionBackground": "#fab28338",
    "editor.lineHighlightBackground": "#141414",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#808080" } },
    { scope: ["keyword", "storage", "entity.name.tag"], settings: { foreground: "#9d7cd8" } },
    { scope: ["string", "markup.inline.raw"], settings: { foreground: "#7fd88f" } },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#f5a742" },
    },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#fab283" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#e06c75" } },
    {
      scope: ["variable.other.property", "support.type.property-name", "keyword.operator"],
      settings: { foreground: "#56b6c2" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#e5c07b" },
    },
  ],
};

export const opencodeCodeThemes = { light, dark };
