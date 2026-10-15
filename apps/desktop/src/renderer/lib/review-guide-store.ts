/**
 * The last review guide written for each pull request, kept on this device. Bounded twice:
 * the most recent guides only, and a size cap per guide so one huge pull request cannot fill
 * local storage. A guide too large to keep stays readable until the app restarts.
 */

import { atom, type WritableAtom } from "jotai";
import type { PullRequestKey } from "../../shared/source-control-contract";
import {
  loadScopedPersistedValue,
  removeScopedPersistedValue,
  saveScopedPersistedValue,
} from "../atoms/persisted";
import { isReviewGuide, type ReviewGuide } from "./review-guide";

const FAMILY = "pull-requests.review-guides";
/** Guides kept across restarts; older ones are dropped first. */
export const MAX_STORED_GUIDES = 30;
/** Characters of one stored guide's JSON. */
export const MAX_STORED_GUIDE_CHARS = 250_000;

export function loadReviewGuide(key: PullRequestKey): ReviewGuide | null {
  return loadScopedPersistedValue<ReviewGuide | null>({
    family: FAMILY,
    scope: key,
    maxEntries: MAX_STORED_GUIDES,
    initialValue: null,
    validate: (value): value is ReviewGuide | null => value === null || isReviewGuide(value),
  });
}

/** Persists a guide; false when it is too large to keep (it stays in memory). */
export function saveReviewGuide(key: PullRequestKey, guide: ReviewGuide | null): boolean {
  if (guide === null) {
    removeScopedPersistedValue(FAMILY, key);
    return true;
  }
  if (JSON.stringify(guide).length > MAX_STORED_GUIDE_CHARS) {
    // Never leave an older guide behind to reappear after a restart.
    removeScopedPersistedValue(FAMILY, key);
    return false;
  }
  saveScopedPersistedValue(FAMILY, key, guide, MAX_STORED_GUIDES);
  return true;
}

type GuideAtom = WritableAtom<ReviewGuide | null, [ReviewGuide | null], void>;
const guideAtoms = new Map<PullRequestKey, GuideAtom>();

/** The stored guide for a pull request, read from storage on first use in each store. */
export function reviewGuideAtom(key: PullRequestKey): GuideAtom {
  let value = guideAtoms.get(key);
  if (!value) {
    const written = atom<{ guide: ReviewGuide | null } | null>(null);
    value = atom(
      (get) => {
        const local = get(written);
        return local ? local.guide : loadReviewGuide(key);
      },
      (_get, set, guide: ReviewGuide | null) => {
        set(written, { guide });
        saveReviewGuide(key, guide);
      },
    );
    guideAtoms.set(key, value);
  }
  return value;
}
