import type { FileDiffInfo } from "@opencode/client";
import { isCancelledError } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { terminalPasteAtom } from "../atoms/terminal-paste";
import { useWorkbenchScope } from "../atoms/workbench";
import { useThreadHeaderInsets } from "../hooks/use-thread-header-insets";
import { openNewWorkbenchTerminal } from "../services/workbench-terminal";
import {
  ChevronDown,
  CircleAlert,
  Copy,
  FileText,
  FolderGit2,
  GitBranch,
  GitFork,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createElement,
  Fragment,
  useContext,
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PalotMessage, PalotModel, PalotSession } from "../../shared";
import type { ProviderLimit } from "../../shared/provider-limit";
import {
  browserLocalLinksAtom,
  browserWebLinksAtom,
  experimentalBrowserAtom,
  sessionProjectionPreferenceAtom,
  showTimelineCacheBustsAtom,
} from "../atoms/ui";
import {
  belongsToSession,
  runtimeAtom,
  selectedSessionIDAtom,
  subagentProgress as calculateSubagentProgress,
  type SessionExecutionState,
} from "../atoms/workspace";
import {
  contextMessageTargetAtom,
  transcriptJumpTargetAtom,
  useWorkbenchCommands,
} from "../atoms/workbench";
import { attentionTargetAtom } from "../atoms/attention";
import {
  clearSessionStopAtom,
  SESSION_STOPPING_MS,
  sessionStopRequestsAtom,
} from "../atoms/session-stop";
import { resolvedAppearanceAtom } from "../atoms/appearance";
import { spring } from "../lib/springs";
import { retainedTranscriptLayouts } from "../lib/transcript-layout-cache";
import type { OpenedSessionView } from "../hooks/use-session-info";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { useBrowserSession } from "../hooks/use-browser-session";
import { openFileInBrowser, workspaceFileTarget } from "../lib/browser-files";
import { serverHomeDirectory } from "../lib/file-reference";
import { LinkActionsProvider, type LinkActions, type WebLinkDestination } from "./link-actions";
import { useSessionTranscriptProjection } from "../hooks/use-session-transcript-projection";
import { useMcpElicitations } from "../hooks/use-mcp-elicitations";
import { useSessionRequests, useSessionFamilyRequestViews } from "../hooks/use-session-requests";
import { useSessionActivityForSession } from "../hooks/use-session-activity";
import { useRunningShells } from "../hooks/use-running-shells";
import { useRunningWork } from "./running-work-control";
import { usePalotNavigation } from "../hooks/use-navigation";
import {
  useProjectCatalog,
  useSessionCatalog,
  useSessionCatalogSelector,
} from "../hooks/use-session-catalog";
import { cn } from "../lib/cn";
import { isChatSession } from "../lib/chats";
import { EditFromHereProvider } from "./transcript/edit-from-here";
import { firstUnseenMessage } from "../lib/transcript-unread";
import { NewMessagesDivider, UnreadContext } from "./transcript/unread-divider";
import { TranscriptArtifactContext } from "./transcript/artifact-context";
import { TranscriptModelsContext } from "./transcript/model-switch";
import {
  PendingApprovalContext,
  PendingApprovalStore,
  pendingApprovalsByPart,
} from "./transcript/pending-approvals";
import { createMarkdownSessionOpener } from "../lib/markdown-session-links";
import { writeClipboardText } from "../lib/clipboard";
import { likelyCacheBusts, type LikelyCacheBust } from "../lib/cache-bust";
import { resolveSessionProjectionPreference } from "../lib/session-projection-policy";
import { withPersistedTurnFailures } from "../lib/persisted-turn-failures";
import {
  sessionActivityLabel,
  sessionActivityStatus,
  type SessionActivityStatus,
} from "../lib/session-activity-status";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { reviewOfferUserMessageID } from "../lib/turn-review-offer";
import { TurnReviewActions } from "./turn-review-offer";
import { TurnChangedFiles } from "./transcript/turn-changed-files";
import { TranscriptDiffScopeContext } from "./script-call-diffs";
import {
  ResponseSelectionAsk,
  responseAnchorSelector,
  responseRowIndex,
  responseSelectionSource,
} from "./response-selection-ask";
import { recordStreamingCommit } from "../lib/streaming-latency";
import { samePlainValue, useStableList, useStableValue } from "../lib/stable-value";
import {
  composerTranscriptPageDirection,
  nearTranscriptTurns,
  readTranscriptScrollUpdate,
  normalizeTranscriptWheelDelta,
  transcriptWheelIsSideways,
  scheduleTranscriptScrollFrame,
  transcriptKeyboardScrollDelta,
  transcriptPageScrollTop,
  transcriptScrollTargetConsumesDelta,
  transcriptSubmissionFollowsBottom,
  type TranscriptScrollIntent,
} from "../lib/transcript-scroll";
import { prefersReducedMotion } from "../hooks/use-reduced-motion";
import { showErrorToast } from "../lib/toast-error";
import {
  type TranscriptBackgroundFacts,
  type TranscriptPresentationRow,
  type TranscriptProjectionRow,
  type TranscriptTurn,
  type TurnPostFinalItem,
} from "../lib/turn-projection";
import {
  messageText,
  pendingRequestViews,
  projectForSession,
  projectLocation,
  projectName,
  sessionIsAdditionalCheckout,
  type PendingRequestView,
} from "../lib/view-models";
import { palot } from "../services/palot";
import { useSessionTitleEditor } from "../hooks/use-session-title-editor";
import { useSessionFork } from "../hooks/use-session-fork";
import { useTranscriptNavigation } from "../hooks/use-transcript-navigation";
import { useTranscriptPrompts } from "../hooks/use-transcript-prompts";
import { useTranscriptInfiniteScroll } from "../hooks/use-transcript-infinite-scroll";
import {
  transcriptPrependPinnedIndexes,
  useTranscriptPrependAnchor,
  type TranscriptPrependPin,
} from "../hooks/use-transcript-prepend-anchor";
import { TranscriptRail } from "./transcript-rail";
import { TranscriptFindBar, useTaskViewShortcuts, useTranscriptFind } from "./transcript-find";
import {
  CompactionTranscriptContext,
  type CompactionTranscriptActions,
} from "./transcript/compaction-row";
import { compactionAnchorSelector, turnIndexForMessage } from "./transcript/compaction-anchor";
import { compactionHistory } from "../lib/context-usage";
import { LiveTurnContext, type LiveTurnInputs } from "./transcript/live-turn-context";
import { ParentTaskBreadcrumb } from "./transcript/parent-breadcrumb";
import {
  composerOpenTabAtom,
  useStandingTabs,
  type ComposerRunningWork,
} from "./composer/composer-standing";
import type { ComposerRequest } from "./composer/composer-requests";
import { lastMessageLimit } from "../lib/usage-limit-reset";
import { latestPlan, planItems } from "./transcript/plan";
import { ActivityGroups, TurnActivity, turnShowsBar } from "./transcript/activity-group";
import { MessageRow } from "./transcript/message-row";
import { PendingRequests } from "./transcript/pending-requests";
import { formatElapsed } from "../lib/duration";
import { useCurrentTime } from "./transcript/shared";
import { TimelineBoundary } from "./transcript/timeline-parts";
import { SessionHistoryDialog } from "./session-history-dialog";
import { useVcsInfo } from "../hooks/use-vcs-info";
import { CheckoutBranchPicker } from "./branch-picker";
import { Composer } from "./composer";
import { ConnectionDestination } from "./connection-destination";
import { useFileReferenceOpener } from "./file-reference-opener";
import { isLocalMarkdownWebLink, MarkdownWorkspaceProvider } from "./markdown-content";
import {
  MessageQuoteOpenerContext,
  type MessageQuoteOpener,
} from "./transcript/user-message-quotes";
import { NewTask } from "./new-task";
import { OpenInSelector } from "./open-in-selector";
import { MoveToProjectDialog } from "./move-to-project-dialog";
import { PullRequestControl } from "./pull-requests/pull-request-control";
import { ShipButton } from "./ship-button";
import { SessionExportMenu, type SessionHistoryActions } from "./session-context-menu";
import { useGuestPendingMessages } from "./guest-links";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ScrollAreaRoot, ScrollViewport, ScrollBar } from "./ui/scroll-area";
import { IconButton, LoadingButton } from "./ui";
import { ThinkingShimmer } from "./thinking-shimmer";
import { ReadImagePreview } from "./read-image-preview";
import { StandaloneShellExecution } from "./tool-execution";
import {
  projectBackgroundWork,
  SubagentReportsContext,
  subagentReportsByChild,
  SubagentComposerNote,
  SubagentSessionDock,
  sessionPresentation,
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
  if (turn.status === "completed" && turn.user) size += 28;
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

export function Thread({
  sessionID,
  openedView,
}: {
  sessionID?: string;
  /**
   * The task's read state from when it was opened, null while it is still being read fresh.
   * Without it, the state cached when the view mounts decides what is unseen.
   */
  openedView?: OpenedSessionView | null;
}) {
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
  return <SessionThread session={session} openedView={openedView} />;
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

const SessionThread = memo(function SessionThread({
  session,
  openedView,
}: {
  session: PalotSession;
  openedView: OpenedSessionView | null | undefined;
}) {
  const runtime = useAtomValue(runtimeAtom);
  return (
    <main
      className="palot-main-surface relative flex h-full min-h-0 flex-col bg-background"
      aria-label="Current task"
      data-palot-task-view=""
    >
      <SessionThreadContents
        key={`${runtime?.connectionID}:${session.id}`}
        session={session}
        openedView={openedView}
      />
    </main>
  );
});

const SessionThreadContents = memo(function SessionThreadContents({
  session,
  openedView,
}: {
  session: PalotSession;
  openedView: OpenedSessionView | null | undefined;
}) {
  "use no memo";
  const transcript = useSessionTranscript(session);
  const requestsQuery = useSessionRequests(session.id);
  const messages = transcript.messages;
  const [mountedView] = useState<OpenedSessionView>(() => ({
    ...(session.idleAt === undefined ? {} : { idleAt: session.idleAt }),
    ...(session.viewedAt === undefined ? {} : { viewedAt: session.viewedAt }),
  }));
  // Null until the route has read the task fresh; nothing is unseen, or landed on, before that.
  const unreadSession = openedView === undefined ? mountedView : openedView;
  const [unreadCleared, setUnreadCleared] = useState(false);
  const unreadMessageID =
    unreadCleared || !unreadSession ? null : firstUnseenMessage(unreadSession, messages);
  const requests = requestsQuery.data ?? null;
  const loading = transcript.isPending || transcript.isHydrating;
  const [animateTranscriptEntrance] = useState(transcript.isPending);
  const cursor = transcript.hasNextPage;
  const activity = useSessionActivityForSession(session.id).data;
  const executionStates = activity?.execution ?? EMPTY_EXECUTION_STATES;
  const runtimeStatus = activity?.status ?? null;
  const execution = executionStates.get(session.id) ?? null;
  const loadingOlder = transcript.isFetchingNextPage;
  const olderRequestRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  // The older-history anchor, read by callbacks declared before the hook runs.
  const prependAnchorRef = useRef<{ isHolding(): boolean } | null>(null);
  const bottomLockedRef = useRef(true);
  const bottomFollowFrameRef = useRef<number | null>(null);
  const lastFollowedVirtualHeightRef = useRef<number | null>(null);
  const navigationGeometryRef = useRef<(() => void) | null>(null);
  const scrollIntentRef = useRef<TranscriptScrollIntent>(null);
  const previousScrollTopRef = useRef<number | null>(null);
  const touchYRef = useRef<number | null>(null);
  // Where an animating composer page scroll is heading, so repeated page keys add up.
  const pageScrollTargetRef = useRef<number | null>(null);
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
  const handleMessageAdmitted = useCallback(() => {
    setUnreadCleared(true);
    // A reader who scrolled up keeps their place; Scroll to bottom stays available.
    if (
      !transcriptSubmissionFollowsBottom({
        locked: bottomLockedRef.current,
        metrics: scrollRef.current,
      })
    )
      return;
    setSubmissionScrollRequest((current) => current + 1);
  }, []);
  const setBottomLock = useCallback((locked: boolean) => {
    bottomLockedRef.current = locked;
    setBottomLocked((current) => (current === locked ? current : locked));
  }, []);
  const scrollToBottomNow = useCallback(() => {
    const viewport = scrollRef.current;
    if (
      !viewport ||
      !bottomLockedRef.current ||
      prependAnchorRef.current?.isHolding() ||
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
  const { openSession } = usePalotNavigation();
  const [markdownOwner] = useState(() =>
    runtime ? { profileID: runtime.profileID, connectionID: runtime.connectionID } : null,
  );
  const openReferencedSession = useMemo(
    () =>
      createMarkdownSessionOpener(
        markdownOwner?.connectionID === transcript.connectionID ? markdownOwner : null,
        openSession,
      ),
    [markdownOwner, openSession, transcript.connectionID],
  );
  const browserEnabled = useAtomValue(experimentalBrowserAtom);
  const webLinks = useAtomValue(browserWebLinksAtom);
  const localLinks = useAtomValue(browserLocalLinksAtom);
  const browser = useBrowserSession({ profileID: runtime?.profileID ?? "", sessionID: session.id });
  const workbench = useWorkbenchCommands(
    runtime ? { profileID: runtime.profileID, sessionID: session.id } : null,
  );
  const store = useStore();
  const workbenchState = useWorkbenchScope(
    runtime ? { profileID: runtime.profileID, sessionID: session.id } : null,
  );
  const runCode = useCallback(
    async (code: string) => {
      if (!runtime?.connected) throw new Error("Connect to the task's server first");
      const existing = [...workbenchState.bottom.tabs, ...workbenchState.right.tabs].find(
        (tab) =>
          tab.kind === "terminal" &&
          tab.resource.sessionID === session.id &&
          !tab.resource.readOnly,
      );
      const result =
        existing && existing.kind === "terminal"
          ? workbench.openTab({ kind: "terminal", ...existing.resource })
          : await openNewWorkbenchTerminal(
              session.id,
              session.location,
              workbench.openTab,
              { pane: "bottom" },
              runtime.connectionID,
            );
      if (!result?.ok) throw new Error("Close a workbench tab before opening a terminal");
      store.set(terminalPasteAtom, (current) => new Map(current).set(result.tabID, code));
    },
    [runtime, session.id, session.location, store, workbench, workbenchState],
  );
  const previewHTML = useCallback(
    (html: string) => {
      const result = workbench.openTab({ kind: "html-preview", location: session.location, html });
      if (!result?.ok)
        showErrorToast("Could not open HTML preview", new Error("Close a workbench tab first"));
    },
    [workbench, session.location],
  );
  const setContextMessageTarget = useSetAtom(contextMessageTargetAtom);
  // Streaming rebuilds the views per chunk; equal content keeps one identity so the
  // composer, dock and approval store skip the chunk.
  const requestViews = useStableList(
    useMemo(() => (requests ? pendingRequestViews(requests, messages) : []), [requests, messages]),
  );
  const dockMessages = useStableValue(messages, sameDockMessages);
  const usageLimit = useMemo(() => lastMessageLimit(messages), [messages]);
  const projectionPreference = useAtomValue(sessionProjectionPreferenceAtom);
  const showTimelineCacheBusts = useAtomValue(showTimelineCacheBustsAtom);
  const projectionPolicy = useMemo(
    () => resolveSessionProjectionPreference(projectionPreference),
    [projectionPreference],
  );

  useLayoutEffect(() => {
    recordStreamingCommit(session.id, transcript.connectionID);
  }, [messages, session.id, transcript.connectionID]);
  const pendingInputs = useStableList(
    useMemo(() => requestViews.filter((request) => request.type === "input"), [requestViews]),
  );
  // Tool rows read their own approval from this store, so a request re-renders only its row.
  const [pendingApprovals] = useState(() => new PendingApprovalStore());
  const setAttentionTarget = useSetAtom(attentionTargetAtom);
  const focusApproval = useCallback(
    (requestID: string) =>
      setAttentionTarget({ sessionID: session.id, requestID, type: "permission" }),
    [session.id, setAttentionTarget],
  );
  useLayoutEffect(() => {
    pendingApprovals.update(pendingApprovalsByPart(requestViews), focusApproval);
  }, [focusApproval, pendingApprovals, requestViews]);
  // MCP servers ask for input through forms owned by the task's location, not the task.
  const elicitations = useMcpElicitations(
    transcript.connectionID,
    session.location.directory,
    !session.parentID,
  );
  const composerRequests = useStableList(
    useMemo(
      () => [
        ...requestViews.filter((request) => request.type === "question" || request.type === "form"),
        ...elicitations,
      ],
      [elicitations, requestViews],
    ),
  );
  const projectedMessages = useMemo(() => {
    const boundary = session.revert?.messageID;
    const index = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
    // Retain the authoritative history for Restore and the undo dock, but do not
    // present messages which are staged for removal as part of the current task.
    return withPersistedTurnFailures(index < 0 ? messages : messages.slice(0, index));
  }, [messages, session.revert?.messageID]);
  const projection = useSessionTranscriptProjection({
    connectionID: transcript.connectionID,
    sessionID: session.id,
    messages: projectedMessages,
    execution,
    requests: requestViews,
    diffs: EMPTY_DIFFS,
    runtimeStatus,
    initialLocation: session.location,
    policy: projectionPolicy,
  });
  const subagentReports = useMemo(
    () => subagentReportsByChild(projection.background.subagentResponses),
    [projection.background.subagentResponses],
  );
  const subagentsOnBackgroundWork = useMemo(
    () =>
      new Set(
        [...subagentReports]
          .filter(([, reports]) => reports.at(-1)?.backgroundWork)
          .map(([childID]) => childID),
      ),
    [subagentReports],
  );
  const subagentProgress = calculateSubagentProgress(
    executionStates,
    session.id,
    execution?.startedAt ?? null,
    subagentsOnBackgroundWork,
  );
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
  const unreadRow = rows.find((row) => {
    if (!unreadMessageID) return false;
    if (row.kind === "user-message") return row.message.id === unreadMessageID;
    if (row.kind === "assistant-message") return row.final.message.id === unreadMessageID;
    if (row.kind === "shell") return row.entry.message.id === unreadMessageID;
    if (row.kind === "boundary")
      return row.group.entries.some((entry) => entry.message.id === unreadMessageID);
    if (row.kind === "activity")
      return row.turn.activity.some(
        (group) =>
          group.entries.some((entry) => entry.message.id === unreadMessageID) ||
          group.messages?.some((message) => message.id === unreadMessageID),
      );
    return false;
  });
  const clearUnread = useCallback(() => setUnreadCleared(true), []);
  const unreadContext = useMemo(
    () => ({ rowID: unreadRow?.id ?? null, seen: clearUnread }),
    [unreadRow?.id, clearUnread],
  );
  const latestUserTurnIndex = turnRows.findLastIndex((row) => row.turn.user !== null);
  const activeTurnIndex = workingTurnIndex(turnRows, pendingInputs);
  const isWorking = activeTurnIndex >= 0;
  const familyRequests = useSessionFamilyRequestViews(session.id);
  // The request cards' set: this task's requests, MCP forms, and its subagents' requests.
  const liveRequests = useStableList(
    useMemo(
      () => [
        ...requestViews,
        ...elicitations,
        ...familyRequests.filter((request) => request.sessionID !== session.id),
      ],
      [elicitations, familyRequests, requestViews, session.id],
    ),
  );
  const stopRequestedAt = useAtomValue(sessionStopRequestsAtom).get(session.id) ?? null;
  const clearSessionStop = useSetAtom(clearSessionStopAtom);
  useEffect(() => {
    if (stopRequestedAt === null) return;
    if (!isWorking && runtimeStatus?.type !== "busy" && runtimeStatus?.type !== "retry") {
      clearSessionStop(session.id);
      return;
    }
    const timer = window.setTimeout(
      () => clearSessionStop(session.id),
      Math.max(0, stopRequestedAt + SESSION_STOPPING_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [clearSessionStop, isWorking, runtimeStatus?.type, session.id, stopRequestedAt]);
  const workingTurn = isWorking ? turnRows[activeTurnIndex]!.turn : null;
  const liveLabel = useMemo(() => {
    if (!workingTurn) return null;
    const status = sessionActivityStatus({
      turn: workingTurn,
      requests: liveRequests,
      runtimeStatus,
      stopping: stopRequestedAt !== null,
    });
    return status ? sessionActivityLabel(status).label : null;
  }, [liveRequests, runtimeStatus, stopRequestedAt, workingTurn]);
  const focusLiveRequest = useCallback(
    (requestID: string) => {
      const request = liveRequests.find((candidate) => candidate.id === requestID);
      if (!request) return;
      setAttentionTarget({
        sessionID:
          "sessionID" in request && typeof request.sessionID === "string"
            ? request.sessionID
            : session.id,
        requestID,
        type: request.type,
      });
    },
    [liveRequests, session.id, setAttentionTarget],
  );
  const moveToBackground = useCallback(() => {
    void palot
      .backgroundSession(session.id)
      .catch((error) => showErrorToast("Could not move the command to the background", error));
  }, [session.id]);
  const liveTurn = useMemo<LiveTurnInputs>(
    () => ({
      requests: liveRequests,
      runtimeStatus,
      stopping: stopRequestedAt !== null,
      label: liveLabel,
      focusRequest: focusLiveRequest,
      moveToBackground,
    }),
    [focusLiveRequest, liveLabel, liveRequests, moveToBackground, runtimeStatus, stopRequestedAt],
  );
  const [pinnedVirtualTurnIDs, setPinnedVirtualTurnIDs] = useState<string[]>([]);
  const [prependPin, setPrependPin] = useState<TranscriptPrependPin | null>(null);
  const [navigationPinnedTurnID, setNavigationPinnedTurnID] = useState<string | null>(null);
  const [findPinnedTurnID, setFindPinnedTurnID] = useState<string | null>(null);
  const pinVirtualTurn = useCallback((turnID: string) => {
    setPinnedVirtualTurnIDs((current) =>
      current.includes(turnID) ? current : [...current, turnID].slice(-MAX_PINNED_VIRTUAL_TURNS),
    );
  }, []);
  const prependPinnedIndexes = useMemo(
    () => transcriptPrependPinnedIndexes(prependPin, turnRows),
    [prependPin, turnRows],
  );
  const getVirtualTurnKey = useCallback(
    (index: number) => turnRows[index]?.id ?? index,
    [turnRows],
  );
  const estimateVirtualTurnSize = useCallback(
    (index: number) => estimateTranscriptTurnSize(turnRows[index]?.turn),
    [turnRows],
  );
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);
  // The near turns the range last included. TanStack reruns the range extractor only when the
  // visible range changes, so onChange compares after resizes and scroll ends and asks for a rerun.
  const nearTurnsKeyRef = useRef("");
  const [nearTurnsRevision, setNearTurnsRevision] = useState(0);
  const readNearTurns = useCallback(
    (range: { startIndex: number; endIndex: number } | null) => {
      const instance = virtualizerRef.current;
      if (!initialTranscriptVisible || !range || !instance?.scrollRect) return [];
      if (instance.scrollOffset === null) return [];
      return nearTranscriptTurns({
        startIndex: range.startIndex,
        endIndex: range.endIndex,
        items: instance.measurementsCache,
        scrollOffset: instance.scrollOffset,
        viewportHeight: instance.scrollRect.height,
      });
    },
    [initialTranscriptVisible],
  );
  const extractVirtualTurnRange = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const near = readNearTurns(range);
      nearTurnsKeyRef.current = near.join(",");
      indexes.push(...near);
      if (activeTurnIndex >= 0 && !indexes.includes(activeTurnIndex)) {
        indexes.push(activeTurnIndex);
      }
      for (const index of prependPinnedIndexes) {
        if (!indexes.includes(index)) indexes.push(index);
      }
      if (navigationPinnedTurnID) {
        const index = turnRows.findIndex((row) => row.id === navigationPinnedTurnID);
        if (index >= 0 && !indexes.includes(index)) indexes.push(index);
      }
      if (findPinnedTurnID) {
        const index = turnRows.findIndex((row) => row.id === findPinnedTurnID);
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
      nearTurnsRevision,
      pinnedVirtualTurnIDs,
      prependPinnedIndexes,
      navigationPinnedTurnID,
      findPinnedTurnID,
      readNearTurns,
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
  const floatingRequests = useStableList(
    useMemo(
      () =>
        // Until the transcript has loaded, a request's tool call is not there to sit beside:
        // deciding then would show it in the composer's panel and move it a moment later.
        loading
          ? []
          : requestViews.filter(
              (request) => request.type === "permission" && !inlineRequestIDs.has(request.id),
            ),
      [inlineRequestIDs, loading, requestViews],
    ),
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
    // Neighbouring turns are mounted by distance (nearTranscriptTurns), not by count.
    overscan: 0,
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
      if (readNearTurns(instance.range).join(",") !== nearTurnsKeyRef.current) {
        setNearTurnsRevision((revision) => revision + 1);
      }
      navigationGeometryRef.current?.();
      const height = instance.getTotalSize();
      if (height === lastFollowedVirtualHeightRef.current) return;
      lastFollowedVirtualHeightRef.current = height;
      scrollToBottomNow();
    },
  });
  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer;
  }, [virtualizer]);
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = bottomLocked ? () => false : undefined;
  const virtualItems = virtualizer.getVirtualItems();
  const virtualTranscriptHeight = virtualizer.getTotalSize();
  // Declared after the virtualizer so its layout effect sees the positions TanStack wrote.
  const prependAnchor = useTranscriptPrependAnchor({
    viewport: scrollRef,
    rows: turnRows,
    historyStartID: messages[0]?.id ?? null,
    hasMore: cursor,
    bottomInset: composerDockHeight ?? 0,
    layoutVersion: virtualTranscriptHeight,
    willScroll: () => {
      scrollIntentRef.current = "anchor";
    },
    didScroll: (scrollTop) => {
      previousScrollTopRef.current = scrollTop;
    },
    pin: setPrependPin,
  });
  prependAnchorRef.current = prependAnchor;
  const releasePrependAnchor = prependAnchor.release;
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
    releasePrependAnchor("cancel");
    scrollToBottom();
  }, [releasePrependAnchor, scrollToBottom, submissionScrollRequest]);
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
      // The header's border box: its bottom border is outside clientHeight, and this height must
      // equal the transcript viewport's clientHeight for a retained layout to restore its offset.
      const viewportHeight = parent
        ? parent.clientHeight - (parent.querySelector("header")?.offsetHeight ?? 0)
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
      // A reader following the bottom keeps following it: the older page lands above, out of
      // view. Anyone else keeps what they see where it is.
      if (!bottomLockedRef.current) prependAnchor.capture();
      const result = await transcript.fetchNextPage();
      if (result.isError) {
        if (isCancelledError(result.error)) {
          prependAnchor.release("cancel");
          return false;
        }
        throw result.error;
      }
      prependAnchor.fetched();
      return true;
    } catch (error) {
      prependAnchor.release("cancel");
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
  const timelineMessages = useMemo(
    () =>
      promptIndex.olderMessages.length === 0
        ? messages
        : [...promptIndex.olderMessages, ...messages],
    [promptIndex.olderMessages, messages],
  );
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
    clearAnchor: releasePrependAnchor,
    hasMore: cursor,
    loading: loadingOlder || transcript.isHydrating,
    historyStartID: messages[0]?.id ?? null,
    loadOlder,
  });
  const [transcriptJumpTarget, setTranscriptJumpTarget] = useAtom(transcriptJumpTargetAtom);
  const compactionJumpFrameRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(compactionJumpFrameRef.current), []);
  // Compaction rows live inside a turn's activity, and responses in rows without a
  // prompt, so prompt navigation cannot reach them. Scroll their turn into range,
  // then the anchor itself.
  const revealTurnAnchor = (
    index: number,
    selector: string,
    anchor: "compaction" | "response",
  ): boolean => {
    const row = turnRows[index];
    if (!row) return false;
    navigation.cancel();
    setBottomLock(false);
    pinVirtualTurn(row.id);
    virtualizer.scrollToIndex(index, { align: "center" });
    cancelAnimationFrame(compactionJumpFrameRef.current);
    const startedAt = performance.now();
    const reveal = () => {
      const element = scrollRef.current?.querySelector<HTMLElement>(selector);
      if (element) {
        // A response may be taller than the viewport; show where it starts.
        element.scrollIntoView({ block: anchor === "response" ? "start" : "center" });
        if (anchor === "compaction")
          element.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
        return;
      }
      if (performance.now() - startedAt < 700) {
        compactionJumpFrameRef.current = requestAnimationFrame(reveal);
      }
    };
    compactionJumpFrameRef.current = requestAnimationFrame(reveal);
    return true;
  };
  const jumpToCompaction = (messageID: string): boolean =>
    messages.some((message) => message.id === messageID && message.type === "compaction") &&
    revealTurnAnchor(
      turnIndexForMessage(turnRows, messageID),
      compactionAnchorSelector(messageID),
      "compaction",
    );
  const unreadLanded = useRef(false);
  const landOnUnread = useEffectEvent(() => {
    if (unreadLanded.current) return;
    // Decide once, when the transcript first settles. Older pages move the first unseen
    // message further back, and landing then would pull the reader away from where they are.
    unreadLanded.current = true;
    if (!unreadRow || !unreadMessageID) return;
    revealTurnAnchor(
      turnRows.findIndex((row) => row.id === unreadRow.turnID),
      "[data-palot-unread]",
      "response",
    );
  });
  const unreadKnown = unreadSession !== null;
  useEffect(() => {
    if (initialTranscriptVisible && !loading && unreadKnown) landOnUnread();
  }, [initialTranscriptVisible, loading, unreadKnown, unreadRow?.id]);
  const jumpToRequestedTurn = useEffectEvent(
    ({ messageID, fallbackMessageID }: { messageID: string; fallbackMessageID?: string }) => {
      if (jumpToCompaction(messageID)) return;
      if (
        revealTurnAnchor(
          responseRowIndex(turnRows, messageID),
          responseAnchorSelector(messageID),
          "response",
        )
      )
        return;
      navigation.jump(fallbackMessageID ?? messageID);
    },
  );
  useEffect(() => {
    if (transcriptJumpTarget?.sessionID !== session.id) return;
    setTranscriptJumpTarget(null);
    jumpToRequestedTurn(transcriptJumpTarget);
  }, [session.id, setTranscriptJumpTarget, transcriptJumpTarget]);

  const find = useTranscriptFind({
    sessionID: session.id,
    rows: turnRows,
    viewport: scrollRef,
    virtualizer,
    bottomInset: composerDockHeight ?? 0,
    pin: setFindPinnedTurnID,
    unlock: () => setBottomLock(false),
    cancelNavigation: navigation.cancel,
  });
  const moveTurn = (direction: "previous" | "next") => {
    // Matches the task menu, which disables previous-turn navigation while history loads.
    if (direction === "previous" && loadingOlder) return;
    navigation.move(direction);
  };
  useTaskViewShortcuts({
    onFind: find.openFind,
    onTurn: moveTurn,
    onJump: () => setHistoryMode("timeline"),
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
    blocked: loadingOlder || prependPin !== null || navigation.isNavigating,
    hasMore: cursor,
    failed: transcript.isFetchNextPageError,
    canLoad: () => !olderRequestRef.current && !prependAnchor.isHolding(),
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
  const openTurnChanges = useCallback(
    (userMessageID: string, file?: string) => {
      workbench.openTab(
        { kind: "turn-diff", location: session.location, userMessageID, file },
        { pane: "right" },
      );
    },
    [session.location, workbench],
  );
  const reviewUserMessageID = session.parentID
    ? null
    : reviewOfferUserMessageID(turnRows, execution, runtimeStatus);
  const reviewAvailable =
    canFetchOpenCode(runtime) && runtime?.connectionID === transcript.connectionID;
  const turnChanges = useMemo<TurnChangesScope>(
    () => ({
      // Counts load only from the connection that owns this transcript.
      profileID: reviewAvailable ? (runtime?.profileID ?? "") : "",
      connectionID: transcript.connectionID,
      reviewUserMessageID,
      open: openTurnChanges,
      onAsked: handleMessageAdmitted,
    }),
    [
      handleMessageAdmitted,
      openTurnChanges,
      reviewAvailable,
      reviewUserMessageID,
      runtime?.profileID,
      transcript.connectionID,
    ],
  );
  const fileReferenceMessagesRef = useRef(messages);
  useEffect(() => {
    fileReferenceMessagesRef.current = messages;
  }, [messages]);
  const getFileReferenceMessages = useCallback(() => fileReferenceMessagesRef.current, []);
  const openFileTab = useCallback(
    (input: Parameters<typeof workbench.openTab>[0]) => workbench.openTab(input, { pane: "right" }),
    [workbench],
  );
  const localPathActions = runtime?.capabilities?.localPathActions === true;
  const homeDirectory = useMemo(
    () =>
      serverHomeDirectory({
        sameMachine: localPathActions,
        localHome: window.palot?.homeDirectory,
        directories: [session.location.directory],
      }),
    [localPathActions, session.location.directory],
  );
  const browserBindingID = browser?.bindingID;
  const openHtmlInBrowser = useCallback(
    async (absolutePath: string) => {
      if (!browserEnabled || !localPathActions || !runtime?.connected || !browserBindingID)
        return false;
      const target = workspaceFileTarget(session.location.directory, absolutePath);
      if (target.kind === "outside") return false;
      return openFileInBrowser(browserBindingID, target.absolute).then(
        () => true,
        () => false,
      );
    },
    [browserBindingID, browserEnabled, localPathActions, runtime?.connected, session.location],
  );
  const fileReferences = useFileReferenceOpener({
    sessionID: session.id,
    location: session.location,
    connectionID: runtime?.connectionID,
    localPathActions,
    homeDirectory,
    getMessages: getFileReferenceMessages,
    openTab: openFileTab,
    openHtml: openHtmlInBrowser,
  });
  const openWorkspaceFile = fileReferences.open;
  const openWebLink = useCallback(
    (href: string, requested?: WebLinkDestination) => {
      let url: URL;
      try {
        url = new URL(href, "https://palot.invalid");
        if (!/^https?:\/\//i.test(href) && !href.startsWith("//")) throw new Error();
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          throw new Error();
      } catch {
        showErrorToast("Could not open link", new Error("Only safe HTTP(S) links can be opened"));
        return;
      }

      const local = isLocalMarkdownWebLink(url);
      const destination = requested ?? (local ? localLinks : webLinks);
      if (destination === "external") {
        if (local && runtime?.topology !== "same-machine") {
          showErrorToast(
            "Cannot open server-local link externally",
            new Error(
              "This task runs on a remote machine or its location is unknown. In an external browser, localhost refers to this computer, not the task server. Choose Palot Browser for local dev links to open them on the task's server.",
            ),
          );
          return;
        }
        void palot.openExternalUrl(url.href);
        return;
      }
      if (!browserEnabled) {
        showErrorToast(
          "Browser unavailable",
          new Error("Enable Palot Browser in settings to open this link"),
        );
        return;
      }
      if (!runtime?.connected || !browser?.bindingID) {
        showErrorToast(
          "Browser unavailable",
          new Error(browser?.error ?? "Browser is still connecting to this task"),
        );
        return;
      }
      void palot
        .browserCommand(browser.bindingID, { type: "tabs.open", url: url.href, focus: true })
        .catch((error: unknown) => showErrorToast("Could not open link in Palot Browser", error));
    },
    [
      browser?.bindingID,
      browser?.error,
      browserEnabled,
      localLinks,
      runtime?.connected,
      runtime?.topology,
      webLinks,
    ],
  );

  const coldTranscriptLoading = coldTranscriptPendingRef.current && loading;
  const latestCompaction = messages.findLast((message) => message.type === "compaction");
  const retryableCompactionID =
    latestCompaction && !isWorking && latestCompaction.content[0]?.status === "failed"
      ? latestCompaction.id
      : null;
  const retryCompaction = useCallback(async () => {
    try {
      await palot.compactSession(session.id);
      handleMessageAdmitted();
    } catch (error) {
      showErrorToast("Could not compact context", error);
    }
  }, [handleMessageAdmitted, session.id]);
  // Keep the context value stable while text streams; windows change only per step.
  const compactionWindowsKey = compactionHistory(messages)
    .map((record) => `${record.messageID}\0${record.before ?? ""}\0${record.after ?? ""}`)
    .join("\n");
  const compactionWindows = useMemo(
    () =>
      new Map(
        compactionWindowsKey
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [messageID = "", before = "", after = ""] = line.split("\0");
            return [
              messageID,
              { before: before ? Number(before) : null, after: after ? Number(after) : null },
            ] as const;
          }),
      ),
    [compactionWindowsKey],
  );
  // Code Mode script edits load their diffs from the same turn diff as the changed-files card.
  const diffScope = useMemo(
    () => ({ profileID: turnChanges.profileID, sessionID: session.id }),
    [session.id, turnChanges.profileID],
  );
  const artifactScope = useMemo(
    () => ({
      connectionID: transcript.connectionID,
      sessionID: session.id,
      location: session.location,
    }),
    [session.id, session.location, transcript.connectionID],
  );
  const compactionActions = useMemo<CompactionTranscriptActions>(
    () => ({ retryableCompactionID, retry: retryCompaction, windows: compactionWindows }),
    [compactionWindows, retryCompaction, retryableCompactionID],
  );

  const openLinkFileInBrowser = useMemo(
    () =>
      browserEnabled && localPathActions && runtime?.connected && browserBindingID
        ? (absolutePath: string) => openFileInBrowser(browserBindingID, absolutePath)
        : undefined,
    [browserBindingID, browserEnabled, localPathActions, runtime?.connected],
  );
  const linkActions = useMemo<LinkActions>(
    () => ({
      connectionID: runtime?.connectionID,
      sessionID: session.id,
      taskDirectory: session.location.directory,
      homeDirectory,
      localPathActions,
      openFileInBrowser: openLinkFileInBrowser,
      openWebLink,
      browserAvailable: browserEnabled && Boolean(browserBindingID),
    }),
    [
      browserBindingID,
      browserEnabled,
      homeDirectory,
      localPathActions,
      openLinkFileInBrowser,
      openWebLink,
      runtime?.connectionID,
      session.id,
      session.location.directory,
    ],
  );
  const openPreferredWebLink = useCallback((href: string) => openWebLink(href), [openWebLink]);
  const openMessageQuote = useCallback<MessageQuoteOpener>(
    (quote, event) => {
      if (quote.kind === "browser") return openWebLink(quote.url);
      // Removed lines only exist in the diff; added or unchanged ones open in the file.
      if (quote.removed)
        return void openFileTab({
          kind: "file-diff",
          location: session.location,
          path: quote.path,
          mode: "working",
        });
      openWorkspaceFile({ path: quote.path, line: quote.startLine, endLine: quote.endLine }, event);
    },
    [openFileTab, openWebLink, openWorkspaceFile, session.location],
  );

  const contents = createElement(
    MarkdownWorkspaceProvider,
    {
      onOpenFile: openWorkspaceFile,
      onOpenWebLink: openPreferredWebLink,
      onOpenSession: openReferencedSession,
      workspaceDirectory: session.location.directory,
      workspaceLocation: session.location,
      allowHomePaths: localPathActions,
      homeDirectory,
      runCode,
      previewHTML,
    },
    fileReferences.picker,
    <CompactionTranscriptContext.Provider value={compactionActions}>
      <SessionThreadHeader
        session={session}
        historyActions={{
          loadingOlder,
          previousTurn: () => navigation.move("previous"),
          nextTurn: () => navigation.move("next"),
          find: find.openFind,
          openTimeline: () => setHistoryMode("timeline"),
          forkFromPrompt: () => setHistoryMode("fork"),
        }}
      />
      {historyMode === "timeline" ? (
        <SessionHistoryDialog
          messages={timelineMessages}
          mode="timeline"
          onClose={() => setHistoryMode(null)}
          hasMore={promptIndex.earlier.available && !promptIndex.earlier.failed}
          loading={promptIndex.earlier.loading}
          error={promptIndex.earlier.failed}
          onLoadMore={() => void promptIndex.earlier.load()}
          autoLoad
          onSelect={(message) => {
            // Pages the transcript back as far as the prompt.
            navigation.jump(message.id);
            setHistoryMode(null);
          }}
        />
      ) : historyMode ? (
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
          <ResponseSelectionAsk
            rootRef={scrollRef}
            rows={turnRows}
            sessionID={session.id}
            location={session.location}
          />
          <ScrollAreaRoot
            data-slot="message-scroller"
            className="group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden"
          >
            <ScrollViewport
              ref={scrollRef}
              role="region"
              aria-label="Task transcript"
              data-focus-region="transcript"
              data-bottom-locked={bottomLocked}
              tabIndex={0}
              className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none]"
              onWheel={(event) => {
                if (transcriptWheelIsSideways(event)) return;
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
                // Scrolling while an older page loads moves the place it must keep.
                if (intent !== "anchor") prependAnchor.readerMoved();
              }}
              onScrollEnd={() => {
                pageScrollTargetRef.current = null;
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
                            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
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
                          turnChanges={turnChanges}
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
            <TranscriptFindBar
              controller={find}
              hasOlder={cursor}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
            />
            <AnimatePresence initial={false}>
              {!bottomLocked && messages.length > 0 ? (
                <motion.div
                  key="scroll-to-bottom"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6, transition: spring.fast.exit }}
                  transition={spring.fast}
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
            </AnimatePresence>
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
        onKeyDown={(event) => {
          // Page keys in the composer page the transcript without moving focus or the caret.
          const direction = composerTranscriptPageDirection(event.nativeEvent);
          const viewport = scrollRef.current;
          if (direction === 0 || !viewport) return;
          event.preventDefault();
          const top = transcriptPageScrollTop({
            metrics: viewport,
            obscuredBottom: composerDockHeight ?? 0,
            direction,
            from: pageScrollTargetRef.current,
          });
          // Same intent bookkeeping as the transcript's own scroll keys: leave the live edge
          // (and request older history at the top) going up, follow again at the bottom.
          navigation.cancel();
          if (direction < 0) {
            infiniteScroll.onUpwardIntent();
            if (top < viewport.scrollTop) scrollIntentRef.current = "up";
          } else {
            infiniteScroll.clearIntent();
          }
          const instant = prefersReducedMotion();
          pageScrollTargetRef.current =
            instant || Math.abs(top - viewport.scrollTop) <= 1 ? null : top;
          viewport.scrollTo({ top, behavior: instant ? "instant" : "smooth" });
        }}
      >
        <div className="pointer-events-auto">
          <SessionDockContents
            session={session}
            revertMessages={dockMessages}
            composerMessages={projection.composerMessages}
            backgroundTranscript={projection.background}
            executionStates={executionStates}
            activityActive={activity?.active ?? false}
            floatingRequests={floatingRequests}
            composerRequests={composerRequests}
            usageLimit={usageLimit}
            pendingInputs={pendingInputs}
            isWorking={isWorking}
            onMessageAdmitted={handleMessageAdmitted}
            onModelsChange={setModels}
          />
        </div>
      </div>
    </CompactionTranscriptContext.Provider>,
  );
  return (
    <EditFromHereProvider session={session} running={isWorking || Boolean(activity?.active)}>
      <UnreadContext.Provider value={unreadContext}>
        <TranscriptArtifactContext.Provider value={artifactScope}>
          <TranscriptModelsContext.Provider value={models}>
            <PendingApprovalContext.Provider value={pendingApprovals}>
              <LiveTurnContext.Provider value={liveTurn}>
                <SubagentReportsContext.Provider value={subagentReports}>
                  <TranscriptDiffScopeContext.Provider value={diffScope}>
                    <LinkActionsProvider value={linkActions}>
                      <MessageQuoteOpenerContext.Provider value={openMessageQuote}>
                        {contents}
                      </MessageQuoteOpenerContext.Provider>
                    </LinkActionsProvider>
                  </TranscriptDiffScopeContext.Provider>
                </SubagentReportsContext.Provider>
              </LiveTurnContext.Provider>
            </PendingApprovalContext.Provider>
          </TranscriptModelsContext.Provider>
        </TranscriptArtifactContext.Provider>
      </UnreadContext.Provider>
    </EditFromHereProvider>
  );
});

export const SessionThreadHeader = memo(function SessionThreadHeader({
  session,
  historyActions,
}: {
  session: PalotSession;
  historyActions?: SessionHistoryActions;
}) {
  const headerRef = useThreadHeaderInsets();
  const title = useSessionTitleEditor(session);
  useEffect(() => {
    const previous = document.title;
    document.title = session.title ?? "Untitled task";
    return () => {
      document.title = previous;
    };
  }, [session.title]);
  const runtime = useAtomValue(runtimeAtom);
  const chat = isChatSession(session);
  const [moveOpen, setMoveOpen] = useState(false);
  const activity = useSessionActivityForSession(session.id).data;
  const movingDisabled = !canFetchOpenCode(runtime) || Boolean(activity?.active);
  const projects = useProjectCatalog();
  const project = projectForSession(projects, session);
  const name = chat
    ? "Chat"
    : project
      ? projectName(project)
      : session.location.directory.split("/").at(-1);
  const location = project ? projectLocation(project) : session.location.directory;
  return (
    <header
      ref={headerRef}
      className="palot-main-surface-header window-drag thread-header @container/thread-header flex h-(--shell-header-height) min-h-(--shell-header-height) items-center gap-2 border-b bg-background/90 px-3 pr-(--window-controls-width) pl-[18px]"
    >
      <div className="group/title flex min-w-0 flex-1 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="window-no-drag flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={chat ? "Chat" : "Show project details"}
              />
            }
          >
            {chat ? (
              <MessageCircle className="size-3.5" aria-hidden="true" />
            ) : (
              <FolderGit2 className="size-3.5" aria-hidden="true" />
            )}
          </TooltipTrigger>
          <TooltipContent
            align="start"
            className="flex-col items-start gap-1 px-2.5 py-2 leading-tight"
          >
            <span className="font-medium">{name ?? "Project"}</span>
            {chat ? (
              <span className="text-muted-foreground">A conversation without a project</span>
            ) : (
              <span className="max-w-72 break-all text-muted-foreground">{location}</span>
            )}
            {!chat && session.location.directory !== location ? (
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
        ) : session.parentID ? (
          <ParentTaskBreadcrumb session={session} onRename={title.start} />
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
      {chat && !session.parentID ? (
        <Button
          variant="ghost"
          size="sm"
          className="window-no-drag"
          disabled={movingDisabled}
          onClick={() => setMoveOpen(true)}
        >
          <FolderGit2 aria-hidden="true" />
          Move to project…
        </Button>
      ) : null}
      {!chat && runtime?.capabilities?.localPathActions === true ? (
        <CheckoutBranchPicker
          key={`${runtime.profileID}:${session.location.directory}`}
          directory={session.location.directory}
          profileID={runtime.profileID}
          disabled={movingDisabled}
        />
      ) : null}
      {session.parentID || chat ? null : <ShipButton session={session} />}
      {session.parentID || chat ? null : <PullRequestControl session={session} />}
      {!chat && runtime?.capabilities?.localPathActions === true ? (
        <OpenInSelector key={runtime.connectionID} sessionID={session.id} />
      ) : null}
      <SessionExportMenu session={session} historyActions={historyActions} />
      {moveOpen ? (
        <MoveToProjectDialog session={session} onClose={() => setMoveOpen(false)} />
      ) : null}
    </header>
  );
});

/**
 * The revert dock reads message ids and kinds and the plan card reads the latest plan, so
 * their list may stay behind while text streams into a message that already exists.
 */
function sameDockMessages(held: PalotMessage[], next: PalotMessage[]): boolean {
  if (held.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const before = held[index]!;
    const after = next[index]!;
    if (before === after) continue;
    if (before.id !== after.id || before.type !== after.type) return false;
    if (!samePlainValue(planParts(before), planParts(after))) return false;
  }
  return true;
}

function planParts(message: PalotMessage) {
  return message.content.flatMap((part, index) => {
    const items = planItems(part);
    return items ? [{ id: part.id ?? index, items }] : [];
  });
}

/**
 * A subagent session's agent name ("explore"), for "From explore subagent" on its requests.
 * The catalog is read when a request arrives, so its churn never re-renders the composer.
 */
function useSubagentAgentNames(): (sessionID: string) => string | null {
  const sessions = useSessionCatalog();
  const sessionsRef = useRef(sessions);
  useLayoutEffect(() => {
    sessionsRef.current = sessions;
  });
  return useCallback((id: string) => {
    const child = sessionsRef.current.find((candidate) => candidate.id === id);
    return child ? sessionPresentation(child).agent.toLowerCase() : null;
  }, []);
}

const SessionDockContents = memo(function SessionDockContents({
  session,
  revertMessages,
  composerMessages,
  backgroundTranscript,
  executionStates,
  activityActive,
  floatingRequests,
  composerRequests,
  usageLimit,
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
  usageLimit: ProviderLimit | null;
  pendingInputs: PendingRequestView[];
  isWorking: boolean;
  onMessageAdmitted(): void;
  onModelsChange(models: PalotModel[]): void;
}) {
  const familyRequests = useSessionFamilyRequestViews(session.id);
  const agentOf = useSubagentAgentNames();
  // The request panel's set: permissions not shown beside their tool call, questions and
  // forms, location-wide MCP forms, and every subagent's requests.
  const panelRequests = useStableList(
    useMemo(
      () => [
        ...floatingRequests,
        ...composerRequests,
        ...familyRequests.filter((request) => request.sessionID !== session.id),
      ],
      [composerRequests, familyRequests, floatingRequests, session.id],
    ),
  );
  return (
    <>
      {/* A subagent task takes messages too (OpenCode reports each round to its parent). */}
      {session.parentID ? <SubagentSessionDock session={session} /> : null}
      <SessionComposer
        session={session}
        messages={composerMessages}
        dockMessages={revertMessages}
        backgroundTranscript={backgroundTranscript}
        executionStates={executionStates}
        activityActive={activityActive}
        requests={panelRequests}
        agentOf={agentOf}
        usageLimit={usageLimit}
        pendingInputs={pendingInputs}
        isWorking={isWorking}
        onMessageAdmitted={onMessageAdmitted}
        onModelsChange={onModelsChange}
      />
    </>
  );
});

const SessionComposer = memo(function SessionComposer({
  session,
  messages,
  dockMessages,
  backgroundTranscript,
  executionStates,
  activityActive,
  requests,
  agentOf,
  usageLimit,
  pendingInputs,
  isWorking,
  onMessageAdmitted,
  onModelsChange,
}: {
  session: PalotSession;
  messages: PalotMessage[];
  /** Message ids, kinds and plan parts; text streaming into a message keeps it unchanged. */
  dockMessages: PalotMessage[];
  backgroundTranscript: TranscriptBackgroundFacts;
  executionStates: Map<string, SessionExecutionState>;
  activityActive: boolean;
  requests: ComposerRequest[];
  agentOf(sessionID: string): string | null;
  usageLimit: ProviderLimit | null;
  pendingInputs: PendingRequestView[];
  isWorking: boolean;
  onMessageAdmitted(): void;
  onModelsChange(models: PalotModel[]): void;
}) {
  const navigate = useNavigate();
  const runtime = useAtomValue(runtimeAtom);
  const sessions = useSessionCatalog();
  const projects = useProjectCatalog();
  // A chat's folder has no checkout or branch to show.
  const chat = isChatSession(session);
  const branchQuery = useVcsInfo(chat ? null : session.location);
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
  const openTab = useAtomValue(composerOpenTabAtom(session.id));
  const runningWork = useRunningWork({
    session,
    sessionIDs: shellSessionIDs,
    items: backgroundWork,
    profileID: runtime?.profileID ?? "",
    connectionID: runtime?.connectionID ?? "",
    open: openTab === "background",
  });
  const plan = useStableValue(
    useMemo(() => latestPlan(dockMessages), [dockMessages]),
    samePlainValue,
  );
  const standing = useStandingTabs({ session, messages: dockMessages, plan });
  // Running work reaches the composer as a stable atom that only its tab, its panel and a
  // waiting steer read, so its changes do not re-render the composer.
  const store = useStore();
  const [runningWorkAtom] = useState(() =>
    atom<ComposerRunningWork>({ items: EMPTY_BACKGROUND_WORK, work: null }),
  );
  const work = runtime ? runningWork : null;
  useLayoutEffect(() => {
    const current = store.get(runningWorkAtom);
    if (current.items !== backgroundWork || current.work !== work)
      store.set(runningWorkAtom, { items: backgroundWork, work });
  }, [backgroundWork, runningWorkAtom, store, work]);
  const guests = useGuestPendingMessages(session.id);
  const isAdditionalCheckout = sessionIsAdditionalCheckout(session, project ?? undefined);
  const navigateToNewTask = useCallback(
    () =>
      void navigate(
        chat
          ? { to: "/new", search: { chat: true } }
          : { to: "/new", search: { projectID: session.projectID, profileID: runtime?.profileID } },
      ),
    [chat, navigate, runtime?.profileID, session.projectID],
  );
  const subagent = Boolean(session.parentID);
  const composerContextBar = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1">
        <ConnectionDestination />
        {subagent ? (
          <SubagentComposerNote />
        ) : chat ? null : (
          <div
            className="flex h-6 min-w-0 items-center gap-1 px-1.5 text-meta leading-none font-medium text-foreground"
            title={isAdditionalCheckout ? "Additional checkout" : "Current checkout"}
          >
            <FolderGit2 className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{isAdditionalCheckout ? "Worktree" : "Checkout"}</span>
          </div>
        )}
        <div className="ml-auto flex h-6 min-w-0 items-center gap-2 px-1.5 text-meta leading-none text-muted-foreground max-[560px]:ml-0">
          {chat || subagent ? null : (
            <>
              <GitBranch className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {branchQuery.isPending
                  ? "Loading branch"
                  : (branchQuery.data?.currentBranch ?? "Detached HEAD")}
              </span>
            </>
          )}
        </div>
      </div>
    ),
    [chat, subagent, branchQuery.data?.currentBranch, branchQuery.isPending, isAdditionalCheckout],
  );

  return (
    <>
      <Composer
        key={session.id}
        session={session}
        messages={messages}
        isWorking={isWorking}
        runningWork={runningWorkAtom}
        standing={standing}
        requests={requests}
        guests={guests}
        agentOf={agentOf}
        usageLimit={usageLimit}
        onMessageAdmitted={onMessageAdmitted}
        onNavigateToNewTask={navigateToNewTask}
        onModelsChange={onModelsChange}
        pendingInputs={pendingInputs}
        contextBar={composerContextBar}
      />
    </>
  );
});

const TranscriptPresentationTurnItem = memo(function TranscriptPresentationTurnItem({
  source,
  rows,
  models,
  sessionID,
  cacheBust,
  onOpenCacheDiagnostic,
  turnChanges,
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
  turnChanges: TurnChangesScope;
  subagentProgress: { active: number; total: number };
  virtualIndex: number;
  virtualSize: number;
  isLastTurn: boolean;
  followTail: boolean;
  measureElement: (element: Element | null) => void;
  onInteract: (turnID: string) => void;
}) {
  const { turn } = source;
  const unread = useContext(UnreadContext);
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
          <Fragment key={row.id}>
            {row.id === unread.rowID ? <NewMessagesDivider /> : null}
            <TranscriptPresentationRowContent
              key={row.id}
              row={row}
              models={row.kind === "assistant-message" ? models : EMPTY_MODELS}
              sessionID={sessionID}
              cacheBust={rowReceivesCacheBust(row, turn) ? cacheBust : null}
              onOpenCacheDiagnostic={onOpenCacheDiagnostic}
              subagentProgress={
                row.kind === "activity" ? subagentProgress : EMPTY_SUBAGENT_PROGRESS
              }
            />
          </Fragment>
        ))}
        <TurnChangesCard turn={turn} sessionID={sessionID} scope={turnChanges} />
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
    turnChanges: TurnChangesScope;
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
    turnChanges: TurnChangesScope;
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
    previous.turnChanges === next.turnChanges &&
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

export interface TurnChangesScope {
  /** Empty when the transcript's connection cannot load diffs. */
  profileID: string;
  connectionID: string;
  /** The latest settled prompt, whose card also offers the review follow-ups. */
  reviewUserMessageID: string | null;
  /** Opens the turn's diff, scrolled to `file` when given. */
  open(userMessageID: string, file?: string): void;
  onAsked(): void;
}

const NO_CHANGED_FILES: readonly string[] = [];

/**
 * The files a finished turn changed, under its answer or, without one, under its work. The
 * latest settled turn keeps the card even without snapshot data, so its diff can name the files.
 */
export const TurnChangesCard = memo(function TurnChangesCard({
  turn,
  sessionID,
  scope,
}: {
  turn: TranscriptTurn;
  sessionID: string;
  scope: TurnChangesScope;
}) {
  const user = turn.user;
  if (!user || user.optimistic === true || turn.status === "working") return null;
  if (turn.kind !== undefined && turn.kind !== "conversation") return null;
  const files = turn.changedFiles ?? NO_CHANGED_FILES;
  const latest = scope.reviewUserMessageID === user.id;
  if (files.length === 0 && !latest) return null;
  return (
    <TurnChangedFiles
      profileID={scope.profileID}
      sessionID={sessionID}
      userMessageID={user.id}
      files={files}
      onOpenDiff={(file) => scope.open(user.id, file)}
      actions={
        latest ? (
          <TurnReviewActions
            connectionID={scope.connectionID}
            sessionID={sessionID}
            userMessageID={user.id}
            onAsked={scope.onAsked}
          />
        ) : undefined
      }
    />
  );
});

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
          runningSubagents={subagentProgress.active}
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
          <div className="relative" {...responseSelectionSource(row.final.message.id)}>
            <MessageRow
              message={row.final.message}
              parts={finalParts}
              className={cn(turn.user && turn.activity.length === 0 && "mt-6")}
            />
          </div>
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
  return turn.status === "working" ? <ActiveTurnMeta turn={turn} /> : null;
}, sameTranscriptPresentationRowContentProps);

/**
 * The running turn, or -1. Prompts still waiting in the inbox show as turns of their own after
 * it; they have not started, so they neither end nor replace the turn that is running.
 */
export function workingTurnIndex(
  rows: readonly TranscriptProjectionRow[],
  pendingInputs: readonly PendingRequestView[],
): number {
  const undelivered = new Set(pendingInputs.map((input) => input.id));
  const index = rows.findLastIndex(
    ({ turn }) =>
      turn.users.length === 0 ||
      turn.activity.length > 0 ||
      turn.final !== null ||
      turn.users.some((user) => !undelivered.has(user.id)),
  );
  return rows[index]?.turn.status === "working" ? index : -1;
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
    const variant = modelRef?.variant?.trim();
    const modelLabel =
      modelName && variant && variant.toLowerCase() !== "default"
        ? `${modelName} · ${variant}`
        : modelName;
    const responseMessageID = turn.final?.message.id;
    const tokensPerSecond = turn.tokensPerSecond === null ? null : turn.tokensPerSecond.toFixed(1);
    // The same whole-turn duration as the turn bar.
    const duration = formatElapsed(Math.max(1_000, completedAt - turn.startedAt));
    const durationTitle = `Worked for ${duration}`;
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
        {modelLabel ? <span title={modelRef?.id}>{modelLabel}</span> : null}
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

/** Seconds a foreground command runs before the live line offers to move it to the background. */
const BACKGROUND_OFFER_MS = 5_000;

/** The words of the live line; a permission names its command or path when the request has one. */
function liveTurnWords(
  status: SessionActivityStatus,
  requests: readonly PendingRequestView[],
  now?: number,
): { label: string; detail: string | null } {
  const words = sessionActivityLabel(status, now);
  if (status.kind !== "approval") return words;
  const detail = requests
    .find((request) => request.id === status.requestID)
    ?.detail?.split("\n")
    .find((line) => line.trim())
    ?.trim();
  return detail ? { ...words, detail } : words;
}

/** What screen readers hear: no per-second countdown and no streaming thought. */
function liveTurnAnnouncement(
  status: SessionActivityStatus,
  requests: readonly PendingRequestView[],
): string {
  if (status.kind === "thinking") return "Working";
  const { label, detail } = liveTurnWords(status, requests);
  return detail ? `${label}, ${detail}` : label;
}

/**
 * The running turn's one live line: what the task is doing or waiting on. The turn bar holds the
 * clock; this line shows elapsed time only while the turn has no bar yet.
 */
export function ActiveTurnMeta({ turn }: { turn: TranscriptTurn }) {
  const live = useContext(LiveTurnContext);
  const now = useCurrentTime();
  const requests = live?.requests ?? EMPTY_LIVE_REQUESTS;
  const status = sessionActivityStatus({
    turn,
    requests,
    runtimeStatus: live?.runtimeStatus ?? null,
    stopping: live?.stopping ?? false,
  }) ?? { kind: "working" as const };
  const { label, detail } = liveTurnWords(status, requests, now);
  const announcement = liveTurnAnnouncement(status, requests);
  const waiting = status.kind === "approval" || status.kind === "answer";
  const offerBackground =
    status.kind === "command" &&
    status.canBackground &&
    status.startedAt !== null &&
    now - status.startedAt >= BACKGROUND_OFFER_MS &&
    live !== null;
  const elapsed = turnShowsBar(turn) ? null : formatElapsed(now - turn.startedAt);
  const words = (
    <>
      {waiting ? (
        <span className="shrink-0 text-foreground/80">{label}</span>
      ) : (
        <ThinkingShimmer className="min-w-0 truncate">{label}</ThinkingShimmer>
      )}
      {detail ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate" title={detail}>
            {detail}
          </span>
        </>
      ) : null}
      {elapsed ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{elapsed}</span>
        </>
      ) : null}
    </>
  );

  return (
    <div
      data-palot-active-turn-status={status.kind}
      className="mt-1 flex h-6 min-w-0 items-center gap-1.5 text-xs leading-none tabular-nums text-muted-foreground/55"
    >
      {/* Announces state changes only; the visible words below change with every tick. */}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {waiting && live ? (
        <button
          type="button"
          aria-label={`${announcement}. Show the request`}
          onClick={() => live.focusRequest(status.requestID)}
          className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {words}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5" aria-hidden="true">
          {words}
        </span>
      )}
      {offerBackground ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={live.moveToBackground}
        >
          Move to background
        </Button>
      ) : null}
    </div>
  );
}

const EMPTY_LIVE_REQUESTS: readonly PendingRequestView[] = [];

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
