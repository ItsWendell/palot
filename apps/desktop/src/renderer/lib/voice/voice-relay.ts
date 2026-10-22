import type { TranscriptTurn } from "../turn-projection";
import type { PendingRequestView } from "../view-models";
import { splitForAppend, VOICE_APPEND_CHARACTER_LIMIT } from "./voice-protocol";
import { leadingParagraphs, speakableText } from "./voice-prompts";

export interface VoiceRelayFrame {
  turns: readonly TranscriptTurn[];
  /** Pending requests for the session and its subagents. */
  requests: readonly PendingRequestView[];
  /** The session (or one of its subagents) is running. */
  busy: boolean;
}

export interface VoiceRelayOutput {
  /** Commentary is spoken (paraphrased); thinking is silent context. */
  kind: "commentary" | "thinking";
  delegationID: string | null;
  content: string;
}

export interface VoiceRelayUpdate {
  outputs: VoiceRelayOutput[];
  /** Short progress line for the call UI, or null while nothing is running. */
  status: string | null;
}

/** Progress notes are silent context; keep them sparse so they stay useful. */
const PROGRESS_INTERVAL_MS = 8_000;
/** Spoken summary budget; the remainder goes in at most two silent chunks. */
const SPOKEN_LIMIT = 900;
const SILENT_LIMIT = VOICE_APPEND_CHARACTER_LIMIT * 2;
/** A turn that finished just before the prompt was admitted is not this delegation's result. */
const COMPLETION_SLACK_MS = 500;

function turnText(turn: TranscriptTurn): string {
  const final = turn.final;
  if (!final) return "";
  return (final.part.text ?? final.message.text ?? "").trim();
}

function workingStatus(turn: TranscriptTurn | undefined): string | null {
  if (!turn || turn.status !== "working") return null;
  const group = turn.activity.at(-1);
  if (turn.final && turn.final.part.streaming) return "Writing a reply";
  const title = group?.currentAction ?? group?.title;
  return title?.trim() || "Working";
}

function requestStatus(requests: readonly PendingRequestView[]): string | null {
  if (requests.some((request) => request.type === "permission")) return "Waiting for your approval";
  if (requests.length > 0) return "Waiting for your answer";
  return null;
}

function describeRequest(request: PendingRequestView): string {
  if (request.type === "permission") {
    const detail = request.detail ? ` (${request.detail})` : "";
    return `The backend needs the user's approval to continue: ${request.title}${detail}. It is waiting in Palot; the user must review it there.`;
  }
  const question = request.questions[0];
  if (question) {
    const options = question.options.map((option) => option.label).slice(0, 4);
    const choices = options.length ? ` Options: ${options.join(", ")}.` : "";
    return `The backend asks: ${question.question}${choices} The user can answer in Palot, or tell you and you'll pass it on.`;
  }
  return `The backend needs input from the user: ${request.title}. It is waiting in Palot.`;
}

/**
 * Turns OpenCode session progress into GPT-Live context updates for client
 * delegation. One relay lives for one call.
 */
export class VoiceAgentRelay {
  private delegationID: string | null = null;
  private awaitingSince: number | null = null;
  private readonly announcedRequests = new Set<string>();
  private lastProgress: string | null = null;
  private lastProgressAt = 0;
  private primed = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** A delegation was sent to the session; its result should be reported back. */
  delegated(delegationID: string): void {
    this.delegationID = delegationID;
    this.awaitingSince = this.now();
    this.lastProgress = null;
  }

  /** True while a delegated request has not produced a result yet. */
  get awaiting(): boolean {
    return this.awaitingSince !== null;
  }

  update(frame: VoiceRelayFrame): VoiceRelayUpdate {
    const outputs: VoiceRelayOutput[] = [];
    const latest = frame.turns.at(-1);

    if (!this.primed) {
      this.primed = true;
      for (const request of frame.requests) this.announcedRequests.add(request.id);
      if (frame.requests.length > 0) {
        outputs.push({
          kind: "thinking",
          delegationID: null,
          content: `Already waiting in Palot before the call started: ${frame.requests.map((request) => request.title).join("; ")}.`,
        });
      }
    }

    for (const request of frame.requests) {
      if (this.announcedRequests.has(request.id)) continue;
      this.announcedRequests.add(request.id);
      outputs.push({
        kind: "commentary",
        delegationID: this.delegationID,
        content: describeRequest(request),
      });
    }

    const status =
      requestStatus(frame.requests) ?? (frame.busy ? (workingStatus(latest) ?? "Working") : null);

    if (this.awaitingSince !== null && frame.busy && status && status !== this.lastProgress) {
      const now = this.now();
      if (now - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
        this.lastProgress = status;
        this.lastProgressAt = now;
        outputs.push({
          kind: "thinking",
          delegationID: this.delegationID,
          content: `Backend progress: ${status}.`,
        });
      }
    }

    if (this.awaitingSince !== null && !frame.busy && latest && latest.status !== "working") {
      const finishedAt = latest.completedAt ?? latest.workCompletedAt ?? 0;
      if (finishedAt + COMPLETION_SLACK_MS >= this.awaitingSince) {
        outputs.push(...this.result(latest));
        this.awaitingSince = null;
      }
    }

    return { outputs, status };
  }

  private result(turn: TranscriptTurn): VoiceRelayOutput[] {
    const delegationID = this.delegationID;
    if (turn.status === "interrupted") {
      return [
        {
          kind: "commentary",
          delegationID,
          content: "The backend's work was stopped before it finished.",
        },
      ];
    }
    const text = speakableText(turnText(turn));
    if (turn.status === "failed") {
      const reason = text ? ` Last message: ${leadingParagraphs(text, 300).lead}` : "";
      return [
        {
          kind: "commentary",
          delegationID,
          content: `The backend's work failed.${reason} Details are in Palot.`,
        },
      ];
    }
    if (!text) {
      return [
        {
          kind: "commentary",
          delegationID,
          content: "The backend finished without a written reply. Details are in Palot.",
        },
      ];
    }
    const { lead, rest } = leadingParagraphs(text, SPOKEN_LIMIT);
    const outputs: VoiceRelayOutput[] = [
      { kind: "commentary", delegationID, content: `The backend finished: ${lead}` },
    ];
    if (rest) {
      const silent = rest.length > SILENT_LIMIT ? `${rest.slice(0, SILENT_LIMIT)}…` : rest;
      for (const chunk of splitForAppend(`More detail from the backend's reply: ${silent}`)) {
        outputs.push({ kind: "thinking", delegationID, content: chunk });
      }
    }
    return outputs;
  }
}
