import { describe, expect, it } from "vitest";
import { findTerminalFileLinks } from "./terminal-file-links";

const texts = (line: string) => findTerminalFileLinks(line).map((link) => link.text);

describe("findTerminalFileLinks", () => {
  it("finds compiler and test locations with columns", () => {
    const line = "src/renderer/lib/thread.tsx:120:4 - error TS2322";
    expect(findTerminalFileLinks(line)).toEqual([
      {
        start: 0,
        end: 32,
        text: "src/renderer/lib/thread.tsx:120:4",
        reference: { path: "src/renderer/lib/thread.tsx", line: 120, column: 4 },
      },
    ]);
  });

  it("finds rooted, home and dot-relative paths, trimming sentence punctuation", () => {
    expect(texts("wrote /tmp/out/report.html, then ./scripts/build.ts.")).toEqual([
      "/tmp/out/report.html",
      "./scripts/build.ts",
    ]);
    // `~` is the server's home, linked only when that home is known (a local server).
    expect(texts("see ~/notes/todo.md")).toEqual([]);
    expect(
      findTerminalFileLinks("see ~/notes/todo.md", { allowHome: true }).map((link) => link.text),
    ).toEqual(["~/notes/todo.md"]);
  });

  it("keeps route groups, params and pnpm store names in one path", () => {
    expect(texts("app/(auth)/[id]/page.tsx changed")).toEqual(["app/(auth)/[id]/page.tsx"]);
    expect(texts("node_modules/.pnpm/react@19.1.0/node_modules/react/index.js")).toEqual([
      "node_modules/.pnpm/react@19.1.0/node_modules/react/index.js",
    ]);
  });

  it("ignores URLs, bare words, globs and shortened paths", () => {
    expect(texts("open https://example.com/docs/page.html")).toEqual([]);
    expect(texts("version 1.2.3 of thread.tsx")).toEqual([]);
    expect(texts("src/**/*.ts")).toEqual([]);
    expect(texts("src/.../main.ts")).toEqual([]);
  });

  it.each([
    ["main.c:1:25: error: expected ';'", "main.c:1:25", { path: "main.c", line: 1, column: 25 }],
    ["page.test.tsx:5:3", "page.test.tsx:5:3", { path: "page.test.tsx", line: 5, column: 3 }],
    [
      "+page.svelte:12:4 warning",
      "+page.svelte:12:4",
      { path: "+page.svelte", line: 12, column: 4 },
    ],
    [
      "app.ts(12,5): error TS2322: Type 'string' is not assignable",
      "app.ts(12,5)",
      { path: "app.ts", line: 12, column: 5 },
    ],
    [
      "src/app.ts(3,1): warning TS6133: 'x' is declared",
      "src/app.ts(3,1)",
      { path: "src/app.ts", line: 3, column: 1 },
    ],
  ])("links a compiler location in %j", (line, text, reference) => {
    expect(findTerminalFileLinks(line)).toEqual([
      { start: line.indexOf(text), end: line.indexOf(text) + text.length - 1, text, reference },
    ]);
  });

  it.each([
    "see README.md, Node.js v22 on 127.0.0.1:3000",
    "README.md(42,7): see details",
    "main.cs(42,7): error CS1002: expected semicolon",
    "Connecting to api.example.com:443...",
    "dial tcp: lookup db.internal:5432: no such host",
    "redis.local:6379> PING",
    "postgres@db.internal:5432",
    "started at 12:30:45, finished 13:02",
    "upgraded react 18.3.1 -> 19.1.0:1:2",
    "listening on http://localhost:5173/app.ts:1:2",
    "open https://example.com/view?file=app.ts:1:2",
    "a.ts:12",
  ])("leaves %j as text", (line) => {
    expect(texts(line)).toEqual([]);
  });
});
