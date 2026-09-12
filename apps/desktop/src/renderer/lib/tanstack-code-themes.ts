const light = {
  name: "tanstack-light",
  type: "light" as const,
  colors: {
    "editor.background": "#faf8f2",
    "editor.foreground": "#111111",
    "editor.selectionBackground": "#3aa3c438",
    "editor.lineHighlightBackground": "#eeebd466",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#756c5b" } },
    {
      scope: ["keyword", "storage", "entity.name.tag"],
      settings: { foreground: "#541f5d" },
    },
    { scope: ["string", "markup.inline.raw"], settings: { foreground: "#1d4226" } },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#d3481b" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#003e53" },
    },
    { scope: ["variable", "variable.other"], settings: { foreground: "#5f1a06" } },
    {
      scope: ["variable.other.property", "support.type.property-name", "keyword.operator"],
      settings: { foreground: "#3e3529" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#624a00" },
    },
  ],
};

const dark = {
  name: "tanstack-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#111111",
    "editor.foreground": "#ffffff",
    "editor.selectionBackground": "#61adbf38",
    "editor.lineHighlightBackground": "#1b1b1b",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#aea691" } },
    {
      scope: ["keyword", "storage", "entity.name.tag"],
      settings: { foreground: "#c56dcf" },
    },
    { scope: ["string", "markup.inline.raw"], settings: { foreground: "#69bc75" } },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#f4d648" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#61adbf" },
    },
    { scope: ["variable", "variable.other"], settings: { foreground: "#edaa8d" } },
    {
      scope: ["variable.other.property", "support.type.property-name", "keyword.operator"],
      settings: { foreground: "#9cd5e2" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#fae884" },
    },
  ],
};

export const tanstackCodeThemes = { light, dark };
