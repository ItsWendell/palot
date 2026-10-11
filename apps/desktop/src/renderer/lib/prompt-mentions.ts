import type { PalotPromptFileReference } from "../../shared";

type PromptMention = PalotPromptFileReference["mention"];

/** A subagent mention, sent as an OpenCode prompt agent part named by the agent ID. */
export interface PromptAgentReference {
  name: string;
  mention: PromptMention;
}

/** An OpenCode reference mention, sent as a file part for the reference's absolute directory. */
export interface PromptDirectoryReference {
  name: string;
  path: string;
  mention: PromptMention;
}

/** Composer mentions beyond the shared prompt contract's workspace files and skills. */
export interface PromptMentionInput {
  agentReferences?: PromptAgentReference[];
  directoryReferences?: PromptDirectoryReference[];
}

/** A `file://` URI for an absolute POSIX or Windows path. */
export function absoluteFileUri(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const rooted = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  if (!rooted.startsWith("/")) throw new Error("Reference path must be absolute");
  return `file://${rooted
    .split("/")
    .map((segment, index) =>
      index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment),
    )
    .join("/")}`;
}

/** Prompt `files` and `agents` parts for agent and reference mentions, as upstream sends them. */
export function promptMentionParts(input: PromptMentionInput) {
  return {
    files: (input.directoryReferences ?? []).map((reference) => ({
      uri: absoluteFileUri(reference.path),
      name: reference.name,
      mention: { ...reference.mention },
    })),
    agents: (input.agentReferences ?? []).map((agent) => ({
      name: agent.name,
      mention: { ...agent.mention },
    })),
  };
}
