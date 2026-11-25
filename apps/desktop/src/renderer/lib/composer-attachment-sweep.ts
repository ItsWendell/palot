import { flushScheduledPersistedValues, persistedStorageKey } from "../atoms/persisted";
import { palot } from "../services/palot";
import { retainedComposerAttachmentURIs } from "./prompt-stash";

/** Started after the window has settled, so the sweep never competes with startup work. */
const SWEEP_DELAY_MS = 30_000;

/**
 * Pasted files are kept under userData so saved drafts and stashed prompts survive a restart. Once
 * per window start, files that no saved draft or stashed prompt references any more are removed.
 */
export function scheduleComposerAttachmentSweep(): void {
  setTimeout(() => {
    try {
      flushScheduledPersistedValues();
      const uris = retainedComposerAttachmentURIs(window.localStorage, persistedStorageKey(""));
      void palot.sweepComposerAttachments(uris).catch((error: unknown) => {
        console.warn("[attachments] Could not remove unused pasted files", error);
      });
    } catch (error) {
      console.warn("[attachments] Could not read saved drafts", error);
    }
  }, SWEEP_DELAY_MS);
}
