/**
 * Opt-in streaming Markdown benchmark. Run from apps/desktop:
 *   PALOT_MARKDOWN_BENCH=1 vp test run src/renderer/components/markdown-streaming.bench.test.tsx
 * Set PALOT_MARKDOWN_BENCH_CORPUS=plain|html to run one corpus, and
 * PALOT_MARKDOWN_BENCH_OUT=<file> to append one JSON line per run.
 */
import { appendFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./markdown-content";

const timing = vi.hoisted(() => ({ parse: 0 }));

vi.mock("@tanstack/markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/markdown")>();
  return {
    ...original,
    parseMarkdown: (...args: Parameters<typeof original.parseMarkdown>) => {
      const start = performance.now();
      try {
        return original.parseMarkdown(...args);
      } finally {
        timing.parse += performance.now() - start;
      }
    },
  };
});

afterEach(cleanup);

const DELTA = 200;
const TARGET = 67_000;

function plainAnswer(): string {
  const sections: string[] = [];
  for (let index = 0; sections.join("\n\n").length < TARGET; index += 1) {
    sections.push(`## Section ${index}: implementation notes`);
    sections.push(
      `The **renderer** keeps \`settled\` blocks memoized while the [stream](https://example.com/docs/${index}) appends text. It measures each delta and avoids re-rendering earlier paragraphs, so long answers stay responsive even near the end of a turn.`,
    );
    sections.push(
      `- First point about item ${index} with *emphasis*\n- Second point referencing \`packages/core/file-${index}.ts\`\n- Third point with a bare URL https://example.com/path/${index}`,
    );
    sections.push(
      `\`\`\`ts\nexport function example${index}(value: number) {\n  return value * ${index};\n}\n\`\`\``,
    );
    if (index % 3 === 0)
      sections.push(
        `| Column | Value | Notes |\n| --- | ---: | :--- |\n| alpha | ${index} | first |\n| beta | ${index * 2} | second |`,
      );
    sections.push(`1. Ordered step ${index}\n2. Another step\n3. Final step with ~~strike~~`);
  }
  return sections.join("\n\n");
}

const DEPENDABOT = `Bumps the go_modules group with 1 update in the /go-platform directory: [github.com/go-jose/go-jose/v4](https://github.com/go-jose/go-jose).

Updates \`github.com/go-jose/go-jose/v4\` from 4.1.4 to 4.1.6
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/go-jose/go-jose/releases">github.com/go-jose/go-jose/v4's releases</a>.</em></p>
<blockquote>
<h2>v4.1.6</h2>
<h2>Fixed Security Issues</h2>
<ul>
<li>Reject mismatched JWE CEK lengths by <a href="https://github.com/akshithg"><code>@&#8203;akshithg</code></a> in <a href="https://redirect.github.com/go-jose/go-jose/pull/266">go-jose/go-jose#266</a></li>
</ul>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/go-jose/go-jose/commit/a0111f8"><code>a0111f8</code></a> Merge commit from fork</li>
</ul>
</details>
<br />`;

function htmlAnswer(): string {
  const sections: string[] = [];
  for (let index = 0; sections.join("\n\n").length < TARGET; index += 1) {
    sections.push(DEPENDABOT);
    sections.push(
      `<details>\n<summary>Step ${index} <kbd>Ctrl</kbd>+<kbd>K</kbd></summary>\n\nThe **renderer** keeps settled blocks memoized while text streams into an open element. Press <kbd>Esc</kbd> to stop, and H<sub>2</sub>O stays readable.\n\n- First point ${index}\n- Second point with <mark>highlight</mark>\n\n</details>`,
    );
    sections.push(
      `| Key | Action |\n| --- | --- |\n| <kbd>J</kbd> | Next<br>file |\n| <kbd>K</kbd> | Previous<br>file |`,
    );
  }
  return sections.join("\n\n");
}

function median(values: number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function bench(name: string, source: string) {
  timing.parse = 0;
  const view = render(<MarkdownContent value="" streaming />);
  const durations: number[] = [];
  const started = performance.now();
  for (let end = DELTA; end < source.length + DELTA; end += DELTA) {
    const value = source.slice(0, end);
    const deltaStart = performance.now();
    act(() => view.rerender(<MarkdownContent value={value} streaming />));
    durations.push(performance.now() - deltaStart);
  }
  const total = performance.now() - started;
  const tail = durations.slice(-50);
  const result = {
    name,
    bytes: source.length,
    deltas: durations.length,
    totalMs: Math.round(total),
    parseMs: Math.round(timing.parse),
    tailMedianMs: Number(median(tail).toFixed(1)),
    tailMaxMs: Number(Math.max(...tail).toFixed(1)),
    detailsElements: view.container.querySelectorAll("details").length,
    load: cpus().length ? loadavg().map((value) => Number(value.toFixed(2))) : [],
  };
  const output = process.env.PALOT_MARKDOWN_BENCH_OUT;
  if (output) appendFileSync(output, `${JSON.stringify(result)}\n`);
  else console.info(`[markdown-bench] ${JSON.stringify(result)}`);
  view.unmount();
  return result;
}

const corpus = process.env.PALOT_MARKDOWN_BENCH_CORPUS;

describe.skipIf(!process.env.PALOT_MARKDOWN_BENCH)("streaming Markdown benchmark", () => {
  it.skipIf(corpus === "html")(
    "streams an HTML-free answer",
    () => {
      expect(bench("plain", plainAnswer()).deltas).toBeGreaterThan(300);
    },
    300_000,
  );
  it.skipIf(corpus === "plain")(
    "streams an HTML-heavy answer",
    () => {
      expect(bench("html", htmlAnswer()).deltas).toBeGreaterThan(300);
    },
    300_000,
  );
});
