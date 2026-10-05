import type { InlineNode, MarkdownExtension } from "@tanstack/markdown";

// OpenCode generates IDs with a 26-character alphanumeric suffix.
export function isCompleteSessionID(value: string): boolean {
  return /^ses_[A-Za-z0-9]{26}$/.test(value);
}

export function createMarkdownSessionOpener(
  owner: { profileID: string; connectionID: string } | null,
  openSession: (sessionID: string, search: { profileID: string }) => unknown,
): ((sessionID: string) => void) | undefined {
  if (!owner?.profileID || !owner.connectionID) return undefined;
  const profileID = owner.profileID;
  return (sessionID) => {
    if (isCompleteSessionID(sessionID)) void openSession(sessionID, { profileID });
  };
}

export function sessionLinksExtension(streaming: boolean): MarkdownExtension {
  const link = (id: string, children: InlineNode[]): InlineNode => ({
    type: "inlineComponent",
    name: "session-link",
    tagName: "palot-session-link",
    attributes: {},
    properties: { "data-session-id": id },
    children,
  });
  const transform = (nodes: InlineNode[]): InlineNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "inlineCode" && isCompleteSessionID(node.value)) {
        return [link(node.value, [node])];
      }
      if (node.type === "strong" || node.type === "emphasis" || node.type === "strike") {
        return [{ ...node, children: transform(node.children) }];
      }
      if (node.type !== "text") return [node];
      const result: InlineNode[] = [];
      let offset = 0;
      const pattern =
        /(?<![A-Za-z0-9_./\\:-])ses_[A-Za-z0-9]{26}(?![A-Za-z0-9_/\\-]|\.[A-Za-z0-9])/g;
      for (const match of node.value.matchAll(pattern)) {
        const end = match.index + match[0].length;
        if (streaming && end === node.value.length) continue;
        if ((node.value.slice(0, match.index).match(/(?<!\\)`+/g)?.length ?? 0) % 2 !== 0) continue;
        // A still-unparsed Markdown destination is not ordinary prose.
        if (node.value.lastIndexOf("](", match.index) > node.value.lastIndexOf(")", match.index))
          continue;
        if (match.index > offset)
          result.push({ type: "text", value: node.value.slice(offset, match.index) });
        result.push(link(match[0], [{ type: "text", value: match[0] }]));
        offset = end;
      }
      if (offset < node.value.length)
        result.push({ type: "text", value: node.value.slice(offset) });
      return result.length ? result : [node];
    });
  return { name: "palot-session-links", transformInline: transform };
}
