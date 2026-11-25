import { useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PalotMessage } from "../../../shared";
import { palot } from "../../services/palot";
import type { BackgroundWorkItem } from "../subagent-activity";
import type { ComposerRunningWorkAtom } from "./composer-standing";
import type { ComposerLive } from "./use-latest";

/** A steer still waiting behind foreground work this long offers (or does) the backgrounding. */
const STEER_BACKGROUND_DELAY_MS = 5_000;

interface PendingBackgroundSteer {
  id: string;
  submittedAt: number;
  blockerIDs: Set<string>;
}

export interface BackgroundSteerPrompt {
  submittedAt: number;
  retry: boolean;
  error: string | null;
}

/**
 * A steer sent while foreground subagent work runs can wait behind it. After a few seconds the
 * composer offers to move that work to the background, or does it when the setting says so; the
 * offer goes away once the steer is delivered, leaves the inbox or the work ends.
 */
export function useBlockedSteer({
  sessionID,
  messages,
  runningWork,
  live,
  autoBackground,
}: {
  sessionID: string;
  messages: PalotMessage[];
  /** Read when needed; followed only while a steer waits, so other changes render nothing. */
  runningWork: ComposerRunningWorkAtom | undefined;
  live: ComposerLive;
  autoBackground: boolean;
}) {
  const store = useStore();
  const readWork = useCallback(
    (): BackgroundWorkItem[] => (runningWork ? store.get(runningWork).items : []),
    [runningWork, store],
  );
  const [pending, setPending] = useState<PendingBackgroundSteer | null>(null);
  const [prompt, setPrompt] = useState<BackgroundSteerPrompt | null>(null);
  const [backgrounding, setBackgrounding] = useState(false);
  const actingRef = useRef(false);

  const steerMessage = useCallback(
    (record: PendingBackgroundSteer): PalotMessage | null =>
      live.current.messages.find((candidate) => candidate.id === record.id) ??
      live.current.messages.find(
        (candidate) =>
          candidate.type === "user" &&
          candidate.delivery === "steer" &&
          candidate.createdAt === record.submittedAt,
      ) ??
      null,
    [live],
  );

  const isWaiting = useCallback(
    (record: PendingBackgroundSteer): boolean =>
      live.current.pendingInputs.some(
        (request) =>
          request.type === "input" &&
          request.delivery === "steer" &&
          (request.id === record.id || request.createdAt === record.submittedAt),
      ),
    [live],
  );

  const blockersOf = useCallback(
    (record: PendingBackgroundSteer): BackgroundWorkItem[] =>
      readWork().filter((item) => record.blockerIDs.has(item.id) && !item.background),
    [readWork],
  );

  const clear = useCallback((record: PendingBackgroundSteer) => {
    setPending((current) => (current?.submittedAt === record.submittedAt ? null : current));
    setPrompt((current) => (current?.submittedAt === record.submittedAt ? null : current));
    actingRef.current = false;
  }, []);

  const backgroundBlockers = useCallback(
    async (record: PendingBackgroundSteer) => {
      if (actingRef.current || !isWaiting(record) || blockersOf(record).length === 0) {
        if (!actingRef.current) clear(record);
        return;
      }
      actingRef.current = true;
      setBackgrounding(true);
      try {
        await palot.backgroundSession(sessionID);
        clear(record);
      } catch (error) {
        actingRef.current = false;
        if (!isWaiting(record) || blockersOf(record).length === 0) {
          clear(record);
          return;
        }
        setPrompt({
          submittedAt: record.submittedAt,
          retry: true,
          error:
            error instanceof Error && error.message
              ? `Could not background the blocking work: ${error.message}`
              : "Could not background the blocking work.",
        });
      } finally {
        setBackgrounding(false);
      }
    },
    [blockersOf, clear, isWaiting, sessionID],
  );

  // While a steer waits, a change in running work re-runs the check below.
  const [workRevision, setWorkRevision] = useState(0);
  const watching = pending !== null;
  useEffect(() => {
    if (!watching || !runningWork) return;
    return store.sub(runningWork, () => setWorkRevision((revision) => revision + 1));
  }, [runningWork, store, watching]);

  // The pending steer record is external session lifecycle state that must be retired immediately.
  /* eslint-disable react-hooks-compiler/set-state-in-effect */
  useEffect(() => {
    const record = pending;
    if (!record) return;
    const message = steerMessage(record);
    const waiting = isWaiting(record);
    if (
      (message && message.runCompletedAt !== undefined) ||
      (prompt?.submittedAt === record.submittedAt && !waiting) ||
      (Date.now() >= record.submittedAt + STEER_BACKGROUND_DELAY_MS &&
        (!waiting || blockersOf(record).length === 0))
    ) {
      clear(record);
      return;
    }
    if (prompt?.submittedAt === record.submittedAt) return;
    const timeout = window.setTimeout(
      () => {
        if (!isWaiting(record) || blockersOf(record).length === 0) {
          clear(record);
          return;
        }
        if (autoBackground) void backgroundBlockers(record);
        else setPrompt({ submittedAt: record.submittedAt, retry: false, error: null });
      },
      Math.max(0, record.submittedAt + STEER_BACKGROUND_DELAY_MS - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [
    autoBackground,
    backgroundBlockers,
    workRevision,
    blockersOf,
    clear,
    isWaiting,
    messages,
    pending,
    prompt,
    steerMessage,
  ]);
  /* eslint-enable react-hooks-compiler/set-state-in-effect */

  const background = useCallback(() => {
    if (pending) void backgroundBlockers(pending);
  }, [backgroundBlockers, pending]);

  return {
    /** Foreground work the waiting steer is blocked by, while the offer is shown. */
    promptItems: prompt
      ? readWork().filter((item) => pending?.blockerIDs.has(item.id) === true && !item.background)
      : [],
    prompt,
    /** The steer the offer is about, while it is shown. */
    waiting: prompt && pending ? { id: pending.id, submittedAt: pending.submittedAt } : null,
    backgrounding,
    background,
    /** Starts watching a steer submitted at `submittedAt` if foreground work started before it. */
    track(id: string, submittedAt: number) {
      const blockers = readWork().filter(
        (item) => !item.background && item.startedAt < submittedAt,
      );
      if (blockers.length === 0) return;
      actingRef.current = false;
      setPrompt(null);
      setPending({ id, submittedAt, blockerIDs: new Set(blockers.map((item) => item.id)) });
    },
    /** The optimistic steer was admitted under the server's message ID. */
    converge(optimisticID: string, receiptID: string) {
      setPending((current) =>
        current?.id === optimisticID ? { ...current, id: receiptID } : current,
      );
    },
    /** The optimistic steer was rolled back; stop watching it. */
    forget(optimisticID: string, startedAt: number) {
      setPending((current) =>
        current?.id === optimisticID || current?.submittedAt === startedAt ? null : current,
      );
      setPrompt((current) => (current?.submittedAt === startedAt ? null : current));
      actingRef.current = false;
    },
  };
}

export type BlockedSteer = ReturnType<typeof useBlockedSteer>;
