import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemColorSchemeAtom } from "../atoms/appearance";
import { htmlSyntaxExtension, paragraphExtension } from "../lib/markdown-html";
import { MarkdownContent } from "./markdown-content";
import { PalotMarkdown } from "./palot-markdown-react";

afterEach(cleanup);

function renderMarkdown(value: string, props: { baseUrl?: string; passiveMedia?: boolean } = {}) {
  return render(<MarkdownContent value={value} {...props} />).container;
}

describe("component names and generics in prose", () => {
  it.each([
    "Update the <Button> and <Modal> components.",
    "Use Array<string> here, and Map<K, V>.",
    "Wrap it in <Suspense fallback={null}> first.",
    "Keep <Summary> and <Code> literal, and <Details open>too</Details>.",
  ])("keeps %j exactly as written", (value) => {
    const container = renderMarkdown(value);
    expect(container.textContent).toBe(value);
    expect(container.querySelectorAll(".markdown *")).toHaveLength(1);
  });

  it("keeps a component on its own line a paragraph with literal text", () => {
    const container = renderMarkdown(
      '<MyComponent />\n\n<Button variant="primary">\nClick\n</Button>',
    );
    expect(Array.from(container.querySelectorAll(".markdown > *"), (node) => node.tagName)).toEqual(
      ["P", "P"],
    );
    expect(container.textContent).toBe(
      '<MyComponent /><Button variant="primary">\nClick\n</Button>',
    );
  });

  it("interprets lowercase allowlisted tags in prose, as GitHub does", () => {
    // "the <p> tag" opens a paragraph element, so the tag itself is not shown.
    const container = renderMarkdown("the <p> tag, <summary>s</summary> and <Summary>S</Summary>");
    expect(container.textContent).toBe("the  tag, s and <Summary>S</Summary>");
    expect(container.querySelectorAll(".markdown > p")).toHaveLength(3);
    expect(container.querySelector("summary")?.textContent).toBe("s");
  });
});

describe("raw HTML structure", () => {
  it("wraps the Markdown between an HTML block's open and close tags", () => {
    const container = renderMarkdown(
      "<details>\n<summary>Click <b>me</b></summary>\n\nSome **markdown**\n\n- a\n- b\n\n</details>\n\nAfter",
    );
    const details = container.querySelector("details")!;
    expect(details.querySelector("summary")?.textContent).toBe("Click me");
    expect(details.querySelector("summary b")?.textContent).toBe("me");
    expect(details.querySelector("strong")?.textContent).toBe("markdown");
    expect(details.querySelectorAll("li")).toHaveLength(2);
    expect(details.textContent).not.toContain("After");
    expect(container.firstElementChild?.lastElementChild?.textContent).toBe("After");
    expect(container.textContent).not.toMatch(/<\/?(?:details|summary|b)>/);
  });

  it("closes a block element from a paragraph's trailing close tag", () => {
    const container = renderMarkdown(
      "<details open>\n<summary>More</summary>\n\nExtra **context**.</details>\n\nOutside",
    );
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("details")?.textContent).toContain("Extra context.");
    expect(container.querySelector("details")?.textContent).not.toContain("Outside");
  });

  it("wraps inline Markdown between inline tags and auto-closes at the container end", () => {
    const container = renderMarkdown("Press <kbd>**Ctrl**</kbd> and <b>bold\n\nplain</span> text");
    expect(container.querySelector("kbd > strong")?.textContent).toBe("Ctrl");
    const [first, second] = container.querySelectorAll("p");
    expect(first?.querySelector("b")?.textContent).toBe("bold");
    expect(second?.querySelector("b")).toBeNull();
    expect(second?.textContent).toBe("plain text");
  });

  it("splits a paragraph around block-level inline tags instead of nesting them", () => {
    const container = renderMarkdown("Text <div>block</div> more");
    expect(Array.from(container.firstElementChild!.children, (node) => node.tagName)).toEqual([
      "P",
      "DIV",
      "P",
    ]);
  });

  it("keeps code blocks and code spans literal", () => {
    const container = renderMarkdown(
      "```html\n<details>x</details>\n```\n\n    <b>indented</b>\n\n`<kbd>span</kbd>`",
    );
    expect(container.querySelector("details, kbd, b")).toBeNull();
    expect(container.textContent).toContain("<details>x</details>");
    expect(container.textContent).toContain("<b>indented</b>");
    expect(container.querySelector("p code")?.textContent).toBe("<kbd>span</kbd>");
  });

  it("decodes entities in Markdown and raw HTML text, link titles and destinations", () => {
    const container = renderMarkdown(
      '&copy; &#x27;q&#39; &amp;lt;\n\n<p>&nbsp;&hellip;&bogus;</p>\n\n[foo](https://example.com/f&ouml;?a=1&amp;b=2 "f&ouml;&ouml;")',
    );
    expect(container.textContent).toBe("© 'q' &lt;\u00a0…&bogus;foo");
    const link = container.querySelector("a")!;
    expect([link.getAttribute("href"), link.title]).toEqual([
      "https://example.com/fö?a=1&b=2",
      "föö",
    ]);
  });

  it("keeps blank lines inside indented code (spec example 81)", () => {
    const container = renderMarkdown("    chunk1\n\n    chunk2\n  \n \n \n    chunk3");
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toBe("chunk1\n\nchunk2\n\n\n\nchunk3");
  });

  it("renders allowed elements with validated attributes", () => {
    const container = renderMarkdown(
      [
        '<div align="center">\n\n# Title\n\n</div>',
        '<ol start="3" type="a" onclick="x"><li value="7">x</li></ol>',
        "<dl><dt>Term</dt><dd>Definition</dd></dl>",
        '<table><tr><th align="right" colspan="2">H</th></tr><tr><td rowspan="x">\n\n**md**\n\n</td></tr></table>',
        'H<sub>2</sub>O, x<sup>2</sup>, <mark>m</mark>, <ins>i</ins>, <s>s</s>, <abbr title="t">a</abbr>, <ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby>',
      ].join("\n\n"),
    );
    expect(container.querySelector("div[style]")?.getAttribute("style")).toBe(
      "text-align: center;",
    );
    expect(container.querySelector("div h1")?.textContent).toBe("Title");
    const list = container.querySelector("ol")!;
    expect([
      list.getAttribute("start"),
      list.getAttribute("type"),
      list.getAttribute("onclick"),
    ]).toEqual(["3", "a", null]);
    expect(container.querySelector("li")?.getAttribute("value")).toBe("7");
    expect(container.querySelector("dl > dt + dd")?.textContent).toBe("Definition");
    const header = container.querySelector(".markdown-table-frame table tbody tr th")!;
    expect([header.getAttribute("colspan"), header.getAttribute("style")]).toEqual([
      "2",
      "text-align: right;",
    ]);
    expect(container.querySelector("td")?.hasAttribute("rowspan")).toBe(false);
    expect(container.querySelector("td strong")?.textContent).toBe("md");
    for (const tag of ["sub", "sup", "mark", "ins", "s", "abbr[title=t]", "ruby rt"])
      expect(container.querySelector(tag), tag).not.toBeNull();
  });

  it("does not autolink inside tag attributes or raw anchors", () => {
    const container = renderMarkdown(
      'See <a href="https://example.com/a">https://example.com/label</a> and <img src="https://example.com/i.png" alt="https://example.com/alt"> or https://bare.example.com',
    );
    const hrefs = Array.from(container.querySelectorAll("a"), (link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com/a", "https://bare.example.com"]);
    expect(container.querySelector("a a")).toBeNull();
    expect(container.textContent).not.toContain('"');
  });

  it("routes raw HTML links like Markdown links", async () => {
    const { palot } = await import("../services/palot");
    const open = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    const container = renderMarkdown('<a href="/pull/1" title="PR">PR</a>', {
      baseUrl: "https://github.com/acme/web/pull/7",
    });
    const link = container.querySelector("a")!;
    expect([link.getAttribute("href"), link.getAttribute("target"), link.title]).toEqual([
      "https://github.com/pull/1",
      "_blank",
      "PR",
    ]);
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith("https://github.com/pull/1");
  });

  it("gates raw HTML images like Markdown images and follows Palot's color scheme", () => {
    const picture =
      '<picture>\n<source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark.png 1x">\n<source media="(prefers-color-scheme: light)" srcset="https://example.com/light.png">\n<img alt="Logo" src="https://example.com/fallback.png" width="80" align="right">\n</picture>';
    expect(renderMarkdown(picture).textContent).toBe("[Image: Logo]");
    expect(renderMarkdown(picture).querySelector("img")).toBeNull();

    const store = createStore();
    store.set(systemColorSchemeAtom, "dark");
    const view = render(
      <Provider store={store}>
        <MarkdownContent value={picture} passiveMedia />
      </Provider>,
    );
    const image = view.container.querySelector("img")!;
    expect([image.getAttribute("src"), image.getAttribute("width")]).toEqual([
      "https://example.com/dark.png",
      "80",
    ]);
    expect(image.closest(".markdown-float-right")).not.toBeNull();
    act(() => store.set(systemColorSchemeAtom, "light"));
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/light.png",
    );
  });

  it("keeps task checkbox order and editing intact around HTML", () => {
    const edit = vi.fn();
    const value =
      "- [ ] one\n\n<details><summary>S</summary>\n\n- [ ] two\n\n</details>\n\n<svg>\n\n- [ ] three\n\n</svg>\n\n<input type=checkbox>";
    const view = render(<MarkdownContent value={value} onTaskEdit={edit} />);
    const boxes = view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(3);
    fireEvent.click(boxes[2]!);
    expect(edit).toHaveBeenCalledWith(value.replace("- [ ] three", "- [x] three"));
  });
});

const XSS = [
  '<a href="javascript:alert(1)">a</a>',
  '<a href="JaVaScRiPt:alert(1)">b</a>',
  '<a href="&#106;avascript:alert(1)">c</a>',
  '<a href="&#x6A;avascript&#x3A;alert(1)">d</a>',
  '<a href="java&#9;script:alert(1)">e</a>',
  '<a href="  javascript:alert(1)">f</a>',
  '<a href="javascript&colon;alert(1)">g</a>',
  '<a href="vbscript:msgbox(1)">h</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">i</a>',
  "<img src=x onerror=alert(1)>",
  '<img src="javascript:alert(1)" onload="alert(1)">',
  '<a href="https://ok.example" onclick="alert(1)" target="_self" ping="https://evil.example" style="color:red" class="fixed inset-0" id="root">ok</a>',
  "<svg onload=alert(1)><script>alert(1)</script><text>svg-text</text></svg>",
  "<math><mtext><img src=x onerror=alert(1)></mtext></math>",
  '<iframe srcdoc="<script>alert(1)</script>" src="https://evil.example"></iframe>',
  '<object data="https://evil.example"></object><embed src="https://evil.example">',
  "<style>*{display:none}</style>",
  '<p style="position:fixed;inset:0" class="x" id="y">styled</p>',
  '<form action="https://evil.example"><input name=x><button formaction="javascript:alert(1)">go</button></form>',
  '<input type="checkbox" checked><textarea><img src=x onerror=alert(1)></textarea>',
  '<details ontoggle="alert(1)" open><summary onclick="alert(1)">s</summary>d</details>',
  '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel=stylesheet href="https://evil.example/x.css">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  "<template><img src=x onerror=alert(1)></template>",
  "<<script>alert(1)//<</script>",
  "<scr<script>ipt>alert(1)</script>",
  '<a href="x" <b>broken</b> <div <div>garbage',
  "<div><span><b>unclosed",
  '<a href="https://a.example">outer <a href="https://b.example">inner</a> [md](https://c.example)</a>',
  '<a href="https://a.example">\n\n[block link](https://b.example)\n\n</a>',
];

describe("raw HTML sanitizer", () => {
  it.each(XSS)("neutralizes %j", (payload) => {
    const container = renderMarkdown(`${payload}\n\nInline ${payload.replaceAll("\n", " ")} end`, {
      baseUrl: "https://github.com/acme/web/pull/7",
    });
    for (const element of container.querySelectorAll("*")) {
      const tag = element.tagName.toLowerCase();
      const ownSvg = element.closest("svg")?.classList.contains("lucide");
      expect([
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "textarea",
        "base",
        "meta",
        "link",
        "template",
        "noscript",
        "math",
      ]).not.toContain(tag);
      if (tag === "svg" || element.closest("svg")) expect(ownSvg, tag).toBe(true);
      if (tag === "input") expect(element.closest("li")).not.toBeNull();
      for (const attribute of element.getAttributeNames()) {
        expect(attribute).not.toMatch(/^on|^(?:srcdoc|formaction|ping|id)$/);
        if (attribute === "style")
          expect(element.getAttribute("style")).toMatch(
            /^(?:(?:text-align|vertical-align): \w+;\s*)+$/,
          );
      }
      for (const attribute of ["href", "src", "srcset"]) {
        const url = element.getAttribute(attribute);
        if (url !== null) expect(url).not.toMatch(/^\s*(?:javascript|vbscript|data:(?!image\/))/i);
      }
    }
    expect(container.querySelector("a a")).toBeNull();
  });

  it("shows script, style, foreign and unknown tags as literal text instead of hiding them", () => {
    const container = renderMarkdown(
      "<script>\nif (a < b) el.innerHTML = '<b>x</b>';\n\n</script>\n\nA <script>alert(1)</script> <style>p{}</style><svg><text>svg</text></svg> <center>centered</center> <iframe srcdoc=\"x\"></iframe>\n\n<textarea>\n<b>raw</b>\n</textarea>\n\n<!DOCTYPE html> <?php echo 1; ?> <!-- hidden -->",
    );
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "<script> if (a < b) el.innerHTML = '<b>x</b>'; </script>A <script>alert(1)</script> <style>p{}</style><svg><text>svg</text></svg> <center>centered</center> <iframe srcdoc=\"x\"></iframe><textarea> raw </textarea><!DOCTYPE html> <?php echo 1; ?>",
    );
    // Allowlisted tags between literal ones still render; nothing else becomes an element.
    expect(Array.from(container.querySelectorAll(".markdown *"), (node) => node.tagName)).toEqual([
      "P",
      "B",
    ]);
  });
});

describe("streaming raw HTML", () => {
  it("holds back an incomplete trailing tag and fills an open details progressively", () => {
    const stream = (value: string) => <MarkdownContent value={value} streaming />;
    const view = render(stream("Intro <det"));
    expect(view.container.textContent).toBe("Intro");

    view.rerender(stream('Intro\n<details>\n<summary>Notes <a href="https://exa'));
    expect(view.container.textContent).not.toContain("<a");
    expect(view.container.querySelector("summary")?.textContent).toBe("Notes ");

    view.rerender(stream("Intro\n<details>\n<summary>Notes</summary>\n\nFirst **para**"));
    const details = view.container.querySelector("details")!;
    details.open = true;
    expect(details.querySelector(".markdown-details-content")?.textContent).toBe("First para");

    view.rerender(stream("Intro\n<details>\n<summary>Notes</summary>\n\nFirst **para**\n\nSecond"));
    expect(view.container.querySelector("details")).toBe(details);
    expect(details.open).toBe(true);
    expect(details.querySelector(".markdown-details-content")?.textContent).toBe(
      "First paraSecond",
    );

    view.rerender(
      stream(
        "Intro\n<details>\n<summary>Notes</summary>\n\nFirst **para**\n\nSecond\n\n</details>\n\nAfter",
      ),
    );
    expect(view.container.querySelector("details")).toBe(details);
    expect(details.textContent).not.toContain("After");
    expect(view.container.textContent).toContain("After");
  });

  it("holds back an incomplete component tag, then shows it literally once complete", () => {
    const stream = (value: string) => <MarkdownContent value={value} streaming />;
    const view = render(stream("Update the <Butt"));
    expect(view.container.textContent).toBe("Update the");
    view.rerender(stream('Update the <Button variant="pri'));
    expect(view.container.textContent).toBe("Update the");
    view.rerender(stream('Update the <Button variant="primary"> and Array<str'));
    expect(view.container.textContent).toBe('Update the <Button variant="primary"> and Array');
    view.rerender(stream('Update the <Button variant="primary"> and Array<string>.'));
    expect(view.container.textContent).toBe(
      'Update the <Button variant="primary"> and Array<string>.',
    );
  });

  it("animates words inside HTML elements", () => {
    const view = render(<MarkdownContent value="" streaming />);
    view.rerender(<MarkdownContent value="Press <kbd>Ctrl</kbd> now" streaming />);
    expect(view.container.querySelector("kbd .palot-markdown-stream-unit")?.textContent).toBe(
      "Ctrl",
    );
    view.rerender(<MarkdownContent value="Press <kbd>Ctrl</kbd> now" />);
    expect(view.container.querySelector(".palot-markdown-stream-unit")).toBeNull();
    expect(view.container.querySelector("kbd")?.textContent).toBe("Ctrl");
  });

  it("re-renders only the open HTML section while later blocks stream", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const renders: string[] = [];
    function Details({ summary, children }: { summary?: ReactNode; children?: ReactNode }) {
      renders.push(String(summary));
      return (
        <details>
          <summary>{summary}</summary>
          {children}
        </details>
      );
    }
    const options = {
      allowHtml: false,
      extensions: [htmlSyntaxExtension(), paragraphExtension()],
      components: { "palot-details": Details },
    };
    const first = "<details>\n<summary>A</summary>\n\nSettled.\n\n</details>\n\n";
    const stream = (tail: string) => (
      <PalotMarkdown streaming {...options}>
        {`${first}<details>\n<summary>B</summary>\n\n${tail}`}
      </PalotMarkdown>
    );
    const view = render(stream("One"));
    now.mockReturnValue(400);
    view.rerender(stream("One two"));
    now.mockReturnValue(800);
    view.rerender(stream("One two three"));
    now.mockReturnValue(1200);
    view.rerender(stream("One two three four"));
    expect(renders.filter((summary) => summary === "A").length).toBeLessThanOrEqual(2);
    expect(renders.filter((summary) => summary === "B")).toHaveLength(4);
    expect(view.container.textContent).toContain("One two three four");
    now.mockRestore();
  });
});

describe("single tildes in the user's own text", () => {
  const user = (value: string) =>
    render(<MarkdownContent value={value} literalSingleTilde />).container;

  it("keeps a single ~ literal in paths the user typed", () => {
    const value = "move ~/foo to (~/bar)";
    const container = user(value);
    expect(container.textContent).toBe(value);
    expect(container.querySelector("del")).toBeNull();
  });

  it("still strikes ~~double~~ and leaves code alone", () => {
    const container = user("Drop ~~the old ~/plan~~ and run `a ~b~ c`\n\n```\n~x~\n```");
    expect(container.querySelector("del")?.textContent).toBe("the old ~/plan");
    expect(container.querySelector("p code")?.textContent).toBe("a ~b~ c");
    expect(container.querySelector("pre")?.textContent).toContain("~x~");
  });

  it("leaves an assistant's single-tilde strikethrough as GFM renders it", () => {
    const container = renderMarkdown("move ~/foo to (~/bar)");
    expect(container.querySelector("del")?.textContent).toBe("/foo to (");
  });
});
