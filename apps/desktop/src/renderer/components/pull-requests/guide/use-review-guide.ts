import type { ModelRef } from "@opencode/client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { atom, useAtomValue, useStore, type PrimitiveAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { actionableErrorMessage } from "../../../../shared";
import {
  pullRequestKey,
  type PullRequestDetail,
  type PullRequestKey,
  type PullRequestRef,
} from "../../../../shared/source-control-contract";
import { newTaskDestinationAtom, runtimeAtom } from "../../../atoms/workspace";
import { useModelCatalog } from "../../../hooks/use-model-catalog";
import { useProjectCatalog } from "../../../hooks/use-session-catalog";
import { sourceControl, sourceControlKeys } from "../../../hooks/use-source-control";
import { canFetchOpenCode } from "../../../lib/opencode-runtime-query";
import {
  buildGuideInput,
  buildGuidePrompt,
  buildGuideRepairPrompt,
  isGuideStale,
  normalizeGuide,
  readGuideResponse,
  type ReviewGuide,
} from "../../../lib/review-guide";
import { reviewGuideAtom } from "../../../lib/review-guide-store";
import { projectLocation, visibleProjects } from "../../../lib/view-models";
import { generateOpenCodeText } from "../../../services/opencode-generate";
import { pickProject } from "../pull-request-actions";

/** A large change takes a while to read; past this the run is given up. */
export const REVIEW_GUIDE_TIMEOUT_MS = 5 * 60_000;

export type ReviewGuideRun =
  | { status: "running"; startedAt: number }
  | { status: "failed"; message: string };

const runAtoms = new Map<PullRequestKey, PrimitiveAtom<ReviewGuideRun | null>>();
const controllers = new Map<PullRequestKey, AbortController>();

/**
 * The run in progress, or the last one that failed, per pull request. In memory on purpose: a
 * run outlives the tab and the pull request on screen, but not the app.
 */
export function reviewGuideRunAtom(key: PullRequestKey): PrimitiveAtom<ReviewGuideRun | null> {
  let value = runAtoms.get(key);
  if (!value) {
    value = atom<ReviewGuideRun | null>(null);
    runAtoms.set(key, value);
  }
  return value;
}

export interface GuideModel {
  ref: ModelRef | null;
  label: string | null;
}

type Store = ReturnType<typeof useStore>;

/**
 * Writes a guide: reads the changed files at the latest head, asks the model once, and once
 * more to repair a reply that is not the expected JSON. The result is held to the change and
 * replaces the stored guide only when it succeeds.
 */
export async function runReviewGuide(
  store: Store,
  queryClient: QueryClient,
  input: {
    detail: PullRequestDetail;
    model: GuideModel;
    connectionID?: string;
  },
): Promise<void> {
  const { detail, model } = input;
  const key = pullRequestKey(detail);
  if (controllers.has(key)) return;
  const controller = new AbortController();
  controllers.set(key, controller);
  const runAtom = reviewGuideRunAtom(key);
  store.set(runAtom, { status: "running", startedAt: Date.now() });
  try {
    const ref: PullRequestRef = {
      host: detail.host,
      repository: detail.repository,
      number: detail.number,
    };
    const files = await queryClient.fetchQuery({
      queryKey: sourceControlKeys.pullRequestFiles(ref),
      queryFn: () => sourceControl.pullRequestFiles(ref),
      staleTime: 10_000,
    });
    if (files.files.length === 0) throw new Error("This pull request does not change any files.");
    const generate = (prompt: string) =>
      generateOpenCodeText({ prompt, model: model.ref }, input.connectionID, controller.signal, {
        timeoutMs: REVIEW_GUIDE_TIMEOUT_MS,
      });
    const first = await generate(buildGuidePrompt(buildGuideInput(detail, files)));
    let read = readGuideResponse(first);
    if (!read.ok) {
      controller.signal.throwIfAborted();
      read = readGuideResponse(await generate(buildGuideRepairPrompt(first, read.error)));
    }
    if (!read.ok)
      throw new Error(
        "The model did not return a guide Palot could read. Try again, or choose another default model.",
      );
    controller.signal.throwIfAborted();
    const guide: ReviewGuide = {
      headSha: files.headOid,
      generatedAt: new Date().toISOString(),
      model: model.label,
      stops: normalizeGuide(read.guide, files.files),
    };
    store.set(reviewGuideAtom(key), guide);
    store.set(runAtom, null);
  } catch (cause) {
    store.set(
      runAtom,
      controller.signal.aborted
        ? null
        : {
            status: "failed",
            message: actionableErrorMessage(cause, "The guide could not be written."),
          },
    );
  } finally {
    controllers.delete(key);
  }
}

export function cancelReviewGuide(key: PullRequestKey): void {
  controllers.get(key)?.abort();
}

/**
 * The model a guide is written with: OpenCode's default for the project that matches the
 * repository (the one Start task would use). Read only while `enabled`, since the catalog is a
 * server round trip; until then OpenCode picks its default itself.
 */
export function useGuideModel(
  detail: Pick<PullRequestDetail, "repository">,
  enabled: boolean,
): GuideModel & { unavailable: string | null } {
  const runtime = useAtomValue(runtimeAtom);
  const projects = useProjectCatalog();
  const destination = useAtomValue(newTaskDestinationAtom);
  const project = useMemo(
    () =>
      pickProject(visibleProjects(projects), detail.repository, destination, runtime?.profileID),
    [destination, detail.repository, projects, runtime?.profileID],
  );
  const catalog = useModelCatalog(
    { directory: project ? projectLocation(project) : "" },
    enabled && Boolean(project),
  );
  const data = catalog.data;
  const model = data?.defaultModel ?? null;
  return {
    ref: model ? { id: model.id, providerID: model.providerID } : null,
    label: model?.name ?? null,
    unavailable:
      data && !data.defaultModel && data.models.length === 0
        ? "No model is available. Connect a provider in Settings."
        : null,
  };
}

/** The stored guide for a pull request, its run, and how to write or rewrite it. */
export function useReviewGuide(detail: PullRequestDetail, options: { catalogEnabled: boolean }) {
  const key = pullRequestKey(detail);
  const store = useStore();
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  const guide = useAtomValue(reviewGuideAtom(key));
  const run = useAtomValue(reviewGuideRunAtom(key));
  const model = useGuideModel(detail, options.catalogEnabled);
  const connected = canFetchOpenCode(runtime);
  const disabledReason = !connected ? "OpenCode is not connected." : model.unavailable;
  const connectionID = runtime?.connectionID;
  const { ref: modelRef, label: modelLabel } = model;

  const write = useCallback(() => {
    if (disabledReason) return;
    void runReviewGuide(store, queryClient, {
      detail,
      model: { ref: modelRef, label: modelLabel },
      ...(connectionID ? { connectionID } : {}),
    });
  }, [connectionID, detail, disabledReason, modelLabel, modelRef, queryClient, store]);
  const cancel = useCallback(() => cancelReviewGuide(key), [key]);
  const dismissFailure = useCallback(() => {
    if (store.get(reviewGuideRunAtom(key))?.status === "failed")
      store.set(reviewGuideRunAtom(key), null);
  }, [key, store]);

  return {
    guide,
    running: run?.status === "running",
    failure: run?.status === "failed" ? run.message : null,
    stale: isGuideStale(guide, detail.headOid),
    write,
    cancel,
    dismissFailure,
    /** Why a guide cannot be written now, or null. */
    disabledReason,
    modelLabel,
  };
}

export type ReviewGuideController = ReturnType<typeof useReviewGuide>;
