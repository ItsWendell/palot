import type { PalotBrowserComment } from "../../../shared/browser-contract";
import type { PalotModel, PalotSession } from "../../../shared";
import type { useComposerPermissions } from "../../hooks/use-composer-permissions";
import { parseBtwQuestion } from "../../lib/btw";
import { projectComposerSubmission } from "../../lib/composer-draft";
import type { ComposerMode } from "../../lib/composer-history";
import { sendToSeveralModels } from "../../lib/composer-multi-model";
import { recentPromptFromSubmission, saveRecentPrompt } from "../../lib/composer-recent-prompts";
import { palot } from "../../services/palot";
import type { NewSessionComposerOptions } from "./composer-props";
import type { ComposerCatalogs } from "./use-composer-catalogs";
import type { ComposerContents, ComposerDraftState } from "./use-composer-draft";
import type { ComposerHistory } from "./use-composer-history";

/**
 * "Send to several models": one new task per model with the same prompt. The draft clears only
 * when every task was created and sent.
 */
export function sendToModels({
  newTask,
  mode,
  contents,
  history,
  selection,
  permissions,
  recentScope,
  browserComments,
}: {
  newTask?(options: NewSessionComposerOptions): Promise<PalotSession | null>;
  mode: ComposerMode;
  contents: ComposerDraftState;
  history: ComposerHistory;
  selection: ComposerCatalogs["selection"];
  permissions: ReturnType<typeof useComposerPermissions>;
  recentScope: string | null;
  browserComments(contents: ComposerContents): PalotBrowserComment[];
}) {
  const { store, stateAtom, setSending } = contents;
  return async function submitToModels(models: PalotModel[], canSubmit: boolean) {
    const submitted = contents.read();
    const submission = projectComposerSubmission(submitted.draft);
    if (
      !newTask ||
      submission.kind !== "prompt" ||
      mode !== "normal" ||
      parseBtwQuestion(submitted.draft.text) !== null
    )
      throw new Error("Use an ordinary prompt in a new task to compare models.");
    if (!canSubmit || store.get(stateAtom).sending)
      throw new Error("Wait for the composer to be ready.");
    selection.assertConnection();
    permissions.assertReady();
    const options = {
      approvalMode: permissions.draftMode,
      agent: selection.session.agent,
      deferNavigation: true,
    };
    const submittedBrowserComments = browserComments(submitted);
    setSending(true);
    try {
      const results = await sendToSeveralModels({
        models,
        text: submission.text,
        create: (model, title) => {
          selection.assertConnection();
          return newTask({
            ...options,
            model: { providerID: model.providerID, id: model.id },
            title,
          });
        },
        send: (target, model) => {
          selection.assertConnection();
          return palot.sendComposerPrompt({
            sessionID: target.id,
            text: submission.text,
            files: submitted.files,
            fileReferences: submission.files,
            skillReferences: submission.skills,
            agentReferences: submission.agents,
            directoryReferences: submission.references,
            browserComments: submittedBrowserComments,
            comments: submitted.comments.map(({ path, comment, selection: range, side }) => ({
              path,
              comment,
              selection: range,
              ...(side ? { side } : {}),
              origin: "review" as const,
            })),
            modelInput: model.capabilities.input,
            delivery: "steer",
          });
        },
      });
      if (results.every((result) => result.sent)) {
        contents.clearSubmitted(submitted);
        history.reset();
        saveRecentPrompt(
          recentScope,
          recentPromptFromSubmission({
            draft: submitted.draft,
            files: submitted.files,
            comments: submitted.comments,
            createdAt: Date.now(),
          }),
        );
        selection.rememberCreated();
        permissions.resetDraft();
      }
      return results;
    } finally {
      setSending(false);
    }
  };
}
