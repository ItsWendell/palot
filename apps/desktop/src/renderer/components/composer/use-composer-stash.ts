import type { PalotFileAttachment } from "../../../shared";
import { emptyComposerDraft, type ComposerDraft } from "../../lib/composer-draft";
import { attachmentsNotRestoredMessage } from "../../lib/composer-history";
import {
  deletePromptStash,
  loadPromptStash,
  restoredStashFiles,
  restorePromptStash,
  stashPrompt,
  withStashedURIs,
  type StashedPrompt,
} from "../../lib/prompt-stash";
import { showErrorToast } from "../../lib/toast-error";
import { palot } from "../../services/palot";
import { toast } from "../ui/toast";
import type { ComposerErrors } from "./use-composer-errors";
import type { ComposerDraftState } from "./use-composer-draft";

/** Copies of pasted files that no stash entry ended up keeping; best effort. */
function release(files: readonly PalotFileAttachment[], original: readonly PalotFileAttachment[]) {
  const uris = files.flatMap((file, index) =>
    file.uri === original[index]?.uri ? [] : [file.uri],
  );
  if (uris.length) void palot.releaseComposerAttachments(uris).catch(() => undefined);
}

/** Pasted files get durable copies, so a stashed prompt still has them after a restart. */
async function durableFiles(files: PalotFileAttachment[]): Promise<PalotFileAttachment[]> {
  if (!files.length) return files;
  return withStashedURIs(files, await palot.persistComposerAttachments(files.map((f) => f.uri)));
}

function unchanged(
  contents: ComposerDraftState,
  draft: ComposerDraft,
  files: PalotFileAttachment[],
): boolean {
  const current = contents.read();
  return current.draft === draft && current.files === files;
}

const CHANGED = "The prompt changed while it was being stashed. Try again.";

/** Setting the draft aside (Mod+S) and bringing a stashed prompt back, per project. */
export function useComposerStash({
  profileID,
  projectID,
  contents,
  errors,
  available,
  focus,
}: {
  profileID: string | undefined;
  projectID: string;
  contents: ComposerDraftState;
  errors: Pick<ComposerErrors, "report">;
  /** Prompt mode, no request, edit, upload or send in the way. */
  available: boolean;
  focus(): void;
}) {
  const scope = JSON.stringify([profileID, projectID]);
  const canStash =
    Boolean(profileID) && available && (contents.facts.hasText || contents.files.length > 0);
  return {
    scope,
    canStash,
    async stash() {
      if (!canStash) return;
      const { draft, files } = contents.read();
      let stored: PalotFileAttachment[] | null = null;
      try {
        stored = await durableFiles(files);
        if (!unchanged(contents, draft, files)) throw new Error(CHANGED);
        stashPrompt(scope, draft, stored);
        stored = null;
        const writer = contents.writer();
        writer.setDraft(emptyComposerDraft());
        writer.setFiles([]);
        toast.add({ type: "success", title: "Prompt stashed" });
      } catch (error) {
        if (stored) release(stored, files);
        showErrorToast("Could not stash prompt", error);
      }
    },
    async restore(id: string) {
      const { draft, files } = contents.read();
      let stored: PalotFileAttachment[] | null = null;
      try {
        const entry: StashedPrompt | undefined = loadPromptStash(scope).find(
          (item) => item.id === id,
        );
        if (!entry) throw new Error("This stashed prompt is no longer available.");
        // Swap a nonempty draft into the stash instead of overwriting it.
        stored = await durableFiles(files);
        const outcomes = await palot.restoreComposerAttachments(entry.files.map((f) => f.uri));
        if (!unchanged(contents, draft, files)) throw new Error(CHANGED);
        const restored = restorePromptStash(scope, entry.id, draft, stored);
        stored = null;
        // The entry is gone from the stash; its copies were staged again above.
        release(entry.files, []);
        const { files: restoredFiles, missing } = restoredStashFiles(restored.files, outcomes);
        const writer = contents.writer();
        writer.setDraft(restored.draft);
        writer.setFiles(restoredFiles);
        if (missing.length) errors.report(attachmentsNotRestoredMessage(missing));
        focus();
      } catch (error) {
        if (stored) release(stored, files);
        showErrorToast("Could not restore prompt", error);
      }
    },
    /** Deletes one stashed prompt and its copies of pasted files. */
    remove(id: string): boolean {
      try {
        const entry = deletePromptStash(scope, id);
        if (entry) release(entry.files, []);
        return true;
      } catch (error) {
        showErrorToast("Could not delete stashed prompt", error);
        return false;
      }
    },
  };
}
