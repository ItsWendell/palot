/**
 * GPT-Live data-channel events Palot reads and the commands it sends.
 * Reference: https://developers.openai.com/api/docs/guides/live-conversations
 */

export type VoiceSpeaker = "user" | "assistant";

export type VoiceCloseReason =
  | "close_requested"
  | "expired"
  | "content"
  | "remote_hangup"
  | "connection_lost";

export type VoiceServerEvent =
  | { type: "session.started"; sessionID: string }
  | { type: "session.closed"; reason: VoiceCloseReason | string | undefined; seconds?: number }
  | { type: "transcript"; speaker: VoiceSpeaker; delta: string; startMs: number; endMs: number }
  | { type: "delegation"; delegationID: string; offsetMs: number }
  | { type: "usage"; seconds: number; contextRatio?: number }
  | { type: "input-muted"; muted: boolean }
  | { type: "error"; message: string; code?: string; clientEventID?: string };

/** Commands the renderer sends on the `oai-events` data channel. */
export type VoiceClientCommand =
  | { type: "session.close" }
  | { type: "session.input_audio.mute" }
  | { type: "session.input_audio.unmute" }
  | {
      type: "session.commentary.append" | "session.thinking.append" | "session.instructions.append";
      delegation_id: string | null;
      content: string;
    };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Decodes one data-channel message. Unknown or malformed events return `undefined`. */
export function parseVoiceServerEvent(data: unknown): VoiceServerEvent | undefined {
  if (typeof data !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  const event = record(parsed);
  if (!event) return undefined;
  switch (event.type) {
    case "session.started": {
      const id = text(record(event.session)?.id);
      return id ? { type: "session.started", sessionID: id } : undefined;
    }
    case "session.closed": {
      const seconds = finite(record(event.usage)?.seconds);
      return {
        type: "session.closed",
        reason: text(event.reason),
        ...(seconds === undefined ? {} : { seconds }),
      };
    }
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      const delta = text(event.delta);
      const startMs = finite(event.start_ms);
      const endMs = finite(event.end_ms);
      if (delta === undefined || startMs === undefined || endMs === undefined) return undefined;
      return {
        type: "transcript",
        speaker: event.type === "session.input_transcript.delta" ? "user" : "assistant",
        delta,
        startMs,
        endMs,
      };
    }
    case "session.delegation.created": {
      const delegation = record(event.delegation);
      const id = text(delegation?.id);
      if (!id || delegation?.target !== "client") return undefined;
      return { type: "delegation", delegationID: id, offsetMs: finite(event.offset_ms) ?? 0 };
    }
    case "session.usage.updated": {
      const seconds = finite(record(event.usage)?.seconds);
      if (seconds === undefined) return undefined;
      const ratio = finite(record(event.context_window)?.usage_ratio);
      return { type: "usage", seconds, ...(ratio === undefined ? {} : { contextRatio: ratio }) };
    }
    case "session.input_audio.muted":
      return { type: "input-muted", muted: true };
    case "session.input_audio.unmuted":
      return { type: "input-muted", muted: false };
    case "error": {
      const error = record(event.error);
      const code = text(error?.code);
      const clientEventID = text(error?.client_event_id);
      return {
        type: "error",
        message: text(error?.message) ?? "The voice service reported an error.",
        ...(code ? { code } : {}),
        ...(clientEventID ? { clientEventID } : {}),
      };
    }
    default:
      return undefined;
  }
}

/** GPT-Live limits each context append to 500 tokens. Characters are a conservative proxy. */
export const VOICE_APPEND_CHARACTER_LIMIT = 1_600;

/** Splits text at paragraph, then sentence, then word boundaries so each append stays in budget. */
export function splitForAppend(content: string, limit = VOICE_APPEND_CHARACTER_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = content.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
    );
    const at =
      cut > limit / 3 ? cut + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : limit;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
