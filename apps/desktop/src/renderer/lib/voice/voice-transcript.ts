import type { VoiceSpeaker } from "./voice-protocol";

export interface VoiceTranscriptFragment {
  speaker: VoiceSpeaker;
  text: string;
  startMs: number;
  endMs: number;
}

export interface VoiceTranscriptLine {
  speaker: VoiceSpeaker;
  text: string;
  startMs: number;
  endMs: number;
}

/** What a client delegation hands to the coding agent. */
export interface VoiceDelegationWindow {
  /** The user's own words since the previous delegation. */
  instruction: string;
  /** `user: …` / `assistant: …` lines since the previous delegation. */
  transcriptDelta: string[];
  /** What the voice assistant said while handing the request over, if anything. */
  voice: string | undefined;
}

/** Same-speaker fragments closer than this read as one line. */
const LINE_GAP_MS = 1_200;

function join(fragments: readonly VoiceTranscriptFragment[]): string {
  return fragments
    .map((fragment) => fragment.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Groups fragments into display lines without reordering speakers. */
export function transcriptLines(
  fragments: readonly VoiceTranscriptFragment[],
): VoiceTranscriptLine[] {
  const lines: VoiceTranscriptLine[] = [];
  for (const fragment of fragments) {
    const previous = lines.at(-1);
    if (
      previous &&
      previous.speaker === fragment.speaker &&
      fragment.startMs - previous.endMs <= LINE_GAP_MS
    ) {
      previous.text = `${previous.text}${fragment.text}`;
      previous.endMs = Math.max(previous.endMs, fragment.endMs);
      continue;
    }
    lines.push({ ...fragment });
  }
  return lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() }))
    .filter((line) => line.text.length > 0);
}

/**
 * Keeps both speakers' transcript fragments in session-timeline order. GPT-Live
 * full duplex speech can overlap, so fragments are ordered by their start time,
 * not by arrival.
 */
export class VoiceTranscript {
  private readonly fragments: VoiceTranscriptFragment[] = [];
  /** Index of the first fragment not yet handed to the agent. */
  private delegated = 0;

  add(fragment: VoiceTranscriptFragment): void {
    if (!fragment.text) return;
    let index = this.fragments.length;
    while (index > 0 && this.fragments[index - 1]!.startMs > fragment.startMs) index -= 1;
    // A late fragment that belongs before the delegation cursor joins the next window.
    this.fragments.splice(Math.max(index, this.delegated), 0, fragment);
  }

  /** True once the user has said something that has not been delegated yet. */
  hasPendingUserSpeech(): boolean {
    return this.fragments
      .slice(this.delegated)
      .some((fragment) => fragment.speaker === "user" && fragment.text.trim());
  }

  latest(speaker: VoiceSpeaker): string | null {
    const lines = transcriptLines(this.fragments).filter((line) => line.speaker === speaker);
    return lines.at(-1)?.text ?? null;
  }

  lines(): VoiceTranscriptLine[] {
    return transcriptLines(this.fragments);
  }

  /** Takes everything said since the previous delegation and advances the cursor. */
  takeDelegationWindow(): VoiceDelegationWindow {
    const window = this.fragments.slice(this.delegated);
    this.delegated = this.fragments.length;
    const user = window.filter((fragment) => fragment.speaker === "user");
    const lastUser = window.findLastIndex((fragment) => fragment.speaker === "user");
    const framing = join(
      window.slice(lastUser + 1).filter((fragment) => fragment.speaker === "assistant"),
    );
    return {
      instruction: join(user),
      transcriptDelta: transcriptLines(window).map((line) => `${line.speaker}: ${line.text}`),
      voice: framing || undefined,
    };
  }
}
