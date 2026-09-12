/**
 * React renderer adapted from @tanstack/markdown 0.0.13 src/react.ts.
 * https://github.com/TanStack/markdown/blob/720e8c2db5973a3401914a8b96d9fd05c30d6fc5/src/react.ts
 * SPDX-License-Identifier: MIT
 */

import {
  type BlockNode,
  type ComponentNode,
  type FootnoteItemNode,
  type InlineNode,
  type ListItemNode,
  type MarkdownDocument,
  type MarkdownInput,
  parseMarkdown,
  type TableCellNode,
  type TableNode,
  type TextNode,
} from "@tanstack/markdown";
import type { MarkdownReactOptions } from "@tanstack/markdown/react";
import {
  Fragment,
  createContext,
  createElement,
  memo,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useContext,
  useState,
} from "react";
import { parseInlineMathMarker } from "../lib/markdown-math";

const MAX_ANIMATION_BACKLOG_MS = 320;
const MAX_ACTIVE_ANIMATION_GROUPS = 64;
const MIN_STAGGER_MS = 4;
const WORD_ANIMATION_DURATION_MS = 150;
const WORD_STAGGER_MS = 40;
const WHITESPACE_ONLY_RE = /^\s+$/;

type CodeBlockNode = Extract<BlockNode, { type: "code" }>;
type InlineCodeNode = Extract<InlineNode, { type: "inlineCode" }>;
type AnimatedTextNode = TextNode | InlineCodeNode | CodeBlockNode;
type AnimationTiming = {
  delay: number;
  duration: number;
  startAt: number;
};
type StreamingAnimationPlan = {
  listItems: ReadonlyMap<ListItemNode, AnimationTiming>;
  words: ReadonlyMap<AnimatedTextNode, ReadonlyMap<number, AnimationTiming>>;
};
type WordReference = {
  end: number;
  listItem?: ListItemNode;
  node: AnimatedTextNode;
  offset: number;
  start: number;
};
type WordCollection = {
  charCount: number;
  text: string;
  words: WordReference[];
};
type AnimationSchedule = {
  baseDelay: number;
  groupCount: number;
  step: number;
};
type CascadeCursor = {
  nextStartAt: number;
};
type ActiveAnimation = {
  end: number;
  start: number;
  startAt: number;
  timing: AnimationTiming;
};
type StreamingSource = {
  kind: "document" | "string";
  value: string;
};
type StreamingAnimationCommit = {
  blockAnimations: ReadonlyArray<readonly ActiveAnimation[]>;
  blockCharCounts: readonly number[];
  blockSignatures: readonly string[];
  nextStartAt: number;
  source: StreamingSource | null;
};
type StreamingAnimationRenderPass = {
  commit: StreamingAnimationCommit;
  plans: Array<StreamingAnimationPlan | undefined>;
  settledBlocks: boolean[];
  signatures: string[];
};

const MarkdownBlockStreamingContext = createContext(false);

export function useMarkdownBlockStreaming(): boolean {
  return useContext(MarkdownBlockStreamingContext);
}

export interface PalotMarkdownProps extends MarkdownReactOptions {
  children: MarkdownInput;
  idPrefix?: string;
  streaming?: boolean;
}

export function PalotMarkdown({ children, streaming = false, ...options }: PalotMarkdownProps) {
  const document = typeof children === "string" ? parseMarkdown(children, options) : children;
  if (streaming) {
    return createElement(StreamingMarkdownDocument, {
      document,
      options,
      source: children,
    });
  }
  return createElement(
    Fragment,
    null,
    document.children.map((node, index) => renderBlockReact(node, options, `b:${index}`)),
  );
}

function StreamingMarkdownDocument({
  document,
  options,
  source,
}: {
  document: MarkdownDocument;
  options: MarkdownReactOptions;
  source: MarkdownInput;
}) {
  "use no memo";

  const [animationRuntime] = useState(() => new StreamingAnimationRuntime());
  const animationPass = animationRuntime.render(document, source);

  useLayoutEffect(() => {
    animationRuntime.commit(animationPass);
  });

  return createElement(
    Fragment,
    null,
    document.children.map((node, index) =>
      createElement(StreamingMarkdownBlock, {
        key: `b:${index}`,
        animationPlan: animationPass.plans[index],
        node,
        options,
        settled: animationPass.settledBlocks[index] ?? false,
        signature: animationPass.signatures[index]!,
      }),
    ),
  );
}

const StreamingMarkdownBlock = memo(
  function StreamingMarkdownBlock({
    animationPlan,
    node,
    options,
    settled,
  }: {
    animationPlan?: StreamingAnimationPlan;
    node: BlockNode;
    options: MarkdownReactOptions;
    settled: boolean;
    signature: string;
  }) {
    return createElement(
      MarkdownBlockStreamingContext.Provider,
      { value: !settled || animationPlan !== undefined },
      renderBlockReact(node, options, undefined, animationPlan),
    );
  },
  (previous, next) =>
    previous.animationPlan === undefined &&
    next.animationPlan === undefined &&
    previous.settled === next.settled &&
    previous.signature === next.signature &&
    sameMarkdownOptions(previous.options, next.options),
);

function sameMarkdownOptions(previous: MarkdownReactOptions, next: MarkdownReactOptions): boolean {
  const previousEntries = Object.entries(previous);
  const nextEntries = Object.entries(next);
  return (
    previousEntries.length === nextEntries.length &&
    previousEntries.every(([key, value]) =>
      Object.is(value, next[key as keyof MarkdownReactOptions]),
    )
  );
}

function renderBlockReact(
  node: BlockNode,
  options: MarkdownReactOptions = {},
  key?: string,
  animationPlan?: StreamingAnimationPlan,
): ReactElement {
  switch (node.type) {
    case "heading":
      return h(
        options,
        `h${node.depth}`,
        {
          key,
          ...(node.id ? { id: scopedMarkdownID(options, node.id) } : {}),
          ...(node.framework ? { "data-framework": node.framework } : {}),
        },
        renderInlines(node.children, options, animationPlan),
        renderHeadingAnchorReact(node.id, options),
      );
    case "paragraph":
      return h(options, "p", { key }, renderInlines(node.children, options, animationPlan));
    case "code":
      return renderCodeBlockReact(node, options, key, animationPlan);
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      return h(
        options,
        tag,
        {
          key,
          ...(node.ordered && node.start && node.start !== 1 ? { start: node.start } : {}),
        },
        node.items.map((item, index) => {
          const itemAnimation = animationPlan?.listItems.get(item);
          return h(
            options,
            "li",
            { key: index, ...streamingMarkerProps(itemAnimation) },
            renderListItemChildrenReact(
              item.children,
              item.checked,
              node.loose,
              options,
              `${index}`,
              animationPlan,
              itemAnimation,
            ),
          );
        }),
      );
    }
    case "blockquote":
      return h(
        options,
        "blockquote",
        { key },
        node.children.map((child, index) =>
          renderBlockReact(child, options, `${key}:${index}`, animationPlan),
        ),
      );
    case "table":
      return h(
        options,
        "table",
        {
          key,
          ...(options.components?.table
            ? { "data-table-copy": JSON.stringify(tableCopy(node)) }
            : {}),
        },
        h(
          options,
          "thead",
          null,
          h(
            options,
            "tr",
            null,
            node.header.map((cell, index) =>
              renderTableCellReact("th", cell, node.align[index], options, index, animationPlan),
            ),
          ),
        ),
        node.rows.length
          ? h(
              options,
              "tbody",
              null,
              node.rows.map((row, rowIndex) =>
                h(
                  options,
                  "tr",
                  { key: rowIndex },
                  row.map((cell, index) =>
                    renderTableCellReact(
                      "td",
                      cell,
                      node.align[index],
                      options,
                      index,
                      animationPlan,
                    ),
                  ),
                ),
              ),
            )
          : null,
      );
    case "footnotes":
      return renderFootnotesReact(node.items, options, key, animationPlan);
    case "thematicBreak":
      return h(options, "hr", { key });
    case "html":
      return options.allowHtml
        ? h(options, "div", { key, dangerouslySetInnerHTML: { __html: node.value } })
        : h(options, "p", { key }, node.value);
    case "callout":
      return h(
        options,
        "div",
        { key, className: `markdown-alert markdown-alert-${node.kind.toLowerCase()}` },
        h(options, "p", { className: "markdown-alert-title" }, node.title),
        h(
          options,
          "div",
          { className: "markdown-alert-content" },
          node.children.map((child, index) =>
            renderBlockReact(child, options, `${key}:${index}`, animationPlan),
          ),
        ),
      );
    case "component":
      return renderComponentReact(node, options, key, animationPlan);
  }
}

function renderInlineReact(
  node: InlineNode,
  options: MarkdownReactOptions = {},
  key?: string,
  animationPlan?: StreamingAnimationPlan,
): ReactNode {
  switch (node.type) {
    case "text":
      return renderTextReact(node, key, animationPlan?.words);
    case "inlineCode": {
      const timing = animationPlan?.words.get(node)?.values().next().value;
      return h(
        options,
        "code",
        {
          key,
          ...streamingElementProps(timing),
          ...(timing ? { "data-markdown-stream-code": "" } : {}),
        },
        node.value,
      );
    }
    case "strong":
      return h(options, "strong", { key }, renderInlines(node.children, options, animationPlan));
    case "emphasis":
      return h(options, "em", { key }, renderInlines(node.children, options, animationPlan));
    case "strike":
      return h(options, "del", { key }, renderInlines(node.children, options, animationPlan));
    case "footnoteReference":
      const referenceID = scopedMarkdownID(
        options,
        `user-content-fnref-${footnoteReferenceId(node)}`,
      );
      return h(
        options,
        "sup",
        { key },
        h(
          options,
          "a",
          {
            id: referenceID,
            "data-footnote-ref": "",
            "aria-describedby": scopedMarkdownID(options, "footnote-label"),
            href: `#${scopedMarkdownID(options, `user-content-fn-${node.id}`)}`,
          },
          node.number,
        ),
      );
    case "link":
      return h(
        options,
        "a",
        { key, href: node.href, ...(node.title ? { title: node.title } : {}) },
        renderInlines(node.children, options, animationPlan),
      );
    case "image":
      return h(options, "img", {
        key,
        src: node.src,
        alt: node.alt,
        ...(node.title ? { title: node.title } : {}),
      });
    case "break":
      return h(options, "br", { key });
    case "inlineHtml":
      const math = parseInlineMathMarker(node.value);
      if (math !== null) {
        return h(options, "palot-inline-math", { key, "data-math": math });
      }
      return options.allowHtml
        ? h(options, "span", { key, dangerouslySetInnerHTML: { __html: node.value } })
        : node.value;
  }
}

function renderTextReact(
  node: TextNode,
  key: string | undefined,
  wordPlan: StreamingAnimationPlan["words"] | undefined,
): ReactNode {
  return renderAnimatedTextReact(node, node.value, key, wordPlan, "data-markdown-stream-word");
}

function renderAnimatedTextReact(
  node: AnimatedTextNode,
  value: string,
  key: string | undefined,
  wordPlan: StreamingAnimationPlan["words"] | undefined,
  marker: "data-markdown-stream-code" | "data-markdown-stream-word",
): ReactNode {
  const animatedOffsets = wordPlan?.get(node);
  if (!animatedOffsets) return value;

  const children: ReactNode[] = [];
  let activeGroup: { offset: number; timing: AnimationTiming; value: string } | undefined;
  const flushActiveGroup = () => {
    if (!activeGroup) return;
    children.push(
      createElement(
        "span",
        {
          key: `${key}:word:${activeGroup.offset}`,
          className: "palot-markdown-stream-unit",
          [marker]: "",
          "data-markdown-stream-start-at": activeGroup.timing.startAt,
          style: streamingAnimationStyle(activeGroup.timing),
        },
        activeGroup.value,
      ),
    );
    activeGroup = undefined;
  };

  for (const part of streamingTextParts(value)) {
    const timing = WHITESPACE_ONLY_RE.test(part.value)
      ? undefined
      : animatedOffsets.get(part.offset);
    if (!timing) {
      flushActiveGroup();
      children.push(part.value);
      continue;
    }
    if (activeGroup?.timing === timing) {
      activeGroup.value += part.value;
      continue;
    }
    flushActiveGroup();
    activeGroup = { offset: part.offset, timing, value: part.value };
  }
  flushActiveGroup();

  return createElement(Fragment, { key }, ...children);
}

function renderInlines(
  nodes: InlineNode[],
  options: MarkdownReactOptions,
  animationPlan?: StreamingAnimationPlan,
): ReactNode[] {
  return nodes.map((node, index) => renderInlineReact(node, options, `i:${index}`, animationPlan));
}

function renderCodeBlockReact(
  node: CodeBlockNode,
  options: MarkdownReactOptions,
  key?: string,
  animationPlan?: StreamingAnimationPlan,
): ReactElement {
  const lang = node.lang ?? "plaintext";
  const highlighter = options.highlighter;
  const codeProps = { className: `language-${lang}` };
  const content = highlighter
    ? undefined
    : renderAnimatedTextReact(
        node,
        node.value,
        undefined,
        animationPlan?.words,
        "data-markdown-stream-code",
      );
  const highlighted = highlighter
    ? {
        dangerouslySetInnerHTML: {
          __html: highlighter(node.value, lang, {
            ...(node.highlightLines && { highlightLines: node.highlightLines }),
            ...(options.codeLineNumbers !== undefined && {
              lineNumbers: options.codeLineNumbers,
            }),
          }),
        },
      }
    : undefined;
  const pre = h(
    options,
    "pre",
    {
      className: `tm-code${options.codeLineNumbers ? " tm-code--line-numbers" : ""}`,
      "data-lang": lang,
      ...(node.meta ? { "data-code-meta": node.meta } : {}),
      ...(node.highlightLines
        ? { "data-code-highlight-lines": node.highlightLines.join(",") }
        : {}),
      ...(node.title ? { "data-code-title": node.title } : {}),
      ...(node.file ? { "data-filename": node.file } : {}),
      ...(node.framework ? { "data-framework": node.framework } : {}),
    },
    h(options, "code", { ...codeProps, ...highlighted }, content),
  );

  if (!node.title) return h(options, Fragment, { key }, pre);

  return h(
    options,
    "figure",
    { key, className: "tm-code-frame", "data-lang": lang },
    h(options, "figcaption", null, node.title),
    pre,
  );
}

function tableCopy(node: TableNode): { tsv: string; csv: string; markdown: string } {
  const rows = [node.header, ...node.rows].map((row) =>
    row.map((cell) => inlineText(cell.children)),
  );
  const tsv = rows.map((row) => row.join("\t")).join("\n");
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const widths =
    rows[0]?.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0), 3)) ?? [];
  const markdown = rows
    .map(
      (row) =>
        `| ${row.map((cell, index) => cell.replaceAll("|", "\\|").padEnd(widths[index] ?? cell.length)).join(" | ")} |`,
    )
    .join("\n");
  const separator = `| ${widths.map((width, index) => alignmentMarker(node.align[index], width)).join(" | ")} |`;
  return {
    tsv,
    csv,
    markdown: `${markdown.split("\n")[0]}\n${separator}\n${markdown.split("\n").slice(1).join("\n")}`,
  };
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inlineCode":
          return node.value;
        case "image":
          return node.alt;
        case "break":
          return "\n";
        case "inlineHtml":
          return parseInlineMathMarker(node.value) ?? "";
        case "link":
        case "strong":
        case "emphasis":
        case "strike":
          return inlineText(node.children);
        default:
          return "";
      }
    })
    .join("");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function alignmentMarker(align: TableNode["align"][number], width: number): string {
  const dashes = "-".repeat(Math.max(3, width));
  if (align === "left") return `:${dashes.slice(1)}`;
  if (align === "right") return `${dashes.slice(0, -1)}:`;
  if (align === "center") return `:${dashes.slice(1, -1)}:`;
  return dashes;
}

function renderListItemChildrenReact(
  children: BlockNode[],
  checked: boolean | undefined,
  loose: boolean | undefined,
  options: MarkdownReactOptions,
  key: string,
  animationPlan?: StreamingAnimationPlan,
  itemAnimation?: AnimationTiming,
): ReactNode[] {
  const [first, ...rest] = children;
  const task =
    checked === undefined
      ? []
      : [
          h(options, "input", {
            key: `${key}:checkbox`,
            type: "checkbox",
            disabled: true,
            checked,
            readOnly: true,
            ...streamingElementProps(itemAnimation),
          }),
          " ",
        ];

  if (first?.type === "paragraph") {
    const content = [...task, ...renderInlines(first.children, options, animationPlan)];
    return [
      ...(loose ? [h(options, "p", { key: `${key}:paragraph` }, content)] : content),
      ...rest.flatMap((child, childIndex) =>
        renderListChildReact(child, loose, options, `${key}:${childIndex + 1}`, animationPlan),
      ),
    ];
  }

  return [
    ...task,
    ...children.flatMap((child, childIndex) =>
      renderListChildReact(child, loose, options, `${key}:${childIndex}`, animationPlan),
    ),
  ];
}

function renderListChildReact(
  child: BlockNode,
  loose: boolean | undefined,
  options: MarkdownReactOptions,
  key: string,
  animationPlan?: StreamingAnimationPlan,
): ReactNode[] {
  return !loose && child.type === "paragraph"
    ? renderInlines(child.children, options, animationPlan)
    : [renderBlockReact(child, options, key, animationPlan)];
}

function renderTableCellReact(
  tag: "td" | "th",
  cell: TableCellNode,
  align: "left" | "center" | "right" | undefined,
  options: MarkdownReactOptions,
  key: number,
  animationPlan?: StreamingAnimationPlan,
): ReactElement {
  return h(
    options,
    tag,
    { key, ...(align ? { style: { textAlign: align } } : {}) },
    renderInlines(cell.children, options, animationPlan),
  );
}

function renderFootnotesReact(
  items: FootnoteItemNode[],
  options: MarkdownReactOptions,
  key?: string,
  animationPlan?: StreamingAnimationPlan,
): ReactElement {
  return h(
    options,
    "section",
    { key, "data-footnotes": "", className: "footnotes" },
    h(
      options,
      "h2",
      { id: scopedMarkdownID(options, "footnote-label"), className: "sr-only" },
      "Footnotes",
      renderHeadingAnchorReact("footnote-label", options),
    ),
    h(
      options,
      "ol",
      null,
      items.map((item) =>
        h(
          options,
          "li",
          { key: item.id, id: scopedMarkdownID(options, `user-content-fn-${item.id}`) },
          renderFootnoteItemReact(item, options, animationPlan),
        ),
      ),
    ),
  );
}

function renderFootnoteItemReact(
  item: FootnoteItemNode,
  options: MarkdownReactOptions,
  animationPlan?: StreamingAnimationPlan,
): ReactNode[] {
  const lastIndex = item.children.length - 1;
  const backrefs = renderFootnoteBackrefsReact(item, options);

  if (lastIndex < 0) return [h(options, "p", { key: "backref-wrapper" }, backrefs.slice(1))];

  return item.children.map((child, index) => {
    if (index === lastIndex && child.type === "paragraph") {
      return h(
        options,
        "p",
        { key: index },
        renderInlines(child.children, options, animationPlan),
        backrefs,
      );
    }
    return renderBlockReact(child, options, `${index}`, animationPlan);
  });
}

function renderFootnoteBackrefsReact(
  item: FootnoteItemNode,
  options: MarkdownReactOptions,
): ReactNode[] {
  const result: ReactNode[] = [];
  for (let index = 1; index <= (item.referenceCount ?? 1); index += 1) {
    const referenceId = index === 1 ? item.id : `${item.id}-${index}`;
    const label = index === 1 ? `${item.number}` : `${item.number}-${index}`;
    result.push(
      " ",
      h(
        options,
        "a",
        {
          key: index,
          "data-footnote-backref": "",
          "aria-label": `Back to reference ${label}`,
          className: "data-footnote-backref",
          href: `#${scopedMarkdownID(options, `user-content-fnref-${referenceId}`)}`,
        },
        "↩",
      ),
    );
  }
  return result;
}

function footnoteReferenceId(node: Extract<InlineNode, { type: "footnoteReference" }>) {
  return node.referenceIndex && node.referenceIndex > 1
    ? `${node.id}-${node.referenceIndex}`
    : node.id;
}

function h(
  options: MarkdownReactOptions,
  tag: string | typeof Fragment,
  props: Record<string, any> | null,
  ...children: ReactNode[]
): ReactElement {
  const component = typeof tag === "string" ? (options.components?.[tag] ?? tag) : tag;
  return createElement(component, props, ...children);
}

function renderComponentReact(
  node: ComponentNode,
  options: MarkdownReactOptions,
  key?: string,
  animationPlan?: StreamingAnimationPlan,
): ReactElement {
  const tag = node.tagName ?? "md-comment-component";
  const props: Record<string, string> = { ...node.properties };
  if (!node.tagName) {
    props["data-component"] = node.name;
    if (!props["data-attributes"]) props["data-attributes"] = JSON.stringify(node.attributes);
  }
  return h(
    options,
    tag,
    { key, ...props },
    node.children.map((child, index) =>
      renderBlockReact(child, options, `${key}:${index}`, animationPlan),
    ),
  );
}

function renderHeadingAnchorReact(
  id: string | undefined,
  options: MarkdownReactOptions,
): ReactNode {
  if (!id || !options.headingAnchors) return null;

  const anchorOptions = typeof options.headingAnchors === "object" ? options.headingAnchors : {};
  return h(
    options,
    "a",
    {
      href: `#${scopedMarkdownID(options, id)}`,
      "aria-hidden": anchorOptions.ariaHidden ?? true,
      className: anchorOptions.className ?? "anchor-heading anchor-heading-link",
      tabIndex: anchorOptions.tabIndex ?? -1,
    },
    anchorOptions.content ?? "#",
  );
}

function scopedMarkdownID(options: MarkdownReactOptions, id: string): string {
  const prefix = (options as { idPrefix?: string }).idPrefix;
  return prefix ? `${prefix}-${id}` : id;
}

class StreamingAnimationRuntime {
  #committed: StreamingAnimationCommit = {
    blockAnimations: [],
    blockCharCounts: [],
    blockSignatures: [],
    nextStartAt: 0,
    source: null,
  };

  render(document: MarkdownDocument, source: MarkdownInput): StreamingAnimationRenderPass {
    const collections = document.children.map((block) => {
      const collection: WordCollection = { charCount: 0, text: "", words: [] };
      collectBlockWords(block, collection);
      return collection;
    });
    const currentSource = streamingSource(source, collections);
    const signatures = document.children.map((block) => JSON.stringify(block));
    const previous = continuesStreamingSource(this.#committed.source, currentSource)
      ? this.#committed
      : {
          blockAnimations: [],
          blockCharCounts: [],
          blockSignatures: [],
          nextStartAt: 0,
          source: null,
        };
    const now = animationNow();
    const cursor: CascadeCursor = {
      nextStartAt: Math.min(Math.max(previous.nextStartAt, now), now + MAX_ANIMATION_BACKLOG_MS),
    };
    const blockAnimations = collections.map((collection, index) =>
      (previous.blockAnimations[index] ?? []).filter(
        (animation) =>
          animation.startAt + WORD_ANIMATION_DURATION_MS > now &&
          animation.end <= collection.charCount,
      ),
    );
    const newWords: Array<{ blockIndex: number; word: WordReference }> = [];
    for (const [blockIndex, collection] of collections.entries()) {
      const previousLength = previous.blockCharCounts[blockIndex] ?? 0;
      for (const word of collection.words) {
        if (!(previousLength > 0 && word.start < previousLength)) {
          newWords.push({ blockIndex, word });
        }
      }
    }

    const schedule = reserveCascade(cursor, newWords.length, now);
    const groupTimings = Array.from({ length: schedule.groupCount }, (_, groupIndex) => {
      const delay = Math.round(schedule.baseDelay + groupIndex * schedule.step);
      return {
        startAt: now + delay,
        timing: { delay, duration: WORD_ANIMATION_DURATION_MS, startAt: now + delay },
      };
    });
    const newGroups = new Map<string, ActiveAnimation>();
    for (const [wordIndex, { blockIndex, word }] of newWords.entries()) {
      const groupIndex = Math.min(
        schedule.groupCount - 1,
        Math.floor((wordIndex * schedule.groupCount) / newWords.length),
      );
      const group = groupTimings[groupIndex];
      if (!group) continue;

      const key = `${blockIndex}:${groupIndex}`;
      const animation = newGroups.get(key);
      if (animation) {
        animation.end = word.end;
      } else {
        const nextAnimation = {
          end: word.end,
          start: word.start,
          startAt: group.startAt,
          timing: group.timing,
        };
        newGroups.set(key, nextAnimation);
        blockAnimations[blockIndex]?.push(nextAnimation);
      }
    }

    return {
      commit: {
        blockAnimations,
        blockCharCounts: collections.map((collection) => collection.charCount),
        blockSignatures: signatures,
        nextStartAt: cursor.nextStartAt,
        source: currentSource,
      },
      plans: collections.map((collection, index) =>
        createStreamingAnimationPlan(collection, blockAnimations[index] ?? []),
      ),
      settledBlocks: signatures.map(
        (signature, index) => previous.blockSignatures[index] === signature,
      ),
      signatures,
    };
  }

  commit(renderPass: StreamingAnimationRenderPass): void {
    this.#committed = renderPass.commit;
  }
}

function streamingSource(
  source: MarkdownInput,
  collections: readonly WordCollection[],
): StreamingSource {
  return typeof source === "string"
    ? { kind: "string", value: source }
    : { kind: "document", value: collections.map((collection) => collection.text).join("\n") };
}

function continuesStreamingSource(
  previous: StreamingSource | null,
  current: StreamingSource,
): boolean {
  return previous?.kind === current.kind && current.value.startsWith(previous.value);
}

function animationNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function reserveCascade(cursor: CascadeCursor, wordCount: number, now: number): AnimationSchedule {
  if (wordCount === 0) return { baseDelay: 0, groupCount: 0, step: WORD_STAGGER_MS };

  const firstStartAt = Math.max(cursor.nextStartAt, now);
  const remainingBudget = Math.max(0, now + MAX_ANIMATION_BACKLOG_MS - firstStartAt);
  const groupCount = Math.min(
    wordCount,
    MAX_ACTIVE_ANIMATION_GROUPS,
    Math.floor(remainingBudget / MIN_STAGGER_MS) + 1,
  );
  const step =
    groupCount === 1
      ? WORD_STAGGER_MS
      : Math.max(MIN_STAGGER_MS, Math.min(WORD_STAGGER_MS, remainingBudget / (groupCount - 1)));
  cursor.nextStartAt = firstStartAt + groupCount * step;
  return {
    baseDelay: Math.max(0, Math.round(firstStartAt - now)),
    groupCount,
    step,
  };
}

function createStreamingAnimationPlan(
  collection: WordCollection,
  animations: readonly ActiveAnimation[],
): StreamingAnimationPlan | undefined {
  if (animations.length === 0) return undefined;

  const listItems = new Map<ListItemNode, AnimationTiming>();
  const seenListItems = new Set<ListItemNode>();
  const words = new Map<AnimatedTextNode, Map<number, AnimationTiming>>();
  let animationIndex = 0;

  for (const word of collection.words) {
    const isFirstListWord = word.listItem ? !seenListItems.has(word.listItem) : false;
    if (word.listItem) seenListItems.add(word.listItem);

    let animation = animations[animationIndex];
    while (animation && animation.end <= word.start) {
      animationIndex += 1;
      animation = animations[animationIndex];
    }
    if (!animation || animation.start > word.start) continue;

    const offsets = words.get(word.node) ?? new Map<number, AnimationTiming>();
    offsets.set(word.offset, animation.timing);
    words.set(word.node, offsets);
    if (word.listItem && isFirstListWord) {
      listItems.set(word.listItem, animation.timing);
    }
  }

  return { listItems, words };
}

function collectBlockWords(
  node: BlockNode,
  collection: WordCollection,
  listItem?: ListItemNode,
): void {
  switch (node.type) {
    case "heading":
    case "paragraph":
      collectInlineWords(node.children, collection, listItem);
      return;
    case "code":
      collectAnimatedTextWords(node, node.value, collection, listItem);
      return;
    case "html":
      collection.text += node.value;
      return;
    case "thematicBreak":
      collection.text += "---";
      return;
    case "list":
      for (const [index, item] of node.items.entries()) {
        if (index > 0) collection.text += "\n";
        for (const child of item.children) collectBlockWords(child, collection, item);
      }
      return;
    case "blockquote":
    case "callout":
    case "component":
      for (const child of node.children) collectBlockWords(child, collection, listItem);
      return;
    case "table":
      for (const cell of node.header) collectInlineWords(cell.children, collection, listItem);
      for (const row of node.rows) {
        for (const cell of row) collectInlineWords(cell.children, collection, listItem);
      }
      return;
    case "footnotes":
      for (const item of node.items) {
        for (const child of item.children) collectBlockWords(child, collection, listItem);
      }
  }
}

function collectInlineWords(
  nodes: InlineNode[],
  collection: WordCollection,
  listItem?: ListItemNode,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text": {
        collectAnimatedTextWords(node, node.value, collection, listItem);
        break;
      }
      case "strong":
      case "emphasis":
      case "strike":
      case "link":
        collectInlineWords(node.children, collection, listItem);
        break;
      case "inlineCode":
        collectAnimatedTextWords(node, node.value, collection, listItem);
        break;
      case "footnoteReference":
        collection.text += String(node.id);
        break;
      case "image":
        collection.text += `${node.alt}\u0000${node.src}`;
        break;
      case "break":
        collection.text += "\n";
        break;
      case "inlineHtml":
        collection.text += node.value;
        break;
    }
  }
}

function collectAnimatedTextWords(
  node: AnimatedTextNode,
  text: string,
  collection: WordCollection,
  listItem?: ListItemNode,
): void {
  collection.text += text;
  for (const part of streamingTextParts(text)) {
    const start = collection.charCount;
    collection.charCount += part.value.length;
    if (WHITESPACE_ONLY_RE.test(part.value)) continue;
    collection.words.push({
      end: collection.charCount,
      listItem,
      node,
      offset: part.offset,
      start,
    });
  }
}

function streamingTextParts(text: string): Array<{ offset: number; value: string }> {
  return Array.from(text.matchAll(/\S+\s*|\s+/gu), (match) => ({
    offset: match.index,
    value: match[0],
  }));
}

function streamingAnimationStyle(timing: AnimationTiming): Record<string, string> {
  return {
    "--palot-markdown-stream-delay": `${timing.delay}ms`,
    "--palot-markdown-stream-duration": `${timing.duration}ms`,
  };
}

function streamingElementProps(timing: AnimationTiming | undefined): Record<string, unknown> {
  if (!timing) return {};
  return {
    className: "palot-markdown-stream-unit",
    "data-markdown-stream-element": "",
    style: streamingAnimationStyle(timing),
  };
}

function streamingMarkerProps(timing: AnimationTiming | undefined): Record<string, unknown> {
  if (!timing) return {};
  return {
    "data-markdown-stream-marker": "",
    style: {
      "--palot-markdown-marker-delay": `${timing.delay}ms`,
      "--palot-markdown-marker-duration": `${timing.duration}ms`,
    },
  };
}
