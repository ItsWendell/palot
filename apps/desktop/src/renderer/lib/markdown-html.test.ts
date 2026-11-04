import { parseMarkdown, type BlockNode, type InlineNode } from "@tanstack/markdown";
import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  holdBackPartialHtml,
  htmlBlockStart,
  htmlSyntaxExtension,
  paragraphExtension,
  RAW_HTML_INCOMPLETE,
  RAW_HTML_INVALID,
  scanRawHtml,
} from "./markdown-html";

const extensions = [htmlSyntaxExtension(), paragraphExtension()];

function blocks(source: string): BlockNode[] {
  return parseMarkdown(source, { extensions, frontmatter: false, headingIds: false }).children;
}

function inline(source: string): InlineNode[] {
  const [first] = blocks(source);
  if (first?.type !== "paragraph") throw new Error(`Expected a paragraph, got ${first?.type}`);
  return first.children;
}

function rawHtml(source: string): string[] {
  return inline(source).flatMap((node) => (node.type === "inlineHtml" ? [node.value] : []));
}

describe("HTML blocks (CommonMark 0.31.2 §4.6)", () => {
  it.each([
    ["<pre lang=x>", 1],
    ["<SCRIPT>", 1],
    ["<style", 1],
    ["  <textarea>", 1],
    ["<!-- note", 2],
    ["<?php", 3],
    ["<!DOCTYPE html>", 4],
    ["<![CDATA[", 5],
    ["<details>", 6],
    ["</div>", 6],
    ["<table><tr><td>", 6],
    ["<summary/>", 6],
    ['<a href="foo">', 7],
    ["</kbd>  ", 7],
    ['<img src="x.png" width="20">', 7],
  ])("recognizes %j as type %i", (line, kind) => {
    expect(htmlBlockStart(line)).toBe(kind);
  });

  it.each([
    "    <div>",
    "<kbd>Ctrl</kbd>",
    "<a href='x'> text",
    "< div>",
    "<prefix",
    "text <div>",
    // Only allowlisted lowercase tags are HTML: components and unknown tags stay paragraphs.
    '<Button variant="primary">',
    "<MyComponent />",
    "</Modal>",
    "<custom-element data-x=1>",
    "<DIV>",
    "<PRE>",
    "<center>",
    "<form action=x>",
  ])("does not start an HTML block at %j", (line) => {
    expect(htmlBlockStart(line)).toBe(0);
  });

  it("lets block-level tags interrupt a paragraph, as in a Dependabot body", () => {
    const [paragraph, html] = blocks(
      "Updates `x` from 4.1.4 to 4.1.6\n<details>\n<summary>Notes</summary>",
    );
    expect(paragraph?.type).toBe("paragraph");
    expect(html).toEqual({ type: "html", value: "<details>\n<summary>Notes</summary>" });
  });

  it("keeps a type 7 tag inside the paragraph it follows", () => {
    expect(blocks("Foo\n<a href='bar'>\nbaz")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Foo\n" },
          { type: "inlineHtml", value: "<a href='bar'>" },
          { type: "text", value: "\nbaz" },
        ],
      },
    ]);
  });

  it("ends type 6 and 7 blocks at a blank line and resumes Markdown", () => {
    expect(blocks("<div>\n*raw*\n\n*md*\n\n</div>").map((node) => node.type)).toEqual([
      "html",
      "paragraph",
      "html",
    ]);
  });

  it("continues type 1 and 2 blocks across blank lines until their end condition", () => {
    expect(blocks("<pre>\na\n\nb\n</pre>\nafter")).toEqual([
      { type: "html", value: "<pre>\na\n\nb\n</pre>" },
      { type: "paragraph", children: [{ type: "text", value: "after" }] },
    ]);
    expect(blocks("<!-- a\n\nb -->\nc").map((node) => node.type)).toEqual(["html", "paragraph"]);
  });

  it("leaves HTML inside fenced code and code spans as text", () => {
    expect(blocks("```html\n<div>x</div>\n```")).toMatchObject([
      { type: "code", value: "<div>x</div>" },
    ]);
    expect(inline("`<b>x</b>` &amp;")).toEqual([
      { type: "inlineCode", value: "<b>x</b>" },
      { type: "text", value: " &" },
    ]);
  });

  it("still parses tables, lists, and headings that follow a paragraph", () => {
    expect(blocks("Intro\n| a | b |\n| - | - |\n| 1 | 2 |").map((node) => node.type)).toEqual([
      "paragraph",
      "table",
    ]);
    expect(blocks("Intro\n- item").map((node) => node.type)).toEqual(["paragraph", "list"]);
    expect(blocks("Intro\n# Title").map((node) => node.type)).toEqual(["paragraph", "heading"]);
  });

  it("does not let an empty list item or a list starting after 1 interrupt a paragraph", () => {
    expect(blocks("Foo\n*\nbar\n2. two").map((node) => node.type)).toEqual(["paragraph"]);
  });
});

describe("paragraph details (GFM)", () => {
  it("turns two trailing spaces into a hard line break, but not at the end", () => {
    expect(inline("foo  \nbar  ")).toEqual([
      { type: "text", value: "foo" },
      { type: "break" },
      { type: "text", value: "bar" },
    ]);
  });

  it("does not break lines inside code spans or raw tags (spec examples 345, 662)", () => {
    expect(inline("``\nfoo\nbar  \nbaz\n``")).toEqual([
      { type: "inlineCode", value: "foo bar baz" },
    ]);
    expect(rawHtml('<a href="foo  \nbar">')).toEqual(['<a href="foo\nbar">']);
  });

  it("makes multi-line setext headings", () => {
    expect(blocks("Foo *bar\nbaz*\n====")).toEqual([
      {
        type: "heading",
        depth: 1,
        children: [
          { type: "text", value: "Foo " },
          { type: "emphasis", children: [{ type: "text", value: "bar\nbaz" }] },
        ],
      },
    ]);
  });
});

describe("raw inline HTML (CommonMark 0.31.2 §6.6)", () => {
  it.each([
    ["<a><bab><c2c>", ["<a>", "<bab>", "<c2c>"]],
    ["<a/><b2/>", ["<a/>", "<b2/>"]],
    ['<a  /><b2\ndata="foo" >', ["<a  />", '<b2\ndata="foo" >']],
    [
      '<a foo="bar" bam = \'baz <em>"</em>\'\n_boolean zoop:33=zoop:33 />',
      ['<a foo="bar" bam = \'baz <em>"</em>\'\n_boolean zoop:33=zoop:33 />'],
    ],
    ['Foo <responsive-image src="foo.jpg" />', ['<responsive-image src="foo.jpg" />']],
    ["</a></foo >", ["</a>", "</foo >"]],
    [
      "foo <!-- this is a --\ncomment - with hyphen -->",
      ["<!-- this is a --\ncomment - with hyphen -->"],
    ],
    ["foo <!--> foo -->", ["<!-->"]],
    ["foo <?php echo $a; ?>", ["<?php echo $a; ?>"]],
    ["foo <!ELEMENT br EMPTY>", ["<!ELEMENT br EMPTY>"]],
    ["foo <![CDATA[>&<]]>", ["<![CDATA[>&<]]>"]],
    ['foo <a href="&ouml;">', ['<a href="&ouml;">']],
  ])("parses %j", (source, expected) => {
    expect(rawHtml(source)).toEqual(expected);
  });

  it.each([
    "<33> <__>",
    '<a h*#ref="hi">',
    "<a href=\"hi'> <a href=hi'>",
    "< a><\nfoo><bar/ >\n<foo bar=baz\nbim!bop />",
    "<a href='bar'title=title>",
    '</a href="foo">',
  ])("rejects %j", (source) => {
    expect(rawHtml(source)).toEqual([]);
  });

  it("scans in linear time and reports incomplete input", () => {
    expect(scanRawHtml(`<a${" ".repeat(50_000)}!`, 0)).toBe(RAW_HTML_INVALID);
    expect(scanRawHtml('<a href="https://exa', 0)).toBe(RAW_HTML_INCOMPLETE);
    expect(scanRawHtml("<det", 0)).toBe(RAW_HTML_INCOMPLETE);
    expect(scanRawHtml("<!-", 0)).toBe(RAW_HTML_INCOMPLETE);
    expect(scanRawHtml("< b", 0)).toBe(RAW_HTML_INVALID);
  });
});

describe("autolinks and entity references", () => {
  it("links URI and email autolinks through the URL policy", () => {
    expect(inline("<https://foo.bar/baz?q=1> <MAILTO:FOO@BAR.BAZ> <foo@bar.example.com>")).toEqual([
      {
        type: "link",
        href: "https://foo.bar/baz?q=1",
        children: [{ type: "text", value: "https://foo.bar/baz?q=1" }],
      },
      { type: "text", value: " " },
      {
        type: "link",
        href: "MAILTO:FOO@BAR.BAZ",
        children: [{ type: "text", value: "MAILTO:FOO@BAR.BAZ" }],
      },
      { type: "text", value: " " },
      {
        type: "link",
        href: "mailto:foo@bar.example.com",
        children: [{ type: "text", value: "foo@bar.example.com" }],
      },
    ]);
    expect(inline("<javascript:alert(1)>")).toEqual([
      { type: "text", value: "javascript:alert(1)" },
    ]);
    expect(inline("<> < https://foo.bar > <m:abc>")).toEqual([
      { type: "text", value: "<> < https://foo.bar > <m:abc>" },
    ]);
  });

  it("decodes valid entity and numeric references in text (spec examples 25–29)", () => {
    expect(inline("&nbsp; &amp; &copy; &AElig; &Dcaron; &frac34; &HilbertSpace; &ngE;")).toEqual([
      { type: "text", value: "\u00a0 & © Æ Ď ¾ ℋ ≧̸" },
    ]);
    expect(inline("&#35; &#1234; &#992; &#0; &#X22; &#XD06; &#xcab;")).toEqual([
      { type: "text", value: '# Ӓ Ϡ \ufffd " ആ ಫ' },
    ]);
    const literal = "&nbsp &x; &#; &#x; &#87654321; &#abcdef0; &ThisIsNotDefined; &hi?; &notit;";
    expect(inline(literal)).toEqual([{ type: "text", value: literal }]);
  });

  it("never resolves Object.prototype members as entity names", () => {
    const value = "&constructor; &toString; &valueOf; &hasOwnProperty; &isPrototypeOf;";
    expect(inline(value)).toEqual([{ type: "text", value }]);
    expect(decodeEntities(`<p title="${value}">`)).toBe(`<p title="${value}">`);
  });
});

describe("streaming hold-back", () => {
  it.each([
    ["Intro <det", "Intro "],
    ['See <a href="https://exa', "See "],
    ["<details>\n<summary>Notes</sum", "<details>\n<summary>Notes"],
    ["Copyright &cop", "Copyright "],
    ["Hidden <!-- not done", "Hidden "],
    ["Trailing <", "Trailing "],
  ])("holds back the incomplete tail of %j", (source, expected) => {
    expect(holdBackPartialHtml(source)).toBe(expected);
  });

  it.each([
    "a < b",
    "Done <b>bold</b>",
    '```html\n<div class="x',
    'x <y z="unclosed\n\nnew paragraph',
    "AT&T rocks",
  ])("keeps %j", (source) => {
    expect(holdBackPartialHtml(source)).toBe(source);
  });
});
