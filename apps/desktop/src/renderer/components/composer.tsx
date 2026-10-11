/** Task composer backed by OpenCode models, permissions, and files. */

import { useQueryClient } from "@tanstack/react-query";
import type { ModelRef } from "@opencode/client";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Clock3,
  Ellipsis,
  Pencil,
  Plus,
  Square,
  SquareTerminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  PalotFileAttachment,
  PalotAttachmentProgress,
  PalotFilePickerResult,
  PalotAgent,
  PalotMessage,
  PalotModel,
  PalotModelCatalog,
  PalotProvider,
  PalotReference,
  PalotSession,
} from "../../shared";
import type { PalotBrowserComment } from "../../shared/browser-contract";
import {
  type ComposerDelivery,
  autoBackgroundOnSteerAtom,
  composerDraftAtomFamily,
  flushComposerDrafts,
  defaultDeliveryAtom,
  defaultModelsAtom,
  modelPickerPreferencesAtom,
} from "../atoms/ui";
import { useWorkbenchCommands } from "../atoms/workbench";
import { askBtw } from "../atoms/btw";
import { draftAfterBtw, parseBtwQuestion } from "../lib/btw";
import { composerStateAtomFamily } from "../atoms/composer-state";
import { composerScope } from "../lib/composer-scope";
import {
  messagesForProfileAtom,
  runtimeAtom,
  type SessionExecutionState,
} from "../atoms/workspace";
import { attentionTargetAtom } from "../atoms/attention";
import {
  composerActionRequestAtom,
  requestGlobalCommandAtom,
  type ComposerActionRequest,
} from "../atoms/command-requests";
import { useComposerCatalog, useWorkspaceFileSearch } from "../hooks/use-composer-discovery";
import { useModelCatalog } from "../hooks/use-model-catalog";
import { useComposerSelection } from "../hooks/use-composer-selection";
import { useComposerPermissions } from "../hooks/use-composer-permissions";
import { useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import { useCacheSession, useProjectCatalog } from "../hooks/use-session-catalog";
import { getContextUsage } from "../lib/context-usage";
import { cn } from "../lib/cn";
import { admitComposerSubmission } from "../lib/composer-admission";
import {
  applyComposerTextChange,
  emptyComposerDraft,
  insertComposerSelection,
  normalizeComposerDraft,
  projectComposerSubmission,
  type ComposerDraft,
  type ComposerDiscoverySelection,
} from "../lib/composer-draft";
import {
  IDLE_HISTORY_CURSOR,
  navigateComposerHistory,
  normalPromptHistory,
  shellCommandHistory,
  type ComposerHistoryCursor,
  type ComposerMode,
} from "../lib/composer-history";
import { detectComposerQuery } from "../lib/composer-query";
import { composerDraftFromMessage } from "../lib/composer-restoration";
import { COMPOSER_SHORTCUT_KEYS, matchComposerShortcut } from "../lib/composer-shortcuts";
import { formatShortcut } from "../lib/keyboard-shortcuts";
import { primaryAgents } from "../lib/selection-memory";
import { reviewCommentsFromMessage, type ReviewComment } from "../lib/review-comments";
import {
  browserCommentsFromMessage,
  liveBrowserComments,
  retainedComposerFiles,
} from "../lib/browser-comments";
import { useBrowserSession } from "../hooks/use-browser-session";
import { useSessionLocationMissing } from "../hooks/use-session-location-missing";
import { SessionLocationMissingView } from "./session-location-missing";
import { formatCommandShortcut } from "../lib/global-commands";
import { BUILTIN_COMMANDS } from "../lib/builtin-commands";
import { convergeMessageReceipt } from "../lib/message-reconcile";
import { modelMatchesRef, resolveModelSelection } from "../lib/model-selection";
import {
  applyModelPreference,
  modelPreferenceKey,
  modelProjectPreferenceKey,
  reconcileModelPreference,
} from "../lib/model-preferences";
import { showErrorToast } from "../lib/toast-error";
import type { ApprovalPreset } from "../lib/session-permissions";
import { updateSessionActivity } from "../lib/session-activity-query";
import { projectForSession, type PendingRequestView } from "../lib/view-models";
import { palot } from "../services/palot";
import { BackgroundWorkPrompt, type BackgroundWorkItem } from "./subagent-activity";
import { ComposerDiscovery, type ComposerDiscoveryItem } from "./composer-discovery";
import { ApprovalSelector } from "./approval-selector";
import { FileAttachment } from "./file-attachment";
import { OpenCodeConnectionAlert } from "./opencode-connection-alert";
import { AttachmentGroup } from "./ui/attachment";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "./ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";
import { Spinner } from "./ui/spinner";
import { SurfaceBackdrop } from "./ui/surface-backdrop";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const EMPTY_MODEL_CATALOG: PalotModelCatalog = {
  models: [],
  defaultModel: null,
  providers: [],
  errors: [],
};
const STEER_BACKGROUND_DELAY_MS = 5_000;
const EMPTY_AGENTS: PalotAgent[] = [];
const EMPTY_REFERENCES: PalotReference[] = [];

/** Slash commands that run a global palette command; `task` ones need an existing task. */
const SLASH_GLOBAL_COMMANDS: Readonly<Record<string, { id: string; task: boolean }>> = {
  fork: { id: "task.fork", task: true },
  export: { id: "task.export", task: true },
  open: { id: "task.files.open", task: true },
  mcp: { id: "settings.open:tools", task: false },
};
const COMPOSER_ACTION_TTL_MS = 5_000;

interface PendingBackgroundSteer {
  id: string;
  submittedAt: number;
  blockerIDs: Set<string>;
}

interface BackgroundSteerPromptState {
  submittedAt: number;
  retry: boolean;
  error: string | null;
}

const TOKEN_FORMATTER = new Intl.NumberFormat(undefined);
function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function tokenTotal(tokens: PalotSession["tokens"]): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function formatTokens(value: number): string {
  return TOKEN_FORMATTER.format(value);
}

function composerDraftWithRetainedFiles(message: PalotMessage): ComposerDraft {
  // Undo/pending edits restore files separately. Don't add the fork-only omission notice.
  const data = message.data;
  return composerDraftFromMessage({
    ...message,
    files: [],
    data: data && typeof data === "object" && !Array.isArray(data) ? { ...data, files: [] } : null,
  });
}

export interface NewSessionComposerOptions {
  approvalMode: ApprovalPreset;
  agent: string | null;
  model: ModelRef | null;
}

interface ComposerProps {
  session: PalotSession;
  messages: PalotMessage[];
  isWorking: boolean;
  onMessageAdmitted?(): void;
  onModelsChange?(models: PalotModel[]): void;
  onCreateSession?(options: NewSessionComposerOptions): Promise<PalotSession | null>;
  onCreateSessionError?(error: unknown): void;
  contextBar?: ReactNode;
  contextBarMode?: "compact" | "new-task";
  pendingInputs?: PendingRequestView[];
  backgroundWork?: BackgroundWorkItem[];
  requestBody?: ReactNode;
  onNavigateToNewTask?(): void;
}

function ComposerView({
  session,
  messages,
  isWorking,
  onMessageAdmitted,
  onModelsChange,
  onCreateSession,
  onCreateSessionError,
  contextBar,
  contextBarMode = "new-task",
  pendingInputs = [],
  backgroundWork = [],
  requestBody,
  onNavigateToNewTask,
}: ComposerProps) {
  const runtime = useAtomValue(runtimeAtom);
  const draftScope = composerScope(
    runtime?.profileID,
    onCreateSession
      ? `new:${session.projectID}:${session.location.directory}:${session.location.workspaceID ?? ""}`
      : `session:${session.id}`,
  );
  useEffect(() => () => flushComposerDrafts(), [draftScope]);
  const store = useStore();
  const draftAtom = composerDraftAtomFamily(draftScope);
  const stateAtom = composerStateAtomFamily(draftScope);
  const [originalDraft, setOriginalDraft] = useAtom(draftAtom);
  const [composerState, setComposerState] = useAtom(stateAtom);
  const { edit: activePendingInputEdit, sending, cancelingID: pendingInputEditID } = composerState;
  const draft = activePendingInputEdit?.draft ?? originalDraft;
  const files = activePendingInputEdit?.files ?? composerState.files;
  const comments = activePendingInputEdit?.comments ?? composerState.comments;
  const browserComments =
    (activePendingInputEdit
      ? activePendingInputEdit.browserComments
      : composerState.browserComments) ?? [];
  const browser = useBrowserSession({
    profileID: runtime?.profileID ?? "unscoped",
    sessionID: session.id,
  });
  const [editingCommentID, setEditingCommentID] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  function setDraft(update: ComposerDraft | ((current: ComposerDraft) => ComposerDraft)) {
    if (!activePendingInputEdit) {
      setOriginalDraft(update);
      return;
    }
    setComposerState((current) => {
      if (current.edit?.id !== activePendingInputEdit.id) return current;
      const next = typeof update === "function" ? update(current.edit.draft) : update;
      return { ...current, edit: { ...current.edit, draft: normalizeComposerDraft(next) } };
    });
  }

  function setFiles(
    update: PalotFileAttachment[] | ((current: PalotFileAttachment[]) => PalotFileAttachment[]),
  ) {
    setComposerState((current) => {
      const edit = activePendingInputEdit ? current.edit : null;
      if (activePendingInputEdit && edit?.id !== activePendingInputEdit.id) return current;
      const previous = edit?.files ?? current.files;
      const next = typeof update === "function" ? update(previous) : update;
      return edit ? { ...current, edit: { ...edit, files: next } } : { ...current, files: next };
    });
  }

  function setSending(value: boolean) {
    setComposerState((current) => ({ ...current, sending: value }));
  }

  function setComments(update: (current: ReviewComment[]) => ReviewComment[]) {
    setComposerState((current) => {
      if (!activePendingInputEdit) return { ...current, comments: update(current.comments) };
      if (current.edit?.id !== activePendingInputEdit.id) return current;
      return { ...current, edit: { ...current.edit, comments: update(current.edit.comments) } };
    });
  }

  function setBrowserComments(update: (current: PalotBrowserComment[]) => PalotBrowserComment[]) {
    setComposerState((current) => {
      if (!activePendingInputEdit)
        return { ...current, browserComments: update(current.browserComments ?? []) };
      if (current.edit?.id !== activePendingInputEdit.id) return current;
      return {
        ...current,
        edit: { ...current.edit, browserComments: update(current.edit.browserComments ?? []) },
      };
    });
  }

  // Only retire the exact contents submitted. Typing and navigation can continue during dispatch.
  function clearSubmittedContents() {
    const current = store.get(stateAtom);
    if (activePendingInputEdit) {
      if (current.edit === activePendingInputEdit) {
        setComposerState((value) => ({ ...value, edit: null }));
      } else if (current.edit?.id === activePendingInputEdit.id) {
        setComposerState((value) =>
          value.edit
            ? {
                ...value,
                edit: {
                  ...value.edit,
                  comments: value.edit.comments.filter((item) => !comments.includes(item)),
                  browserComments: value.edit.browserComments?.filter(
                    (item) => !browserComments.includes(item),
                  ),
                },
              }
            : value,
        );
      }
    } else if (store.get(draftAtom) === draft && current.files === files) {
      setOriginalDraft(emptyComposerDraft());
      setComposerState((value) => ({ ...value, files: [] }));
    }
    if (!activePendingInputEdit) {
      setComposerState((value) => ({
        ...value,
        comments: value.comments.filter((item) => !comments.includes(item)),
        browserComments: value.browserComments?.filter((item) => !browserComments.includes(item)),
      }));
    }
  }
  const permissionSelection = useComposerPermissions(session, Boolean(onCreateSession), draftScope);
  const [delivery, setDelivery] = useAtom(defaultDeliveryAtom);
  const autoBackgroundOnSteer = useAtomValue(autoBackgroundOnSteerAtom);
  const defaultModels = useAtomValue(defaultModelsAtom);
  const modelPickerPreferences = useAtomValue(modelPickerPreferencesAtom);
  const localAttachments = runtime?.capabilities?.localFileAttachments !== false;
  const workbench = useWorkbenchCommands(
    runtime ? { profileID: runtime.profileID, sessionID: session.id } : null,
  );
  const queryClient = useQueryClient();
  const cacheSession = useCacheSession();
  const projects = useProjectCatalog();
  const [locationFailure, setLocationFailure] = useState<{ scope: string; error: unknown } | null>(
    null,
  );
  const recoveryOptions = {
    session,
    project: projectForSession(projects, session) ?? null,
    owner: runtime,
    enabled: !onCreateSession,
    error: locationFailure?.scope === draftScope ? locationFailure.error : undefined,
    onRecovered: cacheSession,
  };
  const locationRecovery = useSessionLocationMissing(recoveryOptions);
  const setMessages = useSetAtom(messagesForProfileAtom(runtime?.profileID ?? "unscoped"));
  const requestGlobalCommand = useSetAtom(requestGlobalCommandAtom);
  const composerActionRequest = useAtomValue(composerActionRequestAtom);
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  const [attachmentUpload, setAttachmentUpload] = useState<{
    progress: PalotAttachmentProgress | null;
  } | null>(null);
  const attachmentRequestRef = useRef<{
    id: string;
    unsubscribe: () => void;
  } | null>(null);
  const attachmentScope = JSON.stringify([
    draftScope,
    session.id,
    session.parentID,
    runtime?.connectionID,
    activePendingInputEdit?.id,
  ]);
  const cancelAttachmentUpload = useCallback(() => {
    const request = attachmentRequestRef.current;
    if (!request) return;
    attachmentRequestRef.current = null;
    request.unsubscribe();
    setAttachmentUpload(null);
    void palot.cancelAttachmentUpload(request.id).catch(() => undefined);
  }, []);
  useLayoutEffect(() => {
    setAttachmentErrors([]);
    return cancelAttachmentUpload;
  }, [attachmentScope, cancelAttachmentUpload]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [isComposing, setIsComposing] = useState(false);
  const [discoverySelection, setDiscoverySelection] = useState({ key: "", index: 0 });
  const [pendingBackgroundSteer, setPendingBackgroundSteer] =
    useState<PendingBackgroundSteer | null>(null);
  const [backgroundSteerPrompt, setBackgroundSteerPrompt] =
    useState<BackgroundSteerPromptState | null>(null);
  const [backgroundingSteer, setBackgroundingSteer] = useState(false);
  const [activeMenu, setActiveMenu] = useState<"agent" | "model" | "approvals" | null>(null);
  const [agentCycleRequest, setAgentCycleRequest] = useState<{
    scope: string;
    direction: 1 | -1;
  } | null>(null);
  // Mode, history position, and local shell history belong to one draft scope.
  const [modeState, setModeState] = useState<{ scope: string; mode: ComposerMode } | null>(null);
  const mode: ComposerMode =
    !requestBody && !activePendingInputEdit && modeState?.scope === draftScope
      ? modeState.mode
      : "normal";
  const historyKey = `${draftScope}\0${mode}`;
  const [historyState, setHistoryState] = useState<{
    key: string;
    cursor: ComposerHistoryCursor;
  } | null>(null);
  const historyCursor =
    historyState?.key === historyKey ? historyState.cursor : IDLE_HISTORY_CURSOR;
  const [submittedShell, setSubmittedShell] = useState<{ scope: string; commands: string[] }>({
    scope: draftScope,
    commands: [],
  });
  const composerShellRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef(messages);
  const backgroundWorkRef = useRef(backgroundWork);
  const pendingInputsRef = useRef(pendingInputs);
  const backgroundActionRef = useRef(false);
  const activeDraftScopeRef = useRef<string | null>(draftScope);

  useLayoutEffect(() => {
    activeDraftScopeRef.current = draftScope;
    return () => {
      activeDraftScopeRef.current = null;
    };
  }, [draftScope]);

  useLayoutEffect(() => {
    messagesRef.current = messages;
    backgroundWorkRef.current = backgroundWork;
    pendingInputsRef.current = pendingInputs;
  }, [backgroundWork, messages, pendingInputs]);
  const modelCatalogQuery = useModelCatalog(session.location);
  const agentCatalogQuery = useSettingsSnapshot(
    {
      ...session.location,
      projectID: session.projectID,
      capabilities: ["agents"],
    },
    Boolean(onCreateSession) || activeMenu === "agent" || agentCycleRequest?.scope === draftScope,
  );
  const catalog = modelCatalogQuery.data ?? EMPTY_MODEL_CATALOG;
  const preferenceProject = projectForSession(projects, session);
  const preferenceScope = modelProjectPreferenceKey(
    runtime?.profileID ?? "disconnected",
    preferenceProject?.id ?? session.projectID,
  );
  const storedPickerPreference = modelPickerPreferences[preferenceScope];
  const pickerPreference = useMemo(
    () => reconcileModelPreference(catalog.models, storedPickerPreference),
    [catalog.models, storedPickerPreference],
  );
  const pickerModels = useMemo(
    () => applyModelPreference(catalog.models, pickerPreference),
    [catalog.models, pickerPreference],
  );
  const catalogsReady = Boolean(
    modelCatalogQuery.data &&
    agentCatalogQuery.data &&
    !modelCatalogQuery.error &&
    !agentCatalogQuery.error &&
    !agentCatalogQuery.data.errors.some((error) => error.capability === "agents"),
  );
  const agents = agentCatalogQuery.data?.agents ?? EMPTY_AGENTS;
  const composerSelection = useComposerSelection({
    session,
    draft: Boolean(onCreateSession),
    draftScope,
    agents,
    models: catalog.models,
    projectDefault: defaultModels[preferenceScope] ?? null,
    forceCatalogDefault: Boolean(
      catalog.defaultModel &&
      pickerPreference.hidden.includes(modelPreferenceKey(catalog.defaultModel)),
    ),
    catalogDefault:
      catalog.defaultModel &&
      pickerPreference.hidden.includes(modelPreferenceKey(catalog.defaultModel))
        ? (pickerModels[0] ?? null)
        : (catalog.defaultModel ?? pickerModels[0] ?? null),
    catalogsReady,
  });
  const displayedSession = composerSelection.session;
  // OpenCode lists its resolved default agent first.
  const defaultAgent = useMemo(() => primaryAgents(agents)[0] ?? null, [agents]);
  const activeQuery = useMemo(
    () =>
      mode === "shell"
        ? null
        : detectComposerQuery(draft.text, selection.start, selection.end, { isComposing }),
    [draft.text, isComposing, mode, selection.end, selection.start],
  );

  const composerCatalogQuery = useComposerCatalog(
    displayedSession.location,
    activeQuery?.kind === "command" || activeQuery?.kind === "skill",
  );
  const discoveryCatalog = composerCatalogQuery.data ?? {
    commands: [],
    skills: [],
    errors: [],
  };
  const deferredQuery = useDeferredValue(activeQuery?.query ?? "");
  const fileSearchQuery = useWorkspaceFileSearch(
    displayedSession.location,
    deferredQuery,
    activeQuery?.kind === "file",
  );
  const fileResults = (fileSearchQuery.data ?? []).map((entry) => entry.path);
  // `@` also offers subagents and OpenCode references, sharing the per-capability settings cache.
  const mentionCatalogQuery = useSettingsSnapshot(
    {
      ...session.location,
      projectID: session.projectID,
      capabilities: ["agents", "references"],
    },
    activeQuery?.kind === "file",
  );
  const mentionAgents = mentionCatalogQuery.data?.agents ?? EMPTY_AGENTS;
  const mentionReferences = mentionCatalogQuery.data?.references ?? EMPTY_REFERENCES;
  const discoveryError =
    activeQuery?.kind === "file"
      ? fileSearchQuery.error instanceof Error
        ? fileSearchQuery.error.message
        : fileSearchQuery.error
          ? "Could not search workspace files."
          : null
      : composerCatalogQuery.error instanceof Error
        ? composerCatalogQuery.error.message
        : composerCatalogQuery.error
          ? "Could not load suggestions."
          : (discoveryCatalog.errors[0]?.message ?? null);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      if (activeDraftScopeRef.current === draftScope) composerRef.current?.focus();
    });
  }, [draftScope]);

  useEffect(() => {
    // Composer owns model discovery; Thread consumes the catalog to label completed turns.
    // eslint-disable-next-line react-doctor/no-pass-data-to-parent
    onModelsChange?.(catalog.models);
  }, [catalog.models, onModelsChange]);

  const discoveryItems = useMemo<ComposerDiscoveryItem[]>(() => {
    if (!activeQuery) return [];
    const query = deferredQuery.toLowerCase();
    if (activeQuery.kind === "command") {
      // Name matches lead description matches, so `/open` is not outranked by `/model`.
      const rank = (command: (typeof discoveryCatalog.commands)[number]) => {
        const name = command.name.toLowerCase();
        if (name.startsWith(query)) return 0;
        if (name.includes(query)) return 1;
        return command.description?.toLowerCase().includes(query) ? 2 : -1;
      };
      return discoveryCatalog.commands
        .map((command) => ({ command, rank: rank(command) }))
        .filter(({ rank }) => rank >= 0)
        .toSorted((left, right) => left.rank - right.rank)
        .map(({ command }) => command)
        .slice(0, 20)
        .map((command) => ({
          kind: "command" as const,
          key: `command:${command.name}`,
          name: command.name,
          description: command.description,
          detail:
            command.agent ??
            (command.model ? `${command.model.providerID}/${command.model.id}` : null),
        }));
    }
    if (activeQuery.kind === "skill") {
      return discoveryCatalog.skills
        .filter(
          (skill) =>
            skill.id.toLowerCase().includes(query) ||
            skill.name.toLowerCase().includes(query) ||
            skill.description?.toLowerCase().includes(query),
        )
        .slice(0, 10)
        .map((skill) => ({
          kind: "skill" as const,
          key: `skill:${skill.id}`,
          id: skill.id,
          name: skill.name,
          description: skill.description,
        }));
    }
    const matches = (...values: (string | null | undefined)[]) =>
      values.some((value) => value?.toLowerCase().includes(query));
    // Upstream order: references, then subagents, then workspace files.
    const references = mentionReferences
      .filter((reference) => !reference.hidden && matches(reference.name, reference.description))
      .slice(0, 10)
      .map((reference) => ({
        kind: "reference" as const,
        key: `reference:${reference.name}`,
        name: reference.name,
        path: reference.path,
        description: reference.description ?? reference.source,
      }));
    const subagents = mentionAgents
      .filter(
        (agent) =>
          !agent.hidden &&
          agent.mode !== "primary" &&
          matches(agent.id, agent.name, agent.description),
      )
      .slice(0, 10)
      .map((agent) => ({
        kind: "agent" as const,
        key: `agent:${agent.id}`,
        name: agent.id,
        description: agent.description,
      }));
    return [
      ...references,
      ...subagents,
      ...fileResults.map((path) => ({
        kind: "file" as const,
        key: `file:${path}`,
        path,
        name: basename(path),
      })),
    ];
  }, [
    activeQuery,
    deferredQuery,
    discoveryCatalog.commands,
    discoveryCatalog.skills,
    fileResults,
    mentionAgents,
    mentionReferences,
  ]);
  const discoveryKey = activeQuery ? `${activeQuery.kind}\0${activeQuery.query}` : "";
  const requestedDiscoveryIndex =
    discoverySelection.key === discoveryKey ? discoverySelection.index : 0;
  const activeDiscoveryIndex = Math.min(
    requestedDiscoveryIndex,
    Math.max(0, discoveryItems.length - 1),
  );

  function setActiveDiscoveryIndex(index: number | ((current: number) => number)) {
    setDiscoverySelection((current) => {
      const currentIndex = Math.min(
        current.key === discoveryKey ? current.index : 0,
        Math.max(0, discoveryItems.length - 1),
      );
      return {
        key: discoveryKey,
        index: typeof index === "function" ? index(currentIndex) : index,
      };
    });
  }

  const context = useMemo(
    () => getContextUsage(messages, catalog.models),
    [catalog.models, messages],
  );
  const queuedPendingInputs = useMemo(
    () => pendingInputs.filter((request) => request.delivery === "queue"),
    [pendingInputs],
  );
  const queuedPendingCount = queuedPendingInputs.length;
  const pendingFilesByID = useMemo(
    () =>
      new Map(
        messages
          .filter((message) => message.type === "user")
          .map((message) => [message.id, message.files]),
      ),
    [messages],
  );
  const composerDelivery = activePendingInputEdit?.delivery ?? delivery;
  const promptItems = backgroundSteerPrompt
    ? backgroundWork.filter(
        (item) => pendingBackgroundSteer?.blockerIDs.has(item.id) === true && !item.background,
      )
    : [];

  const steerMessage = useCallback((record: PendingBackgroundSteer): PalotMessage | null => {
    return (
      messagesRef.current.find((candidate) => candidate.id === record.id) ??
      messagesRef.current.find(
        (candidate) =>
          candidate.type === "user" &&
          candidate.delivery === "steer" &&
          candidate.createdAt === record.submittedAt,
      ) ??
      null
    );
  }, []);

  const steerIsWaiting = useCallback((record: PendingBackgroundSteer): boolean => {
    return pendingInputsRef.current.some(
      (request) =>
        request.type === "input" &&
        request.delivery === "steer" &&
        (request.id === record.id || request.createdAt === record.submittedAt),
    );
  }, []);

  const currentSteerBlockers = useCallback(
    (record: PendingBackgroundSteer): BackgroundWorkItem[] => {
      return backgroundWorkRef.current.filter(
        (item) => record.blockerIDs.has(item.id) && !item.background,
      );
    },
    [],
  );

  const clearBackgroundSteer = useCallback((record: PendingBackgroundSteer) => {
    setPendingBackgroundSteer((current) =>
      current?.submittedAt === record.submittedAt ? null : current,
    );
    setBackgroundSteerPrompt((current) =>
      current?.submittedAt === record.submittedAt ? null : current,
    );
    backgroundActionRef.current = false;
  }, []);

  async function editPendingInput(request: PendingRequestView) {
    const current = store.get(stateAtom);
    if (current.edit || current.cancelingID || current.sending) return;
    const message = messagesRef.current.find(
      (candidate) => candidate.id === request.id && candidate.type === "user",
    );
    if (!message) throw new Error("The pending message is no longer available.");
    const restoredDraft = composerDraftWithRetainedFiles(message);
    setComposerState((current) => ({ ...current, cancelingID: request.id }));
    try {
      await palot.updatePending({ sessionID: session.id, inputID: request.id, action: "cancel" });
      setComposerState((current) => ({
        ...current,
        edit: {
          id: request.id,
          delivery: request.delivery ?? "queue",
          draft: restoredDraft,
          files: retainedComposerFiles(message),
          comments: reviewCommentsFromMessage(message) ?? [],
          browserComments: browserCommentsFromMessage(message),
        },
      }));
      if (activeDraftScopeRef.current === draftScope) {
        setAttachmentErrors([]);
        setSelection({ start: restoredDraft.text.length, end: restoredDraft.text.length });
        focusComposer();
      }
    } finally {
      setComposerState((current) => ({ ...current, cancelingID: null }));
    }
  }

  function restorePreviousDraft() {
    if (!activePendingInputEdit) return;
    setComposerState((current) => ({ ...current, edit: null }));
    setAttachmentErrors([]);
    focusComposer();
  }

  function updateComposerDelivery(next: ComposerDelivery) {
    if (activePendingInputEdit) {
      setComposerState((current) =>
        current.edit ? { ...current, edit: { ...current.edit, delivery: next } } : current,
      );
      return;
    }
    setDelivery(next);
  }

  const backgroundPendingSteer = useCallback(
    async (record: PendingBackgroundSteer) => {
      if (
        backgroundActionRef.current ||
        !steerIsWaiting(record) ||
        currentSteerBlockers(record).length === 0
      ) {
        if (!backgroundActionRef.current) clearBackgroundSteer(record);
        return;
      }
      backgroundActionRef.current = true;
      setBackgroundingSteer(true);
      try {
        await palot.backgroundSession(session.id);
        clearBackgroundSteer(record);
      } catch (error) {
        backgroundActionRef.current = false;
        if (!steerIsWaiting(record) || currentSteerBlockers(record).length === 0) {
          clearBackgroundSteer(record);
          return;
        }
        setBackgroundSteerPrompt({
          submittedAt: record.submittedAt,
          retry: true,
          error:
            error instanceof Error && error.message
              ? `Could not background the blocking work: ${error.message}`
              : "Could not background the blocking work.",
        });
      } finally {
        setBackgroundingSteer(false);
      }
    },
    [clearBackgroundSteer, currentSteerBlockers, session.id, steerIsWaiting],
  );

  // The pending steer record is external session lifecycle state that must be retired immediately.
  /* eslint-disable react-hooks-compiler/set-state-in-effect */
  useEffect(() => {
    const record = pendingBackgroundSteer;
    if (!record) return;
    const message = steerMessage(record);
    const waiting = steerIsWaiting(record);
    if (
      (message && message.runCompletedAt !== undefined) ||
      (backgroundSteerPrompt?.submittedAt === record.submittedAt && !waiting) ||
      (Date.now() >= record.submittedAt + STEER_BACKGROUND_DELAY_MS &&
        (!waiting || currentSteerBlockers(record).length === 0))
    ) {
      clearBackgroundSteer(record);
      return;
    }
    if (backgroundSteerPrompt?.submittedAt === record.submittedAt) return;
    const timeout = window.setTimeout(
      () => {
        if (!steerIsWaiting(record) || currentSteerBlockers(record).length === 0) {
          clearBackgroundSteer(record);
          return;
        }
        if (autoBackgroundOnSteer) void backgroundPendingSteer(record);
        else {
          setBackgroundSteerPrompt({ submittedAt: record.submittedAt, retry: false, error: null });
        }
      },
      Math.max(0, record.submittedAt + STEER_BACKGROUND_DELAY_MS - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [
    autoBackgroundOnSteer,
    backgroundPendingSteer,
    backgroundSteerPrompt,
    backgroundWork,
    clearBackgroundSteer,
    currentSteerBlockers,
    messages,
    pendingBackgroundSteer,
    steerIsWaiting,
    steerMessage,
  ]);
  /* eslint-enable react-hooks-compiler/set-state-in-effect */

  function setComposerMode(next: ComposerMode) {
    if (next === "shell" && (requestBody || activePendingInputEdit)) return;
    setModeState({ scope: draftScope, mode: next });
    setHistoryState(null);
    setAttachmentErrors([]);
    focusComposer();
  }

  /** Returns true when the key recalled history and the default action must be suppressed. */
  function recallHistory(direction: "up" | "down", element: HTMLTextAreaElement): boolean {
    const entries =
      mode === "shell"
        ? shellCommandHistory(
            messagesRef.current,
            submittedShell.scope === draftScope ? submittedShell.commands : [],
          )
        : normalPromptHistory(messagesRef.current);
    const result = navigateComposerHistory({
      direction,
      draft,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      entries,
      cursor: historyCursor,
    });
    if (!result) return false;
    setDraft(result.draft);
    setHistoryState({ key: historyKey, cursor: result.cursor });
    setSelection({ start: result.caret, end: result.caret });
    requestAnimationFrame(() => element.setSelectionRange(result.caret, result.caret));
    return true;
  }

  async function createSubmissionTarget(): Promise<PalotSession | null> {
    composerSelection.assertConnection();
    permissionSelection.assertReady();
    if (!onCreateSession) return session;
    const created = await onCreateSession({
      approvalMode: permissionSelection.draftMode,
      agent: displayedSession.agent,
      model: composerSelection.creationModel,
    });
    composerSelection.assertConnection();
    if (created) {
      composerSelection.rememberCreated();
      permissionSelection.resetDraft();
    }
    return created;
  }

  async function submitShell() {
    const command = draft.text.trim();
    const currentState = store.get(stateAtom);
    if (
      !command ||
      locationRecovery.missing ||
      currentState.sending ||
      currentState.cancelingID ||
      attachmentRequestRef.current ||
      composerSelection.blocked ||
      permissionSelection.isBusy()
    )
      return;
    setAttachmentErrors([]);
    const submittedDraft = draft;
    const connectionID = runtime?.connectionID;
    await admitComposerSubmission({
      submission: {
        kind: "prompt",
        text: command,
        files: [],
        skills: [],
        agents: [],
        references: [],
      },
      files: [],
      delivery: "steer",
      optimistic: false,
      createTarget: createSubmissionTarget,
      dispatch: async (sessionID) => {
        composerSelection.assertConnection();
        await palot.runShell({ sessionID, command }, connectionID);
        return null;
      },
      effects: {
        setSending,
        clearLocal: () => {
          // Attachments and comments stay for the next prompt; shell only consumes the text.
          if (store.get(draftAtom) === submittedDraft) setOriginalDraft(emptyComposerDraft());
          setHistoryState(null);
          setSubmittedShell((current) => ({
            scope: draftScope,
            commands: [
              command,
              ...(current.scope === draftScope ? current.commands : []).filter(
                (item) => item !== command,
              ),
            ].slice(0, 100),
          }));
          onMessageAdmitted?.();
        },
        admitOptimistic: () => undefined,
        convergeReceipt: () => undefined,
        rollbackOptimistic: () => undefined,
        reportCreationError: (error) => onCreateSessionError?.(error),
        reportDispatchError: (error) => {
          setLocationFailure({ scope: draftScope, error });
          setAttachmentErrors([
            error instanceof Error ? error.message : "Could not run the shell command.",
          ]);
        },
      },
    });
  }

  async function cycleAgent(direction: 1 | -1) {
    const available = primaryAgents(agents);
    if (available.length === 0) return;
    const currentID = displayedSession.agent ?? available[0]!.id;
    const index = Math.max(
      0,
      available.findIndex((agent) => agent.id === currentID),
    );
    const next = available[(index + direction + available.length) % available.length];
    if (!next || next.id === currentID) return;
    try {
      await composerSelection.selectAgent(next);
    } catch (error) {
      showErrorToast("Could not switch agents", error);
    }
  }

  const applyPendingAgentCycle = useEffectEvent((direction: 1 | -1) => {
    void cycleAgent(direction);
  });

  // Agents load on demand; apply a shortcut-triggered cycle once the catalogs settle.
  /* eslint-disable react-hooks-compiler/set-state-in-effect */
  useEffect(() => {
    if (!agentCycleRequest || agentCycleRequest.scope !== draftScope) return;
    if (agentCatalogQuery.error || modelCatalogQuery.error) {
      setAgentCycleRequest(null);
      return;
    }
    if (!catalogsReady) return;
    setAgentCycleRequest(null);
    applyPendingAgentCycle(agentCycleRequest.direction);
  }, [
    agentCatalogQuery.error,
    agentCycleRequest,
    catalogsReady,
    draftScope,
    modelCatalogQuery.error,
  ]);
  /* eslint-enable react-hooks-compiler/set-state-in-effect */

  const handleComposerShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      requestBody ||
      locationRecovery.missing ||
      event.defaultPrevented ||
      event.isComposing ||
      event.getModifierState("AltGraph")
    )
      return;
    const shortcut = matchComposerShortcut(event);
    if (!shortcut) return;
    const target = event.target;
    if (target instanceof Element) {
      if (target.closest("[data-workbench-terminal]")) return;
      // Leave other text fields alone; the composer's own input and non-editable focus qualify.
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (editable && !composerShellRef.current?.contains(target)) return;
    }
    if (document.querySelector('[data-slot="dialog-content"][data-open]')) return;
    event.preventDefault();
    const selectionDisabled = sending || composerSelection.busy;
    switch (shortcut) {
      case "model":
        if (!selectionDisabled) setActiveMenu("model");
        return;
      case "agent-next":
      case "agent-previous": {
        if (selectionDisabled) return;
        const direction = shortcut === "agent-next" ? 1 : -1;
        if (catalogsReady) void cycleAgent(direction);
        else setAgentCycleRequest({ scope: draftScope, direction });
        return;
      }
      case "attach":
        if (!sending && !attachmentUpload) void pickFiles();
        return;
      case "shell-mode":
        setComposerMode("shell");
        return;
      case "normal-mode":
        setComposerMode("normal");
        return;
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleComposerShortcut(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Runs a Palot-handled slash command. Commands from the palette leave a typed draft alone:
   * undo and redo restore the reverted prompt only into an empty composer.
   */
  async function runBuiltinCommand(
    commandName: string,
    args: string | undefined,
    source: "draft" | "palette",
  ): Promise<boolean> {
    const fromDraft = source === "draft";
    const restoresDraft =
      fromDraft ||
      (!draft.text.trim() &&
        files.length === 0 &&
        comments.length === 0 &&
        browserComments.length === 0);
    if (commandName === "compact") {
      try {
        setSending(true);
        await palot.compactSession(session.id);
        if (fromDraft) clearSubmittedContents();
      } catch (error) {
        setAttachmentErrors([error instanceof Error ? error.message : "Compaction failed"]);
      } finally {
        setSending(false);
      }
      return true;
    }
    if (commandName === "new" || commandName === "clear") {
      if (fromDraft) clearSubmittedContents();
      if (!onCreateSession) onNavigateToNewTask?.();
      return true;
    }
    if (commandName === "model") {
      if (fromDraft) clearSubmittedContents();
      const arg = args?.trim().toLowerCase();
      if (arg) {
        const matched = catalog.models.find(
          (m) =>
            m.id.toLowerCase() === arg ||
            m.name.toLowerCase() === arg ||
            `${m.providerID}/${m.id}`.toLowerCase() === arg ||
            m.name.toLowerCase().includes(arg) ||
            m.id.toLowerCase().includes(arg),
        );
        if (matched) {
          try {
            await composerSelection.selectModel({
              providerID: matched.providerID,
              id: matched.id,
            });
          } catch (error) {
            showErrorToast("Could not switch models", error);
          }
          return true;
        }
      }
      setActiveMenu("model");
      return true;
    }
    if (commandName === "agent") {
      if (fromDraft) clearSubmittedContents();
      const arg = args?.trim().toLowerCase();
      const matched = arg
        ? primaryAgents(agents).find(
            (agent) => agent.id.toLowerCase() === arg || agent.name.toLowerCase() === arg,
          )
        : undefined;
      if (matched) {
        try {
          await composerSelection.selectAgent(matched);
        } catch (error) {
          showErrorToast("Could not switch agents", error);
        }
        return true;
      }
      setActiveMenu("agent");
      return true;
    }
    const globalCommand = SLASH_GLOBAL_COMMANDS[commandName];
    if (globalCommand) {
      if (globalCommand.task && onCreateSession) {
        setAttachmentErrors([`Open an existing conversation before using /${commandName}.`]);
        return true;
      }
      if (fromDraft) clearSubmittedContents();
      requestGlobalCommand(globalCommand.id);
      return true;
    }
    if (commandName === "undo" || commandName === "revert") {
      const userMessages = messages.filter((message) => message.type === "user");
      const boundary = session.revert
        ? userMessages.findIndex((message) => message.id === session.revert?.messageID)
        : userMessages.length;
      const target = userMessages[Math.max(0, boundary) - 1];
      if (target) {
        const pending = pendingInputs.find(
          (request) => request.type === "input" && request.id === target.id,
        );
        if (pending) {
          try {
            await editPendingInput(pending);
          } catch (error) {
            if (activeDraftScopeRef.current === draftScope) {
              setAttachmentErrors([error instanceof Error ? error.message : "Revert failed"]);
            }
          }
          return true;
        }
        try {
          setSending(true);
          const connectionID = runtime?.connectionID;
          await palot.interrupt(session.id, connectionID);
          await palot.waitForSessionIdle(session.id, connectionID);
          const updated = await palot.stageSessionRevert(
            { sessionID: session.id, messageID: target.id },
            connectionID,
          );
          if (updated) cacheSession(updated);
          if (restoresDraft) {
            setDraft(composerDraftWithRetainedFiles(target));
            setFiles(retainedComposerFiles(target));
            setComments(() => reviewCommentsFromMessage(target) ?? []);
            setBrowserComments(() => browserCommentsFromMessage(target) ?? []);
          }
        } catch (error) {
          if (activeDraftScopeRef.current === draftScope) {
            setAttachmentErrors([error instanceof Error ? error.message : "Revert failed"]);
          }
        } finally {
          setSending(false);
        }
      } else if (fromDraft) {
        setDraft(emptyComposerDraft());
      }
      return true;
    }
    if (commandName === "redo") {
      if (!session.revert) {
        if (fromDraft) setDraft(emptyComposerDraft());
        return true;
      }
      const userMessages = messages.filter((message) => message.type === "user");
      const boundary = userMessages.findIndex(
        (message) => message.id === session.revert?.messageID,
      );
      const target = boundary < 0 ? undefined : userMessages[boundary + 1];
      try {
        setSending(true);
        const connectionID = runtime?.connectionID;
        await palot.interrupt(session.id, connectionID);
        await palot.waitForSessionIdle(session.id, connectionID);
        const updated = target
          ? await palot.stageSessionRevert(
              { sessionID: session.id, messageID: target.id },
              connectionID,
            )
          : await palot.clearSessionRevert(session.id, connectionID);
        if (updated) cacheSession(updated);
        if (restoresDraft) {
          setDraft(target ? composerDraftWithRetainedFiles(target) : emptyComposerDraft());
          setFiles(target ? retainedComposerFiles(target) : []);
          setComments(() => (target ? (reviewCommentsFromMessage(target) ?? []) : []));
          setBrowserComments(() => (target ? (browserCommentsFromMessage(target) ?? []) : []));
        }
      } catch (error) {
        if (activeDraftScopeRef.current === draftScope) {
          setAttachmentErrors([error instanceof Error ? error.message : "Redo failed"]);
        }
      } finally {
        setSending(false);
      }
      return true;
    }
    if (commandName === "restore") {
      if (!session.revert) {
        if (fromDraft) setDraft(emptyComposerDraft());
        return true;
      }
      try {
        setSending(true);
        const updated = await palot.clearSessionRevert(session.id);
        if (updated) cacheSession(updated);
        if (fromDraft) {
          setDraft(emptyComposerDraft());
          setFiles([]);
        }
      } catch (error) {
        setAttachmentErrors([error instanceof Error ? error.message : "Restore failed"]);
      } finally {
        setSending(false);
      }
      return true;
    }
    return false;
  }

  // Palette task actions that need this composer's draft or menus.
  const handleComposerAction = useEffectEvent((request: ComposerActionRequest) => {
    if (requestBody || locationRecovery.missing) return;
    if (request.action === "model" || request.action === "agent") {
      if (!sending && !composerSelection.busy) setActiveMenu(request.action);
      return;
    }
    void runBuiltinCommand(request.action, undefined, "palette");
  });

  useEffect(() => {
    const request = composerActionRequest;
    if (!request || onCreateSession || request.sessionID !== session.id) return;
    if (request.profileID !== null && request.profileID !== runtime?.profileID) return;
    store.set(composerActionRequestAtom, null);
    if (Date.now() - request.requestedAt > COMPOSER_ACTION_TTL_MS) return;
    handleComposerAction(request);
  }, [composerActionRequest, onCreateSession, runtime?.profileID, session.id, store]);

  async function submit(deliveryOverride?: ComposerDelivery) {
    if (mode === "shell") {
      await submitShell();
      return;
    }
    const sideQuestion = parseBtwQuestion(draft.text);
    if (sideQuestion !== null) {
      if (store.get(stateAtom).sending || store.get(stateAtom).cancelingID) return;
      try {
        if (!sideQuestion) throw new Error("Enter a question after /btw.");
        if (onCreateSession) throw new Error("Open an existing conversation before using /btw.");
        if (!runtime?.connected) throw new Error("Connect to OpenCode before using /btw.");
        askBtw(
          store,
          {
            profileID: runtime.profileID,
            connectionID: runtime.connectionID,
            sessionID: session.id,
            location: session.location,
          },
          sideQuestion,
        );
        setAttachmentErrors([]);
        setDraft(draftAfterBtw(draft));
      } catch (error) {
        setAttachmentErrors([
          error instanceof Error ? error.message : "Could not ask this question.",
        ]);
      }
      return;
    }
    const submission = projectComposerSubmission(draft);
    const value = submission.text;
    const currentState = store.get(stateAtom);
    if (
      (!value.trim() &&
        files.length === 0 &&
        submission.skills.length === 0 &&
        comments.length === 0 &&
        browserComments.length === 0) ||
      locationRecovery.missing ||
      currentState.sending ||
      currentState.cancelingID ||
      attachmentRequestRef.current ||
      composerSelection.blocked ||
      permissionSelection.isBusy()
    )
      return;
    if (submission.kind === "command" && (comments.length > 0 || browserComments.length > 0)) {
      setAttachmentErrors(["Remove comments before running a slash command."]);
      return;
    }
    if (
      submission.kind === "command" &&
      files.length > 0 &&
      BUILTIN_COMMANDS.some((command) => command.name === submission.command.toLowerCase())
    ) {
      setAttachmentErrors(["Remove picked attachments before running a slash command."]);
      return;
    }
    setAttachmentErrors([]);

    if (
      submission.kind === "command" &&
      (await runBuiltinCommand(submission.command.toLowerCase(), submission.arguments, "draft"))
    )
      return;

    const effectiveDelivery =
      isWorking && !onCreateSession ? (deliveryOverride ?? composerDelivery) : "steer";
    const submittedFiles = files;
    const submittedBrowserComments = liveBrowserComments(
      browserComments,
      browser?.bindingID ?? null,
      browser?.state.tabs ?? [],
    );
    const submittedComments = comments.map(({ path, comment, selection }) => ({
      path,
      comment,
      selection,
      origin: "review" as const,
    }));
    const modelInput = resolveModelSelection(
      catalog.models,
      displayedSession.model,
      catalog.defaultModel,
    ).model?.capabilities.input;
    const previousExecution = new Map<string, SessionExecutionState | undefined>();
    const mentionInput = {
      ...(submission.agents.length ? { agentReferences: submission.agents } : {}),
      ...(submission.references.length ? { directoryReferences: submission.references } : {}),
    };
    await admitComposerSubmission({
      submission,
      files: submittedFiles,
      comments: submittedComments,
      browserComments: submittedBrowserComments,
      delivery: effectiveDelivery,
      optimistic: submission.kind !== "command",
      createTarget: createSubmissionTarget,
      dispatch: (sessionID, messageID) => {
        composerSelection.assertConnection();
        return submission.kind === "command"
          ? palot.runCommand({
              sessionID,
              command: submission.command,
              modelInput,
              ...(submittedFiles.length ? { files: submittedFiles } : {}),
              ...(submission.arguments ? { arguments: submission.arguments } : {}),
              ...(submission.files.length ? { fileReferences: submission.files } : {}),
              ...(submission.skills.length ? { skillReferences: submission.skills } : {}),
              ...mentionInput,
              delivery: effectiveDelivery,
            })
          : palot.sendComposerPrompt({
              sessionID,
              id: messageID,
              text: value,
              ...(submittedComments.length ? { comments: submittedComments } : {}),
              ...(submittedBrowserComments.length
                ? { browserComments: submittedBrowserComments }
                : {}),
              modelInput,
              ...(submittedFiles.length ? { files: submittedFiles } : {}),
              ...(submission.files.length ? { fileReferences: submission.files } : {}),
              ...(submission.skills.length ? { skillReferences: submission.skills } : {}),
              ...mentionInput,
              delivery: effectiveDelivery,
            });
      },
      effects: {
        setSending,
        clearLocal: () => {
          clearSubmittedContents();
          setHistoryState(null);
        },
        admitOptimistic: ({ sessionID, message, execution }) => {
          onMessageAdmitted?.();
          let nextExecution = execution;
          updateSessionActivity(
            queryClient,
            runtime?.connectionID ?? "disconnected",
            (current) => {
              const previous = current.execution.get(sessionID);
              previousExecution.set(sessionID, previous);
              if (previous?.status === "running") nextExecution = previous;
              if (previous?.status === "running") return current;
              return {
                ...current,
                activeIDs: new Set(current.activeIDs).add(sessionID),
                execution: new Map(current.execution).set(sessionID, execution),
              };
            },
            [sessionID],
          );
          setMessages((current) => {
            const runStartedAt =
              effectiveDelivery === "steer" && nextExecution.status === "running"
                ? (nextExecution.startedAt ?? message.createdAt)
                : undefined;
            const optimistic = runStartedAt === undefined ? message : { ...message, runStartedAt };
            return new Map(current).set(sessionID, [...(current.get(sessionID) ?? []), optimistic]);
          });
          if (isWorking && effectiveDelivery === "steer" && !onCreateSession && !session.parentID) {
            const blockers = backgroundWorkRef.current.filter(
              (item) => !item.background && item.startedAt < message.createdAt,
            );
            if (blockers.length > 0) {
              backgroundActionRef.current = false;
              setBackgroundSteerPrompt(null);
              setPendingBackgroundSteer({
                id: message.id,
                submittedAt: message.createdAt,
                blockerIDs: new Set(blockers.map((item) => item.id)),
              });
            }
          }
        },
        convergeReceipt: (sessionID, optimisticID, receipt) => {
          setPendingBackgroundSteer((current) =>
            current?.id === optimisticID ? { ...current, id: receipt.id } : current,
          );
          setMessages((current) => {
            const existing = current.get(sessionID) ?? [];
            const updated = convergeMessageReceipt(
              existing,
              optimisticID,
              receipt.id,
              receipt.createdAt ?? null,
            );
            return new Map(current).set(sessionID, updated);
          });
        },
        rollbackOptimistic: (sessionID, optimisticID, startedAt) => {
          setPendingBackgroundSteer((current) =>
            current?.id === optimisticID || current?.submittedAt === startedAt ? null : current,
          );
          setBackgroundSteerPrompt((current) =>
            current?.submittedAt === startedAt ? null : current,
          );
          backgroundActionRef.current = false;
          setMessages((current) =>
            new Map(current).set(
              sessionID,
              (current.get(sessionID) ?? []).filter((message) => message.id !== optimisticID),
            ),
          );
          updateSessionActivity(
            queryClient,
            runtime?.connectionID ?? "disconnected",
            (current) => {
              if (current.execution.get(sessionID)?.startedAt !== startedAt) return current;
              const execution = new Map(current.execution);
              const activeIDs = new Set(current.activeIDs);
              const previous = previousExecution.get(sessionID);
              if (previous) execution.set(sessionID, previous);
              else execution.delete(sessionID);
              if (previous?.status === "running") activeIDs.add(sessionID);
              else activeIDs.delete(sessionID);
              return { ...current, activeIDs, execution };
            },
            [sessionID],
          );
        },
        reportCreationError: (error) => onCreateSessionError?.(error),
        reportDispatchError: (error) => {
          setLocationFailure({ scope: draftScope, error });
          setAttachmentErrors([
            error instanceof Error ? error.message : "Palot could not send the attachment.",
          ]);
        },
      },
    });
  }

  function updateSelection(element: HTMLTextAreaElement) {
    setSelection({ start: element.selectionStart, end: element.selectionEnd });
  }

  function selectDiscoveryItem(item: ComposerDiscoveryItem) {
    const element = composerRef.current;
    if (!element) return;
    const freshQuery = detectComposerQuery(
      draft.text,
      element.selectionStart,
      element.selectionEnd,
      { isComposing },
    );
    const itemQueryKind = item.kind === "agent" || item.kind === "reference" ? "file" : item.kind;
    if (!freshQuery || freshQuery.kind !== itemQueryKind) return;
    const localID = crypto.randomUUID();
    const selectionValue: ComposerDiscoverySelection =
      item.kind === "command"
        ? { kind: "command", name: item.name }
        : item.kind === "skill"
          ? { kind: "skill", id: item.id, localID }
          : item.kind === "agent"
            ? { kind: "agent", name: item.name, localID }
            : item.kind === "reference"
              ? { kind: "reference", name: item.name, path: item.path, localID }
              : { kind: "file", path: item.path, localID };
    const inserted = insertComposerSelection(draft, freshQuery, selectionValue);
    setDraft(inserted.draft);
    setSelection({ start: inserted.selectionStart, end: inserted.selectionEnd });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
    });
  }

  async function attachFiles(
    prepare: (requestID: string, isCurrent: () => boolean) => Promise<PalotFilePickerResult | null>,
  ) {
    if (attachmentRequestRef.current || sending) return;
    const request = { id: crypto.randomUUID(), unsubscribe: () => {} };
    const isCurrent = () => attachmentRequestRef.current === request;
    attachmentRequestRef.current = request;
    setAttachmentErrors([]);
    setAttachmentUpload({ progress: null });
    try {
      request.unsubscribe = palot.onAttachmentProgress((progress) => {
        if (
          isCurrent() &&
          progress.requestID === request.id &&
          progress.connectionID === runtime?.connectionID
        ) {
          setAttachmentUpload({ progress });
        }
      });
      const result = await prepare(request.id, isCurrent);
      if (!isCurrent() || !result) return;
      setAttachmentErrors(result.errors);
      setFiles((current) => {
        const byUri = new Map(current.map((item) => [item.uri, item]));
        for (const item of result.files) byUri.set(item.uri, item);
        return [...byUri.values()];
      });
    } catch (error) {
      if (!isCurrent()) return;
      setAttachmentErrors([
        error instanceof Error ? error.message : "Palot could not attach the selected files.",
      ]);
    } finally {
      request.unsubscribe();
      if (isCurrent()) {
        attachmentRequestRef.current = null;
        setAttachmentUpload(null);
      }
    }
  }

  async function pickFiles() {
    if (!localAttachments) {
      setAttachmentErrors(["Local file attachments are unavailable for remote OpenCode servers."]);
      return;
    }
    const connectionID = runtime?.connectionID;
    await attachFiles((requestID) => palot.pickFiles(connectionID, requestID));
  }

  async function pasteImages(items: DataTransferItemList) {
    const connectionID = runtime?.connectionID;
    const images = Array.from(items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => {
        const file = item.getAsFile();
        return file ? [file] : [];
      });
    await attachFiles(async (requestID, isCurrent) => {
      const prepared = await Promise.all(
        images.map(async (image) => ({ mime: image.type, data: await image.arrayBuffer() })),
      );
      if (!isCurrent()) return null;
      return palot.attachClipboardImages(prepared, connectionID, requestID);
    });
  }

  const canSubmit =
    mode === "shell"
      ? Boolean(draft.text.trim()) &&
        !attachmentUpload &&
        !composerSelection.blocked &&
        !permissionSelection.busy &&
        !locationRecovery.missing &&
        !sending &&
        !pendingInputEditID &&
        runtime?.connected !== false
      : (parseBtwQuestion(draft.text) !== null ||
          (!attachmentUpload &&
            !composerSelection.blocked &&
            !permissionSelection.busy &&
            !locationRecovery.missing &&
            !requestBody)) &&
        (Boolean(draft.text.trim()) ||
          files.length > 0 ||
          comments.length > 0 ||
          browserComments.length > 0) &&
        !sending &&
        !pendingInputEditID &&
        runtime?.connected !== false;
  const discoveryOpen = Boolean(activeQuery);
  const unifiedFocus = Boolean(contextBar && contextBarMode === "new-task");
  const handleModelOpenChange = useCallback(
    (open: boolean) => setActiveMenu(open ? "model" : null),
    [],
  );
  const handleAgentOpenChange = useCallback(
    (open: boolean) => setActiveMenu(open ? "agent" : null),
    [],
  );
  const handleApprovalsOpenChange = useCallback(
    (open: boolean) => setActiveMenu(open ? "approvals" : null),
    [],
  );
  const openContext = useCallback(() => {
    workbench.openTab({ kind: "context", location: session.location }, { pane: "right" });
  }, [session.location, workbench]);
  const handleBackground = useCallback(() => {
    if (pendingBackgroundSteer) void backgroundPendingSteer(pendingBackgroundSteer);
  }, [backgroundPendingSteer, pendingBackgroundSteer]);
  return (
    <div
      ref={composerShellRef}
      data-palot-composer-mode={mode}
      className={cn(
        "palot-composer-shell relative mx-auto w-[calc(100%-32px)] shrink-0 pb-2 max-[720px]:w-[calc(100%-20px)]",
        contextBar ? "max-w-[860px]" : "max-w-[760px]",
      )}
    >
      {discoveryOpen ? (
        <ComposerDiscovery
          id={`composer-discovery-${session.id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`}
          items={discoveryItems}
          activeIndex={activeDiscoveryIndex}
          loading={activeQuery?.kind === "file" && fileSearchQuery.isFetching}
          error={discoveryError}
          onActiveIndexChange={setActiveDiscoveryIndex}
          onSelect={selectDiscoveryItem}
        />
      ) : null}
      {requestBody ? null : (
        <BackgroundWorkPrompt
          items={promptItems}
          backgrounding={backgroundingSteer}
          retry={backgroundSteerPrompt?.retry ?? false}
          error={backgroundSteerPrompt?.error ?? null}
          onBackground={handleBackground}
        />
      )}
      <OpenCodeConnectionAlert />
      <SessionLocationMissingView options={recoveryOptions} recovery={locationRecovery} />
      {pendingInputs.length > 0 ? (
        <section
          aria-label="Pending messages"
          className="relative mx-2 -mb-4 min-w-0 rounded-t-2xl border border-b-0 border-foreground/10 bg-muted px-1 pt-1 pb-4"
        >
          <div className="palot-native-scrollbar flex max-h-[min(9rem,20cqh)] min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain">
            {pendingInputs.map((request, index) => (
              <PendingInputTaskbarItem
                key={request.id}
                sessionID={session.id}
                request={request}
                files={pendingFilesByID.get(request.id)}
                editDisabled={Boolean(activePendingInputEdit || pendingInputEditID || sending)}
                onEdit={editPendingInput}
                queuedPosition={
                  request.delivery === "queue"
                    ? pendingInputs
                        .slice(0, index + 1)
                        .filter((candidate) => candidate.delivery === "queue").length
                    : undefined
                }
                queuedCount={queuedPendingCount}
              />
            ))}
          </div>
        </section>
      ) : null}
      <div
        className={cn(
          "relative z-10",
          unifiedFocus &&
            "palot-composer-frame overflow-hidden border border-foreground/12 bg-card transition-colors",
          unifiedFocus && "has-[[data-slot=input-group-control]:focus-visible]:border-ring",
        )}
      >
        <InputGroup
          className={cn(
            "palot-composer @container/composer relative isolate z-10 h-auto min-h-0 flex-col items-stretch overflow-hidden border-foreground/12 bg-card",
            unifiedFocus &&
              "palot-composer-unified border-0 bg-transparent shadow-none ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          )}
        >
          <SurfaceBackdrop tone="composer" />
          {activePendingInputEdit ? (
            <div className="relative z-10 flex min-w-0 items-center gap-2 border-b border-foreground/8 px-4 py-2 text-meta text-muted-foreground">
              <Pencil className="size-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                Editing a canceled pending message. Resubmitting adds it to the end.
              </span>
              <button
                type="button"
                className="shrink-0 font-medium text-foreground/75 hover:text-foreground"
                onClick={restorePreviousDraft}
              >
                Discard edit and restore draft
              </button>
            </div>
          ) : null}
          {!requestBody && comments.length > 0 ? (
            <section
              aria-label="Pending line comments"
              className="relative z-10 max-h-32 space-y-1 overflow-y-auto border-b border-border px-3 py-2"
            >
              {comments.map((item) => (
                <div key={item.id} className="flex min-w-0 items-center gap-1 text-meta">
                  {editingCommentID === item.id ? (
                    <form
                      className="flex min-w-0 flex-1 gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!editingCommentText.trim()) return;
                        setComments((current) =>
                          current.map((comment) =>
                            comment.id === item.id
                              ? { ...comment, comment: editingCommentText.trim() }
                              : comment,
                          ),
                        );
                        setEditingCommentID(null);
                      }}
                    >
                      <input
                        aria-label={`Comment on ${item.path} line ${item.selection.startLine}`}
                        className="min-w-0 flex-1 rounded border border-border bg-card px-1 text-foreground"
                        value={editingCommentText}
                        onChange={(event) => setEditingCommentText(event.target.value)}
                      />
                      <button type="submit" disabled={!editingCommentText.trim()}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingCommentID(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate" title={item.comment}>
                        {item.path}:{item.selection.startLine}
                        {item.selection.endLine !== item.selection.startLine
                          ? `–${item.selection.endLine}`
                          : ""}{" "}
                        · {item.comment}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Edit comment on ${item.path} line ${item.selection.startLine}`}
                        onClick={() => {
                          setEditingCommentID(item.id);
                          setEditingCommentText(item.comment);
                        }}
                      >
                        Edit
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove comment on ${item.path} line ${item.selection.startLine}`}
                    onClick={() =>
                      setComments((current) => current.filter((comment) => comment.id !== item.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          {!requestBody && browserComments.length > 0 ? (
            <section
              aria-label="Pending browser comments"
              className="relative z-10 max-h-40 space-y-2 overflow-y-auto border-b border-border px-3 py-2"
            >
              {browserComments.map((item) => (
                <div key={item.id} className="flex min-w-0 items-start gap-2 text-meta">
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt={`Preview of ${item.element.label}`}
                      className="h-12 w-20 shrink-0 rounded border object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-muted-foreground"
                      title={`${item.url} · ${item.element.selector}`}
                    >
                      {item.element.label} · {item.url}
                    </p>
                    <input
                      aria-label={`Browser comment on ${item.element.label}`}
                      maxLength={8000}
                      className="w-full min-w-0 rounded border border-border bg-card px-1 text-foreground"
                      value={item.comment}
                      onChange={(event) =>
                        setBrowserComments((current) =>
                          current.map((comment) =>
                            comment.id === item.id
                              ? { ...comment, comment: event.target.value }
                              : comment,
                          ),
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove browser comment on ${item.element.label}`}
                    onClick={() =>
                      setBrowserComments((current) =>
                        current.filter((comment) => comment.id !== item.id),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </section>
          ) : null}
          {requestBody ? (
            <div data-palot-composer-request className="px-2 pt-1">
              {requestBody}
            </div>
          ) : (
            <InputGroupTextarea
              ref={composerRef}
              data-palot-composer-input
              aria-label={mode === "shell" ? "Shell command" : "Message Palot"}
              aria-controls={
                discoveryOpen
                  ? `composer-discovery-${session.id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`
                  : undefined
              }
              aria-expanded={discoveryOpen}
              aria-activedescendant={
                discoveryOpen && discoveryItems.length > 0
                  ? `composer-discovery-${session.id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}-option-${activeDiscoveryIndex}`
                  : undefined
              }
              value={draft.text}
              rows={2}
              className={cn(
                "palot-native-scrollbar max-h-[clamp(3rem,25cqh,11rem)] min-h-[calc(2lh+--spacing(4))] flex-none resize-none overflow-y-auto overscroll-contain px-5 pt-3 pb-1",
                mode === "shell" && "font-mono text-code",
              )}
              placeholder={mode === "shell" ? "Run a shell command" : "Do anything"}
              disabled={locationRecovery.missing}
              onChange={(event) => {
                if (
                  mode === "normal" &&
                  !draft.text &&
                  event.target.value === "!" &&
                  !activePendingInputEdit
                ) {
                  setComposerMode("shell");
                  return;
                }
                setDraft((current) => applyComposerTextChange(current, event.target.value));
                updateSelection(event.target);
              }}
              onClick={(event) => updateSelection(event.currentTarget)}
              onSelect={(event) => updateSelection(event.currentTarget)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                updateSelection(event.currentTarget);
              }}
              onPaste={(event) => {
                const hasImages = Array.from(event.clipboardData.items).some(
                  (item) => item.kind === "file" && item.type.startsWith("image/"),
                );
                if (!hasImages && event.clipboardData.getData("text/plain")) return;
                if (!localAttachments) {
                  if (hasImages) {
                    event.preventDefault();
                    setAttachmentErrors([
                      "Image attachments are unavailable for remote OpenCode servers.",
                    ]);
                  }
                  return;
                }
                event.preventDefault();
                void pasteImages(event.clipboardData.items);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (discoveryOpen && discoveryItems.length > 0) {
                  const navigationKey =
                    event.key === "ArrowDown" || (event.ctrlKey && event.key.toLowerCase() === "n")
                      ? "ArrowDown"
                      : event.key === "ArrowUp" ||
                          (event.ctrlKey && event.key.toLowerCase() === "p")
                        ? "ArrowUp"
                        : null;
                  if (navigationKey) {
                    event.preventDefault();
                    const direction = navigationKey === "ArrowDown" ? 1 : -1;
                    setActiveDiscoveryIndex(
                      (current) =>
                        (current + direction + discoveryItems.length) % discoveryItems.length,
                    );
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    const item = discoveryItems[activeDiscoveryIndex] ?? discoveryItems[0];
                    if (item) selectDiscoveryItem(item);
                    return;
                  }
                }
                if (discoveryOpen && event.key === "Escape") {
                  event.preventDefault();
                  setSelection({ start: -1, end: -1 });
                  return;
                }
                if (
                  mode === "shell" &&
                  (event.key === "Escape" ||
                    (event.key === "Backspace" &&
                      !draft.text &&
                      !event.altKey &&
                      !event.ctrlKey &&
                      !event.metaKey))
                ) {
                  event.preventDefault();
                  setComposerMode("normal");
                  return;
                }
                if (
                  !discoveryOpen &&
                  (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  recallHistory(event.key === "ArrowUp" ? "up" : "down", event.currentTarget)
                ) {
                  event.preventDefault();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(
                    isWorking && !onCreateSession && (event.metaKey || event.ctrlKey)
                      ? "steer"
                      : undefined,
                  );
                }
              }}
            />
          )}
          {!requestBody && files.length > 0 ? (
            <AttachmentGroup
              className="palot-native-scrollbar max-h-[min(6rem,15cqh)] shrink-0 overflow-y-auto overscroll-contain px-3 py-1"
              aria-label="Attachments"
            >
              {files.map((file) => (
                <FileAttachment
                  key={file.uri}
                  file={file}
                  onRemove={() =>
                    setFiles((current) => current.filter((item) => item.uri !== file.uri))
                  }
                />
              ))}
            </AttachmentGroup>
          ) : null}
          {!requestBody && composerSelection.error ? (
            <p role="alert" className="px-3 text-compact text-destructive">
              {composerSelection.error}
            </p>
          ) : null}
          {!requestBody && attachmentUpload ? (
            <div className="flex min-w-0 items-center gap-2 px-3 py-1 text-compact text-muted-foreground">
              <span role="status" className="min-w-0 flex-1 truncate">
                {attachmentUpload.progress
                  ? `Uploading ${attachmentUpload.progress.name} (${attachmentUpload.progress.index + 1}/${attachmentUpload.progress.count}) · ${Math.round((attachmentUpload.progress.loaded / Math.max(1, attachmentUpload.progress.total)) * 100)}%`
                  : "Preparing attachments…"}
              </span>
              <InputGroupButton
                type="button"
                size="sm"
                onClick={cancelAttachmentUpload}
                aria-label="Cancel attachment upload"
              >
                Cancel
              </InputGroupButton>
            </div>
          ) : null}
          {!requestBody && attachmentErrors.length > 0 ? (
            <div className="px-4 py-1 text-xs text-destructive" role="alert">
              {attachmentErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}
          {requestBody ? (
            <InputGroupAddon align="block-end" className="justify-between px-3 pt-0 pb-2">
              <ApprovalSelector
                key={JSON.stringify([runtime?.connectionID, draftScope])}
                mode={permissionSelection.mode}
                busy={permissionSelection.busy}
                disabled={sending || composerSelection.busy || !runtime?.connected}
                open={activeMenu === "approvals"}
                onOpenChange={handleApprovalsOpenChange}
                onSelect={permissionSelection.select}
                onSelectionComplete={focusComposer}
              />
              {isWorking && (
                <InputGroupButton
                  type="button"
                  size="sm"
                  aria-label="Stop task"
                  onClick={() => void palot.interrupt(session.id)}
                >
                  <Square className="size-3 fill-current" aria-hidden="true" />
                  Stop
                </InputGroupButton>
              )}
            </InputGroupAddon>
          ) : (
            <InputGroupAddon
              align="block-end"
              className="shrink-0 flex-wrap gap-1.5 px-3 pt-1 pb-2"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      type="button"
                      size="icon-sm"
                      aria-label="Attach files"
                      disabled={sending || Boolean(attachmentUpload) || !localAttachments}
                      onClick={() => void pickFiles()}
                    />
                  }
                >
                  <Plus aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>
                  {localAttachments
                    ? `Attach files · ${formatShortcut(COMPOSER_SHORTCUT_KEYS.attach)}`
                    : "Attachments unavailable for remote servers"}
                </TooltipContent>
              </Tooltip>
              {mode === "shell" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        size="composer"
                        variant="secondary"
                        className="gap-1 px-2"
                        aria-label="Exit shell mode"
                        data-palot-composer-shell-chip
                        onClick={() => setComposerMode("normal")}
                      />
                    }
                  >
                    <SquareTerminal className="shrink-0" aria-hidden="true" />
                    Shell
                    <X className="shrink-0" aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {`Exit shell mode · Esc or ${formatShortcut(COMPOSER_SHORTCUT_KEYS["normal-mode"])}`}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <AgentSelector
                session={displayedSession}
                agents={agents}
                defaultAgent={defaultAgent}
                loading={agentCatalogQuery.isFetching}
                open={activeMenu === "agent"}
                onOpenChange={handleAgentOpenChange}
                onSelectionComplete={focusComposer}
                onSelectAgent={composerSelection.selectAgent}
                disabled={sending || composerSelection.busy}
              />
              <ApprovalSelector
                key={JSON.stringify([runtime?.connectionID, draftScope])}
                mode={permissionSelection.mode}
                busy={permissionSelection.busy}
                disabled={sending || composerSelection.busy || !runtime?.connected}
                open={activeMenu === "approvals"}
                onOpenChange={handleApprovalsOpenChange}
                onSelect={permissionSelection.select}
                onSelectionComplete={focusComposer}
              />
              <div
                className="ml-auto flex min-w-0 max-w-full items-center gap-1.5"
                data-palot-composer-run-controls
              >
                <ModelSelector
                  session={displayedSession}
                  models={pickerModels}
                  catalogModels={catalog.models}
                  defaultModel={catalog.defaultModel}
                  providers={catalog.providers}
                  open={activeMenu === "model"}
                  onOpenChange={handleModelOpenChange}
                  onSelectionComplete={focusComposer}
                  onSelectModel={composerSelection.selectModel}
                  onSelectVariant={composerSelection.selectVariant}
                  disabled={sending || composerSelection.busy}
                />
                {onCreateSession ? null : (
                  <ContextIndicator
                    usage={context}
                    totalProcessed={tokenTotal(session.tokens)}
                    onClick={openContext}
                  />
                )}
                {isWorking && !canSubmit ? (
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    className="rounded-full"
                    aria-label="Stop task"
                    onClick={() => void palot.interrupt(session.id)}
                  >
                    <Square className="size-3.5 fill-current" aria-hidden="true" />
                  </InputGroupButton>
                ) : isWorking && mode === "normal" ? (
                  <div className="flex items-center overflow-hidden rounded-full">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <InputGroupButton
                            type="button"
                            size="sm"
                            className="h-7 rounded-r-none rounded-l-full bg-primary px-2.5 text-primary-foreground hover:bg-primary/90"
                            aria-label={
                              composerDelivery === "queue"
                                ? "Queue message after current turn"
                                : "Steer current turn"
                            }
                            disabled={!canSubmit}
                            onClick={() => void submit()}
                          />
                        }
                      >
                        {sending ? (
                          <Spinner aria-hidden="true" />
                        ) : composerDelivery === "queue" ? (
                          <Clock3 aria-hidden="true" />
                        ) : (
                          <Zap aria-hidden="true" />
                        )}
                        {composerDelivery === "queue" ? "Queue" : "Steer"}
                      </TooltipTrigger>
                      <TooltipContent>
                        {composerDelivery === "queue"
                          ? "Queue after current turn"
                          : `Steer current turn · ${formatCommandShortcut(["Meta", "Enter"])}`}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <InputGroupButton
                            type="button"
                            size="icon-sm"
                            className="w-5 rounded-r-full rounded-l-none border-l border-primary-foreground/20 bg-primary px-0 text-primary-foreground hover:bg-primary/90"
                            aria-label="Choose message delivery"
                            disabled={!canSubmit || sending}
                          />
                        }
                      >
                        <ChevronDown className="size-3" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-64">
                        <DropdownMenuRadioGroup
                          value={composerDelivery}
                          onValueChange={(value) =>
                            updateComposerDelivery(value as ComposerDelivery)
                          }
                        >
                          <DropdownMenuRadioItem value="queue">
                            <Clock3 aria-hidden="true" />
                            Queue after current turn
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="steer">
                            <Zap aria-hidden="true" />
                            Steer current turn
                            <DropdownMenuShortcut>
                              {formatCommandShortcut(["Meta", "Enter"])}
                            </DropdownMenuShortcut>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : (
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    aria-label={mode === "shell" ? "Run shell command" : "Send message"}
                    disabled={!canSubmit}
                    onClick={() => void submit()}
                  >
                    {sending ? <Spinner aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
                  </InputGroupButton>
                )}
              </div>
            </InputGroupAddon>
          )}
        </InputGroup>
        {contextBar ? (
          <div
            className={cn(
              "palot-composer-context relative isolate flex items-center",
              contextBarMode === "compact"
                ? "palot-composer-context-compact z-0 mx-[22px] -mt-4 min-h-12 items-end overflow-hidden rounded-b-[16px] border-0 px-3 pt-4 pb-1"
                : "min-h-12 border-t border-foreground/10 px-4 py-2",
            )}
          >
            <SurfaceBackdrop tone="composer" />
            {contextBar}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const Composer = memo(ComposerView, sameComposerProps);

function sameComposerProps(previous: ComposerProps, next: ComposerProps): boolean {
  return (
    sameComposerSession(previous.session, next.session) &&
    sameComposerMessages(previous.messages, next.messages) &&
    previous.isWorking === next.isWorking &&
    previous.onMessageAdmitted === next.onMessageAdmitted &&
    previous.onModelsChange === next.onModelsChange &&
    previous.onCreateSession === next.onCreateSession &&
    previous.onCreateSessionError === next.onCreateSessionError &&
    previous.contextBar === next.contextBar &&
    previous.contextBarMode === next.contextBarMode &&
    previous.pendingInputs === next.pendingInputs &&
    previous.backgroundWork === next.backgroundWork &&
    previous.requestBody === next.requestBody &&
    previous.onNavigateToNewTask === next.onNavigateToNewTask
  );
}

function sameComposerSession(left: PalotSession, right: PalotSession): boolean {
  return (
    left.id === right.id &&
    left.parentID === right.parentID &&
    left.projectID === right.projectID &&
    left.agent === right.agent &&
    left.permissions === right.permissions &&
    left.model?.id === right.model?.id &&
    left.model?.providerID === right.model?.providerID &&
    left.model?.variant === right.model?.variant &&
    left.location.directory === right.location.directory &&
    left.location.workspaceID === right.location.workspaceID &&
    left.revert?.messageID === right.revert?.messageID &&
    tokenTotal(left.tokens) === tokenTotal(right.tokens)
  );
}

function sameComposerMessages(left: PalotMessage[], right: PalotMessage[]): boolean {
  if (left === right) return true;
  const leftUsers = left.filter((message) => message.type === "user");
  const rightUsers = right.filter((message) => message.type === "user");
  if (
    leftUsers.length !== rightUsers.length ||
    leftUsers.some((message, index) => message !== rightUsers[index])
  ) {
    return false;
  }
  // Shell history only needs new commands; streaming output must not re-render the composer.
  const leftShellIDs = left.filter((message) => message.type === "shell").map(({ id }) => id);
  const rightShellIDs = right.filter((message) => message.type === "shell").map(({ id }) => id);
  if (
    leftShellIDs.length !== rightShellIDs.length ||
    leftShellIDs.some((id, index) => id !== rightShellIDs[index])
  ) {
    return false;
  }
  const leftContext = lastContextMessage(left);
  const rightContext = lastContextMessage(right);
  return (
    tokenTotal(leftContext?.tokens ?? EMPTY_TOKENS) ===
      tokenTotal(rightContext?.tokens ?? EMPTY_TOKENS) &&
    leftContext?.model?.id === rightContext?.model?.id &&
    leftContext?.model?.providerID === rightContext?.model?.providerID
  );
}

const EMPTY_TOKENS: PalotSession["tokens"] = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

function lastContextMessage(messages: PalotMessage[]): PalotMessage | undefined {
  return messages.findLast(
    (message) => message.type === "assistant" && tokenTotal(message.tokens ?? EMPTY_TOKENS) > 0,
  );
}

export const PendingInputTaskbarItem = memo(function PendingInputTaskbarItem({
  sessionID,
  request,
  files,
  editDisabled = false,
  onEdit,
  queuedPosition,
  queuedCount,
}: {
  sessionID: string;
  request: PendingRequestView;
  files?: PalotFileAttachment[];
  editDisabled?: boolean;
  onEdit?(request: PendingRequestView): Promise<void> | void;
  queuedPosition?: number;
  queuedCount: number;
}) {
  const [attentionTarget, setAttentionTarget] = useAtom(attentionTargetAtom);
  const [defaultDelivery, setDefaultDelivery] = useAtom(defaultDeliveryAtom);
  const [responding, setResponding] = useState(false);
  const delivery = request.delivery ?? "steer";
  const attachmentLabel = files?.length
    ? `${files[0]!.name}${files.length > 1 ? ` (+${files.length - 1} more)` : ""}`
    : "Pending message";
  const detail = request.detail?.trim() ? request.detail : attachmentLabel;
  const status =
    delivery === "queue" && queuedCount > 1 && queuedPosition
      ? `Queued · ${queuedPosition}`
      : delivery === "queue"
        ? "Queued"
        : "Steering";

  useEffect(() => {
    if (
      attentionTarget?.sessionID !== sessionID ||
      attentionTarget.type !== "input" ||
      attentionTarget.requestID !== request.id
    ) {
      return;
    }
    const element = document.querySelector<HTMLElement>(
      `[data-palot-request-id="${CSS.escape(request.id)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    element.querySelector<HTMLElement>("button")?.focus();
    setAttentionTarget(null);
  }, [attentionTarget, request.id, sessionID, setAttentionTarget]);

  async function update(action: "steer" | "queue" | "cancel" | "edit") {
    setResponding(true);
    try {
      if (action === "edit") {
        await onEdit?.(request);
        return;
      }
      await palot.updatePending({ sessionID, inputID: request.id, action });
    } catch (error) {
      showErrorToast("Could not update pending message", error);
    } finally {
      setResponding(false);
    }
  }

  return (
    <div
      className="flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-meta leading-none text-muted-foreground hover:bg-foreground/4"
      role="region"
      data-palot-request-id={request.id}
      aria-label={`Pending message actions: ${detail}`}
      aria-busy={responding}
    >
      <span className="flex shrink-0 items-center gap-1 font-medium text-foreground/70">
        {responding ? (
          <Spinner className="size-3" aria-hidden="true" />
        ) : delivery === "queue" ? (
          <Clock3 className="size-3" aria-hidden="true" />
        ) : (
          <Zap className="size-3" aria-hidden="true" />
        )}
        {status}
      </span>
      <span className="min-w-0 flex-1 truncate" title={detail}>
        {detail}
      </span>
      <button
        type="button"
        className="shrink-0 rounded-md px-1.5 py-1 font-medium text-foreground/65 hover:bg-foreground/6 hover:text-foreground"
        aria-label={delivery === "queue" ? "Steer next" : "Run after current turn"}
        disabled={responding}
        onClick={() => void update(delivery === "queue" ? "steer" : "queue")}
      >
        {delivery === "queue" ? "Steer" : "Queue"}
      </button>
      <button
        type="button"
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
        aria-label="Cancel pending message"
        title="Cancel pending message"
        disabled={responding}
        onClick={() => void update("cancel")}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
              aria-label="More pending message actions"
              disabled={responding}
            />
          }
        >
          <Ellipsis className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={4} className="w-44">
          <DropdownMenuItem disabled={editDisabled || !onEdit} onClick={() => void update("edit")}>
            <Pencil aria-hidden="true" />
            Cancel and edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void update("cancel")}>
            <Trash2 aria-hidden="true" />
            Cancel pending message
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDefaultDelivery(defaultDelivery === "queue" ? "steer" : "queue")}
            title="Changes future messages only"
          >
            {defaultDelivery === "queue" ? (
              <Zap aria-hidden="true" />
            ) : (
              <Clock3 aria-hidden="true" />
            )}
            {defaultDelivery === "queue" ? "Turn off queueing" : "Turn on queueing"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

const ContextIndicator = memo(function ContextIndicator({
  usage,
  totalProcessed,
  onClick,
}: {
  usage: ReturnType<typeof getContextUsage>;
  totalProcessed: number;
  onClick(): void;
}) {
  const percentage = usage?.percentage ?? null;
  const visualPercentage = Math.min(100, Math.max(0, percentage ?? 0));
  const status =
    percentage === null
      ? "unavailable"
      : percentage >= 90
        ? "critical"
        : percentage >= 70
          ? "warning"
          : "normal";
  const label = percentage === null ? "Open Context tab" : `Open Context tab, ${percentage}% used`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            type="button"
            size="icon-sm"
            className="palot-context-trigger rounded-full"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <svg
          viewBox="0 0 20 20"
          data-status={status}
          className="-rotate-90 data-[status=critical]:text-destructive data-[status=normal]:text-foreground data-[status=warning]:text-amber-500 dark:data-[status=warning]:text-amber-400"
          aria-hidden="true"
        >
          <circle
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-muted"
          />
          <circle
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - visualPercentage}
            className="transition-[stroke-dashoffset]"
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent>
        {usage
          ? `${percentage ?? "?"}% used · ${formatTokens(usage.total)} latest · ${formatTokens(totalProcessed)} total`
          : `Context details · ${formatTokens(totalProcessed)} tokens processed`}
      </TooltipContent>
    </Tooltip>
  );
});

const ModelSelector = memo(function ModelSelector({
  session,
  models,
  catalogModels,
  defaultModel,
  providers,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectModel,
  onSelectVariant,
  disabled,
}: {
  session: PalotSession;
  models: PalotModel[];
  catalogModels: PalotModel[];
  defaultModel: PalotModel | null;
  providers: PalotProvider[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectionComplete(): void;
  onSelectModel(model: ModelRef): Promise<void>;
  onSelectVariant(model: ModelRef): Promise<void>;
  disabled: boolean;
}) {
  const [switching, setSwitching] = useState(false);
  const selection = resolveModelSelection(catalogModels, session.model, defaultModel);
  const selectedRef = selection.ref;
  const selected = selection.model;
  const usesDefault = selection.usesDefault;
  const unavailable = session.model !== null && selected === null;
  const label = selected?.name ?? selectedRef?.id ?? "Choose model";
  const variant = session.model?.variant;
  const effort =
    selected && selected.variants.length > 0
      ? variant && variant !== "default"
        ? sentenceCase(variant)
        : "Auto"
      : null;
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );

  async function selectModel(model: PalotModel) {
    if (switching || disabled) return;
    const next = {
      id: model.id,
      providerID: model.providerID,
    };
    setSwitching(true);
    try {
      await onSelectModel(next);
      onOpenChange(false);
      onSelectionComplete();
    } catch (error) {
      showErrorToast("Could not switch models", error);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <InputGroupButton
                  type="button"
                  size="composer"
                  className="palot-model-trigger min-w-0 max-w-64 shrink gap-1.5 px-2"
                  aria-label={`Model: ${label}${unavailable ? ", unavailable" : ""}`}
                  aria-description={effort ? `Reasoning: ${effort}` : undefined}
                  disabled={switching || disabled}
                />
              }
            />
          }
        >
          <span className="truncate" data-palot-model-name>
            {label}
          </span>
          {unavailable || usesDefault ? (
            <span className="shrink-0 text-muted-foreground" data-palot-model-detail-label>
              {unavailable ? "Unavailable" : "Default"}
            </span>
          ) : null}
          {effort && (
            <span className="shrink-0 text-muted-foreground" data-palot-model-effort>
              {effort}
            </span>
          )}
          <ChevronDown className="shrink-0" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>
          {`Choose model · ${formatShortcut(COMPOSER_SHORTCUT_KEYS.model)}`}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        className="palot-model-picker w-[min(420px,calc(100vw-24px))] gap-3 p-2.5"
      >
        <PopoverHeader className="px-1">
          <PopoverTitle>Model and reasoning</PopoverTitle>
          <PopoverDescription>
            {unavailable
              ? "This task's selected model is no longer available. Choose another model to continue."
              : usesDefault
                ? "Using the default model configured for this project."
                : "Choose the model used by this task."}
          </PopoverDescription>
        </PopoverHeader>
        <ReasoningOptions
          session={session}
          models={catalogModels}
          defaultModel={defaultModel}
          onOpenChange={onOpenChange}
          onSelectionComplete={onSelectionComplete}
          onSelectModel={onSelectVariant}
          disabled={disabled || switching}
        />
        <Command loop label="Choose model" className="max-h-[340px] bg-transparent p-0">
          <CommandInput placeholder="Search models..." aria-label="Search models" />
          <CommandList data-palot-model-list>
            <CommandEmpty>No models found.</CommandEmpty>
            {unavailable && selectedRef ? (
              <CommandGroup heading="Current task" className="py-1">
                <CommandItem
                  disabled
                  value={`${selectedRef.providerID} ${selectedRef.id} unavailable`}
                >
                  <span className="min-w-0 flex-1 truncate">{selectedRef.id}</span>
                  <span className="text-micro text-muted-foreground">Unavailable</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Available" className="py-1">
              {models.map((model) => (
                <CommandItem
                  key={`${model.providerID}:${model.id}`}
                  value={`${model.name} ${model.id} ${model.providerID} ${providerNames.get(model.providerID) ?? ""}`}
                  disabled={switching || disabled}
                  data-palot-model-option
                  data-checked={
                    selected?.id === model.id && selected.providerID === model.providerID
                  }
                  onSelect={() => {
                    void selectModel(model);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {model.name}
                    <span className="ml-1.5 text-micro text-muted-foreground">
                      {providerNames.get(model.providerID) ?? model.providerID}
                    </span>
                  </span>
                  {modelMatchesRef(model, session.model) ? (
                    <span className="text-micro text-muted-foreground">Current</span>
                  ) : modelMatchesRef(model, defaultModel) ? (
                    <span className="text-micro text-muted-foreground">Default</span>
                  ) : null}
                  <span className="text-micro text-muted-foreground tabular-nums">
                    {Math.round(model.contextLimit / 1_000)}K
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

const AgentSelector = memo(function AgentSelector({
  session,
  agents,
  defaultAgent,
  loading,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectAgent,
  disabled,
}: {
  session: PalotSession;
  agents: PalotAgent[];
  defaultAgent: PalotAgent | null;
  loading: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectionComplete(): void;
  onSelectAgent(agent: PalotAgent): Promise<void>;
  disabled: boolean;
}) {
  const [switching, setSwitching] = useState(false);
  const available = primaryAgents(agents);
  const selected = available.find((agent) => agent.id === session.agent) ?? null;
  // Without an explicit agent, OpenCode runs its default agent; show that agent by name.
  const label = selected?.name ?? session.agent ?? defaultAgent?.name ?? "Default";
  const implicitDefault = !session.agent && defaultAgent !== null;
  const shortcuts = `${formatShortcut(COMPOSER_SHORTCUT_KEYS["agent-next"])} / ${formatShortcut(COMPOSER_SHORTCUT_KEYS["agent-previous"])}`;

  async function selectAgent(agent: PalotAgent) {
    if (switching || disabled) return;
    setSwitching(true);
    try {
      await onSelectAgent(agent);
      onOpenChange(false);
      onSelectionComplete();
    } catch (error) {
      showErrorToast("Could not switch agents", error);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <InputGroupButton
                  type="button"
                  size="composer"
                  className="max-w-40 gap-1 px-2"
                  aria-label={`Agent: ${label}${implicitDefault ? " (default)" : ""}`}
                  disabled={switching || disabled}
                />
              }
            />
          }
        >
          <Bot className="shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
          <ChevronDown className="shrink-0" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{`Switch agent · ${shortcuts}`}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        className="w-[min(360px,calc(100vw-24px))] gap-3 p-2.5"
      >
        <PopoverHeader className="px-1">
          <PopoverTitle>Agent</PopoverTitle>
          <PopoverDescription>Choose the primary agent used by this task.</PopoverDescription>
        </PopoverHeader>
        <Command loop label="Choose agent" className="max-h-[300px] bg-transparent p-0">
          <CommandInput placeholder="Search agents..." aria-label="Search agents" />
          <CommandList>
            <CommandEmpty>
              {loading ? "Loading agents..." : "No primary agents found."}
            </CommandEmpty>
            <CommandGroup heading="Available" className="py-1">
              {available.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.name} ${agent.id} ${agent.description ?? ""}`}
                  disabled={switching || disabled}
                  data-checked={agent.id === session.agent}
                  onSelect={() => void selectAgent(agent)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {agent.name}
                    {agent.description ? (
                      <span className="ml-1.5 text-micro text-muted-foreground">
                        {agent.description}
                      </span>
                    ) : null}
                  </span>
                  {agent.id === session.agent ? (
                    <span className="text-micro text-muted-foreground">Current</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

const ReasoningOptions = memo(function ReasoningOptions({
  session,
  models,
  defaultModel,
  onOpenChange,
  onSelectionComplete,
  onSelectModel,
  disabled,
}: {
  session: PalotSession;
  models: PalotModel[];
  defaultModel: PalotModel | null;
  onOpenChange(open: boolean): void;
  onSelectionComplete(): void;
  onSelectModel(model: ModelRef): Promise<void>;
  disabled: boolean;
}) {
  const [switching, setSwitching] = useState(false);
  const selected = resolveModelSelection(models, session.model, defaultModel).model;
  if (!selected || selected.variants.length === 0) return null;
  const selectedModel = selected;

  const selectedVariant = session.model?.variant === "default" ? undefined : session.model?.variant;

  async function selectVariant(variant: string | undefined) {
    if (switching || disabled) return;
    const next = {
      id: selectedModel.id,
      providerID: selectedModel.providerID,
      ...(variant ? { variant } : {}),
    };
    setSwitching(true);
    try {
      await onSelectModel(next);
      onOpenChange(false);
      onSelectionComplete();
    } catch (error) {
      showErrorToast("Could not change reasoning effort", error);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="grid gap-2 border-b pb-3 px-1">
      <p className="text-compact font-medium">Reasoning effort</p>
      <ToggleGroup
        value={[selectedVariant ?? "model-default"]}
        spacing={1}
        className="flex-wrap justify-start"
        aria-label="Reasoning effort"
        onValueChange={(value) => {
          const variant = value[0];
          if (variant) void selectVariant(variant === "model-default" ? undefined : variant);
        }}
      >
        <ToggleGroupItem
          value="model-default"
          size="sm"
          variant="outline"
          disabled={switching || disabled}
        >
          Auto
        </ToggleGroupItem>
        {selectedModel.variants.map((variant) => (
          <ToggleGroupItem
            key={variant}
            value={variant}
            size="sm"
            variant="outline"
            disabled={switching || disabled}
            data-palot-model-variant
          >
            {sentenceCase(variant)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
});
