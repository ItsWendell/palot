/**
 * The launcher's content in the card's panel slot. It is the only part that reads the launcher's
 * full state and data, so a query or a highlight change renders this list and nothing else.
 */

import { useAtomValue, useStore } from "jotai";
import { memo, useLayoutEffect, useMemo, useState } from "react";
import { reviewInstructionsAtom } from "../../atoms/review-instructions";
import { useReviewBase } from "../../hooks/use-vcs-info";
import type { LocationRef } from "@opencode/client";
import { LauncherList } from "../composer-launcher/launcher-list";
import type { LauncherSources } from "../composer-launcher/launcher-items";
import { highlightedItem, type LauncherState } from "../composer-launcher/launcher-state";
import { useLauncherData } from "../composer-launcher/use-launcher-data";
import type { ComposerLauncher } from "./use-composer-launcher";

/** What the launcher lists for this composer; rebuilt only when the task or its place changes. */
export interface ComposerLauncherData {
  location: LocationRef;
  projectID: string;
  outputProjectID: string;
  /** The open task; null for a new task. */
  sessionID: string | null;
  workbenchSessionID: string;
  newTask: boolean;
  stashScope: string;
  attachDisabled: boolean;
  /** The task's approvals, which the launcher's Approvals entry changes. */
  approvals: LauncherSources["approvals"];
  /** The task's state for "Suggested", read when the launcher opens. */
  session(): LauncherSources["session"];
}

export const ComposerLauncherPanel = memo(function ComposerLauncherPanel({
  launcher,
  data,
}: {
  launcher: ComposerLauncher;
  data: ComposerLauncherData;
}) {
  const store = useStore();
  const live = useAtomValue(launcher.stateAtom);
  // While the panel closes it keeps showing the last open level instead of emptying.
  const [shown, setShown] = useState<LauncherState>(live);
  if (live.status === "open" && live !== shown) setShown(live);
  const state = live.status === "open" ? live : shown;
  const [session] = useState(data.session);
  const stashRevision = useAtomValue(launcher.stashRevisionAtom);
  // The review picker reads the review base only while it is open.
  const reviewBase = useReviewBase(
    data.location,
    state.status === "open" && state.category === "review",
  );
  const instructions = useAtomValue(reviewInstructionsAtom);
  const review = useMemo(
    () => ({ base: reviewBase.ref, instructions }),
    [instructions, reviewBase.ref],
  );
  const { view, sources, now } = useLauncherData({
    state,
    location: data.location,
    projectID: data.projectID,
    outputProjectID: data.outputProjectID,
    sessionID: data.sessionID,
    workbenchSessionID: data.workbenchSessionID,
    newTask: data.newTask,
    stashScope: data.stashScope,
    stashRevision,
    session,
    attachDisabled: data.attachDisabled,
    approvals: data.approvals,
    review,
  });

  const active = live.status === "open" ? (highlightedItem(live, view.items)?.id ?? null) : null;
  const { activeAtom, viewInputs } = launcher;
  useLayoutEffect(() => {
    viewInputs.current = { sources, now };
  }, [now, sources, viewInputs]);
  useLayoutEffect(() => {
    if (store.get(activeAtom) !== active) store.set(activeAtom, active);
  }, [active, activeAtom, store]);
  useLayoutEffect(
    () => () => {
      viewInputs.current = null;
      store.set(activeAtom, null);
    },
    [activeAtom, store, viewInputs],
  );

  return (
    <LauncherList listId={launcher.listId} state={state} view={view} onEvent={launcher.dispatch} />
  );
});
