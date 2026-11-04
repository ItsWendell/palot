/**
 * Converts sanitized raw-HTML element trees (lib/markdown-html-tree.ts) into React elements.
 * Every value reaches React as a prop or text child; there is no HTML string boundary. Links and
 * images go through the document's `a`/`img` components and URL policy, like Markdown ones.
 */

import type { BlockNode, InlineNode, ParagraphNode } from "@tanstack/markdown";
import type { MarkdownReactOptions } from "@tanstack/markdown/react";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { policyUrl } from "../lib/markdown-html";
import {
  HtmlTreeBuilder,
  isBlockLevelHtmlElement,
  tokenizeHtml,
  unmatchedEndTags,
  type HtmlTreeElement,
  type HtmlTreeNode,
} from "../lib/markdown-html-tree";

export interface HtmlTreeRenderer<Leaf> {
  options: MarkdownReactOptions;
  /** `depth`: open HTML elements around the leaf; pass it on with `withHtmlDepth`. */
  leaf(leaf: Leaf, key: string, depth: number): ReactNode;
  /** Override how nested elements render (streaming wraps them in memoized sections). */
  element?(element: HtmlTreeElement<Leaf>): ReactNode;
}

export function isRawInlineHtml(
  node: InlineNode,
): node is Extract<InlineNode, { type: "inlineHtml" }> {
  // Inline math also travels as inlineHtml, but never starts with "<".
  return node.type === "inlineHtml" && node.value.startsWith("<");
}

export function hasRawInlineHtml(nodes: readonly InlineNode[]): boolean {
  return nodes.some(isRawInlineHtml);
}

export function hasRawHtmlBlock(nodes: readonly BlockNode[]): boolean {
  return nodes.some((node) => node.type === "html");
}

type HtmlDepthOptions = MarkdownReactOptions & { htmlDepth?: number };

/** Raw HTML elements open around the content these options render (see MAX_HTML_DEPTH). */
export function htmlDepth(options: MarkdownReactOptions): number {
  return (options as HtmlDepthOptions).htmlDepth ?? 0;
}

/** Options for Markdown nested inside `depth` open HTML elements; the same object when unchanged,
 * so memoized blocks keep their options. */
export function withHtmlDepth<Options extends MarkdownReactOptions>(
  options: Options,
  depth: number,
): Options {
  return depth === htmlDepth(options) ? options : { ...options, htmlDepth: depth };
}

/** One tree for a block list: tags in HTML blocks wrap the Markdown blocks between them. Leaves
 * are indices into `nodes`, keyed `${keyPrefix}:${index}` like ordinary block children. */
export function buildBlockHtmlTree(
  nodes: readonly BlockNode[],
  keyPrefix: string,
  { depth = 0, streamingTail = false }: { depth?: number; streamingTail?: boolean } = {},
): HtmlTreeElement<number> {
  const builder = new HtmlTreeBuilder<number>({ block: true, key: keyPrefix, depth });
  for (const [index, node] of nodes.entries()) {
    if (node.type === "html") {
      // A streaming tail is a new string every delta; caching it would only evict settled blocks.
      const cache = !(streamingTail && index === nodes.length - 1);
      for (const [tokenIndex, token] of tokenizeHtml(node.value, cache).entries())
        builder.token(token, `${keyPrefix}:h${index}.${tokenIndex}`, index);
      continue;
    }
    builder.leaf(index, `${keyPrefix}:${index}`, index);
    if (node.type === "paragraph") {
      const endTags = paragraphEndTags(node);
      if (endTags.length) builder.closeTags(endTags, index);
    }
  }
  return builder.finish(Math.max(0, nodes.length - 1));
}

/** One tree per inline container: tags wrap the inline nodes between them. */
export function buildInlineHtmlTree(
  nodes: readonly InlineNode[],
  keyPrefix: string,
  depth = 0,
): HtmlTreeElement<number> {
  const builder = new HtmlTreeBuilder<number>({ block: false, key: keyPrefix, depth });
  for (const [index, node] of nodes.entries()) {
    if (isRawInlineHtml(node)) {
      for (const token of tokenizeHtml(node.value))
        builder.token(token, `${keyPrefix}:h${index}`, index);
    } else {
      builder.leaf(index, `${keyPrefix}:${index}`, index);
    }
  }
  return builder.finish(Math.max(0, nodes.length - 1));
}

/** A paragraph's own `</details>` can close a block-level element opened by an earlier HTML block. */
function paragraphEndTags(node: ParagraphNode): string[] {
  const values = node.children.filter(isRawInlineHtml).map((child) => child.value);
  return values.some((value) => value.startsWith("</")) ? unmatchedEndTags(values) : [];
}

export function renderHtmlNodes<Leaf>(
  nodes: readonly HtmlTreeNode<Leaf>[],
  renderer: HtmlTreeRenderer<Leaf>,
): ReactNode[] {
  return nodes.map((node) => {
    if (node.kind === "text") return node.value;
    if (node.kind === "leaf") return renderer.leaf(node.leaf, node.key, node.depth);
    return renderer.element ? renderer.element(node) : renderHtmlElement(node, renderer);
  });
}

/** Split an inline tree whose top level holds block-level elements into paragraphs around them,
 * as the HTML parser does, so a `<p>` never contains a `<div>` or `<details>`. */
export function renderHtmlParagraph(
  tree: HtmlTreeElement<number>,
  nodes: readonly InlineNode[],
  renderer: HtmlTreeRenderer<number>,
  key: string | undefined,
  paragraph: (key: string, children: ReactNode[]) => ReactElement,
): ReactElement {
  const groups: Array<HtmlTreeNode<number>[] | HtmlTreeElement<number>> = [];
  for (const child of tree.children) {
    if (child.kind === "element" && isBlockLevelHtmlElement(child.tag)) groups.push(child);
    else if (Array.isArray(groups.at(-1))) (groups.at(-1) as HtmlTreeNode<number>[]).push(child);
    else groups.push([child]);
  }
  if (groups.length === 1 && Array.isArray(groups[0]))
    return paragraph(key ?? "p", renderHtmlNodes(groups[0], renderer));
  return createElement(
    Fragment,
    { key },
    ...groups.map((group, index) =>
      Array.isArray(group)
        ? blankRun(group, nodes)
          ? null
          : paragraph(`p:${index}`, renderHtmlNodes(group, renderer))
        : renderHtmlNodes([group], renderer)[0],
    ),
  );
}

function blankRun(group: readonly HtmlTreeNode<number>[], nodes: readonly InlineNode[]): boolean {
  return group.every((child) => {
    if (child.kind === "text") return !child.value.trim();
    if (child.kind !== "leaf") return false;
    const node = nodes[child.leaf];
    return node?.type === "break" || (node?.type === "text" && !node.value.trim());
  });
}

export function renderHtmlElement<Leaf>(
  element: HtmlTreeElement<Leaf>,
  renderer: HtmlTreeRenderer<Leaf>,
): ReactNode {
  const { attributes, key, tag } = element;
  const { options } = renderer;
  const children = () => renderHtmlNodes(element.children, renderer);
  switch (tag) {
    case "a": {
      const href = policyUrl(attributes.href, "link", options);
      if (!href) return createElement(Fragment, { key }, ...children());
      return mapped(options, "a", { key, href, ...titleProp(attributes) }, children());
    }
    case "img":
      return mapped(options, "img", { key, ...imageProps(attributes, options) }, []);
    case "picture":
      return renderPicture(element, renderer);
    case "source":
      return null;
    case "details":
      return renderDetails(element, renderer);
    case "table":
      return createElement(
        "div",
        { key, className: "markdown-table-frame" },
        createElement("table", elementProps(tag, attributes), ...children()),
      );
    default:
      return createElement(tag, { key, ...elementProps(tag, attributes) }, ...children());
  }
}

function renderDetails<Leaf>(element: HtmlTreeElement<Leaf>, renderer: HtmlTreeRenderer<Leaf>) {
  const { options } = renderer;
  const index = element.children.findIndex(
    (child) => child.kind === "element" && child.tag === "summary",
  );
  const candidate = index === -1 ? undefined : (element.children[index] as HtmlTreeElement<Leaf>);
  // Hoist the summary only when that cannot reorder Markdown (task checkbox indices): either it
  // or everything before it holds no Markdown at any depth.
  const summary =
    candidate &&
    (!containsLeaf(candidate.children) || !containsLeaf(element.children.slice(0, index)))
      ? candidate
      : undefined;
  const content = renderHtmlNodes(
    summary ? element.children.filter((child) => child !== summary) : element.children,
    renderer,
  );
  const summaryContent = summary ? renderHtmlNodes(summary.children, renderer) : undefined;
  const open = Object.hasOwn(element.attributes, "open");
  if (options.components?.["palot-details"])
    return mapped(
      options,
      "palot-details",
      { key: element.key, open, summary: summaryContent },
      content,
    );
  return createElement(
    "details",
    { key: element.key, open },
    summaryContent ? createElement("summary", null, ...summaryContent) : null,
    ...content,
  );
}

function renderPicture<Leaf>(element: HtmlTreeElement<Leaf>, renderer: HtmlTreeRenderer<Leaf>) {
  const { options } = renderer;
  const sources = element.children.flatMap((child) => {
    if (child.kind !== "element" || child.tag !== "source") return [];
    const src = policyUrl(firstSrcsetCandidate(child.attributes.srcset), "image", options);
    return src ? [{ media: child.attributes.media ?? "", src }] : [];
  });
  const image = element.children.find(
    (child): child is HtmlTreeElement<Leaf> => child.kind === "element" && child.tag === "img",
  );
  // Everything else renders in source order, so Markdown (and its task checkboxes) inside a
  // picture keeps its place; the image renders where its <img> was.
  const children = element.children.flatMap((child): ReactNode[] => {
    if (child.kind === "element" && child.tag === "source") return [];
    if (child !== image) return renderHtmlNodes([child], renderer);
    const fallback = renderHtmlElement({ ...image, key: "img" }, renderer);
    return [
      sources.length && options.components?.["palot-picture"]
        ? mapped(
            options,
            "palot-picture",
            { key: image.key, "data-sources": JSON.stringify(sources) },
            [fallback],
          )
        : fallback,
    ];
  });
  return createElement(Fragment, { key: element.key }, ...children);
}

/** The URL of a srcset's first candidate, scanned without backtracking regexes. */
function firstSrcsetCandidate(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const comma = srcset.indexOf(",");
  const first = (comma === -1 ? srcset : srcset.slice(0, comma)).trim();
  const space = first.search(/\s/);
  return (space === -1 ? first : first.slice(0, space)) || undefined;
}

function containsLeaf<Leaf>(nodes: readonly HtmlTreeNode<Leaf>[]): boolean {
  return nodes.some(
    (node) => node.kind === "leaf" || (node.kind === "element" && containsLeaf(node.children)),
  );
}

function mapped(
  options: MarkdownReactOptions,
  tag: string,
  props: Record<string, unknown>,
  children: ReactNode[],
): ReactNode {
  return createElement(options.components?.[tag] ?? tag, props, ...children);
}

const TEXT_ALIGN = new Set(["left", "center", "right", "justify"]);
const IMAGE_ALIGN = new Set(["left", "right", "center", "top", "middle", "bottom"]);
const VERTICAL_ALIGN = new Set(["top", "middle", "bottom", "baseline"]);
const DIRECTION = new Set(["ltr", "rtl", "auto"]);
const SCOPE = new Set(["row", "col", "rowgroup", "colgroup"]);
const LIST_TYPE = new Set(["1", "a", "A", "i", "I"]);
const LANGUAGE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const DIMENSION = /^\d{1,5}%?$/;

function titleProp(attributes: Readonly<Record<string, string>>) {
  const title = attributes.title?.slice(0, 1000);
  return title ? { title } : {};
}

function imageProps(
  attributes: Readonly<Record<string, string>>,
  options: MarkdownReactOptions,
): Record<string, unknown> {
  const align = attributes.align?.toLowerCase();
  return {
    src: policyUrl(attributes.src, "image", options),
    alt: attributes.alt ?? "",
    ...titleProp(attributes),
    ...(attributes.width && DIMENSION.test(attributes.width) ? { width: attributes.width } : {}),
    ...(attributes.height && DIMENSION.test(attributes.height)
      ? { height: attributes.height }
      : {}),
    ...(align && IMAGE_ALIGN.has(align) ? { align } : {}),
  };
}

/** Validated React props for every other allowed element; values never become markup or style
 * text, only enumerated alignment styles. */
function elementProps(
  tag: string,
  attributes: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...titleProp(attributes) };
  if (attributes.lang && LANGUAGE.test(attributes.lang)) props.lang = attributes.lang;
  const dir = attributes.dir?.toLowerCase();
  if (dir && DIRECTION.has(dir)) props.dir = dir;
  const style: Record<string, string> = {};
  const align = attributes.align?.toLowerCase();
  if (align && TEXT_ALIGN.has(align)) style.textAlign = align;
  const valign = attributes.valign?.toLowerCase();
  if (valign && VERTICAL_ALIGN.has(valign)) style.verticalAlign = valign;
  if (Object.keys(style).length) props.style = style;
  const span = (value: string | undefined) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 1000 ? number : undefined;
  };
  if (tag === "td" || tag === "th") {
    const colSpan = span(attributes.colspan);
    const rowSpan = span(attributes.rowspan);
    if (colSpan) props.colSpan = colSpan;
    if (rowSpan) props.rowSpan = rowSpan;
    const scope = attributes.scope?.toLowerCase();
    if (tag === "th" && scope && SCOPE.has(scope)) props.scope = scope;
  }
  if (tag === "ol") {
    const start = Number(attributes.start);
    if (attributes.start && Number.isSafeInteger(start)) props.start = start;
    if (attributes.type && LIST_TYPE.has(attributes.type)) props.type = attributes.type;
    if (Object.hasOwn(attributes, "reversed")) props.reversed = true;
  }
  if (tag === "li") {
    const value = Number(attributes.value);
    if (attributes.value && Number.isSafeInteger(value)) props.value = value;
  }
  if (tag === "time" && attributes.datetime) props.dateTime = attributes.datetime.slice(0, 100);
  return props;
}
