import type { VoiceDelegationWindow } from "./voice-transcript";

/**
 * OpenCode's desktop, web and iOS apps render prompts that start with this header
 * and carry a JSON body with a non-empty `instruction` as Voice messages
 * (packages/app/src/session/timeline/voice-delegation.ts upstream).
 */
const DELEGATION_HEADER =
  "Voice delegation. The user is on a voice call with a voice agent, which hands their requests to you. " +
  "Instruction is the user's own spoken words since the previous delegation; transcripts can contain " +
  "recognition mistakes and later corrections. Lead your reply with one or two plain sentences that can " +
  "be read aloud, then any detail.";

const CONTINUED_HEADER = "Voice delegation (continued). Same fields as before.";

export interface VoiceDelegationPromptInput {
  window: VoiceDelegationWindow;
  /** Whether an earlier delegation in this call already explained the format. */
  continued: boolean;
  context?: string;
}

export function formatVoiceDelegationPrompt(input: VoiceDelegationPromptInput): string {
  const body = {
    ...(input.context ? { context: input.context } : {}),
    instruction: input.window.instruction,
    transcript_delta: input.window.transcriptDelta,
    ...(input.window.voice ? { voice: input.window.voice } : {}),
  };
  return `${input.continued ? CONTINUED_HEADER : DELEGATION_HEADER}\n${JSON.stringify(body, null, 2)}`;
}

export interface VoiceInstructionsInput {
  sessionTitle: string | null;
  projectName: string | null;
  /** The call works in a coordinator session that can start other tasks. */
  coordinator: boolean;
}

/** Startup instructions for the GPT-Live voice model (client delegation). */
export function voiceSessionInstructions(input: VoiceInstructionsInput): string {
  const where = [
    input.projectName ? `project "${input.projectName}"` : null,
    input.sessionTitle ? `task "${input.sessionTitle}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    "## Role",
    "You are the voice of Palot, a desktop app for the OpenCode coding agent. You talk with a developer while a separate coding agent (the backend) does the work" +
      (where ? ` in ${where}.` : "."),
    input.coordinator
      ? "The backend is a coordinator that can start, steer, and check on other coding tasks."
      : "The backend works in the task the user has open.",
    "",
    "## Delegation",
    "- Delegate every request that involves code, files, commands, the repository, tasks, or anything you cannot answer from this conversation. Do not guess about the codebase.",
    "- Delegate as soon as the request is clear; you may say a few words while it starts, like 'On it.'",
    "- Delegate corrections and follow-ups too, so the backend can adjust work already running.",
    "- Small talk, clarifying questions, and summarising what the backend already reported do not need delegation.",
    "",
    "## Backend updates",
    "- Commentary from the backend is something to tell the user. Say it in your own words, briefly. Never read code, file paths in full, or long lists aloud; mention that details are in Palot.",
    "- Thinking context is background. Use it to answer questions about progress, but don't announce it unprompted.",
    "- Never claim work is done unless the backend said so.",
    "- When the backend needs approval or an answer, tell the user it's waiting for them in Palot. You cannot approve anything yourself.",
    "",
    "## Style",
    "Be warm, direct, and short: one or two sentences per turn. Use plain spoken language. If you didn't catch something, ask once.",
  ].join("\n");
}

/** Spoken greeting cue placed in `session.input` so the model opens the call. */
export function voiceGreetingInstruction(sessionTitle: string | null): string {
  return sessionTitle
    ? `Greet the user briefly now, mention you're ready to help with "${sessionTitle}", then pause and listen.`
    : "Greet the user briefly now and ask what they'd like to work on, then pause and listen.";
}

/**
 * Turns a markdown agent reply into text a voice model can paraphrase: code blocks,
 * tables and link targets are dropped; headings and emphasis become plain words.
 */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " (code omitted; see Palot) ")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first paragraphs of a reply, up to `limit` characters, cut at a paragraph or sentence. */
export function leadingParagraphs(text: string, limit: number): { lead: string; rest: string } {
  if (text.length <= limit) return { lead: text, rest: "" };
  const window = text.slice(0, limit);
  const paragraph = window.lastIndexOf("\n\n");
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  const cut = paragraph > limit / 3 ? paragraph : sentence > limit / 3 ? sentence + 1 : limit;
  return { lead: text.slice(0, cut).trim(), rest: text.slice(cut).trim() };
}
