/** Built-in syntax data. See README.md for maintenance guidance. */
import type { ThemeRegistration } from "shiki";

export const builtinSyntaxThemes = {
  "absolutely-dark": {
    bg: "#2d2d2b",
    colors: {
      "activityBar.activeBorder": "#cc7d5e",
      "activityBar.background": "#373735",
      "activityBarBadge.background": "#cc7d5e",
      "button.background": "#cc7d5e",
      "editor.background": "#2d2d2b",
      "editor.foreground": "#f9f9f7",
      "editorCursor.foreground": "#cc7d5e",
      "editorGroupHeader.tabsBackground": "#373735",
      focusBorder: "#cc7d5e",
      foreground: "#f9f9f7",
      "panel.background": "#373735",
      "sideBar.background": "#373735",
      "sideBar.foreground": "#f9f9f7",
      "sideBarTitle.foreground": "#f9f9f7",
      "textLink.foreground": "#cc7d5e",
    },
    fg: "#f9f9f7",
    name: "absolutely-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#b2b2b0",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#00c853",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#ff5f38",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#ff5f38",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#d28e73",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#f9f9f7",
        },
      },
    ],
    type: "dark",
  },
  "absolutely-light": {
    bg: "#f9f9f7",
    colors: {
      "activityBar.activeBorder": "#cc7d5e",
      "activityBar.background": "#f4f4f2",
      "activityBarBadge.background": "#cc7d5e",
      "button.background": "#cc7d5e",
      "editor.background": "#f9f9f7",
      "editor.foreground": "#2d2d2b",
      "editorCursor.foreground": "#cc7d5e",
      "editorGroupHeader.tabsBackground": "#f4f4f2",
      focusBorder: "#cc7d5e",
      foreground: "#2d2d2b",
      "panel.background": "#f4f4f2",
      "sideBar.background": "#f4f4f2",
      "sideBar.foreground": "#2d2d2b",
      "sideBarTitle.foreground": "#2d2d2b",
      "textLink.foreground": "#cc7d5e",
    },
    fg: "#2d2d2b",
    name: "absolutely-light",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#939391",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#00c853",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#ff5f38",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#ff5f38",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#bc7559",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#2d2d2b",
        },
      },
    ],
    type: "light",
  },
  "codex-dark": {
    name: "codex-dark",
    type: "dark",
    colors: {
      "editor.background": "#111111",
      "editor.foreground": "#fcfcfc",
      foreground: "#fcfcfc",
      focusBorder: "#0169cc",
      "editorCursor.foreground": "#0169cc",
      "sideBar.background": "#131313",
      "sideBar.foreground": "#8f8f8f",
      "sideBarTitle.foreground": "#fcfcfc",
      "activityBar.background": "#131313",
      "activityBar.activeBorder": "#0169cc",
      "activityBarBadge.background": "#0169cc",
      "editorGroupHeader.tabsBackground": "#131313",
      "panel.background": "#131313",
      "button.background": "#0169cc",
      "textLink.foreground": "#0169cc",
      "gitDecoration.addedResourceForeground": "#00a240",
      "gitDecoration.deletedResourceForeground": "#e02e2a",
      "gitDecoration.untrackedResourceForeground": "#00a240",
      "terminal.ansiRed": "#F67576",
      "terminal.ansiGreen": "#85df7b",
      "terminal.ansiMagenta": "#B06DFF",
      "terminal.ansiBrightRed": "#F44A4C",
      "terminal.ansiBrightGreen": "#59d24e",
      "terminal.ansiBrightMagenta": "#9840FF",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "comment markup.link",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: ["punctuation.definition.string.begin", "punctuation.definition.string.end"],
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "constant",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "punctuation.definition.constant",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "constant.language",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "variable.other.constant",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.control",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "token.storage",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "keyword.operator.new",
          "keyword.operator.expression.instanceof",
          "keyword.operator.expression.typeof",
          "keyword.operator.expression.void",
          "keyword.operator.expression.delete",
          "keyword.operator.expression.in",
          "keyword.operator.expression.of",
          "keyword.operator.expression.keyof",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.operator.delete",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["variable", "identifier", "meta.definition.variable"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "variable.other.readwrite",
          "meta.object-literal.key",
          "support.variable.property",
          "support.variable.object.process",
          "support.variable.object.node",
        ],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "variable.language",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "variable.parameter.function",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "function.parameter",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "variable.parameter",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "variable.parameter.function.language.python",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "variable.parameter.function.python",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.function",
          "meta.function-call",
          "meta.require",
          "support.function.any-method",
          "variable.function",
        ],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "keyword.other.special-method",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "entity.name.function",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "support.function.console",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: ["support.type", "entity.name.type", "entity.name.class", "storage.type"],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: ["support.class", "entity.name.type.class"],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: ["entity.name.class", "variable.other.class.js", "variable.other.class.ts"],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "entity.name.class.identifier.namespace.type",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "entity.name.type.namespace",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "entity.other.inherited-class",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "entity.name.namespace",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "keyword.operator",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["keyword.operator.logical", "keyword.operator.bitwise", "keyword.operator.channel"],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: [
          "keyword.operator.arithmetic",
          "keyword.operator.comparison",
          "keyword.operator.relational",
          "keyword.operator.increment",
          "keyword.operator.decrement",
        ],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "keyword.operator.assignment",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "keyword.operator.assignment.compound",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.compound.js",
          "keyword.operator.assignment.compound.ts",
        ],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "keyword.operator.ternary",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.operator.optional",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "punctuation",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "punctuation.separator.delimiter",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "punctuation.separator.key-value",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "punctuation.terminator",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "meta.brace",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "meta.brace.square",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "meta.brace.round",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "function.brace",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["punctuation.definition.parameters", "punctuation.definition.typeparameters"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["punctuation.definition.block", "punctuation.definition.tag"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["meta.tag.tsx", "meta.tag.jsx", "meta.tag.js", "meta.tag.ts"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "keyword.operator.expression.import",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "keyword.operator.module",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "support.type.object.console",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["support.module.node", "support.type.object.module", "entity.name.type.module"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "support.constant.math",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "support.constant.property.math",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "support.constant.json",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "support.type.object.dom",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: ["support.variable.dom", "support.variable.property.dom"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "support.variable.property.process",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "meta.property.object",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "variable.parameter.function.js",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["keyword.other.template.begin", "keyword.other.template.end"],
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: ["keyword.other.substitution.begin", "keyword.other.substitution.end"],
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: [
          "punctuation.definition.template-expression.begin",
          "punctuation.definition.template-expression.end",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "meta.template.expression",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "punctuation.section.embedded",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "variable.interpolation",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["punctuation.section.embedded.begin", "punctuation.section.embedded.end"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "punctuation.quasi.element",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "support.type.primitive.ts",
          "support.type.builtin.ts",
          "support.type.primitive.tsx",
          "support.type.builtin.tsx",
        ],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "support.type.type.flowtype",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "support.type.primitive",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "support.variable.magic.python",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "variable.parameter.function.language.special.self.python",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "punctuation.separator.period.python",
          "punctuation.separator.element.python",
          "punctuation.parenthesis.begin.python",
          "punctuation.parenthesis.end.python",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: [
          "punctuation.definition.arguments.begin.python",
          "punctuation.definition.arguments.end.python",
          "punctuation.separator.arguments.python",
          "punctuation.definition.list.begin.python",
          "punctuation.definition.list.end.python",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "support.type.python",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "keyword.operator.logical.python",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "meta.function-call.generic.python",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "constant.character.format.placeholder.other.python",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "meta.function.decorator.python",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: ["support.token.decorator.python", "meta.function.decorator.identifier.python"],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "storage.modifier.lifetime.rust",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "support.function.std.rust",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "entity.name.lifetime.rust",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "variable.language.rust",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.operator.misc.rust",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "keyword.operator.sigil.rust",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "support.constant.core.rust",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["meta.function.c", "meta.function.cpp"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.bracket.curly.cpp",
          "punctuation.section.block.end.bracket.curly.cpp",
          "punctuation.terminator.statement.c",
          "punctuation.section.block.begin.bracket.curly.c",
          "punctuation.section.block.end.bracket.curly.c",
          "punctuation.section.parens.begin.bracket.round.c",
          "punctuation.section.parens.end.bracket.round.c",
          "punctuation.section.parameters.begin.bracket.round.c",
          "punctuation.section.parameters.end.bracket.round.c",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.c",
          "keyword.operator.comparison.c",
          "keyword.operator.c",
          "keyword.operator.increment.c",
          "keyword.operator.decrement.c",
          "keyword.operator.bitwise.shift.c",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.cpp",
          "keyword.operator.comparison.cpp",
          "keyword.operator.cpp",
          "keyword.operator.increment.cpp",
          "keyword.operator.decrement.cpp",
          "keyword.operator.bitwise.shift.cpp",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["punctuation.separator.c", "punctuation.separator.cpp"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["support.type.posix-reserved.c", "support.type.posix-reserved.cpp"],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: ["keyword.operator.sizeof.c", "keyword.operator.sizeof.cpp"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "variable.c",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["storage.type.annotation.java", "storage.type.object.array.java"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "source.java",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.java",
          "punctuation.section.block.end.java",
          "punctuation.definition.method-parameters.begin.java",
          "punctuation.definition.method-parameters.end.java",
          "meta.method.identifier.java",
          "punctuation.section.method.begin.java",
          "punctuation.section.method.end.java",
          "punctuation.terminator.java",
          "punctuation.section.class.begin.java",
          "punctuation.section.class.end.java",
          "punctuation.section.inner-class.begin.java",
          "punctuation.section.inner-class.end.java",
          "meta.method-call.java",
          "punctuation.section.class.begin.bracket.curly.java",
          "punctuation.section.class.end.bracket.curly.java",
          "punctuation.section.method.begin.bracket.curly.java",
          "punctuation.section.method.end.bracket.curly.java",
          "punctuation.separator.period.java",
          "punctuation.bracket.angle.java",
          "punctuation.definition.annotation.java",
          "meta.method.body.java",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "meta.method.java",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: ["storage.modifier.import.java", "storage.type.java", "storage.type.generic.java"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "keyword.operator.instanceof.java",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "meta.definition.variable.name.java",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "token.variable.parameter.java",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "import.storage.java",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "token.package.keyword",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "token.package",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "token.storage.type.java",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "keyword.operator.assignment.go",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["keyword.operator.arithmetic.go", "keyword.operator.address.go"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "entity.name.package.go",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "support.other.namespace.use.php",
          "support.other.namespace.use-as.php",
          "support.other.namespace.php",
          "entity.other.alias.php",
          "meta.interface.php",
        ],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "keyword.operator.error-control.php",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.operator.type.php",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["punctuation.section.array.begin.php", "punctuation.section.array.end.php"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: [
          "storage.type.php",
          "meta.other.type.phpdoc.php",
          "keyword.other.type.php",
          "keyword.other.array.phpdoc.php",
        ],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "meta.function-call.php",
          "meta.function-call.object.php",
          "meta.function-call.static.php",
        ],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: [
          "punctuation.definition.parameters.begin.bracket.round.php",
          "punctuation.definition.parameters.end.bracket.round.php",
          "punctuation.separator.delimiter.php",
          "punctuation.section.scope.begin.php",
          "punctuation.section.scope.end.php",
          "punctuation.terminator.expression.php",
          "punctuation.definition.arguments.begin.bracket.round.php",
          "punctuation.definition.arguments.end.bracket.round.php",
          "punctuation.definition.storage-type.begin.bracket.round.php",
          "punctuation.definition.storage-type.end.bracket.round.php",
          "punctuation.definition.array.begin.bracket.round.php",
          "punctuation.definition.array.end.bracket.round.php",
          "punctuation.definition.begin.bracket.round.php",
          "punctuation.definition.end.bracket.round.php",
          "punctuation.definition.begin.bracket.curly.php",
          "punctuation.definition.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.start.bracket.curly.php",
          "punctuation.definition.section.switch-block.begin.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: [
          "support.constant.ext.php",
          "support.constant.std.php",
          "support.constant.core.php",
          "support.constant.parser-token.php",
        ],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["entity.name.goto-label.php", "support.other.php"],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: [
          "keyword.operator.logical.php",
          "keyword.operator.bitwise.php",
          "keyword.operator.arithmetic.php",
        ],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "keyword.operator.regexp.php",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.operator.comparison.php",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: ["keyword.operator.heredoc.php", "keyword.operator.nowdoc.php"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "variable.other.class.php",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "invalid.illegal.non-null-typehinted.php",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "variable.other.generic-type.haskell",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "storage.type.haskell",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "storage.type.cs",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "entity.name.variable.local.cs",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "entity.name.label.cs",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "entity.name.scope-resolution.function.call",
          "entity.name.scope-resolution.function.definition",
        ],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "punctuation.definition.delayed.unison",
          "punctuation.definition.list.begin.unison",
          "punctuation.definition.list.end.unison",
          "punctuation.definition.ability.begin.unison",
          "punctuation.definition.ability.end.unison",
          "punctuation.operator.assignment.as.unison",
          "punctuation.separator.pipe.unison",
          "punctuation.separator.delimiter.unison",
          "punctuation.definition.hash.unison",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "support.constant.edge",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "support.type.prelude.elm",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "support.constant.elm",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "entity.global.clojure",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "meta.symbol.clojure",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "constant.keyword.clojure",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: ["meta.arguments.coffee", "variable.parameter.function.coffee"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "storage.modifier.import.groovy",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "meta.method.groovy",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "meta.definition.variable.name.groovy",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "meta.definition.class.inherited.classes.groovy",
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: "support.variable.semantic.hlsl",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "support.type.texture.hlsl",
          "support.type.sampler.hlsl",
          "support.type.object.hlsl",
          "support.type.object.rw.hlsl",
          "support.type.fx.hlsl",
          "support.type.object.hlsl",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["text.variable", "text.bracketed"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["support.type.swift", "support.type.vb.asp"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "meta.scope.prerequisites.makefile",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "source.makefile",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "source.ini",
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: "constant.language.symbol.ruby",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: ["function.parameter.ruby", "function.parameter.cs"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "constant.language.symbol.elixir",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html entity.name.tag.laravel-blade",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html support.constant.laravel-blade",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "entity.name.function.xi",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "entity.name.class.xi",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "constant.character.character-class.regexp.xi",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "constant.regexp.xi",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.control.xi",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "invalid.xi",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "beginning.punctuation.definition.quote.markdown.xi",
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown.xi",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "constant.character.xi",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "accent.xi",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "wikiword.xi",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "constant.other.color.rgb-value.xi",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "punctuation.definition.tag.xi",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["support.constant.property-value.scss", "support.constant.property-value.css"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["keyword.operator.css", "keyword.operator.scss", "keyword.operator.less"],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: [
          "support.constant.color.w3c-standard-color-name.css",
          "support.constant.color.w3c-standard-color-name.scss",
        ],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "punctuation.separator.list.comma.css",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "support.type.vendored.property-name.css",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "support.type.property-name.css",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "support.type.property-name",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "support.constant.property-value",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "support.constant.font-name",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "entity.other.attribute-name.class.css",
        settings: {
          foreground: "#6DCBF4",
          fontStyle: "normal",
        },
      },
      {
        scope: "entity.other.attribute-name.id",
        settings: {
          foreground: "#B06DFF",
          fontStyle: "normal",
        },
      },
      {
        scope: [
          "entity.other.attribute-name.pseudo-element",
          "entity.other.attribute-name.pseudo-class",
        ],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "meta.selector",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "selector.sass",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "rgb-value",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "inline-color-decoration rgb-value",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "less rgb-value",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "control.elements",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "keyword.operator.less",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "entity.name.tag",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "entity.other.attribute-name",
        settings: {
          foreground: "#6DCBF4",
          fontStyle: "normal",
        },
      },
      {
        scope: "constant.character.entity",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "meta.tag",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "invalid.illegal.bad-ampersand.html",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "markup.heading",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["markup.heading punctuation.definition.heading", "entity.name.section"],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "entity.name.section.markdown",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "punctuation.definition.heading.markdown",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "markup.heading.setext",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["markup.heading.setext.1.markdown", "markup.heading.setext.2.markdown"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["markup.bold", "todo.bold"],
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "punctuation.definition.bold",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "punctuation.definition.bold.markdown",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: ["markup.italic", "punctuation.definition.italic", "todo.emphasis"],
        settings: {
          foreground: "#F67576",
          fontStyle: "italic",
        },
      },
      {
        scope: "emphasis md",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "markup.italic.markdown",
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: ["markup.underline.link.markdown", "markup.underline.link.image.markdown"],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["string.other.link.title.markdown", "string.other.link.description.markdown"],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "punctuation.definition.metadata.markdown",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: ["markup.inline.raw.markdown", "markup.inline.raw.string.markdown"],
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "punctuation.definition.list.markdown",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "punctuation.definition.string.begin.markdown",
          "punctuation.definition.string.end.markdown",
        ],
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "markup.quote.markdown",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "keyword.other.unit",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "markup.changed.diff",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: [
          "meta.diff.header.from-file",
          "meta.diff.header.to-file",
          "punctuation.definition.from-file.diff",
          "punctuation.definition.to-file.diff",
        ],
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "markup.inserted.diff",
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: "markup.deleted.diff",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "string.regexp",
        settings: {
          foreground: "#3D8DFF",
        },
      },
      {
        scope: "constant.other.character-class.regexp",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "keyword.operator.quantifier.regexp",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "constant.character.escape",
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "source.json meta.structure.dictionary.json > string.quoted.json",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope:
          "source.json meta.structure.dictionary.json > string.quoted.json > punctuation.string",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json",
          "source.json meta.structure.array.json > value.json > string.quoted.json",
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json > punctuation",
          "source.json meta.structure.array.json > value.json > string.quoted.json > punctuation",
        ],
        settings: {
          foreground: "#85df7b",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > constant.language.json",
          "source.json meta.structure.array.json > constant.language.json",
        ],
        settings: {
          foreground: "#6DCBF4",
        },
      },
      {
        scope: "support.type.property-name.json",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "support.type.property-name.json punctuation",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "punctuation.definition.block.sequence.item.yaml",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "block.scope.end",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "block.scope.begin",
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "#B06DFF",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "#FA994C",
        },
      },
      {
        scope: "token.error-token",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "#F67576",
        },
      },
      {
        scope: "invalid.illegal",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.broken",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.deprecated",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.unimplemented",
        settings: {
          foreground: "#ffffff",
        },
      },
    ],
    semanticTokenColors: {
      comment: "#999999",
      string: "#85df7b",
      number: "#6DCBF4",
      regexp: "#3D8DFF",
      keyword: "#F67576",
      variable: "#FA994C",
      parameter: "#999999",
      property: "#FA994C",
      function: "#B06DFF",
      method: "#B06DFF",
      type: "#B06DFF",
      class: "#B06DFF",
      namespace: "#FA994C",
      enumMember: "#6DCBF4",
      "variable.constant": "#FA994C",
      "variable.defaultLibrary": "#FA994C",
    },
  },
  "codex-light": {
    name: "codex-light",
    type: "light",
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#0d0d0d",
      foreground: "#0d0d0d",
      focusBorder: "#0169cc",
      "editorCursor.foreground": "#0169cc",
      "sideBar.background": "#fcfcfc",
      "sideBar.foreground": "#212121",
      "sideBarTitle.foreground": "#0d0d0d",
      "activityBar.background": "#fcfcfc",
      "activityBar.activeBorder": "#0169cc",
      "activityBarBadge.background": "#0169cc",
      "editorGroupHeader.tabsBackground": "#fcfcfc",
      "panel.background": "#fcfcfc",
      "button.background": "#0169cc",
      "textLink.foreground": "#0169cc",
      "gitDecoration.addedResourceForeground": "#00a240",
      "gitDecoration.deletedResourceForeground": "#e02e2a",
      "gitDecoration.untrackedResourceForeground": "#00a240",
      "terminal.ansiRed": "#D53538",
      "terminal.ansiGreen": "#008809",
      "terminal.ansiMagenta": "#751ED9",
      "terminal.ansiBrightRed": "#F44A4C",
      "terminal.ansiBrightGreen": "#59d24e",
      "terminal.ansiBrightMagenta": "#9840FF",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "comment markup.link",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: ["punctuation.definition.string.begin", "punctuation.definition.string.end"],
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "constant",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "punctuation.definition.constant",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "constant.language",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "variable.other.constant",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.control",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "token.storage",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "keyword.operator.new",
          "keyword.operator.expression.instanceof",
          "keyword.operator.expression.typeof",
          "keyword.operator.expression.void",
          "keyword.operator.expression.delete",
          "keyword.operator.expression.in",
          "keyword.operator.expression.of",
          "keyword.operator.expression.keyof",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.operator.delete",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["variable", "identifier", "meta.definition.variable"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "variable.other.readwrite",
          "meta.object-literal.key",
          "support.variable.property",
          "support.variable.object.process",
          "support.variable.object.node",
        ],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "variable.language",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "variable.parameter.function",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "function.parameter",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "variable.parameter",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "variable.parameter.function.language.python",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "variable.parameter.function.python",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.function",
          "meta.function-call",
          "meta.require",
          "support.function.any-method",
          "variable.function",
        ],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "keyword.other.special-method",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "entity.name.function",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "support.function.console",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: ["support.type", "entity.name.type", "entity.name.class", "storage.type"],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: ["support.class", "entity.name.type.class"],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: ["entity.name.class", "variable.other.class.js", "variable.other.class.ts"],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "entity.name.class.identifier.namespace.type",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "entity.name.type.namespace",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "entity.other.inherited-class",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "entity.name.namespace",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "keyword.operator",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["keyword.operator.logical", "keyword.operator.bitwise", "keyword.operator.channel"],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: [
          "keyword.operator.arithmetic",
          "keyword.operator.comparison",
          "keyword.operator.relational",
          "keyword.operator.increment",
          "keyword.operator.decrement",
        ],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "keyword.operator.assignment",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "keyword.operator.assignment.compound",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.compound.js",
          "keyword.operator.assignment.compound.ts",
        ],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "keyword.operator.ternary",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.operator.optional",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "punctuation",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "punctuation.separator.delimiter",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "punctuation.separator.key-value",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "punctuation.terminator",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "meta.brace",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "meta.brace.square",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "meta.brace.round",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "function.brace",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["punctuation.definition.parameters", "punctuation.definition.typeparameters"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["punctuation.definition.block", "punctuation.definition.tag"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["meta.tag.tsx", "meta.tag.jsx", "meta.tag.js", "meta.tag.ts"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "keyword.operator.expression.import",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "keyword.operator.module",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "support.type.object.console",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["support.module.node", "support.type.object.module", "entity.name.type.module"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "support.constant.math",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "support.constant.property.math",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "support.constant.json",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "support.type.object.dom",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: ["support.variable.dom", "support.variable.property.dom"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "support.variable.property.process",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "meta.property.object",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "variable.parameter.function.js",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["keyword.other.template.begin", "keyword.other.template.end"],
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: ["keyword.other.substitution.begin", "keyword.other.substitution.end"],
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: [
          "punctuation.definition.template-expression.begin",
          "punctuation.definition.template-expression.end",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "meta.template.expression",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "punctuation.section.embedded",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "variable.interpolation",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["punctuation.section.embedded.begin", "punctuation.section.embedded.end"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "punctuation.quasi.element",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "support.type.primitive.ts",
          "support.type.builtin.ts",
          "support.type.primitive.tsx",
          "support.type.builtin.tsx",
        ],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "support.type.type.flowtype",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "support.type.primitive",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "support.variable.magic.python",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "variable.parameter.function.language.special.self.python",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "punctuation.separator.period.python",
          "punctuation.separator.element.python",
          "punctuation.parenthesis.begin.python",
          "punctuation.parenthesis.end.python",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: [
          "punctuation.definition.arguments.begin.python",
          "punctuation.definition.arguments.end.python",
          "punctuation.separator.arguments.python",
          "punctuation.definition.list.begin.python",
          "punctuation.definition.list.end.python",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "support.type.python",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "keyword.operator.logical.python",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "meta.function-call.generic.python",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "constant.character.format.placeholder.other.python",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "meta.function.decorator.python",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: ["support.token.decorator.python", "meta.function.decorator.identifier.python"],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "storage.modifier.lifetime.rust",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "support.function.std.rust",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "entity.name.lifetime.rust",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "variable.language.rust",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.operator.misc.rust",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "keyword.operator.sigil.rust",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "support.constant.core.rust",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["meta.function.c", "meta.function.cpp"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.bracket.curly.cpp",
          "punctuation.section.block.end.bracket.curly.cpp",
          "punctuation.terminator.statement.c",
          "punctuation.section.block.begin.bracket.curly.c",
          "punctuation.section.block.end.bracket.curly.c",
          "punctuation.section.parens.begin.bracket.round.c",
          "punctuation.section.parens.end.bracket.round.c",
          "punctuation.section.parameters.begin.bracket.round.c",
          "punctuation.section.parameters.end.bracket.round.c",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.c",
          "keyword.operator.comparison.c",
          "keyword.operator.c",
          "keyword.operator.increment.c",
          "keyword.operator.decrement.c",
          "keyword.operator.bitwise.shift.c",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.cpp",
          "keyword.operator.comparison.cpp",
          "keyword.operator.cpp",
          "keyword.operator.increment.cpp",
          "keyword.operator.decrement.cpp",
          "keyword.operator.bitwise.shift.cpp",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["punctuation.separator.c", "punctuation.separator.cpp"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["support.type.posix-reserved.c", "support.type.posix-reserved.cpp"],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: ["keyword.operator.sizeof.c", "keyword.operator.sizeof.cpp"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "variable.c",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["storage.type.annotation.java", "storage.type.object.array.java"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "source.java",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.java",
          "punctuation.section.block.end.java",
          "punctuation.definition.method-parameters.begin.java",
          "punctuation.definition.method-parameters.end.java",
          "meta.method.identifier.java",
          "punctuation.section.method.begin.java",
          "punctuation.section.method.end.java",
          "punctuation.terminator.java",
          "punctuation.section.class.begin.java",
          "punctuation.section.class.end.java",
          "punctuation.section.inner-class.begin.java",
          "punctuation.section.inner-class.end.java",
          "meta.method-call.java",
          "punctuation.section.class.begin.bracket.curly.java",
          "punctuation.section.class.end.bracket.curly.java",
          "punctuation.section.method.begin.bracket.curly.java",
          "punctuation.section.method.end.bracket.curly.java",
          "punctuation.separator.period.java",
          "punctuation.bracket.angle.java",
          "punctuation.definition.annotation.java",
          "meta.method.body.java",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "meta.method.java",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: ["storage.modifier.import.java", "storage.type.java", "storage.type.generic.java"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "keyword.operator.instanceof.java",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "meta.definition.variable.name.java",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "token.variable.parameter.java",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "import.storage.java",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "token.package.keyword",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "token.package",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "token.storage.type.java",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "keyword.operator.assignment.go",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["keyword.operator.arithmetic.go", "keyword.operator.address.go"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "entity.name.package.go",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "support.other.namespace.use.php",
          "support.other.namespace.use-as.php",
          "support.other.namespace.php",
          "entity.other.alias.php",
          "meta.interface.php",
        ],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "keyword.operator.error-control.php",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.operator.type.php",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["punctuation.section.array.begin.php", "punctuation.section.array.end.php"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: [
          "storage.type.php",
          "meta.other.type.phpdoc.php",
          "keyword.other.type.php",
          "keyword.other.array.phpdoc.php",
        ],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "meta.function-call.php",
          "meta.function-call.object.php",
          "meta.function-call.static.php",
        ],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: [
          "punctuation.definition.parameters.begin.bracket.round.php",
          "punctuation.definition.parameters.end.bracket.round.php",
          "punctuation.separator.delimiter.php",
          "punctuation.section.scope.begin.php",
          "punctuation.section.scope.end.php",
          "punctuation.terminator.expression.php",
          "punctuation.definition.arguments.begin.bracket.round.php",
          "punctuation.definition.arguments.end.bracket.round.php",
          "punctuation.definition.storage-type.begin.bracket.round.php",
          "punctuation.definition.storage-type.end.bracket.round.php",
          "punctuation.definition.array.begin.bracket.round.php",
          "punctuation.definition.array.end.bracket.round.php",
          "punctuation.definition.begin.bracket.round.php",
          "punctuation.definition.end.bracket.round.php",
          "punctuation.definition.begin.bracket.curly.php",
          "punctuation.definition.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.start.bracket.curly.php",
          "punctuation.definition.section.switch-block.begin.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: [
          "support.constant.ext.php",
          "support.constant.std.php",
          "support.constant.core.php",
          "support.constant.parser-token.php",
        ],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["entity.name.goto-label.php", "support.other.php"],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: [
          "keyword.operator.logical.php",
          "keyword.operator.bitwise.php",
          "keyword.operator.arithmetic.php",
        ],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "keyword.operator.regexp.php",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.operator.comparison.php",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: ["keyword.operator.heredoc.php", "keyword.operator.nowdoc.php"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "variable.other.class.php",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "invalid.illegal.non-null-typehinted.php",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "variable.other.generic-type.haskell",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "storage.type.haskell",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "storage.type.cs",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "entity.name.variable.local.cs",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "entity.name.label.cs",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "entity.name.scope-resolution.function.call",
          "entity.name.scope-resolution.function.definition",
        ],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "punctuation.definition.delayed.unison",
          "punctuation.definition.list.begin.unison",
          "punctuation.definition.list.end.unison",
          "punctuation.definition.ability.begin.unison",
          "punctuation.definition.ability.end.unison",
          "punctuation.operator.assignment.as.unison",
          "punctuation.separator.pipe.unison",
          "punctuation.separator.delimiter.unison",
          "punctuation.definition.hash.unison",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "support.constant.edge",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "support.type.prelude.elm",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "support.constant.elm",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "entity.global.clojure",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "meta.symbol.clojure",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "constant.keyword.clojure",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: ["meta.arguments.coffee", "variable.parameter.function.coffee"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "storage.modifier.import.groovy",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "meta.method.groovy",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "meta.definition.variable.name.groovy",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "meta.definition.class.inherited.classes.groovy",
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: "support.variable.semantic.hlsl",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "support.type.texture.hlsl",
          "support.type.sampler.hlsl",
          "support.type.object.hlsl",
          "support.type.object.rw.hlsl",
          "support.type.fx.hlsl",
          "support.type.object.hlsl",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["text.variable", "text.bracketed"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["support.type.swift", "support.type.vb.asp"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "meta.scope.prerequisites.makefile",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "source.makefile",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "source.ini",
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: "constant.language.symbol.ruby",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: ["function.parameter.ruby", "function.parameter.cs"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "constant.language.symbol.elixir",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html entity.name.tag.laravel-blade",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html support.constant.laravel-blade",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "entity.name.function.xi",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "entity.name.class.xi",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "constant.character.character-class.regexp.xi",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "constant.regexp.xi",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.control.xi",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "invalid.xi",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "beginning.punctuation.definition.quote.markdown.xi",
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown.xi",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "constant.character.xi",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "accent.xi",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "wikiword.xi",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "constant.other.color.rgb-value.xi",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "punctuation.definition.tag.xi",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["support.constant.property-value.scss", "support.constant.property-value.css"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["keyword.operator.css", "keyword.operator.scss", "keyword.operator.less"],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: [
          "support.constant.color.w3c-standard-color-name.css",
          "support.constant.color.w3c-standard-color-name.scss",
        ],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "punctuation.separator.list.comma.css",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "support.type.vendored.property-name.css",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "support.type.property-name.css",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "support.type.property-name",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "support.constant.property-value",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "support.constant.font-name",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "entity.other.attribute-name.class.css",
        settings: {
          foreground: "#0071EA",
          fontStyle: "normal",
        },
      },
      {
        scope: "entity.other.attribute-name.id",
        settings: {
          foreground: "#751ED9",
          fontStyle: "normal",
        },
      },
      {
        scope: [
          "entity.other.attribute-name.pseudo-element",
          "entity.other.attribute-name.pseudo-class",
        ],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "meta.selector",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "selector.sass",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "rgb-value",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "inline-color-decoration rgb-value",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "less rgb-value",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "control.elements",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "keyword.operator.less",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "entity.name.tag",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "entity.other.attribute-name",
        settings: {
          foreground: "#0071EA",
          fontStyle: "normal",
        },
      },
      {
        scope: "constant.character.entity",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "meta.tag",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "invalid.illegal.bad-ampersand.html",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "markup.heading",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["markup.heading punctuation.definition.heading", "entity.name.section"],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "entity.name.section.markdown",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "punctuation.definition.heading.markdown",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "markup.heading.setext",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["markup.heading.setext.1.markdown", "markup.heading.setext.2.markdown"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["markup.bold", "todo.bold"],
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "punctuation.definition.bold",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "punctuation.definition.bold.markdown",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: ["markup.italic", "punctuation.definition.italic", "todo.emphasis"],
        settings: {
          foreground: "#D53538",
          fontStyle: "italic",
        },
      },
      {
        scope: "emphasis md",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "markup.italic.markdown",
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: ["markup.underline.link.markdown", "markup.underline.link.image.markdown"],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["string.other.link.title.markdown", "string.other.link.description.markdown"],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "punctuation.definition.metadata.markdown",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: ["markup.inline.raw.markdown", "markup.inline.raw.string.markdown"],
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "punctuation.definition.list.markdown",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "punctuation.definition.string.begin.markdown",
          "punctuation.definition.string.end.markdown",
        ],
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "markup.quote.markdown",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "keyword.other.unit",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "markup.changed.diff",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: [
          "meta.diff.header.from-file",
          "meta.diff.header.to-file",
          "punctuation.definition.from-file.diff",
          "punctuation.definition.to-file.diff",
        ],
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "markup.inserted.diff",
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: "markup.deleted.diff",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "string.regexp",
        settings: {
          foreground: "#001BCB",
        },
      },
      {
        scope: "constant.other.character-class.regexp",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "keyword.operator.quantifier.regexp",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "constant.character.escape",
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "source.json meta.structure.dictionary.json > string.quoted.json",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope:
          "source.json meta.structure.dictionary.json > string.quoted.json > punctuation.string",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json",
          "source.json meta.structure.array.json > value.json > string.quoted.json",
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json > punctuation",
          "source.json meta.structure.array.json > value.json > string.quoted.json > punctuation",
        ],
        settings: {
          foreground: "#008809",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > constant.language.json",
          "source.json meta.structure.array.json > constant.language.json",
        ],
        settings: {
          foreground: "#0071EA",
        },
      },
      {
        scope: "support.type.property-name.json",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "support.type.property-name.json punctuation",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "punctuation.definition.block.sequence.item.yaml",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "block.scope.end",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "block.scope.begin",
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "#751ED9",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "#BD5800",
        },
      },
      {
        scope: "token.error-token",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "#D53538",
        },
      },
      {
        scope: "invalid.illegal",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.broken",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.deprecated",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.unimplemented",
        settings: {
          foreground: "#ffffff",
        },
      },
    ],
    semanticTokenColors: {
      comment: "#666666",
      string: "#008809",
      number: "#0071EA",
      regexp: "#001BCB",
      keyword: "#D53538",
      variable: "#BD5800",
      parameter: "#666666",
      property: "#BD5800",
      function: "#751ED9",
      method: "#751ED9",
      type: "#751ED9",
      class: "#751ED9",
      namespace: "#BD5800",
      enumMember: "#0071EA",
      "variable.constant": "#BD5800",
      "variable.defaultLibrary": "#BD5800",
    },
  },
  "linear-dark": {
    bg: "#17181d",
    colors: {
      "activityBar.activeBorder": "#5e6ad2",
      "activityBar.background": "#080a0f",
      "activityBarBadge.background": "#5e6ad2",
      "button.background": "#5e6ad2",
      "editor.background": "#17181d",
      "editor.foreground": "#e6e9ef",
      "editorCursor.foreground": "#8c97ff",
      "editorGroupHeader.tabsBackground": "#0f1219",
      focusBorder: "#5e6ad2",
      foreground: "#e6e9ef",
      "panel.background": "#0a0c11",
      "sideBar.background": "#080a0f",
      "sideBar.foreground": "#d8dce6",
      "sideBarTitle.foreground": "#f7f8f8",
      "textLink.foreground": "#5e6ad2",
    },
    fg: "#e6e9ef",
    name: "linear-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#636b7b",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol", "entity.other.attribute-name"],
        settings: {
          foreground: "#7ad9c0",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#f5c56a",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#8c97ff",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#73b7ff",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#c2a1ff",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation.definition.tag",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#b5bccb",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#e6e9ef",
        },
      },
    ],
  },
  "linear-light": {
    bg: "#f7f8fa",
    colors: {
      "activityBar.activeBorder": "#5e6ad2",
      "activityBar.background": "#f2f4f8",
      "activityBarBadge.background": "#5e6ad2",
      "button.background": "#5e6ad2",
      "editor.background": "#f7f8fa",
      "editor.foreground": "#2a3140",
      "editorCursor.foreground": "#5e6ad2",
      "editorGroupHeader.tabsBackground": "#f2f4f8",
      focusBorder: "#5e6ad2",
      foreground: "#2a3140",
      "panel.background": "#f2f4f8",
      "sideBar.background": "#f2f4f8",
      "sideBar.foreground": "#4a5263",
      "sideBarTitle.foreground": "#1f2430",
      "textLink.foreground": "#5e6ad2",
    },
    fg: "#2a3140",
    name: "linear-light",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#8a93a6",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol", "entity.other.attribute-name"],
        settings: {
          foreground: "#0f8f83",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#b4831f",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#5e6ad2",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#4380d8",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#8160d8",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation.definition.tag",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#6f7788",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#2a3140",
        },
      },
    ],
    type: "light",
  },
  "lobster-dark": {
    bg: "#111827",
    colors: {
      "activityBar.activeBorder": "#ff5c5c",
      "activityBar.background": "#111827",
      "activityBarBadge.background": "#ff5c5c",
      "button.background": "#ff5c5c",
      "editor.background": "#111827",
      "editor.foreground": "#e4e4e7",
      "editorCursor.foreground": "#ff5c5c",
      "editorGroupHeader.tabsBackground": "#1a1d25",
      focusBorder: "#ff5c5c",
      foreground: "#e4e4e7",
      "panel.background": "#111827",
      "sideBar.background": "#111827",
      "sideBar.foreground": "#e4e4e7",
      "sideBarTitle.foreground": "#fafafa",
      "textLink.foreground": "#ff5c5c",
    },
    fg: "#e4e4e7",
    name: "lobster-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#71717a",
        },
      },
      {
        scope: [
          "string",
          "string.quoted",
          "constant.other.symbol",
          "entity.other.attribute-name",
          "support.constant",
        ],
        settings: {
          foreground: "#14b8a6",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#f59e0b",
        },
      },
      {
        scope: [
          "keyword",
          "keyword.control",
          "storage",
          "storage.type",
          "storage.modifier",
          "invalid",
          "invalid.deprecated",
        ],
        settings: {
          foreground: "#ff5c5c",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#3b82f6",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
          "markup.heading",
        ],
        settings: {
          foreground: "#22c55e",
        },
      },
      {
        scope: ["keyword.operator", "punctuation.accessor", "punctuation.definition.tag"],
        settings: {
          foreground: "#ff7070",
        },
      },
      {
        scope: ["punctuation.separator"],
        settings: {
          foreground: "#a1a1aa",
        },
      },
      {
        scope: ["punctuation", "punctuation.definition.list.begin", "meta.diff.header"],
        settings: {
          foreground: "#71717a",
        },
      },
      {
        scope: [
          "punctuation.bracket",
          "punctuation.definition.string",
          "punctuation.definition.parameters",
          "punctuation.definition.typeparameters",
          "punctuation.section.embedded",
        ],
        settings: {
          foreground: "#a1a1aa",
        },
      },
      {
        scope: [
          "variable",
          "variable.other.readwrite",
          "variable.parameter",
          "variable.other.object",
          "variable.language",
          "variable.language.this",
          "variable.language.self",
          "variable.other.property",
          "meta.object-literal.key",
          "entity.name.label",
          "meta.annotation",
          "markup.bold",
          "markup.italic",
          "markup.raw",
        ],
        settings: {
          foreground: "#e4e4e7",
        },
      },
    ],
    type: "dark",
  },
  "matrix-dark": {
    bg: "#040805",
    colors: {
      "activityBar.activeBorder": "#1eff5a",
      "activityBar.background": "#020402",
      "activityBarBadge.background": "#1eff5a",
      "button.background": "#1eff5a",
      "editor.background": "#040805",
      "editor.foreground": "#b8ffca",
      "editorCursor.foreground": "#1eff5a",
      "editorGroupHeader.tabsBackground": "#020402",
      focusBorder: "#1eff5a",
      foreground: "#b8ffca",
      "panel.background": "#020402",
      "sideBar.background": "#020402",
      "sideBar.foreground": "#9bffb8",
      "sideBarTitle.foreground": "#d8ffe2",
      "textLink.foreground": "#1eff5a",
    },
    fg: "#b8ffca",
    name: "matrix-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#3f8f52",
        },
      },
      {
        scope: [
          "string",
          "string.quoted",
          "constant.other.symbol",
          "entity.other.attribute-name",
          "support.constant",
        ],
        settings: {
          foreground: "#7dff95",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#55ff7d",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#1eff5a",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#3adf6a",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#9bffb8",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation.definition.tag",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#6bd985",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#b8ffca",
        },
      },
    ],
    type: "dark",
  },
  "notion-dark": {
    bg: "#191919",
    colors: {
      "activityBar.activeBorder": "#3183d8",
      "activityBar.background": "#151515",
      "activityBarBadge.background": "#3183d8",
      "button.background": "#3183d8",
      "editor.background": "#191919",
      "editor.foreground": "#d9d9d8",
      "editorCursor.foreground": "#3183d8",
      "editorGroupHeader.tabsBackground": "#151515",
      focusBorder: "#3183d8",
      foreground: "#d9d9d8",
      "panel.background": "#151515",
      "sideBar.background": "#151515",
      "sideBar.foreground": "#d9d9d8",
      "sideBarTitle.foreground": "#f7f7f5",
      "textLink.foreground": "#3183d8",
    },
    fg: "#d9d9d8",
    name: "notion-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#6a9955",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol"],
        settings: {
          foreground: "#ce9178",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean", "regexp", "string.regexp"],
        settings: {
          foreground: "#b5cea8",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#569cd6",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#4ec9b0",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#dcdcaa",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#d4d4d4",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#d9d9d8",
        },
      },
    ],
    type: "dark",
  },
  "notion-light": {
    bg: "#ffffff",
    colors: {
      "activityBar.activeBorder": "#3183d8",
      "activityBar.background": "#f7f6f3",
      "activityBarBadge.background": "#3183d8",
      "button.background": "#3183d8",
      "editor.background": "#ffffff",
      "editor.foreground": "#37352f",
      "editorCursor.foreground": "#3183d8",
      "editorGroupHeader.tabsBackground": "#f7f6f3",
      focusBorder: "#3183d8",
      foreground: "#37352f",
      "panel.background": "#f7f6f3",
      "sideBar.background": "#f7f6f3",
      "sideBar.foreground": "#4f4b45",
      "sideBarTitle.foreground": "#37352f",
      "textLink.foreground": "#3183d8",
    },
    fg: "#37352f",
    name: "notion-light",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#008000",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol"],
        settings: {
          foreground: "#a31515",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean", "regexp", "string.regexp"],
        settings: {
          foreground: "#098658",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#0000ff",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#267f99",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#795e26",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#37352f",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#37352f",
        },
      },
    ],
    type: "light",
  },
  "oscurange-dark": {
    $schema: "vscode://schemas/color-theme",
    name: "oscurange-dark",
    displayName: "Oscurange",
    type: "dark",
    colors: {
      "editor.background": "#0B0B0F",
      "editor.foreground": "#E6E6E6",
      "editorCursor.foreground": "#F9B98C",
    },
    tokenColors: [
      {
        name: "Default foreground",
        scope: ["source", "text"],
        settings: {
          foreground: "#E6E6E6",
        },
      },
      {
        name: "Comments",
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#46474F",
        },
      },
      {
        name: "Constants and enums",
        scope: [
          "constant",
          "constant.language",
          "constant.other",
          "entity.name.enum",
          "support.constant",
        ],
        settings: {
          foreground: "#F9B98C",
        },
      },
      {
        name: "Strings",
        scope: ["string", "string.quoted"],
        settings: {
          foreground: "#E6E6E6",
        },
      },
      {
        name: "Numbers and booleans",
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#F9B98C",
        },
      },
      {
        name: "Functions and constructors",
        scope: [
          "entity.name.function",
          "meta.function-call",
          "support.function",
          "variable.function",
          "entity.name.function.constructor",
        ],
        settings: {
          foreground: "#F9B98C",
        },
      },
      {
        name: "Keywords and operators",
        scope: ["keyword", "keyword.operator", "storage", "storage.type"],
        settings: {
          foreground: "#9099A1",
        },
      },
      {
        name: "Punctuation",
        scope: [
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
          "punctuation.definition.list.begin",
        ],
        settings: {
          foreground: "#5C6974",
        },
      },
      {
        name: "Tags",
        scope: ["entity.name.tag", "meta.tag"],
        settings: {
          foreground: "#F9B98C",
        },
      },
      {
        name: "Attributes",
        scope: ["entity.other.attribute-name"],
        settings: {
          foreground: "#9099A1",
        },
      },
      {
        name: "Properties",
        scope: ["variable.other.property", "meta.object-literal.key"],
        settings: {
          foreground: "#E6E6E6",
        },
      },
      {
        name: "Variables",
        scope: [
          "variable",
          "variable.other.readwrite",
          "variable.parameter",
          "variable.other.object",
        ],
        settings: {
          foreground: "#E6E6E6",
        },
      },
      {
        name: "Special variables",
        scope: ["variable.language", "variable.language.this", "variable.language.self"],
        settings: {
          foreground: "#E6E6E6",
        },
      },
      {
        name: "Built-in types",
        scope: ["support.type", "support.class", "support.type.primitive"],
        settings: {
          foreground: "#9592A4",
        },
      },
      {
        name: "Titles and headings",
        scope: ["entity.name", "markup.heading"],
        settings: {
          foreground: "#FFA16C",
          fontStyle: "bold",
        },
      },
      {
        name: "Links",
        scope: ["markup.underline.link", "string.other.link"],
        settings: {
          foreground: "#479FFA",
          fontStyle: "italic",
        },
      },
      {
        name: "Emphasis",
        scope: ["markup.italic"],
        settings: {
          fontStyle: "italic",
        },
      },
      {
        name: "Strong emphasis",
        scope: ["markup.bold"],
        settings: {
          fontStyle: "bold",
        },
      },
      {
        name: "Regex and escapes",
        scope: ["string.regexp", "constant.character.escape"],
        settings: {
          foreground: "#9592A4",
        },
      },
      {
        name: "Labels and hints",
        scope: ["entity.name.label", "meta.annotation", "markup.raw"],
        settings: {
          foreground: "#E6E6E6",
        },
      },
      {
        name: "Variants and modifiers",
        scope: ["storage.modifier", "keyword.other"],
        settings: {
          foreground: "#F9B98C",
        },
      },
    ],
  },
  "proof-light": {
    bg: "#f5f3ed",
    colors: {
      "activityBar.activeBorder": "#3d755d",
      "activityBar.background": "#efede6",
      "activityBarBadge.background": "#3d755d",
      "button.background": "#3d755d",
      "editor.background": "#f5f3ed",
      "editor.foreground": "#2f312d",
      "editorCursor.foreground": "#3d755d",
      "editorGroupHeader.tabsBackground": "#efede6",
      focusBorder: "#3d755d",
      foreground: "#2f312d",
      "panel.background": "#efede6",
      "sideBar.background": "#efede6",
      "sideBar.foreground": "#4b4d48",
      "sideBarTitle.foreground": "#2f312d",
      "textLink.foreground": "#3d755d",
    },
    fg: "#2f312d",
    name: "proof-light",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#8b877c",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol"],
        settings: {
          foreground: "#3d755d",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean", "regexp", "string.regexp"],
        settings: {
          foreground: "#d3b45b",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#5f6ac2",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#5f6ac2",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#3d755d",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#7a766d",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#2f312d",
        },
      },
    ],
    type: "light",
  },
  "raycast-dark": {
    name: "raycast-dark",
    type: "dark",
    colors: {
      "editor.foreground": "#FFFFFF",
      "editor.background": "#141414",
      "editorGroupHeader.tabsBackground": "#101010",
      "editorGroupHeader.tabsBorder": "#161616",
      "tab.border": "#161616",
      "tab.inactiveBackground": "#101010",
      "tab.activeBackground": "#141414",
      "tab.activeForeground": "#FFFFFF",
      "tab.inactiveForeground": "#FFFFFF80",
      "editor.selectionBackground": "#323232",
      "editor.wordHighlightBackground": "#FFFFFF14",
      "editor.findMatchBackground": "#FF92174d",
      "editor.findMatchHighlightBackground": "#FF921726",
      "editor.lineHighlightBackground": "#202020",
      "editor.lineHighlightBorder": "#202020",
      "editorLineNumber.foreground": "#FFFFFF33",
      "editorLineNumber.activeForeground": "#FFFFFF99",
      "editorCursor.foreground": "#4FA3F8",
      "editorWhitespace.foreground": "#FFFFFF14",
      "editorIndentGuide.background": "#FFFFFF0d",
      "editorIndentGuide.activeBackground": "#FFFFFF1f",
      "editorBracketMatch.background": "#FFFFFF14",
      "editorBracketMatch.border": "#FFFFFF33",
      "editorBracketHighlight.foreground1": "#C4935A",
      "editorBracketHighlight.foreground2": "#9484BD",
      "editorBracketHighlight.foreground3": "#6AAAB5",
      "editorBracketHighlight.foreground4": "#C4935A",
      "editorBracketHighlight.foreground5": "#9484BD",
      "editorBracketHighlight.foreground6": "#6AAAB5",
      "editorBracketHighlight.unexpectedBracket.foreground": "#FF6363",
      "editorGutter.addedBackground": "#59D499",
      "editorGutter.modifiedBackground": "#FFC531",
      "editorGutter.deletedBackground": "#FF6363",
      "editorError.foreground": "#FF6363",
      "editorWarning.foreground": "#FF9217",
      "editorInfo.foreground": "#56C2FF",
      "diffEditor.insertedTextBackground": "#59D49915",
      "diffEditor.removedTextBackground": "#FF636315",
      "diffEditor.insertedLineBackground": "#59D4990D",
      "diffEditor.removedLineBackground": "#FF63630D",
      "sideBar.background": "#101010",
      "sideBar.foreground": "#FFFFFF99",
      "sideBarTitle.foreground": "#FFFFFFcc",
      "statusBar.background": "#141414",
      "statusBar.foreground": "#FFFFFF99",
      "statusBar.debuggingBackground": "#FF6363",
      "statusBar.debuggingForeground": "#FFFFFF",
      "activityBar.background": "#0a0a0a",
      "activityBar.foreground": "#FFFFFFcc",
      "activityBarBadge.background": "#4FA3F8",
      "activityBarBadge.foreground": "#FFFFFF",
      "list.inactiveSelectionBackground": "#FFFFFF14",
      "list.activeSelectionBackground": "#FFFFFF1f",
      "list.activeSelectionForeground": "#FFFFFF",
      "list.hoverBackground": "#FFFFFF14",
      "list.focusBackground": "#181818",
      "list.highlightForeground": "#4FA3F8",
      focusBorder: "#282828",
      "editorWidget.background": "#101010",
      "editorWidget.border": "#FFFFFF14",
      "button.background": "#4FA3F8",
      "button.foreground": "#FFFFFF",
      "dropdown.background": "#101010",
      "dropdown.listBackground": "#101010",
      "input.background": "#151515",
      "input.foreground": "#FFFFFF",
      "input.border": "#FFFFFF1f",
      "input.placeholderForeground": "#FFFFFF66",
      "minimap.background": "#121212",
      "titleBar.activeBackground": "#101010",
      "titleBar.activeForeground": "#FFFFFFcc",
      "titleBar.inactiveBackground": "#101010",
      "titleBar.inactiveForeground": "#FFFFFF66",
      "scrollbarSlider.background": "#FFFFFF0f",
      "scrollbarSlider.hoverBackground": "#FFFFFF1f",
      "scrollbarSlider.activeBackground": "#FFFFFF2e",
      "panel.background": "#141414",
      "panel.border": "#FFFFFF14",
      "panelTitle.activeForeground": "#FFFFFFcc",
      "panelTitle.activeBorder": "#4FA3F8",
      "panelTitle.inactiveForeground": "#FFFFFF66",
      "terminal.background": "#141414",
      "terminal.foreground": "#FFFFFFcc",
      "terminal.ansiRed": "#FF6363",
      "terminal.ansiGreen": "#59D499",
      "terminal.ansiYellow": "#FFC531",
      "terminal.ansiBlue": "#56C2FF",
      "terminal.ansiMagenta": "#CF2F98",
      "terminal.ansiCyan": "#56C2FF",
      "terminal.ansiWhite": "#FFFFFF",
      "terminal.ansiBrightRed": "#FF6363",
      "terminal.ansiBrightGreen": "#59D499",
      "terminal.ansiBrightYellow": "#FFC531",
      "terminal.ansiBrightBlue": "#56C2FF",
      "terminal.ansiBrightMagenta": "#CF2F98",
      "terminal.ansiBrightCyan": "#56C2FF",
      "terminal.ansiBrightWhite": "#FFFFFF",
      "terminal.ansiBlack": "#000000",
      "terminal.ansiBrightBlack": "#FFFFFF66",
      "gitDecoration.addedResourceForeground": "#59D499",
      "gitDecoration.modifiedResourceForeground": "#FFC531",
      "gitDecoration.deletedResourceForeground": "#FF6363",
      "gitDecoration.untrackedResourceForeground": "#59D499",
      "gitDecoration.conflictingResourceForeground": "#FF9217",
      "gitDecoration.ignoredResourceForeground": "#FFFFFF33",
      "breadcrumb.foreground": "#FFFFFF66",
      "breadcrumb.focusForeground": "#FFFFFFcc",
      "widget.shadow": "#00000066",
      "notifications.background": "#101010",
      "notifications.border": "#FFFFFF14",
      "quickInput.background": "#101010",
      "quickInput.foreground": "#FFFFFF",
      "commandCenter.background": "#151515",
      "commandCenter.foreground": "#FFFFFF99",
      "commandCenter.border": "#FFFFFF14",
      "peekView.border": "#4FA3F8",
      "peekViewEditor.background": "#101010",
      "peekViewResult.background": "#101010",
      "peekViewTitle.background": "#101010",
      "editorOverviewRuler.errorForeground": "#FF6363",
      "editorOverviewRuler.warningForeground": "#FF9217",
      "editorOverviewRuler.infoForeground": "#56C2FF",
      "minimap.findMatchHighlight": "#FF921766",
      "minimap.selectionHighlight": "#FFFFFF33",
    },
    tokenColors: [
      {
        scope: [
          "keyword.operator.accessor",
          "meta.group.braces.round.function.arguments",
          "meta.template.expression",
          "markup.fenced_code meta.embedded.block",
        ],
        settings: {
          foreground: "#FFFFFF",
        },
      },
      {
        scope: "emphasis",
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: ["strong", "markup.heading.markdown", "markup.bold.markdown"],
        settings: {
          fontStyle: "bold",
        },
      },
      {
        scope: ["markup.italic.markdown"],
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: "meta.link.inline.markdown",
        settings: {
          fontStyle: "underline",
          foreground: "#4FA3F8",
        },
      },
      {
        scope: [
          "string",
          "markup.fenced_code",
          "markup.inline",
          "string.quoted.docstring.multi.python",
        ],
        settings: {
          foreground: "#FF6363",
        },
      },
      {
        scope: ["comment", "string.quoted.docstring.multi"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.other.placeholder",
          "constant.character.format.placeholder",
          "variable.language.this",
          "variable.other.object",
          "variable.other.class",
          "variable.other.constant",
          "meta.property-name",
          "meta.property-value",
          "support",
        ],
        settings: {
          foreground: "#FFFFFF",
        },
      },
      {
        scope: [
          "keyword",
          "storage.modifier",
          "storage.type",
          "storage.control.clojure",
          "entity.name.function.clojure",
          "entity.name.tag.yaml",
          "support.function.node",
          "support.type.property-name.json",
          "punctuation.separator.key-value",
          "punctuation.definition.template-expression",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: "variable.parameter.function",
        settings: {
          foreground: "#CCCCCC",
          fontStyle: "italic",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.type",
          "entity.other.inherited-class",
          "meta.function-call",
          "meta.instance.constructor",
          "entity.other.attribute-name",
          "entity.name.function",
          "constant.keyword.clojure",
        ],
        settings: {
          foreground: "#FF9217",
        },
      },
      {
        scope: [
          "entity.name.tag",
          "support.class.component",
          "string.quoted",
          "string.regexp",
          "string.interpolated",
          "string.template",
          "string.unquoted.plain.out.yaml",
          "keyword.other.template",
        ],
        settings: {
          foreground: "#FF6363",
        },
      },
      {
        scope: [
          "punctuation.definition.arguments",
          "punctuation.definition.dict",
          "punctuation.separator",
          "meta.function-call.arguments",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["markup.underline.link", "punctuation.definition.metadata.markdown"],
        settings: {
          foreground: "#4FA3F8",
        },
      },
      {
        scope: ["beginning.punctuation.definition.list.markdown"],
        settings: {
          foreground: "#FF6363",
        },
      },
      {
        scope: [
          "punctuation.definition.string.begin.markdown",
          "punctuation.definition.string.end.markdown",
          "string.other.link.title.markdown",
          "string.other.link.description.markdown",
        ],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: ["constant.numeric.decimal", "constant.language.boolean", "meta.var.exp.ts"],
        settings: {
          foreground: "#FFFFFF",
        },
      },
      {
        scope: ["support.variable.property"],
        settings: {
          foreground: "#CCCCCC",
        },
      },
      {
        scope: ["markup.inserted"],
        settings: {
          foreground: "#59D499",
        },
      },
      {
        scope: ["markup.deleted"],
        settings: {
          foreground: "#FF6363",
        },
      },
      {
        scope: ["markup.changed"],
        settings: {
          foreground: "#FFC531",
        },
      },
    ],
  },
  "raycast-light": {
    name: "raycast-light",
    type: "light",
    colors: {
      "editor.foreground": "#000000",
      "editor.background": "#FFFFFF",
      "editorGroupHeader.tabsBackground": "#fcfcfc",
      "editorGroupHeader.tabsBorder": "#fefefe",
      "tab.border": "#fefefe",
      "tab.inactiveBackground": "#fcfcfc",
      "tab.activeBackground": "#FFFFFF",
      "tab.activeForeground": "#000000",
      "tab.inactiveForeground": "#00000080",
      "editor.selectionBackground": "#fdfdfd",
      "editor.wordHighlightBackground": "#00000014",
      "editor.findMatchBackground": "#C75D074d",
      "editor.findMatchHighlightBackground": "#C75D0726",
      "editor.lineHighlightBackground": "#fefefe",
      "editor.lineHighlightBorder": "#fefefe",
      "editorLineNumber.foreground": "#00000033",
      "editorLineNumber.activeForeground": "#00000099",
      "editorCursor.foreground": "#138AF2",
      "editorWhitespace.foreground": "#00000014",
      "editorIndentGuide.background": "#0000000d",
      "editorIndentGuide.activeBackground": "#0000001f",
      "editorBracketMatch.background": "#00000014",
      "editorBracketMatch.border": "#00000033",
      "editorBracketHighlight.foreground1": "#8B6D3F",
      "editorBracketHighlight.foreground2": "#6B5BA0",
      "editorBracketHighlight.foreground3": "#4A8490",
      "editorBracketHighlight.foreground4": "#8B6D3F",
      "editorBracketHighlight.foreground5": "#6B5BA0",
      "editorBracketHighlight.foreground6": "#4A8490",
      "editorBracketHighlight.unexpectedBracket.foreground": "#B12424",
      "editorGutter.addedBackground": "#006B4F",
      "editorGutter.modifiedBackground": "#F8A300",
      "editorGutter.deletedBackground": "#B12424",
      "editorError.foreground": "#B12424",
      "editorWarning.foreground": "#C75D07",
      "editorInfo.foreground": "#138AF2",
      "diffEditor.insertedTextBackground": "#006B4F15",
      "diffEditor.removedTextBackground": "#B1242415",
      "diffEditor.insertedLineBackground": "#006B4F0D",
      "diffEditor.removedLineBackground": "#B124240D",
      "sideBar.background": "#fcfcfc",
      "sideBar.foreground": "#00000099",
      "sideBarTitle.foreground": "#000000cc",
      "statusBar.background": "#FFFFFF",
      "statusBar.foreground": "#00000099",
      "statusBar.debuggingBackground": "#B12424",
      "statusBar.debuggingForeground": "#FFFFFF",
      "activityBar.background": "#f9f9f9",
      "activityBar.foreground": "#000000cc",
      "activityBarBadge.background": "#138AF2",
      "activityBarBadge.foreground": "#FFFFFF",
      "list.inactiveSelectionBackground": "#0000000f",
      "list.activeSelectionBackground": "#0000001a",
      "list.activeSelectionForeground": "#000000",
      "list.hoverBackground": "#0000000f",
      "list.focusBackground": "#fefefe",
      "list.highlightForeground": "#138AF2",
      focusBorder: "#fcfcfc",
      "editorWidget.background": "#fcfcfc",
      "editorWidget.border": "#00000014",
      "button.background": "#138AF2",
      "button.foreground": "#FFFFFF",
      "dropdown.background": "#fcfcfc",
      "dropdown.listBackground": "#fcfcfc",
      "input.background": "#ffffff",
      "input.foreground": "#000000",
      "input.border": "#0000001f",
      "input.placeholderForeground": "#00000066",
      "minimap.background": "#fefefe",
      "titleBar.activeBackground": "#fcfcfc",
      "titleBar.activeForeground": "#000000cc",
      "titleBar.inactiveBackground": "#fcfcfc",
      "titleBar.inactiveForeground": "#00000066",
      "scrollbarSlider.background": "#0000000f",
      "scrollbarSlider.hoverBackground": "#0000001f",
      "scrollbarSlider.activeBackground": "#0000002e",
      "panel.background": "#FFFFFF",
      "panel.border": "#00000014",
      "panelTitle.activeForeground": "#000000cc",
      "panelTitle.activeBorder": "#138AF2",
      "panelTitle.inactiveForeground": "#00000066",
      "terminal.background": "#FFFFFF",
      "terminal.foreground": "#000000cc",
      "terminal.ansiRed": "#B12424",
      "terminal.ansiGreen": "#006B4F",
      "terminal.ansiYellow": "#F8A300",
      "terminal.ansiBlue": "#138AF2",
      "terminal.ansiMagenta": "#9A1B6E",
      "terminal.ansiCyan": "#138AF2",
      "terminal.ansiWhite": "#000000",
      "terminal.ansiBrightRed": "#B12424",
      "terminal.ansiBrightGreen": "#006B4F",
      "terminal.ansiBrightYellow": "#F8A300",
      "terminal.ansiBrightBlue": "#138AF2",
      "terminal.ansiBrightMagenta": "#9A1B6E",
      "terminal.ansiBrightCyan": "#138AF2",
      "terminal.ansiBrightWhite": "#000000",
      "terminal.ansiBlack": "#FFFFFF",
      "terminal.ansiBrightBlack": "#00000066",
      "gitDecoration.addedResourceForeground": "#006B4F",
      "gitDecoration.modifiedResourceForeground": "#F8A300",
      "gitDecoration.deletedResourceForeground": "#B12424",
      "gitDecoration.untrackedResourceForeground": "#006B4F",
      "gitDecoration.conflictingResourceForeground": "#C75D07",
      "gitDecoration.ignoredResourceForeground": "#00000033",
      "breadcrumb.foreground": "#00000066",
      "breadcrumb.focusForeground": "#000000cc",
      "widget.shadow": "#00000015",
      "notifications.background": "#fcfcfc",
      "notifications.border": "#00000014",
      "quickInput.background": "#fcfcfc",
      "quickInput.foreground": "#000000",
      "commandCenter.background": "#ffffff",
      "commandCenter.foreground": "#00000099",
      "commandCenter.border": "#00000014",
      "peekView.border": "#138AF2",
      "peekViewEditor.background": "#fcfcfc",
      "peekViewResult.background": "#fcfcfc",
      "peekViewTitle.background": "#fcfcfc",
      "editorOverviewRuler.errorForeground": "#B12424",
      "editorOverviewRuler.warningForeground": "#C75D07",
      "editorOverviewRuler.infoForeground": "#138AF2",
      "minimap.findMatchHighlight": "#C75D0766",
      "minimap.selectionHighlight": "#00000033",
    },
    tokenColors: [
      {
        scope: [
          "keyword.operator.accessor",
          "meta.group.braces.round.function.arguments",
          "meta.template.expression",
          "markup.fenced_code meta.embedded.block",
        ],
        settings: {
          foreground: "#000000",
        },
      },
      {
        scope: "emphasis",
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: ["strong", "markup.heading.markdown", "markup.bold.markdown"],
        settings: {
          fontStyle: "bold",
        },
      },
      {
        scope: ["markup.italic.markdown"],
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: "meta.link.inline.markdown",
        settings: {
          fontStyle: "underline",
          foreground: "#138AF2",
        },
      },
      {
        scope: [
          "string",
          "markup.fenced_code",
          "markup.inline",
          "string.quoted.docstring.multi.python",
        ],
        settings: {
          foreground: "#C03030",
        },
      },
      {
        scope: ["comment", "string.quoted.docstring.multi"],
        settings: {
          foreground: "#999999",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.other.placeholder",
          "constant.character.format.placeholder",
          "variable.language.this",
          "variable.other.object",
          "variable.other.class",
          "variable.other.constant",
          "meta.property-name",
          "meta.property-value",
          "support",
        ],
        settings: {
          foreground: "#000000",
        },
      },
      {
        scope: [
          "keyword",
          "storage.modifier",
          "storage.type",
          "storage.control.clojure",
          "entity.name.function.clojure",
          "entity.name.tag.yaml",
          "support.function.node",
          "support.type.property-name.json",
          "punctuation.separator.key-value",
          "punctuation.definition.template-expression",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: "variable.parameter.function",
        settings: {
          foreground: "#333333",
          fontStyle: "italic",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.type",
          "entity.other.inherited-class",
          "meta.function-call",
          "meta.instance.constructor",
          "entity.other.attribute-name",
          "entity.name.function",
          "constant.keyword.clojure",
        ],
        settings: {
          foreground: "#C75D07",
        },
      },
      {
        scope: [
          "entity.name.tag",
          "support.class.component",
          "string.quoted",
          "string.regexp",
          "string.interpolated",
          "string.template",
          "string.unquoted.plain.out.yaml",
          "keyword.other.template",
        ],
        settings: {
          foreground: "#C75D07",
        },
      },
      {
        scope: ["string.quoted", "string.template", "string.regexp", "string.interpolated"],
        settings: {
          foreground: "#C03030",
        },
      },
      {
        scope: [
          "punctuation.definition.arguments",
          "punctuation.definition.dict",
          "punctuation.separator",
          "meta.function-call.arguments",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["markup.underline.link", "punctuation.definition.metadata.markdown"],
        settings: {
          foreground: "#138AF2",
        },
      },
      {
        scope: ["beginning.punctuation.definition.list.markdown"],
        settings: {
          foreground: "#C03030",
        },
      },
      {
        scope: [
          "punctuation.definition.string.begin.markdown",
          "punctuation.definition.string.end.markdown",
          "string.other.link.title.markdown",
          "string.other.link.description.markdown",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["constant.numeric.decimal", "constant.language.boolean", "meta.var.exp.ts"],
        settings: {
          foreground: "#000000",
        },
      },
      {
        scope: ["support.variable.property"],
        settings: {
          foreground: "#333333",
        },
      },
      {
        scope: ["markup.inserted"],
        settings: {
          foreground: "#006B4F",
        },
      },
      {
        scope: ["markup.deleted"],
        settings: {
          foreground: "#B12424",
        },
      },
      {
        scope: ["markup.changed"],
        settings: {
          foreground: "#F8A300",
        },
      },
    ],
  },
  "sentry-dark": {
    bg: "#2d2935",
    colors: {
      "activityBar.activeBorder": "#7055f6",
      "activityBar.background": "#26222d",
      "activityBarBadge.background": "#7055f6",
      "button.background": "#7055f6",
      "editor.background": "#2d2935",
      "editor.foreground": "#e6dff9",
      "editorCursor.foreground": "#7055f6",
      "editorGroupHeader.tabsBackground": "#26222d",
      focusBorder: "#7055f6",
      foreground: "#e6dff9",
      "panel.background": "#26222d",
      "sideBar.background": "#26222d",
      "sideBar.foreground": "#d5cdee",
      "sideBarTitle.foreground": "#f4f1ff",
      "textLink.foreground": "#7055f6",
    },
    fg: "#e6dff9",
    name: "sentry-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#8d849f",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol", "entity.other.attribute-name"],
        settings: {
          foreground: "#8ee6d7",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#f4c46a",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#7055f6",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#c39bff",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#a58cff",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation.definition.tag",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#c8bedf",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#e6dff9",
        },
      },
    ],
    type: "dark",
  },
  "temple-dark": {
    bg: "#02120c",
    colors: {
      "activityBar.activeBorder": "#e4f222",
      "activityBar.background": "#1d2d0f",
      "activityBarBadge.background": "#e4f222",
      "button.background": "#e4f222",
      "editor.background": "#02120c",
      "editor.foreground": "#c7e6da",
      "editorCursor.foreground": "#e4f222",
      "editorGroupHeader.tabsBackground": "#1d2d0f",
      focusBorder: "#e4f222",
      foreground: "#c7e6da",
      "panel.background": "#1d2d0f",
      "sideBar.background": "#1d2d0f",
      "sideBar.foreground": "#c7e6da",
      "sideBarTitle.foreground": "#c7e6da",
      "textLink.foreground": "#e4f222",
    },
    fg: "#c7e6da",
    name: "temple-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#394d46",
        },
      },
      {
        scope: [
          "string",
          "constant.other.symbol",
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#e4f222",
        },
      },
      {
        scope: [
          "keyword",
          "keyword.control",
          "storage",
          "storage.type",
          "storage.modifier",
          "constant.numeric",
          "constant.language.boolean",
        ],
        settings: {
          foreground: "#e4f222",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#859419",
        },
      },
      {
        scope: ["keyword.operator", "entity.other.attribute-name"],
        settings: {
          foreground: "#788617",
        },
      },
      {
        scope: [
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
          "punctuation.definition.list.begin",
        ],
        settings: {
          foreground: "#4f5e13",
        },
      },
      {
        scope: [
          "variable",
          "variable.other.readwrite",
          "variable.parameter",
          "variable.other.object",
          "variable.language",
          "variable.language.this",
          "variable.language.self",
          "string",
          "string.quoted",
          "variable.other.property",
          "meta.object-literal.key",
          "entity.name.label",
          "meta.annotation",
          "markup.raw",
        ],
        settings: {
          foreground: "#c7e6da",
        },
      },
    ],
    type: "dark",
  },
  "vercel-dark": {
    bg: "#000000",
    colors: {
      "activityBar.activeBorder": "#006efe",
      "activityBar.background": "#000000",
      "activityBarBadge.background": "#006efe",
      "button.background": "#006efe",
      "editor.background": "#000000",
      "editor.foreground": "#ededed",
      "editorCursor.foreground": "#006efe",
      "editorGroupHeader.tabsBackground": "#000000",
      focusBorder: "#006efe",
      foreground: "#ededed",
      "panel.background": "#000000",
      "sideBar.background": "#000000",
      "sideBar.foreground": "#a1a1a1",
      "sideBarTitle.foreground": "#ededed",
      "textLink.foreground": "#006efe",
    },
    fg: "#ededed",
    name: "vercel-dark",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol", "entity.other.attribute-name"],
        settings: {
          foreground: "#00AD3A",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#9540D5",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#006efe",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#52A8FF",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#9540D5",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation.definition.tag",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#a1a1a1",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#ededed",
        },
      },
    ],
  },
  "vercel-light": {
    bg: "#ffffff",
    colors: {
      "activityBar.activeBorder": "#006aff",
      "activityBar.background": "#ffffff",
      "activityBarBadge.background": "#006aff",
      "button.background": "#006aff",
      "editor.background": "#ffffff",
      "editor.foreground": "#171717",
      "editorCursor.foreground": "#006aff",
      "editorGroupHeader.tabsBackground": "#ffffff",
      focusBorder: "#006aff",
      foreground: "#171717",
      "panel.background": "#ffffff",
      "sideBar.background": "#ffffff",
      "sideBar.foreground": "#666666",
      "sideBarTitle.foreground": "#171717",
      "textLink.foreground": "#006aff",
    },
    fg: "#171717",
    name: "vercel-light",
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["string", "string.quoted", "constant.other.symbol", "entity.other.attribute-name"],
        settings: {
          foreground: "#28A948",
        },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.language.boolean",
          "constant.character.escape",
          "regexp",
          "string.regexp",
        ],
        settings: {
          foreground: "#A100F8",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#006aff",
        },
      },
      {
        scope: [
          "entity.name.type",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: {
          foreground: "#0059D1",
        },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.function-call",
        ],
        settings: {
          foreground: "#A100F8",
        },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation.accessor",
          "punctuation.definition.tag",
          "punctuation",
          "punctuation.bracket",
          "punctuation.separator",
        ],
        settings: {
          foreground: "#666666",
        },
      },
      {
        scope: ["variable", "meta.object-literal.key", "meta.object.member", "meta.property-name"],
        settings: {
          foreground: "#171717",
        },
      },
    ],
    type: "light",
  },
  "xcode-dark": {
    name: "xcode-dark",
    type: "dark",
    colors: {
      "editor.background": "#1f1f24",
      "editor.foreground": "#ffffffd9",
      foreground: "#ffffffd9",
      focusBorder: "#5482ff",
      "editorCursor.foreground": "#5482ff",
      "sideBar.background": "#1f1f24",
      "sideBar.foreground": "#ffffffd9",
      "sideBarTitle.foreground": "#ffffffd9",
      "activityBar.background": "#1f1f24",
      "activityBar.activeBorder": "#5482ff",
      "activityBarBadge.background": "#5482ff",
      "editorGroupHeader.tabsBackground": "#1f1f24",
      "panel.background": "#1f1f24",
      "button.background": "#5482ff",
      "textLink.foreground": "#5482ff",
      "editor.lineHighlightBackground": "#23252b",
      "editor.selectionBackground": "#515b70",
      "editorWhitespace.foreground": "#424d5b",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#6c7986",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#fc6a5d",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#fc5fa3",
        },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character.escape"],
        settings: {
          foreground: "#d0bf69",
        },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
        settings: {
          foreground: "#5dd8ff",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.function",
          "meta.function-call",
          "variable.function",
        ],
        settings: {
          foreground: "#67b7a4",
        },
      },
      {
        scope: ["variable", "identifier", "meta.definition.variable", "support.variable.property"],
        settings: {
          foreground: "#67b7a4",
        },
      },
      {
        scope: ["markup.underline.link", "markup.underline.link.markdown"],
        settings: {
          foreground: "#5482ff",
        },
      },
    ],
  },
  "xcode-light": {
    name: "xcode-light",
    type: "light",
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#000000d9",
      foreground: "#000000d9",
      focusBorder: "#0e0eff",
      "editorCursor.foreground": "#0e0eff",
      "sideBar.background": "#ffffff",
      "sideBar.foreground": "#000000d9",
      "sideBarTitle.foreground": "#000000d9",
      "activityBar.background": "#ffffff",
      "activityBar.activeBorder": "#0e0eff",
      "activityBarBadge.background": "#0e0eff",
      "editorGroupHeader.tabsBackground": "#ffffff",
      "panel.background": "#ffffff",
      "button.background": "#0e0eff",
      "textLink.foreground": "#0e0eff",
      "editor.lineHighlightBackground": "#e8f2ff",
      "editor.selectionBackground": "#a4cdff",
      "editorWhitespace.foreground": "#cccccc",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#5d6c79",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#c41a16",
        },
      },
      {
        scope: ["keyword", "keyword.control", "storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#9b2393",
        },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character.escape"],
        settings: {
          foreground: "#1c00cf",
        },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
        settings: {
          foreground: "#0b4f79",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.function",
          "meta.function-call",
          "variable.function",
        ],
        settings: {
          foreground: "#326d74",
        },
      },
      {
        scope: ["variable", "identifier", "meta.definition.variable", "support.variable.property"],
        settings: {
          foreground: "#326d74",
        },
      },
      {
        scope: ["markup.underline.link", "markup.underline.link.markdown"],
        settings: {
          foreground: "#0e0eff",
        },
      },
    ],
  },
} satisfies Record<string, ThemeRegistration>;
