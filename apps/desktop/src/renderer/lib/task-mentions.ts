import type { InlineNode, MarkdownExtension } from "@tanstack/markdown";
import type { PalotProject, PalotSession } from "../../shared";
import { isCompleteSessionID } from "./markdown-session-links";
import { projectForSession, projectName } from "./view-models";

// OpenCode v2.2.0 packages/util/src/session-mention.ts: keep the wire format identical.
const pattern = /(?<![\w/:@-])(?:@session:)?(ses_[A-Za-z0-9]{26})(?![\w/-])/g;

export function taskMentions(text: string) {
  return Array.from(text.matchAll(pattern), (match) => ({
    id: match[1]!,
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function serializeTaskMention(sessionID: string): string {
  return `@session:${sessionID}`;
}

/** The caller supplies the active connection's catalog, never a cross-server task list. */
export function taskMentionSuggestions(
  sessions: readonly PalotSession[],
  projects: PalotProject[],
  currentSessionID: string,
  query: string,
) {
  const search = query.toLowerCase();
  return sessions
    .filter(
      (session) =>
        !session.parentID &&
        !session.archivedAt &&
        session.id !== currentSessionID &&
        isCompleteSessionID(session.id),
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .map((session) => {
      const project = projectForSession(projects, session);
      return {
        id: session.id,
        title: session.title?.trim() || "Untitled task",
        project: project ? projectName(project) : session.location.directory,
      };
    })
    .filter((task) =>
      [task.title, task.project, task.id].some((value) => value.toLowerCase().includes(search)),
    )
    .slice(0, 10);
}

/** Explicit mentions complement the existing bare-session-ID Markdown links. */
export function taskMentionsExtension(streaming: boolean): MarkdownExtension {
  const link = (id: string, children: InlineNode[]): InlineNode => ({
    type: "inlineComponent",
    name: "task-mention",
    tagName: "palot-session-link",
    attributes: {},
    properties: { "data-session-id": id },
    children,
  });
  const transform = (nodes: InlineNode[]): InlineNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "inlineCode") {
        const mention = taskMentions(node.value)[0];
        return mention?.text === node.value && node.value.startsWith("@session:")
          ? [link(mention.id, [node])]
          : [node];
      }
      if (node.type === "strong" || node.type === "emphasis" || node.type === "strike") {
        return [{ ...node, children: transform(node.children) }];
      }
      if (node.type !== "text") return [node];
      const result: InlineNode[] = [];
      let offset = 0;
      for (const mention of taskMentions(node.value)) {
        if (!mention.text.startsWith("@session:")) continue;
        if (streaming && mention.end === node.value.length) continue;
        if ((node.value.slice(0, mention.start).match(/(?<!\\)`+/g)?.length ?? 0) % 2 !== 0)
          continue;
        if (
          node.value.lastIndexOf("](", mention.start) > node.value.lastIndexOf(")", mention.start)
        )
          continue;
        if (mention.start > offset)
          result.push({ type: "text", value: node.value.slice(offset, mention.start) });
        result.push(link(mention.id, [{ type: "text", value: mention.text }]));
        offset = mention.end;
      }
      if (offset < node.value.length)
        result.push({ type: "text", value: node.value.slice(offset) });
      return result.length ? result : [node];
    });
  return { name: "palot-task-mentions", transformInline: transform };
}
