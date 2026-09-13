import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdownReact } from "@tanstack/markdown/react";
import {
  type BlockNode,
  type InlineComponentNode,
  type MarkdownDocument,
  parseMarkdown,
} from "@tanstack/markdown";
import { type ComponentProps, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PalotMarkdown, useMarkdownBlockStreaming } from "./palot-markdown-react";

const OPTIONS = {
  allowHtml: false,
  frontmatter: false,
  headingIds: false,
} as const;

describe("PalotMarkdown", () => {
  it("matches the upstream React renderer when streaming is disabled", () => {
    const source = [
      "# Heading",
      "",
      "Paragraph with **strong**, *emphasis*, ~~strike~~, `inline code`, and [a link](https://example.com).",
      "",
      "> Quoted text",
      "",
      "- [x] Task",
      "- Nested",
      "",
      "| Name | Value |",
      "| --- | ---: |",
      "| One | 1 |",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "---",
    ].join("\n");

    const upstream = renderToStaticMarkup(<>{renderMarkdownReact(source, OPTIONS)}</>);
    const palot = renderToStaticMarkup(<PalotMarkdown {...OPTIONS}>{source}</PalotMarkdown>);

    expect(palot).toBe(upstream);
  });

  it.each([0, 1, 3])("preserves an ordered list starting at %i", (start) => {
    const source = `${start}. First\n${start + 1}. Second`;
    const view = render(<PalotMarkdown {...OPTIONS}>{source}</PalotMarkdown>);

    expect(view.container.querySelector("ol")?.start).toBe(start);
    expect(view.container.innerHTML).toBe(
      renderToStaticMarkup(<>{renderMarkdownReact(source, OPTIONS)}</>),
    );
  });

  it.each<{ name: string; children: BlockNode[] }>([
    { name: "empty", children: [] },
    { name: "code-ending", children: [{ type: "code", value: "example" }] },
    {
      name: "quote-ending",
      children: [
        {
          type: "blockquote",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Note" }] }],
        },
      ],
    },
    {
      name: "paragraph-ending",
      children: [{ type: "paragraph", children: [{ type: "text", value: "Note" }] }],
    },
  ])("retains every backreference in a $name footnote", ({ children }) => {
    const document: MarkdownDocument = {
      type: "root",
      children: [
        { type: "footnotes", items: [{ id: "note", number: 1, referenceCount: 2, children }] },
      ],
    };
    const view = render(<PalotMarkdown {...OPTIONS}>{document}</PalotMarkdown>);

    expect(view.container.innerHTML).toBe(
      renderToStaticMarkup(<>{renderMarkdownReact(document, OPTIONS)}</>),
    );
    view.rerender(
      <PalotMarkdown {...OPTIONS} idPrefix="message">
        {document}
      </PalotMarkdown>,
    );
    const backrefs = view.container.querySelectorAll(
      "li > p:last-child > a[data-footnote-backref]",
    );
    expect(Array.from(backrefs, (link) => link.getAttribute("href"))).toEqual([
      "#message-user-content-fnref-note",
      "#message-user-content-fnref-note-2",
    ]);
    expect(backrefs[1]?.getAttribute("aria-label")).toBe("Back to reference 1-2");
    expect(view.container.querySelector("li > p:last-child")?.textContent?.endsWith("↩ ↩")).toBe(
      true,
    );
  });

  it.each([undefined, "mention"])(
    "renders nested inline components through the %s component mapping",
    (tagName) => {
      const inline: InlineComponentNode = {
        type: "inlineComponent",
        name: "mention",
        attributes: { user: "alice" },
        properties: { title: "Profile" },
        tagName,
        children: [
          {
            type: "strong",
            children: [
              {
                type: "inlineComponent",
                name: "label",
                attributes: {},
                children: [{ type: "text", value: "Alice" }],
              },
            ],
          },
        ],
      };
      const document: MarkdownDocument = {
        type: "root",
        children: [{ type: "paragraph", children: [inline] }],
      };
      function Mention(props: ComponentProps<"span">) {
        return <mark {...props} />;
      }
      const components = { [tagName ?? "span"]: Mention };
      const view = render(
        <PalotMarkdown {...OPTIONS} components={components}>
          {document}
        </PalotMarkdown>,
      );

      expect(view.container.innerHTML).toBe(
        renderToStaticMarkup(<>{renderMarkdownReact(document, { ...OPTIONS, components })}</>),
      );
      const mention = view.container.querySelector("p > mark");
      expect(mention?.textContent).toBe("Alice");
      expect(mention?.getAttribute("title")).toBe("Profile");
      expect(mention?.getAttribute("data-component")).toBe(tagName ? null : "mention");
      expect(mention?.getAttribute("data-attributes")).toBe(tagName ? null : '{"user":"alice"}');
    },
  );

  it("copies and animates nested inline component text in tables", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const documentFor = (value: string): MarkdownDocument => ({
      type: "root",
      children: [
        {
          type: "table",
          align: [undefined],
          header: [{ type: "tableCell", children: [{ type: "text", value: "Name" }] }],
          rows: [
            [
              {
                type: "tableCell",
                children: [
                  {
                    type: "inlineComponent",
                    name: "mention",
                    attributes: {},
                    children: [{ type: "strong", children: [{ type: "text", value }] }],
                  },
                ],
              },
            ],
          ],
        },
      ],
    });
    function Table(props: ComponentProps<"table">) {
      return <table {...props} />;
    }
    const components = { table: Table };
    const view = render(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {documentFor("Alice")}
      </PalotMarkdown>,
    );
    expect(view.container.querySelector("td [data-markdown-stream-word]")?.textContent).toBe(
      "Alice",
    );

    now.mockReturnValue(400);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {documentFor("Alice Smith")}
      </PalotMarkdown>,
    );
    expect(
      Array.from(
        view.container.querySelectorAll("[data-markdown-stream-word]"),
        (word) => word.textContent,
      ),
    ).toEqual(["Smith"]);
    expect(
      JSON.parse(view.container.querySelector("table")!.getAttribute("data-table-copy")!),
    ).toEqual({
      tsv: "Name\nAlice Smith",
      csv: "Name\nAlice Smith",
      markdown: "| Name        |\n| ----------- |\n| Alice Smith |",
    });
    now.mockRestore();
  });

  it("forwards fence metadata to the highlighter and custom pre without losing Palot metadata", () => {
    const meta = 'title="example.ts" {1}';
    const source = `\`\`\`ts ${meta}\nconst value = 1;\n\`\`\``;
    const highlighter = vi.fn(() => '<span class="token">highlighted</span>');
    function Pre(props: ComponentProps<"pre">) {
      return <pre {...props} data-custom-pre="" />;
    }
    const view = render(
      <PalotMarkdown
        {...OPTIONS}
        codeLineNumbers
        highlighter={highlighter}
        components={{ pre: Pre }}
      >
        {source}
      </PalotMarkdown>,
    );

    expect(highlighter).toHaveBeenCalledWith("const value = 1;", "ts", {
      meta,
      highlightLines: [1],
      lineNumbers: true,
    });
    const pre = view.container.querySelector("pre[data-custom-pre]");
    expect(pre?.getAttribute("data-meta")).toBe(meta);
    expect(pre?.getAttribute("data-code-meta")).toBe(meta);
    expect(pre?.getAttribute("data-code-highlight-lines")).toBe("1");
    expect(pre?.querySelector("code .token")?.textContent).toBe("highlighted");
  });

  it("animates new words across every live block", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {"Earlier words stay still.\n\nLatest words animate now."}
      </PalotMarkdown>,
    );
    const paragraphs = view.container.querySelectorAll("p");

    expect(paragraphs[0]?.querySelectorAll("[data-markdown-stream-word]")).toHaveLength(4);
    expect(paragraphs[1]?.querySelectorAll("[data-markdown-stream-word]")).toHaveLength(4);
  });

  it("keeps custom code content and streaming context through an unfinished fence", () => {
    function Code(props: ComponentProps<"code">) {
      const streaming = useMarkdownBlockStreaming();
      return <code {...props} data-custom-code="" data-streaming={streaming} />;
    }
    const components = { code: Code };
    const source = "```ts file=example.ts\nconst value =";
    const view = render(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {source}
      </PalotMarkdown>,
    );
    expect(view.container.querySelector("code[data-custom-code]")?.textContent).toBe(
      "const value =",
    );
    expect(view.container.querySelector("code")?.getAttribute("data-streaming")).toBe("true");

    view.rerender(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {`${source} 1;\nconsole.log(value);`}
      </PalotMarkdown>,
    );
    expect(view.container.querySelector("code[data-custom-code]")?.textContent).toBe(
      "const value = 1;\nconsole.log(value);",
    );
    expect(view.container.querySelector("pre")?.getAttribute("data-code-meta")).toBe(
      "file=example.ts",
    );

    view.rerender(
      <PalotMarkdown {...OPTIONS} components={components}>
        {`${source} 1;\nconsole.log(value);\n\`\`\``}
      </PalotMarkdown>,
    );
    expect(view.container.querySelector("code[data-custom-code]")?.textContent).toBe(
      "const value = 1;\nconsole.log(value);",
    );
    expect(view.container.querySelector("code")?.getAttribute("data-streaming")).toBe("false");
    expect(view.container.querySelector("[data-markdown-stream-code]")).toBeNull();
  });

  it("renders whitespace-only live input without looping", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {" "}
      </PalotMarkdown>,
    );

    expect(view.container.textContent).toBe("");
    expect(view.container.querySelector("[data-markdown-stream-word]")).toBeNull();
  });

  it("bounds a large streamed batch by time and active element count", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const value = Array.from({ length: 1_000 }, (_, index) => `word${index}`).join(" ");
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {value}
      </PalotMarkdown>,
    );

    const animatedWords = view.container.querySelectorAll<HTMLElement>(
      "[data-markdown-stream-word]",
    );
    expect(animatedWords).toHaveLength(64);
    expect(animatedWords[0]?.textContent).toContain("word0 ");
    expect(animatedWords[63]?.style.getPropertyValue("--palot-markdown-stream-delay")).toBe(
      "320ms",
    );
    expect(view.container.textContent).toBe(value);
    now.mockRestore();
  });

  it("animates inline and fenced code", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {"Text before `inline code` after."}
      </PalotMarkdown>,
    );

    expect(view.container.querySelector("code[data-markdown-stream-code]")).toBeTruthy();
    expect(view.container.querySelector("code")?.textContent).toBe("inline code");

    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        {"```ts\nconst value = 1;\n```"}
      </PalotMarkdown>,
    );
    expect(view.container.querySelector("code [data-markdown-stream-code]")).toBeTruthy();
    expect(view.container.querySelector("code")?.textContent).toBe("const value = 1;");
  });

  it("animates inline code when a closing backtick reshapes streamed text", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        Use `bun test
      </PalotMarkdown>,
    );

    now.mockReturnValue(30);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        Use `bun test`
      </PalotMarkdown>,
    );

    expect(view.container.querySelector("code")?.textContent).toBe("bun test");
    expect(view.container.querySelector("code[data-markdown-stream-code]")).toBeTruthy();
    now.mockRestore();
  });

  it("keeps media out of word animation", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        Text before ![diagram](https://example.com/diagram.png) after
      </PalotMarkdown>,
    );

    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/diagram.png",
    );
    expect(view.container.querySelectorAll("[data-markdown-stream-word]")).toHaveLength(3);
    expect(view.container.querySelectorAll("[data-markdown-stream-word]")[0]?.textContent).toBe(
      "Text ",
    );
  });

  it("preserves in-flight word elements as text is appended", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        Hello
      </PalotMarkdown>,
    );
    const hello = view.getByText("Hello");

    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        Hello world
      </PalotMarkdown>,
    );

    expect(view.getByText("Hello")).toBe(hello);
    expect(hello.style.getPropertyValue("--palot-markdown-stream-duration")).toBe("150ms");
    expect(view.getByText("world").hasAttribute("data-markdown-stream-word")).toBe(true);
    now.mockRestore();
  });

  it("does not restart old words when completed Markdown reshapes the inline tree", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        Planning **the next step
      </PalotMarkdown>,
    );
    expect(view.container.querySelectorAll("[data-markdown-stream-word]")).toHaveLength(4);

    now.mockReturnValue(400);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        Planning **the next step**
      </PalotMarkdown>,
    );

    expect(view.container.querySelector("strong")?.textContent).toBe("the next step");
    const words = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
    );
    expect(words).toHaveLength(0);
    now.mockRestore();
  });

  it("stagger schedules a normal streamed batch without delaying the source", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        One two three
      </PalotMarkdown>,
    );
    const words = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
    );

    expect(words.map((word) => word.textContent)).toEqual(["One ", "two ", "three"]);
    expect(
      words.map((word) => word.style.getPropertyValue("--palot-markdown-stream-delay")),
    ).toEqual(["0ms", "40ms", "80ms"]);
    expect(view.container.textContent).toBe("One two three");
    now.mockRestore();
  });

  it("serializes the word cascade across sibling blocks", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {"One two\n\nThree four"}
      </PalotMarkdown>,
    );
    const paragraphs = view.container.querySelectorAll("p");
    const delays = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
      (word) => word.style.getPropertyValue("--palot-markdown-stream-delay"),
    );

    expect(paragraphs).toHaveLength(2);
    expect(delays).toEqual(["0ms", "40ms", "80ms", "120ms"]);
    now.mockRestore();
  });

  it("animates only appended words after the prior paint commits", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        One two
      </PalotMarkdown>,
    );

    now.mockReturnValue(30);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        One two three
      </PalotMarkdown>,
    );

    const words = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
    );
    expect(
      words
        .slice(0, 2)
        .map((word) => word.style.getPropertyValue("--palot-markdown-stream-duration")),
    ).toEqual(["150ms", "150ms"]);
    expect(
      words.slice(0, 2).map((word) => word.style.getPropertyValue("--palot-markdown-stream-delay")),
    ).toEqual(["0ms", "40ms"]);
    expect(words[2]?.style.getPropertyValue("--palot-markdown-stream-duration")).toBe("150ms");
    expect(words[2]?.style.getPropertyValue("--palot-markdown-stream-delay")).toBe("50ms");
    now.mockRestore();
  });

  it("keeps equivalent MarkdownDocument instances on the same stream timeline", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {parseMarkdown("One two", OPTIONS)}
      </PalotMarkdown>,
    );

    now.mockReturnValue(200);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        {parseMarkdown("One two three", OPTIONS)}
      </PalotMarkdown>,
    );

    const words = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
    );
    expect(words).toHaveLength(1);
    expect(words[0]?.textContent).toBe("three");
    expect(words[0]?.style.getPropertyValue("--palot-markdown-stream-delay")).toBe("0ms");
    expect(view.container.textContent).toBe("One two three");
    now.mockRestore();
  });

  it("restarts the animation timeline when a MarkdownDocument is replaced", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {parseMarkdown("Old response", OPTIONS)}
      </PalotMarkdown>,
    );

    now.mockReturnValue(200);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        {parseMarkdown("Replacement response", OPTIONS)}
      </PalotMarkdown>,
    );

    const words = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
    );
    expect(words.map((word) => word.textContent)).toEqual(["Replacement ", "response"]);
    expect(
      words.map((word) => word.style.getPropertyValue("--palot-markdown-stream-delay")),
    ).toEqual(["0ms", "40ms"]);
    now.mockRestore();
  });

  it("drops settled word elements while streaming continues", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        One two
      </PalotMarkdown>,
    );

    now.mockReturnValue(200);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        One two
      </PalotMarkdown>,
    );

    expect(view.container.querySelector("[data-markdown-stream-word]")).toBeNull();
    expect(view.container.textContent).toBe("One two");
    now.mockRestore();
  });

  it("does not rerender settled blocks while a later block streams", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    let paragraphRenders = 0;
    function Paragraph({ children }: { children?: React.ReactNode }) {
      paragraphRenders += 1;
      return <p>{children}</p>;
    }
    const components = { p: Paragraph };
    const view = render(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {"First block.\n\nSecond block"}
      </PalotMarkdown>,
    );
    expect(paragraphRenders).toBe(2);

    now.mockReturnValue(200);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {"First block.\n\nSecond block grows"}
      </PalotMarkdown>,
    );
    expect(paragraphRenders).toBe(4);

    now.mockReturnValue(400);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS} components={components}>
        {"First block.\n\nSecond block grows again"}
      </PalotMarkdown>,
    );

    expect(paragraphRenders).toBe(5);
    expect(view.container.textContent).toBe("First block.Second block grows again");
    now.mockRestore();
  });

  it("restarts the animation timeline when a string source is replaced", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        Old response
      </PalotMarkdown>,
    );

    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        Replacement response
      </PalotMarkdown>,
    );

    const words = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
    );
    expect(
      words.map((word) => word.style.getPropertyValue("--palot-markdown-stream-duration")),
    ).toEqual(["150ms", "150ms"]);
    expect(words[0]?.style.getPropertyValue("--palot-markdown-stream-delay")).toBe("0ms");
  });

  it("keeps StrictMode render replays on one deterministic schedule", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <StrictMode>
        <PalotMarkdown streaming {...OPTIONS}>
          One two three
        </PalotMarkdown>
      </StrictMode>,
    );

    expect(
      Array.from(
        view.container.querySelectorAll<HTMLElement>("[data-markdown-stream-word]"),
        (word) => word.style.getPropertyValue("--palot-markdown-stream-delay"),
      ),
    ).toEqual(["0ms", "40ms", "80ms"]);
    now.mockRestore();
  });

  it("synchronizes list markers and task checkboxes with the first word", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        {"- First\n- [x] Second"}
      </PalotMarkdown>,
    );
    const items = view.container.querySelectorAll<HTMLElement>("li");
    const checkbox = view.container.querySelector<HTMLElement>('input[type="checkbox"]');

    expect(items[0]?.style.getPropertyValue("--palot-markdown-marker-delay")).toBe("0ms");
    expect(items[1]?.style.getPropertyValue("--palot-markdown-marker-delay")).toBe("40ms");
    expect(checkbox?.hasAttribute("data-markdown-stream-element")).toBe(true);
    expect(checkbox?.style.getPropertyValue("--palot-markdown-stream-delay")).toBe("40ms");
  });

  it("does not restart list chrome after the first word settles", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        - [x] One two
      </PalotMarkdown>,
    );

    now.mockReturnValue(160);
    view.rerender(
      <PalotMarkdown streaming {...OPTIONS}>
        - [x] One two
      </PalotMarkdown>,
    );

    expect(view.container.querySelector("li")?.hasAttribute("data-markdown-stream-marker")).toBe(
      false,
    );
    expect(
      view.container
        .querySelector('input[type="checkbox"]')
        ?.hasAttribute("data-markdown-stream-element"),
    ).toBe(false);
    expect(view.container.querySelectorAll("[data-markdown-stream-word]")).toHaveLength(1);
    now.mockRestore();
  });

  it("removes temporary word elements when streaming completes", () => {
    const view = render(
      <PalotMarkdown streaming {...OPTIONS}>
        Complete response
      </PalotMarkdown>,
    );
    expect(view.container.querySelector("[data-markdown-stream-word]")).not.toBeNull();

    view.rerender(<PalotMarkdown {...OPTIONS}>Complete response</PalotMarkdown>);

    expect(view.container.querySelector("[data-markdown-stream-word]")).toBeNull();
    expect(view.container.textContent).toBe("Complete response");
  });
});
