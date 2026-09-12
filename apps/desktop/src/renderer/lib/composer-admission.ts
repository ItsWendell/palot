import type { PalotFileAttachment, PalotMessage, PalotSession } from "../../shared";
import type { SessionExecutionState } from "../atoms/workspace";
import type { ComposerSubmission } from "./composer-draft";

export interface ComposerAdmissionReceipt {
  id: string;
  createdAt?: number | null;
}

interface ComposerAdmissionInput {
  submission: ComposerSubmission;
  files: PalotFileAttachment[];
  delivery: "steer" | "queue";
  optimistic?: boolean;
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
  const optimistic = optimisticMessage(input.submission, input.files, input.delivery, submittedAt);
  let target: PalotSession | null = null;
  let admitted = false;

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
    const receipt = await input.dispatch(target.id, optimistic.id);
    input.effects.clearLocal();
    if (receipt) input.effects.convergeReceipt(target.id, optimistic.id, receipt);
  } catch (error) {
    if (!target) input.effects.reportCreationError(error);
    else {
      if (admitted) input.effects.rollbackOptimistic(target.id, optimistic.id, submittedAt);
      input.effects.reportDispatchError(error);
    }
  } finally {
    input.effects.setSending(false);
  }
}

function optimisticMessage(
  submission: ComposerSubmission,
  files: PalotFileAttachment[],
  delivery: "steer" | "queue",
  submittedAt: number,
): PalotMessage {
  return {
    id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "user",
    optimistic: true,
    createdAt: submittedAt,
    timelineAt: submittedAt,
    delivery,
    completedAt: submittedAt,
    text: submission.text || null,
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
