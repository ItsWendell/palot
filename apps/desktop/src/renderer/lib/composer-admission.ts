import type { PalotFileAttachment, PalotMessage, PalotSession } from "../../shared";
import type { SessionExecutionState } from "../atoms/workspace";
import type { ComposerSubmission } from "./composer-draft";
import { formatReviewComment, type ReviewComment } from "./review-comments";
import { formatBrowserComment } from "./browser-comments";
import type { PalotBrowserComment } from "../../shared/browser-contract";

export interface ComposerAdmissionReceipt {
  id: string;
  createdAt?: number | null;
}

interface ComposerAdmissionInput {
  submission: ComposerSubmission;
  files: PalotFileAttachment[];
  comments?: Omit<ReviewComment, "id">[];
  browserComments?: PalotBrowserComment[];
  delivery: "steer" | "queue";
  optimistic?: boolean;
  /**
   * Hand the composer back when dispatch is still pending after this long. A slash command can
   * run for minutes before OpenCode responds; a later failure is still reported.
   */
  detachAfterMs?: number;
  createTarget(): Promise<PalotSession | null>;
  dispatch(
    sessionID: string,
    messageID: string,
  ): Promise<ComposerAdmissionReceipt | null | undefined>;
  effects: ComposerAdmissionEffects;
}

export interface ComposerAdmissionEffects {
  setSending(sending: boolean): void;
  /** Retire the submitted contents after dispatch succeeds, without clearing newer edits. */
  clearLocal(): void;
  admitOptimistic(input: {
    sessionID: string;
    message: PalotMessage;
    execution: SessionExecutionState;
  }): void;
  convergeReceipt(sessionID: string, optimisticID: string, receipt: ComposerAdmissionReceipt): void;
  rollbackOptimistic(sessionID: string, optimisticID: string, startedAt: number): void;
  reportCreationError(error: unknown): void;
  reportDispatchError(error: unknown): void;
}

export async function admitComposerSubmission(input: ComposerAdmissionInput): Promise<void> {
  const submittedAt = Date.now();
  const optimistic = optimisticMessage(
    input.submission,
    input.files,
    input.delivery,
    submittedAt,
    input.comments ?? [],
    input.browserComments ?? [],
  );
  let target: PalotSession | null = null;
  let admitted = false;
  let detachTimer: ReturnType<typeof setTimeout> | undefined;

  input.effects.setSending(true);
  try {
    target = await input.createTarget();
    if (!target) throw new Error("Could not create this task");
    if (input.optimistic !== false) {
      input.effects.admitOptimistic({
        sessionID: target.id,
        message: optimistic,
        execution: { status: "running", startedAt: submittedAt, completedAt: null },
      });
      admitted = true;
    }
    const dispatched = input.dispatch(target.id, optimistic.id);
    const receipt = await (input.detachAfterMs === undefined
      ? dispatched
      : Promise.race([
          dispatched,
          new Promise<typeof DETACHED>((resolve) => {
            detachTimer = setTimeout(() => resolve(DETACHED), input.detachAfterMs);
          }),
        ]));
    if (receipt === DETACHED) {
      const sessionID = target.id;
      input.effects.clearLocal();
      void dispatched.catch((error: unknown) => {
        if (admitted) input.effects.rollbackOptimistic(sessionID, optimistic.id, submittedAt);
        input.effects.reportDispatchError(error);
      });
      return;
    }
    input.effects.clearLocal();
    if (receipt) input.effects.convergeReceipt(target.id, optimistic.id, receipt);
  } catch (error) {
    if (!target) input.effects.reportCreationError(error);
    else {
      if (admitted) input.effects.rollbackOptimistic(target.id, optimistic.id, submittedAt);
      input.effects.reportDispatchError(error);
    }
  } finally {
    clearTimeout(detachTimer);
    input.effects.setSending(false);
  }
}

const DETACHED = Symbol("detached");

function optimisticMessage(
  submission: ComposerSubmission,
  files: PalotFileAttachment[],
  delivery: "steer" | "queue",
  submittedAt: number,
  comments: Omit<ReviewComment, "id">[],
  browserComments: PalotBrowserComment[],
): PalotMessage {
  return {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "user",
    optimistic: true,
    createdAt: submittedAt,
    timelineAt: submittedAt,
    delivery,
    completedAt: submittedAt,
    text:
      [
        submission.text,
        ...comments.map(formatReviewComment),
        ...browserComments.map(formatBrowserComment),
      ]
        .filter(Boolean)
        .join("\n") || null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    ...(files.length > 0 ? { files } : {}),
    ...(submission.files.length > 0
      ? {
          fileReferences: submission.files.map((file) => ({
            uri: `workspace:${file.path}`,
            name: file.name,
            mention: file.mention,
          })),
        }
      : {}),
    ...(submission.skills.length > 0 ? { skillReferences: submission.skills } : {}),
    content: [],
    data: null,
  };
}
