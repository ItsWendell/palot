import { Map as MapIcon, Sparkles } from "lucide-react";
import { useMemo } from "react";
import type { PullRequestDetail, PullRequestRef } from "../../../../shared/source-control-contract";
import { usePullRequestFiles } from "../../../hooks/use-source-control";
import type { ReviewGuideStop } from "../../../lib/review-guide";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { Spinner } from "../../ui/spinner";
import { useStartPullRequestTask } from "../pull-request-actions";
import { askAboutStopPrompt } from "./guide-model";
import { GuideTour } from "./guide-tour";
import type { ReviewGuideController } from "./use-review-guide";

const WRITING = "Writing guide… this can take a minute.";

/**
 * The Guide tab: a maintainer's tour of the pull request, written on request and kept on this
 * device. Opening the tab never runs a model; Write guide does.
 */
export function PullRequestGuideTab({
  pullRequest,
  controller,
}: {
  pullRequest: PullRequestDetail;
  controller: ReviewGuideController;
}) {
  const { host, repository, number } = pullRequest;
  const ref = useMemo<PullRequestRef>(
    () => ({ host, repository, number }),
    [host, repository, number],
  );
  const files = usePullRequestFiles(ref);
  const startTask = useStartPullRequestTask();
  const { guide, running, failure, stale, write, cancel, dismissFailure, disabledReason } =
    controller;

  const failureBanner = (
    <Banner
      open={failure !== null}
      status="error"
      title="Could not write the guide"
      dismissible
      onDismiss={dismissFailure}
    >
      {failure}
    </Banner>
  );

  if (!guide) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 p-4">
        {failureBanner}
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {running ? <Spinner /> : <MapIcon aria-hidden="true" />}
            </EmptyMedia>
            <EmptyTitle>{running ? "Writing a review guide" : "No review guide yet"}</EmptyTitle>
            <EmptyDescription>
              {running
                ? WRITING
                : "A guide is a short tour of the change for deciding whether it should land: stops in reading order, the code that carries each idea, and the few calls only you can make. Mechanical changes are grouped at the end."}
            </EmptyDescription>
          </EmptyHeader>
          {running ? (
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Button type="button" size="sm" disabled={disabledReason !== null} onClick={write}>
                <Sparkles data-icon="inline-start" aria-hidden="true" />
                {failure ? "Try again" : "Write guide"}
              </Button>
              {disabledReason ? (
                <p className="text-meta text-muted-foreground">{disabledReason}</p>
              ) : null}
            </div>
          )}
        </Empty>
      </div>
    );
  }

  const banner = running ? (
    <Banner
      status="info"
      icon={Spinner}
      title={WRITING}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={cancel}>
          Cancel
        </Button>
      }
    />
  ) : failure ? (
    failureBanner
  ) : stale ? (
    <Banner
      status="warning"
      title="Written before the latest push"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabledReason !== null}
          onClick={write}
        >
          Rewrite
        </Button>
      }
    >
      Excerpts may point at lines that have since moved.
    </Banner>
  ) : null;

  const ask = (stop: ReviewGuideStop, index: number, question?: string) =>
    void startTask(
      "detail",
      pullRequest,
      askAboutStopPrompt({
        url: pullRequest.url,
        stop,
        index,
        stopCount: guide.stops.length,
        ...(question ? { question } : {}),
      }),
    );

  return (
    <GuideTour
      pullRequest={pullRequest}
      guide={guide}
      files={files.data}
      banner={banner}
      onAsk={ask}
    />
  );
}
