import type { FileDiffInfo, FormValue } from "@opencode/client";
import { isCancelledError } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Copy,
  FileText,
  FolderGit2,
  GitBranch,
  GitFork,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Sparkles,
  Undo2,
} from "lucide-react";
import { motion } from "motion/react";
import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PalotMessage, PalotMessageContent, PalotModel, PalotSession } from "../../shared";
import {
  activityGroupOpenAtomFamily,
  sessionProjectionPreferenceAtom,
  showTimelineCacheBustsAtom,
  turnActivityOpenAtomFamily,
} from "../atoms/ui";
import {
  belongsToSession,
  runtimeAtom,
  selectedSessionIDAtom,
  subagentProgress as calculateSubagentProgress,
  type SessionExecutionState,
} from "../atoms/workspace";
import { contextMessageTargetAtom, useWorkbenchCommands } from "../atoms/workbench";
import { attentionTargetAtom } from "../atoms/attention";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { retainedTranscriptLayouts } from "../lib/transcript-layout-cache";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { useSessionTranscriptProjection } from "../hooks/use-session-transcript-projection";
import { useSessionRequests, useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import type { OwnedPendingRequestView } from "../lib/session-family-requests";
import { useSessionActivityForSession } from "../hooks/use-session-activity";
import { useRunningShells } from "../hooks/use-running-shells";
import { ProcessFooterControl } from "./process-footer-control";
import {
  useCacheSession,
  useProjectCatalog,
  useSessionCatalog,
  useSessionCatalogSelector,
} from "../hooks/use-session-catalog";
import { cn } from "../lib/cn";
import { writeClipboardText } from "../lib/clipboard";
import { likelyCacheBusts, type LikelyCacheBust } from "../lib/cache-bust";
import { resolveSessionProjectionPreference } from "../lib/session-projection-policy";
import { projectToolExecution } from "../lib/tool-executions";
import { recordStreamingCommit } from "../lib/streaming-latency";
import {
  readTranscriptScrollUpdate,
  normalizeTranscriptWheelDelta,
  scheduleTranscriptScrollFrame,
  transcriptKeyboardScrollDelta,
  transcriptScrollTargetConsumesDelta,
  type TranscriptScrollIntent,
} from "../lib/transcript-scroll";
import { showErrorToast } from "../lib/toast-error";
import {
  createReasoningTitle,
  sameTurnActivityGroup,
  splitReasoningContent,
  type TranscriptBackgroundFacts,
  type TranscriptPresentationRow,
  type TranscriptProjectionRow,
  type TurnActivityGroup,
  type TranscriptTurn,
  type TurnPart,
  type TurnPostFinalItem,
} from "../lib/turn-projection";
import {
  isTool,
  messageRole,
  messageText,
  pendingRequestViews,
  projectForSession,
  projectLocation,
  projectName,
  sessionIsAdditionalCheckout,
  type PendingFormFieldView,
  type PendingRequestView,
} from "../lib/view-models";
import { palot } from "../services/palot";
import { useSessionTitleEditor } from "../hooks/use-session-title-editor";
import { useSessionFork } from "../hooks/use-session-fork";
import { useTranscriptNavigation } from "../hooks/use-transcript-navigation";
import { useTranscriptPrompts } from "../hooks/use-transcript-prompts";
import { useTranscriptInfiniteScroll } from "../hooks/use-transcript-infinite-scroll";
import { TranscriptRail } from "./transcript-rail";
import { CompactionUsage } from "./compaction-usage";
import { SessionHistoryDialog } from "./session-history-dialog";
import { PermissionPreview } from "./permission-preview";
import { useVcsInfo } from "../hooks/use-vcs-info";
import { Composer } from "./composer";
import { ConnectionDestination } from "./connection-destination";
import { FileAttachment } from "./file-attachment";
import {
  MarkdownContent,
  MarkdownWorkspaceProvider,
  type MarkdownFileReference,
} from "./markdown-content";
import { NewTask } from "./new-task";
import { OpenInSelector } from "./open-in-selector";
import { SessionExportMenu, type SessionHistoryActions } from "./session-context-menu";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AttachmentGroup } from "./ui/attachment";
import { Badge } from "./ui/badge";
import { Bubble, BubbleContent } from "./ui/bubble";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Message, MessageContent } from "./ui/message";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "./ui/questionnaire";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ScrollAreaRoot, ScrollViewport, ScrollBar } from "./ui/scroll-area";
import { IconButton, LoadingButton } from "./ui";
import { ThinkingShimmer } from "./thinking-shimmer";
import { ReadImagePreview } from "./read-image-preview";
import { ReadToolExecutionGroup, StandaloneShellExecution, ToolExecution } from "./tool-execution";
import {
  projectBackgroundWork,
  SubagentFooterControl,
  SubagentLaunch,
  SubagentResponse,
  SubagentSessionDock,
  type BackgroundWorkItem,
} from "./subagent-activity";

const EMPTY_DIFFS: FileDiffInfo[] = [];
const EMPTY_EXECUTION_STATES = new Map<string, SessionExecutionState>();
const EMPTY_SUBAGENT_PROGRESS = { active: 0, total: 0 };
const EMPTY_BACKGROUND_WORK: BackgroundWorkItem[] = [];
const EMPTY_MODELS: PalotModel[] = [];
const MAX_PINNED_VIRTUAL_TURNS = 16;
const INITIAL_TRANSCRIPT_STABLE_FRAMES = 3;
const MAX_INITIAL_TRANSCRIPT_SETTLE_MS = 250;
const PREPEND_ANCHOR_STABLE_FRAMES = 8;
const MAX_PREPEND_ANCHOR_SETTLE_MS = 1_000;

function nestedScrollConsumesDelta(root: HTMLElement, target: EventTarget | null, delta: number) {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== root) {
    const overflow = getComputedStyle(element).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      transcriptScrollTargetConsumesDelta(element, delta)
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

function estimateTranscriptTurnSize(turn: TranscriptTurn | undefined): number {
  if (!turn) return 96;
  let size = turn.user ? 96 : 24;
  if (turn.rootBoundary) size += 56;
  if (turn.activity.length > 0) {
    const entries = turn.activity.reduce((total, group) => total + group.entries.length, 0);
    size += Math.min(480, 44 + turn.activity.length * 32 + entries * 12);
  }
  if (turn.blockingRequests.some((request) => request.type !== "input")) size += 320;
  if (turn.final) {
    const text = messageText(turn.final.message, turn.final.part);
    size += 56 + Math.max(24, Math.ceil(text.length / 88) * 24);
  }
  if (turn.postFinal.length > 0) size += Math.min(420, 48 + turn.postFinal.length * 48);
  if (turn.status === "working") size += 28;
  if (
    turn.kind === "subagent" ||
    turn.final ||
    turn.status === "failed" ||
    turn.status === "interrupted" ||
    turn.kind === "shell" ||
    turn.kind === "compaction"
  ) {
    size += turn.kind === "subagent" ? 12 : 32;
  } else if (turn.user) {
    size += 16;
  }
  return Math.max(72, size);
}

export function Thread({ sessionID }: { sessionID?: string }) {
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const targetSessionID = sessionID ?? selectedSessionID;
  const selectSession = useCallback(
    (sessions: PalotSession[]) =>
      targetSessionID
        ? (sessions.find((candidate) => candidate.id === targetSessionID) ?? null)
        : null,
    [targetSessionID],
  );
  const session = useSessionCatalogSelector(selectSession, sameThreadSession);
  if (!session) return <NewTask />;
  return <SessionThread session={session} />;
}

function sameThreadSession(left: PalotSession | null, right: PalotSession | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.revert || right.revert) return false;
  return (
    left.id === right.id &&
    left.parentID === right.parentID &&
    left.projectID === right.projectID &&
    left.title === right.title &&
    left.agent === right.agent &&
    left.permissions === right.permissions &&
    left.model?.id === right.model?.id &&
    left.model?.providerID === right.model?.providerID &&
    left.model?.variant === right.model?.variant &&
    left.location.directory === right.location.directory &&
    left.location.workspaceID === right.location.workspaceID &&
    left.archivedAt === right.archivedAt
  );
}

const SessionThread = memo(function SessionThread({ session }: { session: PalotSession }) {
  return (
    <main
      className="palot-main-surface relative flex h-full min-h-0 flex-col bg-background"
      aria-label="Current task"
    >
      <SessionThreadContents key={session.id} session={session} />
    </main>
  );
});

const SessionThreadContents = memo(function SessionThreadContents({
  session,
}: {
  session: PalotSession;
}) {
  "use no memo";
  const transcript = useSessionTranscript(session);
  const requestsQuery = useSessionRequests(session.id);
  const messages = transcript.messages;
  const requests = requestsQuery.data ?? null;
  const loading = transcript.isPending || transcript.isHydrating;
  const [animateTranscriptEntrance] = useState(transcript.isPending);
  const cursor = transcript.hasNextPage;
  const activity = useSessionActivityForSession(session.id).data;
  const executionStates = activity?.execution ?? EMPTY_EXECUTION_STATES;
  const runtimeStatus = activity?.status ?? null;
  const execution = executionStates.get(session.id) ?? null;
  const subagentProgress = calculateSubagentProgress(
    executionStates,
    session.id,
    execution?.startedAt ?? null,
  );
  const loadingOlder = transcript.isFetchingNextPage;
  const olderRequestRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const prependAnchorRef = useRef<{
    turnID: string | null;
    turnCount: number;
    viewportTop: number;
    fallbackHeight: number;
    fallbackScrollTop: number;
  } | null>(null);
  const bottomLockedRef = useRef(true);
  const bottomFollowFrameRef = useRef<number | null>(null);
  const lastFollowedVirtualHeightRef = useRef<number | null>(null);
  const navigationGeometryRef = useRef<(() => void) | null>(null);
  const scrollIntentRef = useRef<TranscriptScrollIntent>(null);
  const previousScrollTopRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);
  const coldTranscriptPendingRef = useRef(transcript.isPending && messages.length === 0);
  const initialTranscriptSettledRef = useRef(coldTranscriptPendingRef.current);
  const [composerDockHeight, setComposerDockHeight] = useState<number | null>(null);
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null);
  const [layoutHeight, setLayoutHeight] = useState<number | null>(null);
  const appearance = useAtomValue(resolvedAppearanceAtom);
  const appearanceLayoutKey = useMemo(() => JSON.stringify(appearance), [appearance]);
  const [initialTranscriptVisible, setInitialTranscriptVisible] = useState(
    coldTranscriptPendingRef.current,
  );
  const [submissionScrollRequest, setSubmissionScrollRequest] = useState(0);
  const [bottomLocked, setBottomLocked] = useState(true);
  const [historyMode, setHistoryMode] = useState<"timeline" | "fork" | null>(null);
  useLayoutEffect(() => {
    // Later page hydration must not unmount the viewport, composer, or scroll observers.
    if (!loading) coldTranscriptPendingRef.current = false;
  }, [loading]);
  const forkFromPrompt = useSessionFork();
  const handleMessageAdmitted = useCallback(
    () => setSubmissionScrollRequest((current) => current + 1),
    [],
  );
  const setBottomLock = useCallback((locked: boolean) => {
    bottomLockedRef.current = locked;
    setBottomLocked((current) => (current === locked ? current : locked));
  }, []);
  const scrollToBottomNow = useCallback(() => {
    const viewport = scrollRef.current;
    if (
      !viewport ||
      !bottomLockedRef.current ||
      prependAnchorRef.current ||
      scrollIntentRef.current !== null
    )
      return;
    const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (Math.abs(viewport.scrollTop - target) > 0.5) viewport.scrollTop = target;
    previousScrollTopRef.current = viewport.scrollTop;
  }, []);
  const scheduleScrollToBottom = useCallback(() => {
    if (!bottomLockedRef.current) return;
    // One coalesced follow-up for explicit navigation, not a per-commit settle loop.
    scheduleTranscriptScrollFrame(bottomFollowFrameRef, scrollToBottomNow);
  }, [scrollToBottomNow]);
  const scrollToBottom = useCallback(() => {
    scrollIntentRef.current = null;
    setBottomLock(true);
    scrollToBottomNow();
    scheduleScrollToBottom();
  }, [scheduleScrollToBottom, scrollToBottomNow, setBottomLock]);
  const [models, setModels] = useState<PalotModel[]>([]);
  const runtime = useAtomValue(runtimeAtom);
  const workbench = useWorkbenchCommands(
    runtime ? { profileID: runtime.profileID, sessionID: session.id } : null,
  );
  const setContextMessageTarget = useSetAtom(contextMessageTargetAtom);
  const requestViews = useMemo(
    () => (requests ? pendingRequestViews(requests, messages) : []),
    [requests, messages],
  );
  const projectionPreference = useAtomValue(sessionProjectionPreferenceAtom);
  const showTimelineCacheBusts = useAtomValue(showTimelineCacheBustsAtom);
  const projectionPolicy = useMemo(
    () => resolveSessionProjectionPreference(projectionPreference),
    [projectionPreference],
  );

  useLayoutEffect(() => {
    recordStreamingCommit(session.id, transcript.connectionID);
  }, [messages, session.id, transcript.connectionID]);
  const pendingInputs = useMemo(
    () => requestViews.filter((request) => request.type === "input"),
    [requestViews],
  );
  const composerRequests = useMemo(
    () => requestViews.filter((request) => request.type === "question" || request.type === "form"),
    [requestViews],
  );
  const projection = useSessionTranscriptProjection({
    connectionID: transcript.connectionID,
    sessionID: session.id,
    messages,
    execution,
    requests: requestViews,
    diffs: EMPTY_DIFFS,
    runtimeStatus,
    initialLocation: session.location,
    policy: projectionPolicy,
  });
  const turnRows = projection.rows;
  const layoutOwner = JSON.stringify([transcript.connectionID, session.id]);
  const windowWidth = window.innerWidth;
  const pixelRatio = window.devicePixelRatio;
  const fontStatus = document.fonts?.status;
  const layoutKey = useMemo(
    () =>
      JSON.stringify([
        layoutWidth,
        windowWidth,
        pixelRatio,
        appearanceLayoutKey,
        projectionPreference,
        showTimelineCacheBusts,
        fontStatus,
      ]),
    [
      layoutWidth,
      windowWidth,
      pixelRatio,
      appearanceLayoutKey,
      projectionPreference,
      showTimelineCacheBusts,
      fontStatus,
    ],
  );
  const layoutRows = useMemo(() => turnRows.map((row) => ({ id: row.id, token: row })), [turnRows]);
  const restoredLayout = useMemo(
    () =>
      layoutWidth === null
        ? null
        : retainedTranscriptLayouts.get(layoutOwner, layoutKey, layoutRows),
    [layoutOwner, layoutKey, layoutRows, layoutWidth],
  );
  const rows = projection.presentationRows;
  const latestUserTurnIndex = turnRows.findLastIndex((row) => row.turn.user !== null);
  const activeTurnIndex = turnRows.at(-1)?.turn.status === "working" ? turnRows.length - 1 : -1;
  const isWorking = activeTurnIndex >= 0;
  const [pinnedVirtualTurnIDs, setPinnedVirtualTurnIDs] = useState<string[]>([]);
  const [prependPinnedTurnID, setPrependPinnedTurnID] = useState<string | null>(null);
  const [navigationPinnedTurnID, setNavigationPinnedTurnID] = useState<string | null>(null);
  const pinVirtualTurn = useCallback((turnID: string) => {
    setPinnedVirtualTurnIDs((current) =>
      current.includes(turnID) ? current : [...current, turnID].slice(-MAX_PINNED_VIRTUAL_TURNS),
    );
  }, []);
  const clearPrependAnchor = useCallback(() => {
    prependAnchorRef.current = null;
    setPrependPinnedTurnID(null);
  }, []);
  const getVirtualTurnKey = useCallback(
    (index: number) => turnRows[index]?.id ?? index,
    [turnRows],
  );
  const estimateVirtualTurnSize = useCallback(
    (index: number) => estimateTranscriptTurnSize(turnRows[index]?.turn),
    [turnRows],
  );
  const extractVirtualTurnRange = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeTurnIndex >= 0 && !indexes.includes(activeTurnIndex)) {
        indexes.push(activeTurnIndex);
      }
      if (prependPinnedTurnID) {
        const index = turnRows.findIndex((row) => row.id === prependPinnedTurnID);
        if (index >= 0 && !indexes.includes(index)) indexes.push(index);
      }
      if (navigationPinnedTurnID) {
        const index = turnRows.findIndex((row) => row.id === navigationPinnedTurnID);
        if (index >= 0 && !indexes.includes(index)) indexes.push(index);
      }
      for (const turnID of pinnedVirtualTurnIDs) {
        const index = turnRows.findIndex((row) => row.id === turnID);
        if (index >= 0 && !indexes.includes(index)) indexes.push(index);
      }
      if (bottomLocked && latestUserTurnIndex >= 0 && !indexes.includes(latestUserTurnIndex)) {
        indexes.push(latestUserTurnIndex);
      }
      indexes.sort((left, right) => left - right);
      return indexes;
    },
    [
      activeTurnIndex,
      bottomLocked,
      latestUserTurnIndex,
      pinnedVirtualTurnIDs,
      prependPinnedTurnID,
      navigationPinnedTurnID,
      turnRows,
    ],
  );
  const presentationRowsByTurn = useMemo(() => {
    const grouped = new Map<string, TranscriptPresentationRow[]>();
    for (const row of rows) {
      const current = grouped.get(row.turnID);
      if (current) current.push(row);
      else grouped.set(row.turnID, [row]);
    }
    return grouped;
  }, [rows]);
  const cacheBusts = useMemo(
    () => new Map(likelyCacheBusts(messages).map((warning) => [warning.messageID, warning])),
    [messages],
  );
  const inlineRequestIDs = projection.inlineRequestIDs;
  const floatingRequests = useMemo(
    () =>
      requestViews.filter(
        (request) => request.type === "permission" && !inlineRequestIDs.has(request.id),
      ),
    [inlineRequestIDs, requestViews],
  );
  const scrollerContentStyle = useMemo(
    () => ({
      paddingTop: cursor ? 64 : 32,
      paddingBottom: composerDockHeight === null ? 16 : composerDockHeight + 16,
    }),
    [composerDockHeight, cursor],
  );
  const scrollButtonStyle = useMemo(
    () => ({ bottom: (composerDockHeight ?? 0) + 12 }),
    [composerDockHeight],
  );
  const virtualizer = useVirtualizer({
    // The dock's first layout gives us the actual pane width before seeding
    // measurements. Never reuse wrapping estimates based on window width alone.
    enabled: composerDockHeight !== null && layoutWidth !== null,
    count: turnRows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: getVirtualTurnKey,
    estimateSize: estimateVirtualTurnSize,
    rangeExtractor: extractVirtualTurnRange,
    overscan: initialTranscriptVisible ? 1 : 0,
    paddingStart: cursor ? 64 : 32,
    paddingEnd: (composerDockHeight ?? 0) + 16,
    scrollPaddingEnd: (composerDockHeight ?? 0) + 16,
    // Bottom-follow positions the real viewport. An out-of-range initial offset
    // never gets a correcting scroll event while a short transcript still fits.
    initialMeasurementsCache: restoredLayout?.measurements,
    initialRect: restoredLayout?.viewport,
    initialOffset:
      restoredLayout?.complete &&
      restoredLayout.composerHeight === composerDockHeight &&
      restoredLayout.viewport.height === layoutHeight
        ? Math.max(0, restoredLayout.totalSize - restoredLayout.viewport.height)
        : 0,
    useFlushSync: false,
    // TanStack owns the spacer and vertical positions. Its onChange runs AFTER
    // those DOM writes, including ResizeObserver measurements, so bottom-follow
    // never has to wait for React to commit a newly measured spacer height.
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    onChange: (instance) => {
      navigationGeometryRef.current?.();
      const height = instance.getTotalSize();
      if (height === lastFollowedVirtualHeightRef.current) return;
      lastFollowedVirtualHeightRef.current = height;
      scrollToBottomNow();
    },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = bottomLocked ? () => false : undefined;
  const virtualItems = virtualizer.getVirtualItems();
  const virtualTranscriptHeight = virtualizer.getTotalSize();
  const hasVirtualTurns = turnRows.length > 0;
  const saveLayoutRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    saveLayoutRef.current = () => {
      const viewport = scrollRef.current;
      if (
        !viewport ||
        !initialTranscriptSettledRef.current ||
        composerDockHeight === null ||
        viewport.clientWidth !== layoutWidth ||
        document.fonts?.status === "loading"
      )
        return;
      retainedTranscriptLayouts.set(layoutOwner, {
        layoutKey,
        rows: layoutRows,
        measurements: virtualizer.takeSnapshot(),
        viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
        totalSize: virtualizer.getTotalSize(),
        composerHeight: composerDockHeight,
      });
    };
  });
  useLayoutEffect(() => () => saveLayoutRef.current?.(), [layoutOwner, virtualizer]);
  useEffect(() => {
    return () => {
      if (bottomFollowFrameRef.current !== null) {
        cancelAnimationFrame(bottomFollowFrameRef.current);
        bottomFollowFrameRef.current = null;
      }
    };
  }, []);
  useLayoutEffect(() => {
    if (submissionScrollRequest === 0) return;
    // An explicit new submission supersedes an in-flight history prepend.
    clearPrependAnchor();
    scrollToBottom();
  }, [clearPrependAnchor, scrollToBottom, submissionScrollRequest]);
  useLayoutEffect(() => {
    // The adapter's layout effect has already applied geometry for new refs and
    // option changes (e.g. composer padding). Correct before this commit paints.
    scrollToBottomNow();
  }, [composerDockHeight, scrollToBottomNow, turnRows.length, virtualTranscriptHeight]);
  useEffect(() => {
    const viewport = scrollRef.current;
    const content = transcriptContentRef.current;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(scrollToBottomNow);
    observer.observe(viewport);
    // Virtual content is already handled after the adapter's measured writes.
    // Observing that ancestor as well can create skipped RO notifications when
    // a child measurement synchronously changes its spacer height.
    if (!hasVirtualTurns) observer.observe(content);
    return () => observer.disconnect();
  }, [composerDockHeight, hasVirtualTurns, scrollToBottomNow, session.id]);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    const pendingAnchor = prependAnchorRef.current;
    if (!pendingAnchor || !viewport) return;
    let frame = 0;
    let stableFrames = 0;
    const startedAt = performance.now();
    const restoreAnchor = () => {
      const anchor = prependAnchorRef.current;
      if (!anchor) return;
      const timedOut = performance.now() - startedAt >= MAX_PREPEND_ANCHOR_SETTLE_MS;
      if (turnRows.length <= anchor.turnCount && viewport.scrollHeight <= anchor.fallbackHeight) {
        if (timedOut) {
          clearPrependAnchor();
          return;
        }
        frame = requestAnimationFrame(restoreAnchor);
        return;
      }
      scrollIntentRef.current = "anchor";
      const anchorIndex = anchor.turnID
        ? turnRows.findIndex((row) => row.id === anchor.turnID)
        : -1;
      const anchorElement =
        anchorIndex >= 0
          ? viewport.querySelector<HTMLElement>(`[data-index="${anchorIndex}"]`)
          : null;
      if (anchorElement) {
        const viewportTop = viewport.getBoundingClientRect().top;
        const correction =
          anchorElement.getBoundingClientRect().top - viewportTop - anchor.viewportTop;
        if (Math.abs(correction) > 0.5) viewport.scrollTop += correction;
        stableFrames = Math.abs(correction) <= 0.5 ? stableFrames + 1 : 0;
      } else {
        const target =
          anchor.fallbackScrollTop + Math.max(0, viewport.scrollHeight - anchor.fallbackHeight);
        if (Math.abs(target - viewport.scrollTop) > 0.5) viewport.scrollTop = target;
        stableFrames = 0;
      }
      previousScrollTopRef.current = viewport.scrollTop;
      if (stableFrames >= PREPEND_ANCHOR_STABLE_FRAMES || timedOut) {
        clearPrependAnchor();
        return;
      }
      frame = requestAnimationFrame(restoreAnchor);
    };
    restoreAnchor();
    return () => cancelAnimationFrame(frame);
  }, [clearPrependAnchor, turnRows, virtualTranscriptHeight]);
  useEffect(() => {
    const clearScrollbarIntent = () => {
      if (scrollIntentRef.current === "scrollbar") scrollIntentRef.current = null;
    };
    window.addEventListener("pointerup", clearScrollbarIntent);
    window.addEventListener("pointercancel", clearScrollbarIntent);
    return () => {
      window.removeEventListener("pointerup", clearScrollbarIntent);
      window.removeEventListener("pointercancel", clearScrollbarIntent);
    };
  }, []);
  useEffect(() => {
    if (transcript.error && !transcript.isFetchNextPageError) {
      showErrorToast(`Could not load task "${session.title || session.id}"`, transcript.error);
    }
  }, [session.id, session.title, transcript.error, transcript.isFetchNextPageError]);

  useLayoutEffect(() => {
    const element = composerDockRef.current;
    if (!element) return;
    const setMeasuredHeight = (height: number) => {
      const next = Math.ceil(height);
      setComposerDockHeight((current) => (current === next ? current : next));
      const width = element.parentElement?.clientWidth ?? null;
      setLayoutWidth((current) => (current === width ? current : width));
      const parent = element.parentElement;
      const viewportHeight = parent
        ? parent.clientHeight - (parent.querySelector("header")?.clientHeight ?? 0)
        : null;
      setLayoutHeight((current) => (current === viewportHeight ? current : viewportHeight));
    };
    // Reserve the overlay before paint so bottom-anchored content never starts behind it.
    setMeasuredHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const borderSize = entry.borderBoxSize[0]?.blockSize;
      setMeasuredHeight(borderSize ?? entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, session.id]);
  useLayoutEffect(() => {
    if (initialTranscriptSettledRef.current) return;
    if (turnRows.length === 0) {
      if (loading) return;
      initialTranscriptSettledRef.current = true;
      setInitialTranscriptVisible(true);
      return;
    }
    // Estimated rows can briefly report the end before the final measured range settles.
    // Opacity keeps the transcript measurable while hiding the unstable geometry.
    let frame = 0;
    let previousScrollHeight: number | null = null;
    let stableFrames = 0;
    const startedAt = performance.now();
    const revealTranscript = () => {
      initialTranscriptSettledRef.current = true;
      setInitialTranscriptVisible(true);
    };
    const settleAtEnd = () => {
      const viewport = scrollRef.current;
      if (viewport && performance.now() - startedAt >= MAX_INITIAL_TRANSCRIPT_SETTLE_MS) {
        viewport.scrollTop = viewport.scrollHeight;
        revealTranscript();
        return;
      }
      const finalTurn = viewport?.querySelector(`[data-index="${turnRows.length - 1}"]`);
      const transcriptSurface = finalTurn?.parentElement;
      const finalTurnRect = finalTurn?.getBoundingClientRect();
      const transcriptRect = transcriptSurface?.getBoundingClientRect();
      const measuredBottomReserve =
        finalTurnRect && transcriptRect ? transcriptRect.bottom - finalTurnRect.bottom : 0;
      if (
        !viewport ||
        !transcriptSurface ||
        !finalTurn ||
        measuredBottomReserve < (composerDockHeight ?? 0) + 15
      ) {
        frame = requestAnimationFrame(settleAtEnd);
        return;
      }
      viewport.scrollTop = viewport.scrollHeight;
      const scrollHeight = viewport.scrollHeight;
      const bottomGap = scrollHeight - viewport.clientHeight - Math.max(0, viewport.scrollTop);
      stableFrames = previousScrollHeight === scrollHeight && bottomGap <= 1 ? stableFrames + 1 : 0;
      if (stableFrames >= INITIAL_TRANSCRIPT_STABLE_FRAMES) {
        revealTranscript();
        return;
      }
      previousScrollHeight = scrollHeight;
      frame = requestAnimationFrame(settleAtEnd);
    };
    frame = requestAnimationFrame(settleAtEnd);
    return () => cancelAnimationFrame(frame);
  }, [composerDockHeight, loading, turnRows.length]);

  async function loadOlder() {
    if (!cursor || loadingOlder || olderRequestRef.current) return false;
    olderRequestRef.current = true;
    try {
      const viewport = scrollRef.current;
      if (viewport) {
        setBottomLock(false);
        const fallbackHeight = viewport.scrollHeight;
        const fallbackScrollTop = viewport.scrollTop;
        let viewportRect = viewport.getBoundingClientRect();
        let anchorElement = Array.from(
          viewport.querySelectorAll<HTMLElement>('[data-scroll-anchor="true"]'),
        )
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.bottom >= viewportRect.top)
          .toSorted((left, right) => left.rect.top - right.rect.top)[0];
        const stableTurnID =
          anchorElement?.element.dataset.turnRowId ??
          turnRows.find((row) => row.turn.user !== null)?.id ??
          null;
        setPrependPinnedTurnID(stableTurnID);
        prependAnchorRef.current = {
          turnID: stableTurnID,
          turnCount: turnRows.length,
          viewportTop: anchorElement ? anchorElement.rect.top - viewportRect.top : 0,
          fallbackHeight,
          fallbackScrollTop,
        };
        if (!anchorElement && stableTurnID) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          viewportRect = viewport.getBoundingClientRect();
          const element = Array.from(
            viewport.querySelectorAll<HTMLElement>("[data-turn-row-id]"),
          ).find((candidate) => candidate.dataset.turnRowId === stableTurnID);
          if (element && prependAnchorRef.current) {
            anchorElement = { element, rect: element.getBoundingClientRect() };
            prependAnchorRef.current.viewportTop = anchorElement.rect.top - viewportRect.top;
          }
        }
      }
      const result = await transcript.fetchNextPage();
      if (result.isError) {
        if (isCancelledError(result.error)) {
          clearPrependAnchor();
          return false;
        }
        throw result.error;
      }
      return true;
    } catch (error) {
      clearPrependAnchor();
      showErrorToast("Could not load earlier messages", error);
      return false;
    } finally {
      olderRequestRef.current = false;
    }
  }

  const promptIndex = useTranscriptPrompts({
    sessionID: session.id,
    hasOlder: cursor,
    firstMessage: messages[0],
    loaded: projection.prompts,
  });
  const navigation = useTranscriptNavigation({
    scopeID: `${transcript.connectionID}\0${session.id}`,
    resetKey: submissionScrollRequest,
    rows: turnRows,
    prompts: projection.prompts,
    indexedPrompts: promptIndex.prompts,
    viewport: scrollRef,
    virtualizer,
    bottomInset: composerDockHeight ?? 0,
    pin: setNavigationPinnedTurnID,
    unlock: () => setBottomLock(false),
    clearAnchor: clearPrependAnchor,
    hasMore: cursor,
    loading: loadingOlder || transcript.isHydrating,
    historyStartID: messages[0]?.id ?? null,
    loadOlder,
  });

  useLayoutEffect(() => {
    navigationGeometryRef.current = navigation.onGeometryChange;
    return () => {
      navigationGeometryRef.current = null;
    };
  }, [navigation.onGeometryChange]);

  const infiniteScroll = useTranscriptInfiniteScroll({
    scopeID: `${transcript.connectionID}\0${session.id}`,
    resetKey: submissionScrollRequest,
    firstVisibleIndex: virtualizer.range?.startIndex ?? null,
    ready: !loading && initialTranscriptVisible,
    blocked: loadingOlder || prependPinnedTurnID !== null || navigation.isNavigating,
    hasMore: cursor,
    failed: transcript.isFetchNextPageError,
    canLoad: () => !olderRequestRef.current && prependAnchorRef.current === null,
    loadOlder,
  });

  const openCacheDiagnostic = useCallback(
    (messageID: string) => {
      const result = workbench.openTab(
        { kind: "context", location: session.location },
        { pane: "right" },
      );
      if (result?.ok) setContextMessageTarget({ sessionID: session.id, messageID });
    },
    [session.id, session.location, setContextMessageTarget, workbench],
  );
  const openWorkspaceFile = useCallback(
    (reference: MarkdownFileReference, event?: React.MouseEvent | React.KeyboardEvent) => {
      const modifier = event ? event.metaKey || event.ctrlKey : false;
      const path = workspaceRelativePath(reference.path, session.location.directory);

      if (modifier || !path) {
        const absolutePath =
          reference.path.startsWith("/") || reference.path.startsWith("~")
            ? reference.path
            : `${session.location.directory.replace(/\/+$/, "")}/${reference.path}`;
        void palot.externalOpen(
          {
            resource: {
              kind: "file",
              path: absolutePath,
              line: reference.line,
              sessionID: session.id,
            },
          },
          runtime?.connectionID,
        );
        return;
      }

      workbench.openTab(
        {
          kind: "file",
          location: session.location,
          path,
          ...(reference.line ? { line: reference.line } : {}),
        },
        { pane: "right" },
      );
    },
    [session.id, session.location, workbench, runtime?.connectionID],
  );

  const coldTranscriptLoading = coldTranscriptPendingRef.current && loading;

  return createElement(
    MarkdownWorkspaceProvider,
    { onOpenFile: openWorkspaceFile, workspaceDirectory: session.location.directory },
    <>
      <SessionThreadHeader
        session={session}
        historyActions={{
          loadingOlder,
          previousTurn: () => navigation.move("previous"),
          nextTurn: () => navigation.move("next"),
          openTimeline: () => setHistoryMode("timeline"),
          forkFromPrompt: () => setHistoryMode("fork"),
        }}
      />
      {historyMode ? (
        <SessionHistoryDialog
          messages={messages}
          mode={historyMode}
          onClose={() => setHistoryMode(null)}
          hasMore={cursor}
          loading={loadingOlder}
          error={transcript.isFetchNextPageError}
          onLoadMore={() => void loadOlder()}
          onSelect={async (message) => {
            if (historyMode === "fork")
              await forkFromPrompt({
                sessionID: session.id,
                beforeMessageID: message.id,
                restore: message,
              });
            else navigation.jump(message.id);
            setHistoryMode(null);
          }}
        />
      ) : null}

      {composerDockHeight === null || coldTranscriptLoading ? (
        <div
          className="min-h-0 flex-1"
          aria-label={coldTranscriptLoading ? "Loading task transcript" : undefined}
          aria-busy={coldTranscriptLoading || undefined}
        />
      ) : (
        <div
          data-palot-transcript-surface
          data-palot-transcript-state={initialTranscriptVisible ? "visible" : "settling"}
          data-palot-transcript-restored-measurements={restoredLayout?.measurements.length ?? 0}
          aria-hidden={initialTranscriptVisible ? undefined : true}
          className={cn(
            "relative min-h-0 flex-1",
            initialTranscriptVisible &&
              animateTranscriptEntrance &&
              "transition-opacity duration-100 ease-out motion-reduce:transition-none",
          )}
          style={{
            opacity: initialTranscriptVisible ? 1 : 0,
            pointerEvents: initialTranscriptVisible ? undefined : "none",
          }}
        >
          <ScrollAreaRoot
            data-slot="message-scroller"
            className="group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden"
          >
            <ScrollViewport
              ref={scrollRef}
              role="region"
              aria-label="Task transcript"
              data-bottom-locked={bottomLocked}
              tabIndex={0}
              className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none]"
              onWheel={(event) => {
                const delta = normalizeTranscriptWheelDelta({
                  deltaY: event.deltaY,
                  deltaMode: event.deltaMode,
                  viewportHeight: event.currentTarget.clientHeight,
                });
                if (
                  delta !== 0 &&
                  !nestedScrollConsumesDelta(event.currentTarget, event.target, delta)
                ) {
                  navigation.cancel();
                  if (delta > 0) infiniteScroll.clearIntent();
                }
                const scrollable =
                  event.currentTarget.scrollHeight - event.currentTarget.clientHeight > 1;
                if (
                  delta < 0 &&
                  !nestedScrollConsumesDelta(event.currentTarget, event.target, delta)
                ) {
                  infiniteScroll.onUpwardIntent();
                  if (scrollable) scrollIntentRef.current = "up";
                }
              }}
              onTouchStart={(event) => {
                touchYRef.current = event.touches[0]?.clientY ?? null;
              }}
              onTouchMove={(event) => {
                const y = event.touches[0]?.clientY;
                if (y === undefined) return;
                if (
                  touchYRef.current !== null &&
                  y !== touchYRef.current &&
                  !nestedScrollConsumesDelta(
                    event.currentTarget,
                    event.target,
                    touchYRef.current - y,
                  )
                ) {
                  navigation.cancel();
                  if (touchYRef.current !== null && y < touchYRef.current)
                    infiniteScroll.clearIntent();
                }
                const scrollable =
                  event.currentTarget.scrollHeight - event.currentTarget.clientHeight > 1;
                if (
                  touchYRef.current !== null &&
                  y > touchYRef.current &&
                  !nestedScrollConsumesDelta(
                    event.currentTarget,
                    event.target,
                    touchYRef.current - y,
                  )
                ) {
                  infiniteScroll.onUpwardIntent();
                  if (scrollable) scrollIntentRef.current = "up";
                }
                touchYRef.current = y;
              }}
              onTouchEnd={() => {
                touchYRef.current = null;
              }}
              onTouchCancel={() => {
                touchYRef.current = null;
              }}
              onKeyDown={(event) => {
                const delta = transcriptKeyboardScrollDelta(event);
                if (
                  delta !== 0 &&
                  !nestedScrollConsumesDelta(event.currentTarget, event.target, delta)
                ) {
                  navigation.cancel();
                  if (delta < 0) {
                    infiniteScroll.onUpwardIntent();
                    if (event.currentTarget.scrollHeight - event.currentTarget.clientHeight > 1)
                      scrollIntentRef.current = "up";
                  } else {
                    infiniteScroll.clearIntent();
                  }
                }
              }}
              onPointerDown={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (
                  event.currentTarget.scrollHeight - event.currentTarget.clientHeight > 1 &&
                  event.target === event.currentTarget &&
                  event.clientX >= bounds.right - 20
                ) {
                  // Idle bottom-follow scroll events deliberately skip geometry reads.
                  // Start drag direction tracking from the actual browser offset.
                  previousScrollTopRef.current = event.currentTarget.scrollTop;
                  scrollIntentRef.current = "scrollbar";
                  navigation.cancel();
                }
              }}
              onPointerUp={() => {
                if (scrollIntentRef.current === "scrollbar") scrollIntentRef.current = null;
              }}
              onPointerCancel={() => {
                if (scrollIntentRef.current === "scrollbar") scrollIntentRef.current = null;
              }}
              onScroll={(event) => {
                const viewport = event.currentTarget;
                const intent = scrollIntentRef.current;
                const update = readTranscriptScrollUpdate({
                  current: bottomLockedRef.current,
                  metrics: viewport,
                  previousScrollTop: previousScrollTopRef.current,
                  intent,
                });
                if (!update) return;
                if (
                  intent === "scrollbar" &&
                  previousScrollTopRef.current !== null &&
                  update.scrollTop < previousScrollTopRef.current
                )
                  infiniteScroll.onUpwardIntent();
                else if (intent === "scrollbar") infiniteScroll.clearIntent();
                setBottomLock(update.locked);
                previousScrollTopRef.current = update.scrollTop;
                if (intent === "up" || intent === "anchor") scrollIntentRef.current = null;
              }}
            >
              <div
                ref={transcriptContentRef}
                role="log"
                aria-relevant="additions"
                className={cn(
                  "relative flex h-max min-h-full flex-col gap-0",
                  turnRows.length > 0 && "block",
                )}
                style={turnRows.length > 0 ? undefined : scrollerContentStyle}
              >
                {turnRows.length > 0 ? (
                  <div
                    data-palot-virtual-transcript
                    ref={virtualizer.containerRef}
                    className="relative w-full"
                  >
                    {cursor ? (
                      <div className="absolute inset-x-0 top-2 flex justify-center pb-4">
                        {transcript.isFetchNextPageError ? (
                          <LoadingButton loading={loadingOlder} onClick={() => void loadOlder()}>
                            Retry loading earlier messages
                          </LoadingButton>
                        ) : loadingOlder ? (
                          <span
                            role="status"
                            className="flex items-center gap-2 text-meta text-muted-foreground"
                          >
                            <LoaderCircle
                              className="size-3 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Loading earlier messages…
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {virtualItems.map((virtualItem) => {
                      const turnRow = turnRows[virtualItem.index];
                      if (!turnRow) return null;
                      return (
                        <TranscriptPresentationTurnItem
                          key={virtualItem.key}
                          source={turnRow}
                          rows={presentationRowsByTurn.get(turnRow.id) ?? []}
                          models={models}
                          sessionID={session.id}
                          cacheBust={
                            showTimelineCacheBusts ? turnCacheBust(turnRow.turn, cacheBusts) : null
                          }
                          onOpenCacheDiagnostic={openCacheDiagnostic}
                          subagentProgress={
                            virtualItem.index === turnRows.length - 1
                              ? subagentProgress
                              : EMPTY_SUBAGENT_PROGRESS
                          }
                          virtualIndex={virtualItem.index}
                          virtualSize={virtualItem.size}
                          isLastTurn={virtualItem.index === turnRows.length - 1}
                          followTail={virtualItem.index === turnRows.length - 1 && bottomLocked}
                          measureElement={virtualizer.measureElement}
                          onInteract={pinVirtualTurn}
                        />
                      );
                    })}
                  </div>
                ) : null}
                {messages.length === 0 && !loading ? (
                  <div className="mx-auto w-[calc(100%-40px)] max-w-[760px] max-[720px]:w-[calc(100%-22px)]">
                    <ThreadPrompt
                      title="What should Palot work on?"
                      description="Describe a change, ask about the code, or start with a plan."
                    />
                  </div>
                ) : null}
              </div>
            </ScrollViewport>
            <ScrollBar
              onPointerDown={() => {
                navigation.cancel();
                previousScrollTopRef.current = scrollRef.current?.scrollTop ?? null;
                scrollIntentRef.current = "scrollbar";
              }}
              onPointerUp={() => {
                scrollIntentRef.current = null;
              }}
              onPointerCancel={() => {
                scrollIntentRef.current = null;
              }}
            />
            {navigation.railVisible ? (
              <div
                className={cn(
                  "group/transcript-rail absolute left-0 z-20 hidden items-center [@media(pointer:fine)]:flex",
                  navigation.railCompact ? "w-6 pl-px" : "w-10 pl-2",
                )}
                style={{ top: navigation.railTop, height: navigation.railHeight }}
              >
                <TranscriptRail
                  prompts={promptIndex.prompts}
                  activeMessageID={navigation.activeMessageID}
                  onSelect={navigation.jump}
                  height={navigation.railHeight}
                  compact={navigation.railCompact}
                  earlier={promptIndex.earlier}
                />
              </div>
            ) : null}
            {!bottomLocked && messages.length > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute left-1/2 z-30 -translate-x-1/2"
                style={scrollButtonStyle}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    navigation.cancel();
                    infiniteScroll.clearIntent();
                    scrollToBottom();
                  }}
                >
                  <ChevronDown data-icon="inline-start" aria-hidden="true" />
                  Scroll to bottom
                </Button>
              </motion.div>
            ) : null}
          </ScrollAreaRoot>
        </div>
      )}
      {/* Measure the dock during loading without permitting submissions against incomplete history. */}
      <div
        ref={composerDockRef}
        data-palot-composer-dock
        inert={coldTranscriptLoading}
        aria-busy={coldTranscriptLoading || undefined}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40"
      >
        <div className="pointer-events-auto">
          <SessionDockContents
            session={session}
            revertMessages={messages}
            composerMessages={projection.composerMessages}
            backgroundTranscript={projection.background}
            executionStates={executionStates}
            activityActive={activity?.active ?? false}
            floatingRequests={floatingRequests}
            composerRequests={composerRequests}
            pendingInputs={pendingInputs}
            isWorking={isWorking}
            onMessageAdmitted={handleMessageAdmitted}
            onModelsChange={setModels}
          />
        </div>
      </div>
    </>,
  );
});

function workspaceRelativePath(path: string, directory: string): string | null {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedDirectory = directory.replaceAll("\\", "/").replace(/\/$/, "");
  const relative = normalizedPath.startsWith(`${normalizedDirectory}/`)
    ? normalizedPath.slice(normalizedDirectory.length + 1)
    : normalizedPath.replace(/^\.\//, "");
  if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) return null;
  return relative;
}

export const SessionThreadHeader = memo(function SessionThreadHeader({
  session,
  historyActions,
}: {
  session: PalotSession;
  historyActions?: SessionHistoryActions;
}) {
  const title = useSessionTitleEditor(session);
  useEffect(() => {
    const previous = document.title;
    document.title = session.title ?? "Untitled task";
    return () => {
      document.title = previous;
    };
  }, [session.title]);
  const runtime = useAtomValue(runtimeAtom);
  const projects = useProjectCatalog();
  const project = projectForSession(projects, session);
  const name = project ? projectName(project) : session.location.directory.split("/").at(-1);
  const location = project ? projectLocation(project) : session.location.directory;
  return (
    <header className="palot-main-surface-header window-drag thread-header @container/thread-header flex h-(--shell-header-height) min-h-(--shell-header-height) items-center gap-2 border-b bg-background/90 px-3 pr-(--window-controls-width) pl-[18px]">
      <div className="group/title flex min-w-0 flex-1 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="window-no-drag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Show project details"
              />
            }
          >
            <FolderGit2 className="size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent
            align="start"
            className="flex-col items-start gap-1 px-2.5 py-2 leading-tight"
          >
            <span className="font-medium">{name ?? "Project"}</span>
            <span className="max-w-72 break-all text-muted-foreground">{location}</span>
            {session.location.directory !== location ? (
              <span className="max-w-72 break-all text-muted-foreground">
                Checkout: {session.location.directory}
              </span>
            ) : null}
          </TooltipContent>
        </Tooltip>
        {title.editing ? (
          <Input
            autoFocus
            aria-label="Task title"
            value={title.draft}
            maxLength={1_000}
            className="window-no-drag h-7 min-w-32 max-w-md border-ring bg-background px-1.5 text-compact font-semibold"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => title.setDraft(event.target.value)}
            onBlur={() => void title.commit()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                title.cancel();
              }
            }}
          />
        ) : (
          <strong
            className="window-no-drag truncate text-compact font-semibold"
            onDoubleClick={(event) => {
              event.preventDefault();
              title.start();
            }}
          >
            {session.title ?? "Untitled task"}
          </strong>
        )}
        {!title.editing ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="window-no-drag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover/title:opacity-100 focus:opacity-100"
                  aria-label="Rename task"
                  onClick={title.start}
                />
              }
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Rename task</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {runtime?.capabilities?.localPathActions === true ? (
        <OpenInSelector key={runtime.connectionID} sessionID={session.id} />
      ) : null}
      <SessionExportMenu session={session} historyActions={historyActions} />
    </header>
  );
});

const SessionDockContents = memo(function SessionDockContents({
  session,
  revertMessages,
  composerMessages,
  backgroundTranscript,
  executionStates,
  activityActive,
  floatingRequests,
  composerRequests,
  pendingInputs,
  isWorking,
  onMessageAdmitted,
  onModelsChange,
}: {
  session: PalotSession;
  revertMessages: PalotMessage[];
  composerMessages: PalotMessage[];
  backgroundTranscript: TranscriptBackgroundFacts;
  executionStates: Map<string, SessionExecutionState>;
  activityActive: boolean;
  floatingRequests: PendingRequestView[];
  composerRequests: PendingRequestView[];
  pendingInputs: PendingRequestView[];
  isWorking: boolean;
  onMessageAdmitted(): void;
  onModelsChange(models: PalotModel[]): void;
}) {
  const familyRequests = useSessionFamilyRequestViews(session.id);
  const dockRequests = useMemo(
    () => [
      ...composerRequests,
      ...familyRequests.filter((request) => request.sessionID !== session.id),
    ],
    [composerRequests, familyRequests, session.id],
  );
  return (
    <>
      <PendingRequests sessionID={session.id} requests={floatingRequests} />
      <SessionRevertDock session={session} messages={revertMessages} />
      {session.parentID ? (
        <>
          <PendingRequests sessionID={session.id} requests={dockRequests} />
          <SubagentSessionDock session={session} />
        </>
      ) : (
        <ParentSessionComposer
          session={session}
          messages={composerMessages}
          backgroundTranscript={backgroundTranscript}
          executionStates={executionStates}
          activityActive={activityActive}
          composerRequests={dockRequests}
          pendingInputs={pendingInputs}
          isWorking={isWorking}
          onMessageAdmitted={onMessageAdmitted}
          onModelsChange={onModelsChange}
        />
      )}
    </>
  );
});

const ParentSessionComposer = memo(function ParentSessionComposer({
  session,
  messages,
  backgroundTranscript,
  executionStates,
  activityActive,
  composerRequests,
  pendingInputs,
  isWorking,
  onMessageAdmitted,
  onModelsChange,
}: {
  session: PalotSession;
  messages: PalotMessage[];
  backgroundTranscript: TranscriptBackgroundFacts;
  executionStates: Map<string, SessionExecutionState>;
  activityActive: boolean;
  composerRequests: PendingRequestView[];
  pendingInputs: PendingRequestView[];
  isWorking: boolean;
  onMessageAdmitted(): void;
  onModelsChange(models: PalotModel[]): void;
}) {
  const navigate = useNavigate();
  const runtime = useAtomValue(runtimeAtom);
  const sessions = useSessionCatalog();
  const projects = useProjectCatalog();
  const branchQuery = useVcsInfo(session.location);
  const shellSessionIDs = useMemo(
    () =>
      new Set([
        session.id,
        ...[...executionStates.keys()].filter((id) =>
          belongsToSession(executionStates, id, session.id),
        ),
      ]),
    [executionStates, session.id],
  );
  const runningShells =
    useRunningShells(session.location, {
      enabled: true,
      shouldPoll: activityActive,
      sessionIDs: shellSessionIDs,
    }).data ?? null;
  const projectedBackgroundWork = useMemo(
    () =>
      projectBackgroundWork({
        sessionID: session.id,
        background: backgroundTranscript,
        runningShells,
        sessions,
        states: executionStates,
      }),
    [backgroundTranscript, executionStates, runningShells, session.id, sessions],
  );
  const backgroundWork =
    projectedBackgroundWork.length === 0 ? EMPTY_BACKGROUND_WORK : projectedBackgroundWork;
  const project = projectForSession(projects, session) ?? null;
  const requestBody = useMemo(
    () =>
      composerRequests.length > 0 ? (
        <PendingRequests sessionID={session.id} requests={composerRequests} inline />
      ) : undefined,
    [composerRequests, session.id],
  );
  const isAdditionalCheckout = sessionIsAdditionalCheckout(session, project ?? undefined);
  const navigateToNewTask = useCallback(
    () =>
      void navigate({
        to: "/new",
        search: { projectID: session.projectID, profileID: runtime?.profileID },
      }),
    [navigate, runtime?.profileID, session.projectID],
  );
  const composerContextBar = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1">
        <ConnectionDestination />
        <div
          className="flex h-6 min-w-0 items-center gap-1 px-1.5 text-meta leading-none font-medium text-foreground"
          title={isAdditionalCheckout ? "Additional checkout" : "Current checkout"}
        >
          <FolderGit2 className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{isAdditionalCheckout ? "Worktree" : "Checkout"}</span>
        </div>
        <div className="ml-auto flex h-6 min-w-0 items-center gap-2 px-1.5 text-meta leading-none text-muted-foreground max-[560px]:ml-0">
          <SubagentFooterControl sessionID={session.id} items={backgroundWork} />
          <ProcessFooterControl session={session} sessionIDs={shellSessionIDs} />
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {branchQuery.isPending
              ? "Loading branch"
              : (branchQuery.data?.currentBranch ?? "Detached HEAD")}
          </span>
        </div>
      </div>
    ),
    [
      backgroundWork,
      branchQuery.data?.currentBranch,
      branchQuery.isPending,
      isAdditionalCheckout,
      session.id,
      session,
      shellSessionIDs,
    ],
  );

  return (
    <Composer
      key={session.id}
      session={session}
      messages={messages}
      isWorking={isWorking}
      backgroundWork={backgroundWork}
      requestBody={requestBody}
      onMessageAdmitted={onMessageAdmitted}
      onNavigateToNewTask={navigateToNewTask}
      onModelsChange={onModelsChange}
      pendingInputs={pendingInputs}
      contextBarMode="compact"
      contextBar={composerContextBar}
    />
  );
});

const SessionRevertDock = memo(
  function SessionRevertDock({
    session,
    messages,
  }: {
    session: PalotSession;
    messages: PalotMessage[];
  }) {
    const cacheSession = useCacheSession();
    const [action, setAction] = useState<"restore" | "commit" | null>(null);
    const revert = session.revert;
    if (!revert) return null;
    const boundary = messages.findIndex((message) => message.id === revert.messageID);
    const affectedMessages =
      boundary < 0
        ? 0
        : messages.slice(boundary).filter((message) => message.type === "user").length;
    const affectedMessageCount = Math.max(1, affectedMessages);
    const files = revert.files ?? [];
    const additions = files.reduce((total, file) => total + file.additions, 0);
    const deletions = files.reduce((total, file) => total + file.deletions, 0);

    const run = async (next: "restore" | "commit") => {
      setAction(next);
      try {
        const updated =
          next === "restore"
            ? await palot.clearSessionRevert(session.id)
            : await palot.commitSessionRevert(session.id);
        if (updated) cacheSession(updated);
      } catch (error) {
        showErrorToast(
          next === "restore" ? "Could not restore reverted work" : "Could not finalize undo",
          error,
        );
      } finally {
        setAction(null);
      }
    };

    return (
      <div
        className="mx-auto mb-2 w-[calc(100%-32px)] max-w-[740px] overflow-hidden rounded-lg border border-warning/35 bg-warning/8 shadow-sm max-[720px]:w-[calc(100%-20px)]"
        aria-live="polite"
      >
        <div className="flex min-h-10 items-center gap-2 px-3 py-2">
          <Undo2 className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Undo staged</div>
            <div className="truncate text-micro text-muted-foreground">
              {affectedMessageCount} {affectedMessageCount === 1 ? "message" : "messages"}
              {files.length > 0
                ? ` and ${files.length} changed ${files.length === 1 ? "file" : "files"}`
                : ""}
            </div>
          </div>
          {files.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5 font-mono text-micro tabular-nums max-[560px]:hidden">
              <span className="text-success">+{additions}</span>
              <span className="text-destructive">-{deletions}</span>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={action !== null}
            onClick={() => void run("restore")}
          >
            {action === "restore" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            Restore
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={action !== null}
            onClick={() => void run("commit")}
          >
            {action === "commit" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Undo2 aria-hidden="true" />
            )}
            Finalize undo
          </Button>
        </div>
        {files.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto border-t border-warning/20 px-3 py-1.5">
            {files.slice(0, 5).map((file) => (
              <span
                key={file.file}
                className="max-w-48 shrink-0 truncate rounded bg-background/65 px-1.5 py-0.5 font-mono text-code-compact text-muted-foreground"
                title={file.file}
              >
                {file.file}
              </span>
            ))}
            {files.length > 5 ? (
              <span className="shrink-0 px-1 py-0.5 text-micro text-muted-foreground">
                +{files.length - 5} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
  (previous, next) => {
    if (!previous.session.revert && !next.session.revert) return true;
    return previous.session === next.session && previous.messages === next.messages;
  },
);

const TranscriptPresentationTurnItem = memo(function TranscriptPresentationTurnItem({
  source,
  rows,
  models,
  sessionID,
  cacheBust,
  onOpenCacheDiagnostic,
  subagentProgress,
  virtualIndex,
  virtualSize,
  isLastTurn,
  followTail,
  measureElement,
  onInteract,
}: {
  source: TranscriptProjectionRow;
  rows: TranscriptPresentationRow[];
  models: PalotModel[];
  sessionID: string;
  cacheBust: LikelyCacheBust | null;
  onOpenCacheDiagnostic: (messageID: string) => void;
  subagentProgress: { active: number; total: number };
  virtualIndex: number;
  virtualSize: number;
  isLastTurn: boolean;
  followTail: boolean;
  measureElement: (element: Element | null) => void;
  onInteract: (turnID: string) => void;
}) {
  const { turn } = source;
  // The status is the last presentation row. Its live-edge clearance must not
  // inherit different historical spacing from text/tool/subagent turn kinds.
  const activeTail = isLastTurn && rows.at(-1)?.kind === "turn-status";
  const virtualStyle = useMemo(
    () => ({
      // The live tail needs its real first-layout height. An intrinsic fallback
      // can otherwise leave a newly mounted status above an empty estimated box.
      containIntrinsicSize:
        activeTail && followTail ? undefined : `auto ${Math.ceil(virtualSize)}px`,
      contentVisibility: activeTail && followTail ? ("visible" as const) : ("auto" as const),
      transform: "translateX(-50%)",
    }),
    [activeTail, followTail, virtualSize],
  );
  const articleLabel =
    turn.kind === "shell"
      ? "Shell command"
      : turn.kind !== "conversation" && turn.kind !== "subagent"
        ? "Timeline boundary"
        : turn.kind === "subagent"
          ? "Subagent response"
          : "Conversation turn";
  return (
    <div
      ref={measureElement}
      data-index={virtualIndex}
      data-message-id={turn.id}
      data-turn-row-id={source.id}
      data-scroll-anchor={turn.user !== null}
      onFocusCapture={() => onInteract(source.id)}
      onPointerDownCapture={() => onInteract(source.id)}
      className={cn(
        "absolute left-1/2 w-[calc(100%-40px)] max-w-[760px] max-[720px]:w-[calc(100%-22px)]",
        activeTail
          ? "pb-0"
          : turn.kind === "subagent"
            ? "pb-3"
            : turn.final ||
                turn.status === "failed" ||
                turn.status === "interrupted" ||
                turn.kind === "shell" ||
                turn.kind === "compaction"
              ? "pb-8"
              : turn.user
                ? "pb-4"
                : "pb-0",
      )}
      style={virtualStyle}
    >
      <article aria-label={articleLabel}>
        {rows.map((row) => (
          <TranscriptPresentationRowContent
            key={row.id}
            row={row}
            models={row.kind === "assistant-message" ? models : EMPTY_MODELS}
            sessionID={sessionID}
            cacheBust={rowReceivesCacheBust(row, turn) ? cacheBust : null}
            onOpenCacheDiagnostic={onOpenCacheDiagnostic}
            subagentProgress={row.kind === "activity" ? subagentProgress : EMPTY_SUBAGENT_PROGRESS}
          />
        ))}
      </article>
    </div>
  );
}, sameTranscriptPresentationTurnItemProps);

function sameTranscriptPresentationTurnItemProps(
  previous: {
    source: TranscriptProjectionRow;
    rows: TranscriptPresentationRow[];
    models: PalotModel[];
    sessionID: string;
    cacheBust: LikelyCacheBust | null;
    onOpenCacheDiagnostic: (messageID: string) => void;
    subagentProgress: { active: number; total: number };
    virtualIndex: number;
    virtualSize: number;
    isLastTurn: boolean;
    followTail: boolean;
    measureElement: (element: Element | null) => void;
    onInteract: (turnID: string) => void;
  },
  next: {
    source: TranscriptProjectionRow;
    rows: TranscriptPresentationRow[];
    models: PalotModel[];
    sessionID: string;
    cacheBust: LikelyCacheBust | null;
    onOpenCacheDiagnostic: (messageID: string) => void;
    subagentProgress: { active: number; total: number };
    virtualIndex: number;
    virtualSize: number;
    isLastTurn: boolean;
    followTail: boolean;
    measureElement: (element: Element | null) => void;
    onInteract: (turnID: string) => void;
  },
): boolean {
  return (
    previous.source === next.source &&
    previous.rows.length === next.rows.length &&
    previous.rows.every((row, index) => row === next.rows[index]) &&
    previous.models === next.models &&
    previous.sessionID === next.sessionID &&
    previous.cacheBust === next.cacheBust &&
    previous.onOpenCacheDiagnostic === next.onOpenCacheDiagnostic &&
    previous.virtualIndex === next.virtualIndex &&
    previous.virtualSize === next.virtualSize &&
    previous.isLastTurn === next.isLastTurn &&
    previous.followTail === next.followTail &&
    previous.measureElement === next.measureElement &&
    previous.onInteract === next.onInteract &&
    previous.subagentProgress.active === next.subagentProgress.active &&
    previous.subagentProgress.total === next.subagentProgress.total
  );
}

function rowReceivesCacheBust(row: TranscriptPresentationRow, turn: TranscriptTurn): boolean {
  if (turn.kind !== undefined && turn.kind !== "conversation" && turn.kind !== "subagent") {
    return false;
  }
  if (row.kind === "assistant-message") return true;
  if (!turn.final && turn.blockingRequests.some((request) => request.type !== "input")) {
    return row.kind === "requests";
  }
  if (!turn.final && row.kind === "activity") return true;
  return !turn.final && turn.activity.length === 0 && row.kind === "user-message";
}

const TranscriptPresentationRowContent = memo(function TranscriptPresentationRowContent({
  row,
  models,
  sessionID,
  cacheBust,
  onOpenCacheDiagnostic,
  subagentProgress,
}: {
  row: TranscriptPresentationRow;
  models: PalotModel[];
  sessionID: string;
  cacheBust: LikelyCacheBust | null;
  onOpenCacheDiagnostic: (messageID: string) => void;
  subagentProgress: { active: number; total: number };
}) {
  const finalParts = useMemo(
    () => (row.kind === "assistant-message" ? [row.final.part] : []),
    [row],
  );
  const showCacheBust = cacheBust !== null;

  if (row.kind === "user-message") {
    return (
      <>
        <MessageRow message={row.message} />
        {showCacheBust ? (
          <CacheBustWarning warning={cacheBust} onOpen={onOpenCacheDiagnostic} />
        ) : null}
      </>
    );
  }
  if (row.kind === "boundary") {
    return <TimelineBoundary group={row.group} />;
  }
  if (row.kind === "shell") {
    return (
      <div role="group" aria-label="Shell result">
        <StandaloneShellExecution part={row.entry.part} index={row.entry.index} />
      </div>
    );
  }
  if (row.kind === "activity") {
    const { turn } = row;
    if (turn.kind !== "conversation" && turn.kind !== "subagent") {
      return (
        <div
          role="group"
          aria-label={turn.kind === "shell" ? "Shell activity" : "Timeline activity"}
        >
          <ActivityGroups groups={turn.activity} live={false} reveal sessionID={sessionID} />
          {showCacheBust ? (
            <CacheBustWarning warning={cacheBust} onOpen={onOpenCacheDiagnostic} />
          ) : null}
        </div>
      );
    }
    return (
      <div
        role="group"
        aria-label={turn.kind === "subagent" ? "Subagent activity" : "Turn activity"}
      >
        <TurnActivity
          turn={turn}
          sessionID={sessionID}
          preventAutoCollapse={subagentProgress.active > 0}
        />
        {showCacheBust ? (
          <CacheBustWarning warning={cacheBust} onOpen={onOpenCacheDiagnostic} />
        ) : null}
      </div>
    );
  }
  if (row.kind === "requests") {
    const permissions = row.requests.filter((request) => request.type === "permission");
    return permissions.length > 0 ? (
      <PendingRequests sessionID={sessionID} requests={permissions} inline />
    ) : null;
  }
  if (row.kind === "assistant-message") {
    const { turn } = row;
    return (
      <>
        <div className="group/final-message">
          <MessageRow
            message={row.final.message}
            parts={finalParts}
            className={cn(turn.user && turn.activity.length === 0 && "mt-6")}
          />
          {turn.status !== "working" && turn.completedAt !== null ? (
            <FinalMessageMeta
              turn={turn}
              models={models}
              sessionID={sessionID}
              forkBeforeMessageID={row.forkBeforeMessageID}
              onOpenDetails={onOpenCacheDiagnostic}
            />
          ) : null}
        </div>
        {showCacheBust ? (
          <CacheBustWarning warning={cacheBust} onOpen={onOpenCacheDiagnostic} />
        ) : null}
      </>
    );
  }
  if (row.kind === "post-final") {
    return <PostFinalItems items={row.items} />;
  }
  const { turn } = row;
  return turn.status === "working" ? (
    <ActiveTurnMeta startedAt={turn.startedAt} label={activeTurnLabel(turn)} />
  ) : null;
}, sameTranscriptPresentationRowContentProps);

export function activeTurnLabel(turn: TranscriptTurn): "Working" | "Finishing" {
  if (!turn.final) return "Working";
  const hasToolActivity = turn.activity.some(
    (group) => group.kind === "tools" || group.kind === "subagent-tool",
  );
  const finalMessageSettled =
    turn.final.message.finish !== null && turn.final.message.finish !== "tool-calls";
  return hasToolActivity || finalMessageSettled ? "Finishing" : "Working";
}

function sameTranscriptPresentationRowContentProps(
  previous: {
    row: TranscriptPresentationRow;
    models: PalotModel[];
    sessionID: string;
    cacheBust: LikelyCacheBust | null;
    onOpenCacheDiagnostic: (messageID: string) => void;
    subagentProgress: { active: number; total: number };
  },
  next: {
    row: TranscriptPresentationRow;
    models: PalotModel[];
    sessionID: string;
    cacheBust: LikelyCacheBust | null;
    onOpenCacheDiagnostic: (messageID: string) => void;
    subagentProgress: { active: number; total: number };
  },
): boolean {
  return (
    previous.models === next.models &&
    previous.sessionID === next.sessionID &&
    previous.cacheBust === next.cacheBust &&
    previous.onOpenCacheDiagnostic === next.onOpenCacheDiagnostic &&
    previous.row === next.row &&
    previous.subagentProgress.active === next.subagentProgress.active &&
    previous.subagentProgress.total === next.subagentProgress.total
  );
}

function turnCacheBust(
  turn: TranscriptTurn,
  warnings: Map<string, LikelyCacheBust>,
): LikelyCacheBust | null {
  const messageIDs = [
    ...(turn.rootBoundary?.entries.map((entry) => entry.message.id) ?? []),
    ...turn.activity.flatMap((group) => group.entries.map((entry) => entry.message.id)),
    ...(turn.final ? [turn.final.message.id] : []),
  ];
  const matches = messageIDs.flatMap((id) => {
    const warning = warnings.get(id);
    return warning ? [warning] : [];
  });
  return matches.reduce<LikelyCacheBust | null>(
    (largest, warning) => (!largest || warning.drop > largest.drop ? warning : largest),
    null,
  );
}

function CacheBustWarning({
  warning,
  onOpen,
}: {
  warning: LikelyCacheBust;
  onOpen: (messageID: string) => void;
}) {
  return (
    <button
      type="button"
      className="mt-2 flex w-full items-start gap-2 rounded-md border border-warning/25 bg-warning/6 px-2.5 py-2 text-left text-xs text-foreground/85 transition-colors hover:border-warning/40 hover:bg-warning/10"
      aria-label={`Open cache diagnostic for raw message ${warning.messageID}`}
      onClick={() => onOpen(warning.messageID)}
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Likely cache bust: {warning.drop.toLocaleString()} fewer cached tokens than the previous
        step
      </span>
    </button>
  );
}

export const FinalMessageMeta = memo(
  function FinalMessageMeta({
    turn,
    models,
    sessionID,
    forkBeforeMessageID,
    onOpenDetails,
  }: {
    turn: TranscriptTurn;
    models: PalotModel[];
    sessionID: string;
    forkBeforeMessageID?: string;
    onOpenDetails?: (messageID: string) => void;
  }) {
    const [copied, setCopied] = useState(false);
    const [forking, setForking] = useState(false);
    const forkSession = useSessionFork();
    const completedAt = turn.completedAt!;
    const response = turn.final ? messageText(turn.final.message, turn.final.part) : "";
    const modelRef = turn.final?.message.model ?? null;
    const model = models.find(
      (candidate) => candidate.id === modelRef?.id && candidate.providerID === modelRef.providerID,
    );
    const modelName = model?.name ?? modelRef?.id ?? null;
    const responseMessageID = turn.final?.message.id;
    const tokensPerSecond = turn.tokensPerSecond === null ? null : turn.tokensPerSecond.toFixed(1);
    const hasWorkDuration = turn.workCompletedAt !== null;
    const duration = formatWorkedFor(turn.startedAt, turn.workCompletedAt ?? completedAt);
    const durationTitle = hasWorkDuration ? `Worked for ${duration}` : `Completed in ${duration}`;
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(completedAt);
    const fullTime = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(completedAt);

    return (
      <div className="mt-1 flex h-6 items-center gap-1.5 text-xs leading-none tabular-nums text-muted-foreground/55 opacity-0 transition-opacity duration-150 ease-out group-focus-within/final-message:opacity-100 group-hover/final-message:opacity-100 motion-reduce:transition-none">
        <IconButton
          label={copied ? "Copied response" : "Copy response"}
          size="icon-sm"
          className="text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
          onClick={() => {
            void writeClipboardText(response);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          <Copy aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Fork from this response"
          size="icon-sm"
          disabled={forking}
          className="text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
          onClick={() => {
            setForking(true);
            void forkSession({ sessionID, beforeMessageID: forkBeforeMessageID })
              .catch((error) => showErrorToast("Could not fork task", error))
              .finally(() => setForking(false));
          }}
        >
          {forking ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <GitFork aria-hidden="true" />
          )}
        </IconButton>
        {onOpenDetails && responseMessageID ? (
          <IconButton
            label="Response details"
            size="icon-sm"
            className="text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
            onClick={() => onOpenDetails(responseMessageID)}
          >
            <FileText aria-hidden="true" />
          </IconButton>
        ) : null}
        {modelName ? <span title={modelRef?.id}>{modelName}</span> : null}
        {tokensPerSecond !== null ? (
          <>
            {modelName ? <span aria-hidden="true">·</span> : null}
            <span
              title="Output tokens per second over provider stream duration"
              aria-label={`${tokensPerSecond} output tokens per second over provider stream duration`}
            >
              {tokensPerSecond} tok/s
            </span>
          </>
        ) : null}
        {(modelName || turn.tokensPerSecond !== null) && <span aria-hidden="true">·</span>}
        <span title={durationTitle}>{duration}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(completedAt).toISOString()} title={fullTime}>
          {time}
        </time>
      </div>
    );
  },
  (previous, next) => {
    return (
      previous.models === next.models &&
      previous.sessionID === next.sessionID &&
      previous.forkBeforeMessageID === next.forkBeforeMessageID &&
      previous.onOpenDetails === next.onOpenDetails &&
      previous.turn.final?.message === next.turn.final?.message &&
      previous.turn.final?.part === next.turn.final?.part &&
      previous.turn.tokensPerSecond === next.turn.tokensPerSecond &&
      previous.turn.startedAt === next.turn.startedAt &&
      previous.turn.workCompletedAt === next.turn.workCompletedAt &&
      previous.turn.completedAt === next.turn.completedAt
    );
  },
);

function formatWorkedFor(startedAt: number, completedAt: number): string {
  const seconds = Math.max(1, Math.round((completedAt - startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatWorkingFor(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function useCurrentTime(active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active]);

  return now;
}

export function ActiveTurnMeta({
  startedAt,
  label = "Working",
}: {
  startedAt: number;
  label?: "Working" | "Finishing";
}) {
  const now = useCurrentTime();

  const duration = formatWorkingFor(startedAt, now);
  return (
    <div
      data-palot-active-turn-status
      className="mt-1 flex h-6 items-center gap-1.5 text-xs leading-none tabular-nums text-muted-foreground/55"
      role="status"
      aria-label={`${label} for ${duration}`}
    >
      <ThinkingShimmer>{label}</ThinkingShimmer>
      <span aria-hidden="true">·</span>
      <span>{duration}</span>
    </div>
  );
}

function TurnActivityDurationLabel({ turn }: { turn: TranscriptTurn }) {
  const now = useCurrentTime(
    turn.status === "working" && turn.workCompletedAt === null && turn.completedAt === null,
  );
  const duration = formatWorkedFor(turn.startedAt, turn.workCompletedAt ?? turn.completedAt ?? now);
  if (turn.status === "working") {
    return turn.workCompletedAt === null ? `Working for ${duration}` : `Worked for ${duration}`;
  }
  if (turn.status === "interrupted") return `Stopped after ${duration}`;
  if (turn.status === "failed") return `Failed after ${duration}`;
  return turn.workCompletedAt === null ? `Completed in ${duration}` : `Worked for ${duration}`;
}

const activityDisclosureTriggerClassName =
  "h-auto min-h-7 max-w-full justify-start py-1 pr-0 pl-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!";
const activityDisclosureTitleClassName = "min-w-0 truncate text-foreground/85";

function TurnActivitySummary({ turn }: { turn: TranscriptTurn }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      <span className={activityDisclosureTitleClassName}>
        <TurnActivityDurationLabel turn={turn} />
      </span>
    </span>
  );
}

export function TurnActivity({
  turn,
  sessionID,
  preventAutoCollapse = false,
}: {
  turn: TranscriptTurn;
  sessionID: string;
  preventAutoCollapse?: boolean;
}) {
  const disclosureAtom = useMemo(
    () => turnActivityOpenAtomFamily(sessionID, turn.id),
    [sessionID, turn.id],
  );
  const [persistedOpen, setPersistedOpen] = useAtom(disclosureAtom);
  const [interacted, setInteracted] = useState(false);
  const defaultOpen = preventAutoCollapse || !turn.shouldAutoCollapse || !turn.canCollapse;
  const canDisclose = turn.blockingRequests.length === 0;
  const open = canDisclose ? (persistedOpen ?? defaultOpen) : true;

  if (turn.activity.length === 0) return null;

  if (turn.activity.length > 0 && turn.activity.every((group) => group.kind === "compaction")) {
    return (
      <div className="my-2">
        <ActivityGroups
          groups={turn.activity}
          live={turn.status === "working"}
          sessionID={sessionID}
        />
      </div>
    );
  }

  if (!canDisclose) {
    return (
      <div className="my-2">
        <div className="mb-1 flex h-7 items-center gap-1.5 text-meta text-muted-foreground/75">
          <TurnActivitySummary turn={turn} />
        </div>
        <ActivityGroups
          groups={turn.activity}
          live={turn.status === "working"}
          sessionID={sessionID}
        />
      </div>
    );
  }

  const pinnedActivity = turn.activity.filter(
    (group) => group.pinned || group.kind === "subagent" || group.kind === "subagent-tool",
  );

  if (pinnedActivity.length > 0) {
    return (
      <Collapsible
        open={open}
        onOpenChange={(value) => {
          setInteracted(true);
          setPersistedOpen(value);
        }}
        data-palot-turn-activity
        className="my-3"
      >
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={activityDisclosureTriggerClassName}
            />
          }
        >
          <TurnActivitySummary turn={turn} />
          {open ? (
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )}
        </CollapsibleTrigger>
        {!open ? (
          <div className="pt-2">
            <ActivityGroups groups={pinnedActivity} live={false} sessionID={sessionID} />
          </div>
        ) : null}
        <CollapsibleContent smooth animate={interacted} className="pt-2">
          <ActivityGroups
            groups={turn.activity}
            live={turn.status === "working"}
            sessionID={sessionID}
          />
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        setInteracted(true);
        setPersistedOpen(value);
      }}
      data-palot-turn-activity
      className="my-3"
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={activityDisclosureTriggerClassName}
          />
        }
      >
        <TurnActivitySummary turn={turn} />
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={interacted} className="pt-2">
        <ActivityGroups
          groups={turn.activity}
          live={turn.status === "working"}
          sessionID={sessionID}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityGroups({
  groups,
  live,
  sessionID,
  reveal = false,
  revealGeneration = 0,
}: {
  groups: TurnActivityGroup[];
  live: boolean;
  sessionID: string;
  reveal?: boolean;
  revealGeneration?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      {groups.map((group, index) => (
        <ActivityGroupItem
          key={group.id}
          group={group}
          live={live && index === groups.length - 1}
          reveal={reveal}
          revealGeneration={revealGeneration}
          sessionID={sessionID}
        />
      ))}
    </div>
  );
}

const ActivityGroupItem = memo(
  function ActivityGroupItem({
    group,
    live,
    reveal,
    revealGeneration,
    sessionID,
  }: {
    group: TurnActivityGroup;
    live: boolean;
    reveal: boolean;
    revealGeneration: number;
    sessionID: string;
  }) {
    if (group.kind === "input") {
      return (
        <div className="my-2 flex flex-col gap-2">
          {(group.messages ?? []).map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </div>
      );
    }
    if (group.kind === "content") return <ActivityParts entries={group.entries} live={live} />;
    if (group.kind === "compaction") return <CompactionBoundary group={group} />;
    if (group.kind === "boundary") return <TimelineBoundary group={group} />;
    if (group.kind === "subagent") return <SubagentResponse group={group} />;
    if (group.kind === "subagent-tool") {
      return <SubagentLaunch group={group} parentSessionID={sessionID} />;
    }
    if (
      group.showReasoningSummaries === false &&
      group.entries.every((entry) => entry.part.type === "reasoning")
    ) {
      return (
        <div className="flex min-h-7 flex-col justify-center text-xs text-muted-foreground">
          <span className="text-foreground/75">{group.title}</span>
          {live && group.currentAction ? (
            <ThinkingShimmer className="text-meta">{group.currentAction}</ThinkingShimmer>
          ) : null}
        </div>
      );
    }
    if (group.presentation === "individual") {
      return (
        <GroupedActivityDetails
          entries={group.entries}
          live={live}
          detailsDefaultOpen={group.detailsDefaultOpen}
          showReasoningSummaries={group.showReasoningSummaries}
          sessionID={sessionID}
          groupSameFileReads={group.groupSameFileReads}
        />
      );
    }
    return (
      <ActivityGroup
        group={group}
        live={live}
        defaultOpen={reveal || group.defaultOpen}
        revealGeneration={revealGeneration}
        sessionID={sessionID}
      />
    );
  },
  (previous, next) =>
    previous.live === next.live &&
    previous.reveal === next.reveal &&
    previous.revealGeneration === next.revealGeneration &&
    previous.sessionID === next.sessionID &&
    sameTurnActivityGroup(previous.group, next.group),
);

export function ActivityGroup({
  group,
  live,
  defaultOpen = false,
  revealGeneration = 0,
  sessionID = "",
}: {
  group: TurnActivityGroup;
  live: boolean;
  defaultOpen?: boolean;
  revealGeneration?: number;
  sessionID?: string;
}) {
  const disclosureAtom = useMemo(
    () => activityGroupOpenAtomFamily(sessionID, group.id),
    [sessionID, group.id],
  );
  const [persistedOpen, setPersistedOpen] = useAtom(disclosureAtom);
  const [animate, setAnimate] = useState(false);
  const appliedRevealGeneration = useRef(0);
  const hasError =
    group.status === "failed" ||
    group.entries.some((entry) => {
      if (!isTool(entry.part)) return false;
      const state = entry.part.state;
      return Boolean(
        state && typeof state === "object" && !Array.isArray(state) && state.status === "error",
      );
    });
  const forcedOpen = group.forceOpen === true;
  const open = forcedOpen ? true : (persistedOpen ?? defaultOpen);
  const shimmer = live || group.kind === "compaction";

  useEffect(() => {
    if (revealGeneration <= appliedRevealGeneration.current) return;
    appliedRevealGeneration.current = revealGeneration;
    setPersistedOpen(true);
  }, [revealGeneration, setPersistedOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        if (forcedOpen) return;
        setAnimate(true);
        setPersistedOpen(value);
      }}
      data-palot-activity-group={group.kind}
      className="my-1 min-w-0 text-muted-foreground"
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={activityDisclosureTriggerClassName}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <span className={activityDisclosureTitleClassName}>{group.title}</span>
          {shimmer && group.currentAction ? (
            <ThinkingShimmer className="min-w-0 truncate text-muted-foreground">
              · {group.currentAction}
            </ThinkingShimmer>
          ) : null}
        </span>
        {hasError ? <span className="sr-only">Failed</span> : null}
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={animate} className="min-w-0 pt-1">
        <GroupedActivityDetails
          entries={group.entries}
          live={live}
          detailsDefaultOpen={group.detailsDefaultOpen}
          showReasoningSummaries={group.showReasoningSummaries}
          sessionID={sessionID}
          groupSameFileReads={group.groupSameFileReads}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

type ActivityDetailRow =
  | { id: string; kind: "reasoning"; entries: TurnPart[] }
  | { id: string; kind: "read"; path: string; entries: TurnPart[] }
  | { id: string; kind: "compaction"; entry: TurnPart }
  | { id: string; kind: "part"; entry: TurnPart };

function activityDetailRows(
  entries: TurnPart[],
  groupSameFileReads = false,
  showReasoningSummaries = true,
): ActivityDetailRow[] {
  const rows: ActivityDetailRow[] = [];
  for (const entry of entries) {
    if (entry.part.type === "compaction") {
      rows.push({
        id: entry.part.id ?? `${entry.message.id}:compaction:${entry.index}`,
        kind: "compaction",
        entry,
      });
      continue;
    }
    if (entry.part.type !== "reasoning") {
      const execution =
        groupSameFileReads && isTool(entry.part)
          ? projectToolExecution(entry.part, entry.index)
          : null;
      if (execution?.kind === "read" && execution.path !== "Unknown path") {
        const previous = rows.at(-1);
        const existing =
          previous?.kind === "read" && previous.path === execution.path ? previous : null;
        if (existing) existing.entries.push(entry);
        else {
          rows.push({
            id: entry.part.id ?? `${entry.message.id}:read:${entry.index}`,
            kind: "read",
            path: execution.path,
            entries: [entry],
          });
        }
        continue;
      }
      rows.push({
        id: entry.part.id ?? `${entry.message.id}:${entry.part.type}:${entry.index}`,
        kind: "part",
        entry,
      });
      continue;
    }
    if (!showReasoningSummaries) continue;
    if (!messageText(entry.message, entry.part).trim()) continue;
    const previous = rows.at(-1);
    if (previous?.kind === "reasoning") {
      previous.entries.push(entry);
    } else {
      rows.push({
        id: entry.part.id ?? `${entry.message.id}:reasoning:${entry.index}`,
        kind: "reasoning",
        entries: [entry],
      });
    }
  }
  return rows;
}

function GroupedActivityDetails({
  entries,
  live,
  detailsDefaultOpen = false,
  showReasoningSummaries = true,
  sessionID,
  groupSameFileReads = false,
}: {
  entries: TurnPart[];
  live: boolean;
  detailsDefaultOpen?: boolean;
  showReasoningSummaries?: boolean;
  sessionID: string;
  groupSameFileReads?: boolean;
}) {
  const rows = activityDetailRows(entries, groupSameFileReads, showReasoningSummaries);
  const lastEntry = entries.at(-1);
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) =>
        row.kind === "reasoning" ? (
          row.entries.length > 1 &&
          row.entries.every(
            (entry) =>
              entry.part.presentation !== "preamble" && entry.part.presentation !== "recap",
          ) ? (
            <ThoughtGroupDisclosure
              key={row.id}
              entries={row.entries}
              live={live && row.entries.includes(lastEntry!)}
              defaultOpen={showReasoningSummaries}
            />
          ) : (
            <div key={row.id} className="flex flex-col gap-1">
              {row.entries.map((entry) => (
                <ThoughtDisclosure
                  key={entryID(entry)}
                  entry={entry}
                  live={live && entry === lastEntry}
                  defaultOpen={showReasoningSummaries}
                />
              ))}
            </div>
          )
        ) : row.kind === "read" ? (
          <ReadToolExecutionGroup
            key={row.id}
            entries={row.entries.map((entry) => ({ part: entry.part, index: entry.index }))}
            defaultOpen={detailsDefaultOpen}
          />
        ) : row.kind === "compaction" ? (
          <CompactionBoundary
            key={row.id}
            group={{
              id: row.id,
              kind: "compaction",
              title: "Compacting context",
              status:
                row.entry.part.status === "failed"
                  ? "failed"
                  : row.entry.part.status === "running"
                    ? "running"
                    : "completed",
              entries: [row.entry],
            }}
          />
        ) : (
          <ActivityPartDetail
            key={row.id}
            entry={row.entry}
            live={live && row.entry.message.completedAt === null}
            defaultOpen={detailsDefaultOpen}
            sessionID={sessionID}
          />
        ),
      )}
    </div>
  );
}

function ActivityPartDetail({
  entry,
  live,
  defaultOpen,
  sessionID,
}: {
  entry: TurnPart;
  live: boolean;
  defaultOpen: boolean;
  sessionID: string;
}) {
  if (isTool(entry.part)) {
    const execution = projectToolExecution(entry.part, entry.index);
    if (execution.kind === "subagent") {
      const status =
        execution.status === "error"
          ? "failed"
          : execution.status === "running"
            ? "running"
            : execution.status === "pending"
              ? "pending"
              : "completed";
      return (
        <SubagentLaunch
          group={{
            id: entryID(entry),
            kind: "subagent-tool",
            title: execution.description || "Delegated work",
            status,
            entries: [entry],
          }}
          parentSessionID={sessionID}
        />
      );
    }
  }
  return (
    <MessagePartView
      message={entry.message}
      part={entry.part}
      index={entry.index}
      live={live}
      defaultOpen={defaultOpen}
    />
  );
}

function entryID(entry: TurnPart): string {
  return entry.part.id ?? `${entry.message.id}:${entry.part.type}:${entry.index}`;
}

export function CompactionBoundary({ group }: { group: TurnActivityGroup }) {
  const [open, setOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const part = group.entries.find((entry) => entry.part.type === "compaction")?.part;
  const failed = group.status === "failed";
  const running = group.status === "running";
  const label = failed ? "Compaction failed" : running ? "Compacting..." : "Compaction completed";
  const error = part?.error?.trim();
  const summary = part?.text?.trim();
  const recent = part?.recent?.trim();
  const recentTokens = recent ? Math.round(recent.length / 4) : 0;
  const recentLabel = `Approximately ${recentTokens.toLocaleString()} tokens of recent context are kept verbatim`;
  const hasDetails = Boolean(
    summary || recent || error || part?.cost !== undefined || part?.tokens,
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-3 min-w-0"
      data-palot-compaction={group.status}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground/65">
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
        <CollapsibleTrigger
          disabled={!hasDetails}
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs font-normal text-muted-foreground/65 hover:bg-transparent hover:text-muted-foreground aria-expanded:bg-transparent"
            />
          }
        >
          {running ? <ThinkingShimmer>{label}</ThinkingShimmer> : <span>{label}</span>}
          {hasDetails ? (
            open ? (
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            ) : (
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            )
          ) : null}
        </CollapsibleTrigger>
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
      </div>
      {hasDetails ? (
        <CollapsibleContent className="mx-auto mt-1.5 max-h-[32rem] max-w-3xl overflow-y-auto rounded-lg border border-border/50 bg-muted/15 px-3 py-2.5">
          <CompactionUsage part={part} />
          {error ? <p className="m-0 text-xs/relaxed text-destructive">{error}</p> : null}
          {summary ? (
            <MarkdownContent value={summary} className="text-xs/relaxed text-foreground/75" />
          ) : null}
          {recent ? (
            <Collapsible
              open={recentOpen}
              onOpenChange={setRecentOpen}
              className={cn(summary || error ? "mt-2 border-t border-border/40 pt-2" : undefined)}
            >
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 max-w-full justify-start px-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
                  />
                }
              >
                <span className="min-w-0 truncate text-left">{recentLabel}</span>
                {recentOpen ? (
                  <ChevronDown data-icon="inline-end" aria-hidden="true" />
                ) : (
                  <ChevronRight data-icon="inline-end" aria-hidden="true" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1">
                <MarkdownContent value={recent} className="text-xs/relaxed text-foreground/70" />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

export function TimelineBoundary({ group }: { group: TurnActivityGroup }) {
  const part = group.entries[0]?.part;
  if (!part) return null;
  const data =
    part.data && typeof part.data === "object" && !Array.isArray(part.data) ? part.data : {};
  if (data.kind === "synthetic") return <SyntheticUpdate group={group} />;
  return <StandardTimelineBoundary group={group} part={part} />;
}

function StandardTimelineBoundary({
  group,
  part,
}: {
  group: TurnActivityGroup;
  part: PalotMessageContent;
}) {
  const data =
    part.data && typeof part.data === "object" && !Array.isArray(part.data) ? part.data : {};
  const detail = part.text?.trim();
  const failed = group.status === "failed";
  const running = group.status === "running";
  const interrupted = group.status === "interrupted";
  const role = failed ? "alert" : running ? "status" : "separator";
  const label = part.name ?? group.title;
  const retryAt = typeof data.at === "number" ? data.at : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || retryAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [retryAt, running]);

  const retryDelay = retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1_000));
  const visibleLabel = retryDelay && retryDelay > 0 ? `${label} in ${retryDelay}s` : label;

  if (failed || interrupted) {
    const Icon = failed ? CircleAlert : CircleStop;
    return (
      <div
        className={cn(
          "my-3 flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5",
          failed ? "border-destructive/25 bg-destructive/[0.045]" : "border-border/60 bg-muted/20",
        )}
        role={role}
        aria-label={label}
        data-palot-boundary={typeof data.kind === "string" ? data.kind : "session"}
      >
        <Icon
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            failed ? "text-destructive" : "text-muted-foreground/75",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p
            className={cn(
              "m-0 text-xs font-medium",
              failed ? "text-destructive" : "text-foreground/80",
            )}
          >
            {label}
          </p>
          {detail ? (
            <p
              className={cn(
                "mt-0.5 mb-0 text-xs/relaxed",
                failed ? "text-destructive/80" : "text-muted-foreground/70",
              )}
            >
              {detail}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="my-3 flex min-w-0 flex-col gap-1.5"
      role={role}
      aria-label={visibleLabel}
      data-palot-boundary={typeof data.kind === "string" ? data.kind : "session"}
    >
      <div className={cn("flex items-center gap-3 text-xs", "text-muted-foreground/65")}>
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
        {running ? <ThinkingShimmer>{visibleLabel}</ThinkingShimmer> : <span>{label}</span>}
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
      </div>
      {detail ? (
        <p className={cn("m-0 text-center text-xs/relaxed", "text-muted-foreground/55")}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function SyntheticUpdate({ group }: { group: TurnActivityGroup }) {
  const [open, setOpen] = useState(false);
  const part = group.entries[0]?.part;
  if (!part) return null;
  const detail = part.text?.trim();
  const label = part.name ?? group.title;

  if (!detail) {
    return (
      <div
        className="my-2 flex h-7 min-w-0 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-label={label}
        data-palot-synthetic-update={group.id}
      >
        <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate text-foreground/75">{label}</span>
      </div>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-2 min-w-0 text-muted-foreground"
      data-palot-synthetic-update={group.id}
    >
      <CollapsibleTrigger
        disabled={!detail}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 max-w-full justify-start px-0 text-xs font-normal hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          />
        }
      >
        <Sparkles data-icon="inline-start" aria-hidden="true" />
        <span className="min-w-0 truncate text-left text-foreground/75">{label}</span>
        {detail ? (
          open ? (
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )
        ) : null}
      </CollapsibleTrigger>
      {detail ? (
        <CollapsibleContent className="ml-5 max-h-[32rem] max-w-3xl overflow-y-auto rounded-lg border border-border/50 bg-muted/15 px-3 py-2.5">
          <MarkdownContent value={detail} className="text-xs/relaxed text-foreground/75" />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function ThoughtGroupDisclosure({
  entries,
  live,
  defaultOpen = false,
}: {
  entries: TurnPart[];
  live: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const interacted = useRef(false);
  const [animate, setAnimate] = useState(false);
  const thoughts = useMemo(
    () =>
      entries.map((entry) => {
        const text = messageText(entry.message, entry.part).trim();
        return {
          id: entryID(entry),
          title: createReasoningTitle(text),
          content: splitReasoningContent(text),
        };
      }),
    [entries],
  );
  const duration = useMemo(() => {
    const created = entries.flatMap((entry) =>
      entry.part.time?.created === undefined ? [] : [entry.part.time.created],
    );
    const completed = entries.flatMap((entry) =>
      entry.part.time?.completed === undefined ? [] : [entry.part.time.completed],
    );
    if (created.length !== entries.length || completed.length !== entries.length) return null;
    return formatThoughtDuration(Math.max(...completed) - Math.min(...created));
  }, [entries]);
  const done = !live || entries.every((entry) => entry.part.time?.completed !== undefined);
  const stateLabel = "Reasoning";
  const title = open ? stateLabel : `${stateLabel}: ${thoughts.at(-1)?.title ?? "Reasoning"}`;
  const summary = `${entries.length} steps${duration ? ` · ${duration}` : ""}`;

  useEffect(() => {
    if (!interacted.current) setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        interacted.current = true;
        setAnimate(true);
        setOpen(value);
      }}
      className="my-0.5 min-w-0 text-muted-foreground"
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${title} · ${summary}`}
            className="h-7 w-full justify-start px-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!"
          />
        }
      >
        <Brain data-icon="inline-start" aria-hidden="true" />
        {done ? (
          <span className="min-w-0 flex-1 truncate text-left text-foreground/80 transition-colors group-hover/button:text-foreground">
            {title}
          </span>
        ) : (
          <ThinkingShimmer className="min-w-0 flex-1 truncate text-left transition-colors group-hover/button:text-foreground">
            {title}
          </ThinkingShimmer>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground/65 transition-colors group-hover/button:text-foreground/80">
          {summary}
        </span>
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={animate} className="min-w-0 pt-1">
        <div className="flex flex-col gap-3 py-1">
          {thoughts.map((thought) => (
            <div
              key={thought.id}
              className="border-l border-border/70 pl-3 text-xs/relaxed text-muted-foreground"
            >
              {thought.content.title ? (
                <div className="font-medium text-foreground/80">{thought.content.title}</div>
              ) : null}
              {thought.content.body ? (
                <MarkdownContent
                  value={thought.content.body}
                  className="mt-1 max-h-80 overflow-y-auto pr-2 text-xs/relaxed text-muted-foreground"
                />
              ) : thought.content.title ? null : (
                thought.title
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ThoughtDisclosure({
  entry,
  live,
  defaultOpen = false,
}: {
  entry: TurnPart;
  live: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const interacted = useRef(false);
  const [animate, setAnimate] = useState(false);
  const text = messageText(entry.message, entry.part).trim();
  const content = useMemo(() => splitReasoningContent(text), [text]);
  const completedAt = entry.part.time?.completed;
  const duration =
    completedAt === undefined || entry.part.time?.created === undefined
      ? null
      : formatThoughtDuration(completedAt - entry.part.time.created);
  const done = completedAt !== undefined || !live;
  const presentationLabel =
    entry.part.presentation === "preamble"
      ? "Update"
      : entry.part.presentation === "recap"
        ? "Recap"
        : "Reasoning";
  const label = `${presentationLabel}${content.title ? `: ${content.title}` : ""}`;
  const compact = !text.includes("\n") || Boolean(content.title && !content.body);
  useEffect(() => {
    if (!interacted.current) setOpen(defaultOpen);
  }, [defaultOpen]);
  if (!text) return null;
  if (compact) {
    const compactLabel = content.title ?? createReasoningTitle(text);
    return (
      <div className="my-0.5 flex h-7 min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <Brain className="size-3 shrink-0" aria-hidden="true" />
        {done ? (
          <span className="min-w-0 flex-1 truncate text-foreground/80">
            {presentationLabel}: {compactLabel}
          </span>
        ) : (
          <ThinkingShimmer className="min-w-0 flex-1 truncate">
            {presentationLabel}: {compactLabel}
          </ThinkingShimmer>
        )}
        {duration ? <span className="shrink-0 tabular-nums opacity-65">{duration}</span> : null}
      </div>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        interacted.current = true;
        setAnimate(true);
        setOpen(value);
      }}
      className="my-0.5 min-w-0 text-muted-foreground"
    >
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-0! text-xs font-normal hover:bg-transparent! hover:text-foreground aria-expanded:bg-transparent!"
          />
        }
      >
        <Brain data-icon="inline-start" aria-hidden="true" />
        {done ? (
          <span className="min-w-0 flex-1 truncate text-left text-foreground/80 transition-colors group-hover/button:text-foreground">
            {label}
          </span>
        ) : (
          <ThinkingShimmer className="min-w-0 flex-1 truncate text-left transition-colors group-hover/button:text-foreground">
            {label}
          </ThinkingShimmer>
        )}
        {duration ? (
          <span className="shrink-0 tabular-nums text-muted-foreground/65 transition-colors group-hover/button:text-foreground/80">
            {duration}
          </span>
        ) : null}
        {open ? (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent smooth animate={animate} className="min-w-0 pt-1">
        <div className="my-1">
          {content.title && !content.body ? (
            <div className="border-l border-border/70 pl-3 text-xs/relaxed text-muted-foreground">
              {content.title}
            </div>
          ) : null}
          {content.body ? (
            <MarkdownContent
              value={content.body}
              className="max-h-80 overflow-y-auto pr-2 text-xs/relaxed text-muted-foreground"
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatThoughtDuration(durationMs: number): string {
  const clamped = Math.max(0, durationMs);
  if (clamped < 1_000) return `${Math.round(clamped)}ms`;
  return `${(clamped / 1_000).toFixed(1).replace(/\.0$/, "")}s`;
}

function ActivityParts({ entries, live }: { entries: TurnPart[]; live: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry) => (
        <MessagePartView
          key={`${entry.message.id}:${entry.part.id ?? entry.index}`}
          message={entry.message}
          part={entry.part}
          index={entry.index}
          live={live && entry.message.completedAt === null}
        />
      ))}
    </div>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  parts: selectedParts,
  className,
}: {
  message: PalotMessage;
  parts?: PalotMessageContent[];
  className?: string;
}) {
  const role = messageRole(message);
  const parts =
    selectedParts ??
    (message.content.length > 0 ? message.content : [{ type: "text", text: message.text ?? "" }]);
  const align = role === "user" ? "end" : "start";
  const userContentSummary = role === "user" ? summarizeMessageParts(parts) : null;
  const userContent = (
    <>
      {message.fileReferences?.length || message.skillReferences?.length ? (
        <MessageReferences
          files={message.fileReferences ?? []}
          skills={message.skillReferences ?? []}
        />
      ) : null}
      {parts.map((part, index) => (
        <MessagePartView
          key={part.id ?? `${message.id}-${index}`}
          message={message}
          part={part}
          index={index}
          live={message.completedAt === null}
        />
      ))}
    </>
  );
  return (
    <Message role="article" aria-label={`${role} message`} align={align} className={className}>
      <MessageContent>
        <Bubble
          align={align}
          variant={role === "user" ? "secondary" : "ghost"}
          className={cn(role === "assistant" && "w-full")}
        >
          <BubbleContent className={cn(role === "assistant" && "w-full")}>
            {role !== "user" && message.files?.length ? (
              <MessageAttachments files={message.files} />
            ) : null}
            {userContentSummary ? (
              <ExpandableUserMessageContent
                likelyLong={userContentSummary.likelyLong}
                accessibleText={userContentSummary.text}
              >
                {userContent}
              </ExpandableUserMessageContent>
            ) : (
              userContent
            )}
            {role === "user" && message.files?.length ? (
              <MessageAttachments files={message.files} className="mt-2" />
            ) : null}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
});

const COLLAPSED_USER_MESSAGE_HEIGHT = 208;

function summarizeMessageParts(parts: PalotMessageContent[]): {
  likelyLong: boolean;
  text: string;
} {
  const textParts: string[] = [];
  let lines = 0;
  for (const part of parts) {
    if (!("text" in part) || typeof part.text !== "string") continue;
    textParts.push(part.text);
    lines += part.text.split("\n").length - 1;
  }
  const text = textParts.join("\n");
  return { likelyLong: text.length > 700 || lines > 12, text };
}

function ExpandableUserMessageContent({
  children,
  likelyLong,
  accessibleText,
}: {
  children: React.ReactNode;
  likelyLong: boolean;
  accessibleText: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [measuredOverflow, setMeasuredOverflow] = useState(false);
  const overflowing = measured ? measuredOverflow : likelyLong;
  const collapsed = overflowing && !expanded;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      if (content.scrollHeight <= 0) return;
      setMeasured(true);
      setMeasuredOverflow(content.scrollHeight > COLLAPSED_USER_MESSAGE_HEIGHT + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <div
        className={cn("relative", collapsed && "overflow-hidden")}
        style={collapsed ? { maxHeight: COLLAPSED_USER_MESSAGE_HEIGHT } : undefined}
      >
        {collapsed && accessibleText ? <span className="sr-only">{accessibleText}</span> : null}
        <div
          ref={contentRef}
          inert={collapsed ? true : undefined}
          aria-hidden={collapsed || undefined}
        >
          {children}
        </div>
        {collapsed ? (
          <span
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-secondary to-transparent"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {overflowing ? (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

function MessageAttachments({
  files,
  className,
}: {
  files: NonNullable<PalotMessage["files"]>;
  className?: string;
}) {
  return (
    <AttachmentGroup
      className={cn("max-w-full justify-start py-0", className)}
      aria-label="Attachments"
    >
      {files.map((file, index) => (
        <FileAttachment key={`${file.uri}:${index}`} file={file} />
      ))}
    </AttachmentGroup>
  );
}

function MessageReferences({
  files,
  skills,
}: {
  files: NonNullable<PalotMessage["fileReferences"]>;
  skills: NonNullable<PalotMessage["skillReferences"]>;
}) {
  return (
    <div className="mb-2 flex max-w-full flex-wrap justify-end gap-1.5" aria-label="References">
      {files.map((file, index) => (
        <span
          key={`${file.uri}:${file.mention.start}:${index}`}
          className="flex max-w-64 items-center gap-1.5 rounded-md border border-foreground/10 bg-background/45 px-2 py-1 text-xs"
          title={file.uri}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">@{file.name}</span>
        </span>
      ))}
      {skills.map((skill, index) => (
        <span
          key={`${skill.id}:${skill.mention.start}:${index}`}
          className="flex max-w-64 items-center gap-1.5 rounded-md border border-foreground/10 bg-background/45 px-2 py-1 text-xs"
        >
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">${skill.id}</span>
        </span>
      ))}
    </div>
  );
}

function MessagePartView({
  message,
  part,
  index,
  live = false,
  defaultOpen = false,
}: {
  message: PalotMessage;
  part: PalotMessageContent;
  index: number;
  live?: boolean;
  defaultOpen?: boolean;
}) {
  if (isTool(part)) return <ToolExecution part={part} index={index} defaultOpen={defaultOpen} />;
  if (part.type === "compaction") {
    const group: TurnActivityGroup = {
      id: part.id ?? `${message.id}:compaction:${index}`,
      kind: "compaction",
      title: "Compacting context",
      status:
        part.status === "failed" ? "failed" : part.status === "running" ? "running" : "completed",
      entries: [{ message, part, index }],
    };
    return <CompactionBoundary group={group} />;
  }
  if (part.type === "timeline-boundary") {
    return (
      <TimelineBoundary
        group={{
          id: part.id ?? `${message.id}:boundary:${index}`,
          kind: "boundary",
          title: part.name ?? "Session update",
          status:
            part.status === "failed"
              ? "failed"
              : part.status === "running"
                ? "running"
                : part.status === "interrupted"
                  ? "interrupted"
                  : "completed",
          entries: [{ message, part, index }],
        }}
      />
    );
  }
  if (part.type === "reasoning") {
    const reasoning = messageText(message, part).trim();
    return reasoning ? <ThoughtDisclosure entry={{ message, part, index }} live={live} /> : null;
  }
  const value = messageText(message, part);
  if (!value) return null;
  return <MarkdownContent value={value} streaming={live && message.type === "assistant"} />;
}

export const PendingRequests = memo(function PendingRequests({
  sessionID,
  requests,
  inline = false,
}: {
  sessionID: string;
  requests: Array<
    PendingRequestView & Partial<Pick<OwnedPendingRequestView, "sessionID" | "sessionTitle">>
  >;
  inline?: boolean;
}) {
  const [responding, setResponding] = useState<Set<string>>(new Set());
  const [attentionTarget, setAttentionTarget] = useAtom(attentionTargetAtom);

  useEffect(() => {
    if (
      !attentionTarget ||
      !requests.some(
        (request) =>
          (request.sessionID ?? sessionID) === attentionTarget.sessionID &&
          request.id === attentionTarget.requestID &&
          request.type === attentionTarget.type,
      ) ||
      attentionTarget.type === "input"
    ) {
      return;
    }
    const element = document.querySelector<HTMLElement>(
      `[data-palot-request-session-id="${CSS.escape(attentionTarget.sessionID)}"][data-palot-request-id="${CSS.escape(attentionTarget.requestID)}"][data-palot-request-type="${CSS.escape(attentionTarget.type)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.querySelector<HTMLElement>("button, input, textarea, select")?.focus();
    setAttentionTarget(null);
  }, [attentionTarget, requests, sessionID, setAttentionTarget]);

  async function respond(requestID: string, action: () => Promise<void>, fallback: string) {
    setResponding((current) => new Set(current).add(requestID));
    try {
      await action();
    } catch (error) {
      showErrorToast(fallback, error);
    } finally {
      setResponding((current) => {
        const next = new Set(current);
        next.delete(requestID);
        return next;
      });
    }
  }

  function replyPermission(
    ownerSessionID: string,
    responseKey: string,
    requestID: string,
    value: "once" | "always" | "reject",
    message?: string,
  ) {
    return respond(
      responseKey,
      () =>
        palot.replyPermission({
          sessionID: ownerSessionID,
          requestID,
          reply: value,
          ...(message ? { message } : {}),
        }),
      "Could not answer this request",
    );
  }

  const cardRequests = requests.filter((request) => request.type !== "input");
  if (cardRequests.length === 0) return null;
  return (
    <div
      className={cn(
        "relative z-30 flex flex-col gap-2 overflow-y-auto overscroll-contain p-1",
        inline
          ? "my-1 max-h-[min(42vh,24rem)] w-full"
          : "mx-auto mb-2 max-h-[min(42vh,24rem)] w-[calc(100%-32px)] max-w-[740px] max-[720px]:w-[calc(100%-20px)]",
      )}
      aria-live="polite"
    >
      {cardRequests.map((request) => {
        const ownerSessionID = request.sessionID ?? sessionID;
        const responseKey = `${ownerSessionID}:${request.type}:${request.id}`;
        const disabled = responding.has(responseKey);
        const requestKey = `${responseKey}:${JSON.stringify({ questions: request.questions, fields: request.fields, delivery: request.delivery })}`;
        return (
          <motion.div
            key={requestKey}
            data-palot-request-id={request.id}
            data-palot-request-session-id={ownerSessionID}
            data-palot-request-type={request.type}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {ownerSessionID !== sessionID ? (
              <p
                className="mb-1 truncate px-1 text-meta font-medium text-warning"
                title={request.sessionTitle}
              >
                Subagent · {request.sessionTitle ?? "Delegated task"}
              </p>
            ) : null}
            {request.type === "question" ? (
              <QuestionRequestCard
                request={request}
                disabled={disabled}
                compact={inline}
                onSubmit={(answers) =>
                  respond(
                    responseKey,
                    () =>
                      palot.replyForm({
                        sessionID: ownerSessionID,
                        formID: request.id,
                        answer: Object.fromEntries(
                          answers.map((values, index) => [
                            `q${index}`,
                            request.questions[index]?.multiple ? values : (values[0] ?? ""),
                          ]),
                        ),
                      }),
                    "Could not submit these answers",
                  )
                }
                onDismiss={() =>
                  respond(
                    responseKey,
                    () =>
                      palot.cancelForm({
                        sessionID: ownerSessionID,
                        formID: request.id,
                      }),
                    "Could not dismiss this question",
                  )
                }
              />
            ) : request.type === "form" ? (
              <FormRequestCard
                request={request}
                disabled={disabled}
                compact={inline}
                onSubmit={(answer) =>
                  respond(
                    responseKey,
                    () =>
                      palot.replyForm({
                        sessionID: ownerSessionID,
                        formID: request.id,
                        answer,
                      }),
                    "Could not submit this form",
                  )
                }
                onCancel={() =>
                  respond(
                    responseKey,
                    () => palot.cancelForm({ sessionID: ownerSessionID, formID: request.id }),
                    "Could not cancel this form",
                  )
                }
              />
            ) : (
              <PermissionRequestCard
                request={request}
                disabled={disabled}
                onReply={(value, message) =>
                  replyPermission(ownerSessionID, responseKey, request.id, value, message)
                }
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
});

export function PostFinalItems({ items }: { items: TurnPostFinalItem[] }) {
  const resources = items.filter((item) => item.kind !== "diff");

  return (
    <div className="mt-3 flex flex-col gap-2" role="group" aria-label="Produced resources">
      {resources.map((item) => (
        <div key={item.id} className="min-w-0">
          {item.kind === "file" && item.mime?.startsWith("image/") && item.uri ? (
            <ReadImagePreview src={item.uri} name={item.name} mime={item.mime} />
          ) : (
            <span
              className="flex max-w-64 items-center gap-1.5 rounded-md border border-foreground/10 bg-muted/25 px-2 py-1 text-xs text-foreground/80"
              title={item.uri ?? item.name}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{item.name}</span>
              <Badge variant="outline" className="ml-0.5 text-micro">
                {item.kind === "change"
                  ? "changed"
                  : item.mime?.startsWith("image/")
                    ? "image"
                    : "file"}
              </Badge>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function RequestCard({
  request,
  children,
  compact = false,
  showHeader = true,
}: {
  request: PendingRequestView;
  children: React.ReactNode;
  compact?: boolean;
  showHeader?: boolean;
}) {
  const titleID = `request-${request.id}-title`;
  return (
    <Alert
      role="region"
      aria-labelledby={showHeader ? titleID : undefined}
      aria-label={showHeader ? undefined : request.title}
      className={cn(
        "gap-3 p-3",
        compact
          ? "border-0 bg-transparent px-1 py-1 shadow-none"
          : "bg-card/95 shadow-lg backdrop-blur-xl",
      )}
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-3">
          <AlertTitle id={titleID}>{request.title}</AlertTitle>
          <Badge variant="outline">
            {request.type === "input" ? (request.delivery ?? "pending") : request.type}
          </Badge>
        </div>
      ) : null}
      {children}
    </Alert>
  );
}

function PermissionRequestCard({
  request,
  disabled,
  onReply,
}: {
  request: PendingRequestView;
  disabled: boolean;
  onReply: (value: "once" | "always" | "reject", message?: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <RequestCard request={request}>
      {request.permissionPreview ? <PermissionPreview preview={request.permissionPreview} /> : null}
      <AlertDescription className="flex flex-col gap-2 text-left text-pretty">
        {request.detail ? <span>{request.detail}</span> : null}
        {request.resources.length > 0 ? (
          <span className="flex flex-col gap-1">
            <span className="text-micro font-medium text-foreground">Requested</span>
            {request.resources.map((resource, index) => (
              <code
                key={`${resource}:${index}`}
                className="rounded bg-muted/70 px-1.5 py-1 font-mono text-code-compact break-all text-foreground"
              >
                {resource}
              </code>
            ))}
          </span>
        ) : null}
        {request.savePatterns.length > 0 ? (
          <span className="flex flex-col gap-1">
            <span className="text-micro font-medium text-foreground">
              Remember for this project
            </span>
            {request.savePatterns.map((pattern, index) => (
              <code
                key={`${pattern}:${index}`}
                className="rounded bg-muted/70 px-1.5 py-1 font-mono text-code-compact break-all text-foreground"
              >
                {pattern}
              </code>
            ))}
          </span>
        ) : (
          <span className="text-micro">
            Project-wide approval is unavailable because OpenCode did not provide a reusable
            pattern.
          </span>
        )}
        <span className="text-micro">Deny stops all pending protected actions in this task.</span>
      </AlertDescription>
      {rejecting ? (
        <div
          className="flex flex-col gap-2"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setRejecting(false);
            }
          }}
        >
          <label className="text-compact" htmlFor={`reject-${request.id}`}>
            Rejection reason (optional)
          </label>
          <Input
            id={`reject-${request.id}`}
            autoFocus
            value={reason}
            disabled={disabled}
            placeholder="Tell OpenCode what to do differently"
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={disabled}
              onClick={() => void onReply("reject", reason.trim() || undefined)}
            >
              Confirm denial
            </Button>
          </div>
        </div>
      ) : null}
      {rejecting ? null : (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => setRejecting(true)}
          >
            Deny
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void onReply("once")}
          >
            Allow once
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={disabled || request.savePatterns.length === 0}
            title={
              request.savePatterns.length === 0
                ? "OpenCode did not provide a reusable project pattern"
                : "Save these patterns for every task in this project"
            }
            onClick={() => void onReply("always")}
          >
            Always allow for this project
          </Button>
        </div>
      )}
    </RequestCard>
  );
}

function QuestionRequestCard({
  request,
  disabled,
  onSubmit,
  onDismiss,
  compact = false,
}: {
  request: PendingRequestView;
  disabled: boolean;
  onSubmit: (answers: string[][]) => Promise<void>;
  onDismiss: () => Promise<void>;
  compact?: boolean;
}) {
  const items = useMemo(
    () =>
      request.questions.map((question, index) => ({
        name: `q${index}`,
        required: true,
        disabled,
        choices: question.options.map((option) => ({ value: option.label })),
      })),
    [disabled, request.questions],
  );

  return (
    <RequestCard request={request} compact={compact} showHeader={false}>
      <Questionnaire
        className="relative"
        items={items}
        shortcuts="numbers"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const answers = request.questions.map((_, index) =>
            data
              .getAll(`q${index}`)
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          );
          void onSubmit(answers);
        }}
      >
        <QuestionnaireProgress
          className="absolute top-0 right-0"
          render={(props, { current, total }) => (
            <div {...props}>
              {current}/{total}
            </div>
          )}
        />
        {request.questions.map((question, questionIndex) => (
          <QuestionnaireItem
            key={`${request.id}:${questionIndex}`}
            name={`q${questionIndex}`}
            multiple={question.multiple}
            required
            disabled={disabled}
          >
            <QuestionnaireTitle className="w-full pr-12">{question.question}</QuestionnaireTitle>
            {question.multiple ? (
              <QuestionnaireDescription>Select multiple</QuestionnaireDescription>
            ) : null}
            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice key={option.label} value={option.label}>
                  <span className="font-medium text-foreground">{option.label}</span>
                  {option.description ? (
                    <QuestionnaireChoiceDescription>
                      {option.description}
                    </QuestionnaireChoiceDescription>
                  ) : null}
                </QuestionnaireChoice>
              ))}
              {question.custom ? (
                <QuestionnaireInput
                  disabled={disabled}
                  placeholder="Other answer…"
                  aria-label={`${question.header} custom answer`}
                />
              ) : null}
            </QuestionnaireChoices>
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions className="grid-cols-[auto_minmax(0,1fr)_auto_auto]">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="col-start-1"
            disabled={disabled}
            onClick={() => void onDismiss()}
          >
            Dismiss
          </Button>
          <QuestionnairePrevious size="sm" className="col-start-2" />
          <QuestionnaireNext size="sm" className="col-start-4" />
          <QuestionnaireSubmit size="sm" className="col-start-4" disabled={disabled}>
            {disabled ? "Sending" : "Send"}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </RequestCard>
  );
}

function initialFormAnswers(fields: PendingFormFieldView[]): Record<string, FormValue> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field.defaultValue !== undefined) return [[field.key, field.defaultValue]];
      return field.type === "boolean" ? [[field.key, false]] : [];
    }),
  );
}

function formFieldVisible(
  field: PendingFormFieldView,
  answers: Record<string, FormValue>,
): boolean {
  return field.when.every((condition) => {
    const answer = answers[condition.key];
    const matched = Array.isArray(answer)
      ? typeof condition.value === "string" && answer.includes(condition.value)
      : answer === condition.value;
    return condition.op === "eq" ? matched : !matched;
  });
}

function formFieldValid(field: PendingFormFieldView, value: FormValue | undefined): boolean {
  if (field.type === "external") return true;
  if (value === undefined) return !field.required;
  if (typeof value === "string") {
    if (value.trim().length === 0) return !field.required;
    if (field.minLength !== undefined && value.length < field.minLength) return false;
    if (field.maxLength !== undefined && value.length > field.maxLength) return false;
    if (field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
    if (field.format === "uri") {
      try {
        new URL(value);
      } catch {
        return false;
      }
    }
    if (
      field.options.length > 0 &&
      !field.custom &&
      !field.options.some((option) => (option.value ?? option.label) === value)
    ) {
      return false;
    }
    return true;
  }
  if (typeof value === "number") {
    if (field.minimum !== undefined && value < field.minimum) return false;
    if (field.maximum !== undefined && value > field.maximum) return false;
    if (field.type === "integer" && !Number.isInteger(value)) return false;
    return true;
  }
  if (Array.isArray(value)) {
    if (field.required && value.length === 0) return false;
    if (field.minItems !== undefined && value.length < field.minItems) return false;
    if (field.maxItems !== undefined && value.length > field.maxItems) return false;
    if (
      !field.custom &&
      value.some((item) => !field.options.some((option) => (option.value ?? option.label) === item))
    ) {
      return false;
    }
    return true;
  }
  return typeof value === "boolean";
}

function FormRequestCard({
  request,
  disabled,
  onSubmit,
  onCancel,
  compact = false,
}: {
  request: PendingRequestView;
  disabled: boolean;
  onSubmit: (answer: Record<string, FormValue>) => Promise<void>;
  onCancel: () => Promise<void>;
  compact?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, FormValue>>(() =>
    initialFormAnswers(request.fields),
  );
  const visibleFields = request.fields.filter((field) => formFieldVisible(field, answers));
  const valid = visibleFields.every((field) => formFieldValid(field, answers[field.key]));

  function setAnswer(key: string, value: FormValue | undefined) {
    setAnswers((current) => {
      if (value !== undefined) return { ...current, [key]: value };
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const submittedAnswers = Object.fromEntries(
    visibleFields.flatMap((field) => {
      const value = answers[field.key];
      return value === undefined || field.type === "external" ? [] : [[field.key, value]];
    }),
  );

  return (
    <RequestCard request={request} compact={compact}>
      {request.detail ? (
        <AlertDescription className="text-left text-pretty">{request.detail}</AlertDescription>
      ) : null}
      <div className="flex flex-col gap-3">
        {visibleFields.map((field) => (
          <FormFieldControl
            key={field.key}
            field={field}
            value={answers[field.key]}
            disabled={disabled}
            onChange={(value) => setAnswer(field.key, value)}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => void onCancel()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={disabled || !valid}
          onClick={() => void onSubmit(submittedAnswers)}
        >
          {disabled ? "Submitting" : "Submit"}
        </Button>
      </div>
    </RequestCard>
  );
}

function FormFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PendingFormFieldView;
  value: FormValue | undefined;
  disabled: boolean;
  onChange: (value: FormValue | undefined) => void;
}) {
  const label = (
    <span className="flex items-center gap-1 text-xs font-medium text-foreground">
      {field.title}
      {field.required ? (
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      ) : null}
    </span>
  );
  if (field.type === "external") {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        {field.description ? (
          <span className="text-micro text-muted-foreground">{field.description}</span>
        ) : null}
        {field.url ? (
          <Button size="xs" variant="outline" render={<a href={field.url} />}>
            Open required step
          </Button>
        ) : null}
      </div>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 rounded-lg border border-input bg-input/20 px-2.5 py-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          {label}
          {field.description ? (
            <span className="text-micro text-muted-foreground">{field.description}</span>
          ) : null}
        </span>
        <Switch
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
      </label>
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend>{label}</legend>
        {field.description ? (
          <span className="text-micro text-muted-foreground">{field.description}</span>
        ) : null}
        {field.options.map((option) => {
          const optionValue = option.value ?? option.label;
          return (
            <label
              key={optionValue}
              className="flex items-start gap-2 rounded-lg border border-input bg-input/20 px-2.5 py-2 text-xs"
            >
              <input
                className="mt-0.5 size-3.5 accent-primary"
                type="checkbox"
                checked={selected.includes(optionValue)}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    selected.includes(optionValue)
                      ? selected.filter((item) => item !== optionValue)
                      : [...selected, optionValue],
                  )
                }
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{option.label}</span>
                {option.description ? (
                  <span className="text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
        {field.custom ? (
          <Input
            disabled={disabled}
            placeholder="Add a custom value and press Enter"
            aria-label={`${field.title} custom value`}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !event.currentTarget.value.trim()) return;
              event.preventDefault();
              const next = event.currentTarget.value.trim();
              if (!selected.includes(next)) onChange([...selected, next]);
              event.currentTarget.value = "";
            }}
          />
        ) : null}
      </fieldset>
    );
  }
  const inputType =
    field.type === "number" || field.type === "integer"
      ? "number"
      : field.format === "email"
        ? "email"
        : field.format === "uri"
          ? "url"
          : field.format === "date"
            ? "date"
            : field.format === "date-time"
              ? "datetime-local"
              : "text";
  return (
    <label className="flex flex-col gap-1.5">
      {label}
      {field.description ? (
        <span className="text-micro text-muted-foreground">{field.description}</span>
      ) : null}
      {field.type === "string" && field.options.length > 0 && !field.custom ? (
        <select
          className="h-8 rounded-md border border-input bg-input/20 px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          required={field.required}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select an option</option>
          {field.options.map((option) => (
            <option key={option.value ?? option.label} value={option.value ?? option.label}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <Input
            type={inputType}
            list={field.options.length > 0 ? `${field.key}-options` : undefined}
            value={typeof value === "string" || typeof value === "number" ? value : ""}
            disabled={disabled}
            required={field.required}
            placeholder={field.placeholder}
            min={field.minimum}
            max={field.maximum}
            minLength={field.minLength}
            maxLength={field.maxLength}
            pattern={field.pattern}
            step={field.type === "integer" ? 1 : undefined}
            onChange={(event) =>
              onChange(
                field.type === "number" || field.type === "integer"
                  ? event.target.value === ""
                    ? undefined
                    : Number(event.target.value)
                  : event.target.value,
              )
            }
          />
          {field.options.length > 0 ? (
            <datalist id={`${field.key}-options`}>
              {field.options.map((option) => (
                <option key={option.value ?? option.label} value={option.value ?? option.label}>
                  {option.label}
                </option>
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </label>
  );
}

function ThreadPrompt({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-[300px]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
