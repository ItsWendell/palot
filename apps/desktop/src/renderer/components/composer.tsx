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
  Trash2,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  PalotFileAttachment,
  PalotAgent,
  PalotMessage,
  PalotModel,
  PalotModelCatalog,
  PalotProvider,
  PalotSession,
} from "../../shared";
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
import { composerStateAtomFamily } from "../atoms/composer-state";
import { composerScope } from "../lib/composer-scope";
import {
  messagesForProfileAtom,
  runtimeAtom,
  type SessionExecutionState,
} from "../atoms/workspace";
import { attentionTargetAtom } from "../atoms/attention";
import { useComposerCatalog, useWorkspaceFileSearch } from "../hooks/use-composer-discovery";
import { useModelCatalog } from "../hooks/use-model-catalog";
import { useComposerSelection } from "../hooks/use-composer-selection";
import { useComposerPermissions } from "../hooks/use-composer-permissions";
import { useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import { useCacheSession } from "../hooks/use-session-catalog";
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
import { detectComposerQuery } from "../lib/composer-query";
import { composerDraftFromMessage } from "../lib/composer-restoration";
import { formatCommandShortcut } from "../lib/global-commands";
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
import type { PendingRequestView } from "../lib/view-models";
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

  // Only retire the exact contents submitted. Typing and navigation can continue during dispatch.
  function clearSubmittedContents() {
    const current = store.get(stateAtom);
    if (activePendingInputEdit) {
      if (current.edit === activePendingInputEdit) {
        setComposerState((value) => ({ ...value, edit: null }));
      }
    } else if (store.get(draftAtom) === draft && current.files === files) {
      setOriginalDraft(emptyComposerDraft());
      setComposerState((value) => ({ ...value, files: [] }));
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
  const setMessages = useSetAtom(messagesForProfileAtom(runtime?.profileID ?? "unscoped"));
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [isComposing, setIsComposing] = useState(false);
  const [discoverySelection, setDiscoverySelection] = useState({ key: "", index: 0 });
  const [pendingBackgroundSteer, setPendingBackgroundSteer] =
    useState<PendingBackgroundSteer | null>(null);
  const [backgroundSteerPrompt, setBackgroundSteerPrompt] =
    useState<BackgroundSteerPromptState | null>(null);
  const [backgroundingSteer, setBackgroundingSteer] = useState(false);
  const [activeMenu, setActiveMenu] = useState<"agent" | "model" | "approvals" | null>(null);
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
    Boolean(onCreateSession) || activeMenu === "agent",
  );
  const catalog = modelCatalogQuery.data ?? EMPTY_MODEL_CATALOG;
  const preferenceScope = modelProjectPreferenceKey(
    runtime?.profileID ?? "disconnected",
    session.projectID,
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
  const composerSelection = useComposerSelection({
    session,
    draft: Boolean(onCreateSession),
    draftScope,
    agents: agentCatalogQuery.data?.agents ?? EMPTY_AGENTS,
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
    catalogsReady: Boolean(
      modelCatalogQuery.data &&
      agentCatalogQuery.data &&
      !modelCatalogQuery.error &&
      !agentCatalogQuery.error &&
      !agentCatalogQuery.data.errors.some((error) => error.capability === "agents"),
    ),
  });
  const displayedSession = composerSelection.session;
  const activeQuery = useMemo(
    () => detectComposerQuery(draft.text, selection.start, selection.end, { isComposing }),
    [draft.text, isComposing, selection.end, selection.start],
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
      return discoveryCatalog.commands
        .filter(
          (command) =>
            command.name.toLowerCase().includes(query) ||
            command.description?.toLowerCase().includes(query),
        )
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
    return fileResults.map((path) => ({
      kind: "file" as const,
      key: `file:${path}`,
      path,
      name: basename(path),
    }));
  }, [activeQuery, deferredQuery, discoveryCatalog.commands, discoveryCatalog.skills, fileResults]);
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
          files: message.files ?? [],
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

  async function submit(deliveryOverride?: ComposerDelivery) {
    const submission = projectComposerSubmission(draft);
    const value = submission.text;
    const currentState = store.get(stateAtom);
    if (
      (!value.trim() && files.length === 0 && submission.skills.length === 0) ||
      currentState.sending ||
      currentState.cancelingID ||
      composerSelection.blocked ||
      permissionSelection.isBusy()
    )
      return;
    if (submission.kind === "command" && files.length > 0) {
      setAttachmentErrors(["Remove picked attachments before running a slash command."]);
      return;
    }
    setAttachmentErrors([]);

    if (submission.kind === "command") {
      const commandName = submission.command.toLowerCase();
      if (commandName === "compact") {
        try {
          setSending(true);
          await palot.compactSession(session.id);
          clearSubmittedContents();
        } catch (error) {
          setAttachmentErrors([error instanceof Error ? error.message : "Compaction failed"]);
        } finally {
          setSending(false);
        }
        return;
      }
      if (commandName === "new" || commandName === "clear") {
        clearSubmittedContents();
        if (!onCreateSession) onNavigateToNewTask?.();
        return;
      }
      if (commandName === "model") {
        clearSubmittedContents();
        const arg = submission.arguments?.trim().toLowerCase();
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
            return;
          }
        }
        setActiveMenu("model");
        return;
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
            return;
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
            setDraft(composerDraftWithRetainedFiles(target));
            setFiles(target.files ?? []);
          } catch (error) {
            if (activeDraftScopeRef.current === draftScope) {
              setAttachmentErrors([error instanceof Error ? error.message : "Revert failed"]);
            }
          } finally {
            setSending(false);
          }
        } else {
          setDraft(emptyComposerDraft());
        }
        return;
      }
      if (commandName === "redo") {
        if (!session.revert) {
          setDraft(emptyComposerDraft());
          return;
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
          setDraft(target ? composerDraftWithRetainedFiles(target) : emptyComposerDraft());
          setFiles(target?.files ?? []);
        } catch (error) {
          if (activeDraftScopeRef.current === draftScope) {
            setAttachmentErrors([error instanceof Error ? error.message : "Redo failed"]);
          }
        } finally {
          setSending(false);
        }
        return;
      }
      if (commandName === "restore") {
        if (!session.revert) {
          setDraft(emptyComposerDraft());
          return;
        }
        try {
          setSending(true);
          const updated = await palot.clearSessionRevert(session.id);
          if (updated) cacheSession(updated);
          setDraft(emptyComposerDraft());
          setFiles([]);
        } catch (error) {
          setAttachmentErrors([error instanceof Error ? error.message : "Restore failed"]);
        } finally {
          setSending(false);
        }
        return;
      }
    }

    const effectiveDelivery =
      isWorking && !onCreateSession ? (deliveryOverride ?? composerDelivery) : "steer";
    const submittedFiles = files;
    const previousExecution = new Map<string, SessionExecutionState | undefined>();
    await admitComposerSubmission({
      submission,
      files: submittedFiles,
      delivery: effectiveDelivery,
      optimistic: submission.kind !== "command",
      createTarget: async () => {
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
      },
      dispatch: (sessionID, messageID) => {
        composerSelection.assertConnection();
        return submission.kind === "command"
          ? palot.runCommand({
              sessionID,
              command: submission.command,
              ...(submission.arguments ? { arguments: submission.arguments } : {}),
              ...(submission.files.length ? { fileReferences: submission.files } : {}),
              ...(submission.skills.length ? { skillReferences: submission.skills } : {}),
              delivery: effectiveDelivery,
            })
          : palot.sendComposerPrompt({
              sessionID,
              id: messageID,
              text: value,
              ...(submittedFiles.length ? { files: submittedFiles } : {}),
              ...(submission.files.length ? { fileReferences: submission.files } : {}),
              ...(submission.skills.length ? { skillReferences: submission.skills } : {}),
              delivery: effectiveDelivery,
            });
      },
      effects: {
        setSending,
        clearLocal: clearSubmittedContents,
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
        reportDispatchError: (error) =>
          setAttachmentErrors([
            error instanceof Error ? error.message : "Palot could not send the attachment.",
          ]),
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
    if (!freshQuery || freshQuery.kind !== item.kind) return;
    const selectionValue: ComposerDiscoverySelection =
      item.kind === "command"
        ? { kind: "command", name: item.name }
        : item.kind === "skill"
          ? { kind: "skill", id: item.id, localID: crypto.randomUUID() }
          : { kind: "file", path: item.path, localID: crypto.randomUUID() };
    const inserted = insertComposerSelection(draft, freshQuery, selectionValue);
    setDraft(inserted.draft);
    setSelection({ start: inserted.selectionStart, end: inserted.selectionEnd });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
    });
  }

  async function pickFiles() {
    if (!localAttachments) {
      setAttachmentErrors(["Local file attachments are unavailable for remote OpenCode servers."]);
      return;
    }
    try {
      const result = await palot.pickFiles(runtime?.connectionID);
      setAttachmentErrors(result.errors);
      if (result.files.length === 0) return;
      setFiles((current) => {
        const byUri = new Map(current.map((item) => [item.uri, item]));
        for (const item of result.files) byUri.set(item.uri, item);
        return [...byUri.values()];
      });
    } catch (error) {
      setAttachmentErrors([
        error instanceof Error ? error.message : "Palot could not attach the selected files.",
      ]);
    }
  }

  async function pasteImages(items: DataTransferItemList) {
    const connectionID = runtime?.connectionID;
    const images = Array.from(items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => {
        const file = item.getAsFile();
        return file ? [file] : [];
      });
    try {
      const result = await palot.attachClipboardImages(
        await Promise.all(
          images.map(async (image) => ({ mime: image.type, data: await image.arrayBuffer() })),
        ),
        connectionID,
      );
      setAttachmentErrors(result.errors);
      setFiles((current) => {
        const byUri = new Map(current.map((item) => [item.uri, item]));
        for (const item of result.files) byUri.set(item.uri, item);
        return [...byUri.values()];
      });
    } catch (error) {
      setAttachmentErrors([
        error instanceof Error ? error.message : "Palot could not paste the screenshot.",
      ]);
    }
  }

  const canSubmit =
    !composerSelection.blocked &&
    !permissionSelection.busy &&
    !requestBody &&
    (Boolean(draft.text.trim()) || files.length > 0) &&
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
          contextBarMode === "new-task" &&
            "overflow-hidden rounded-[22px] border border-foreground/12 bg-card transition-colors",
          unifiedFocus && "has-[[data-slot=input-group-control]:focus-visible]:border-ring",
        )}
      >
        <InputGroup
          className={cn(
            "palot-composer @container/composer relative isolate z-10 h-auto min-h-0 flex-col items-stretch overflow-hidden rounded-[22px] border-foreground/12 bg-card",
            unifiedFocus &&
              "rounded-none border-0 bg-transparent shadow-none ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0",
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
          {requestBody ? (
            <div data-palot-composer-request className="px-2 pt-1">
              {requestBody}
            </div>
          ) : (
            <InputGroupTextarea
              ref={composerRef}
              data-palot-composer-input
              aria-label="Message Palot"
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
              className="palot-native-scrollbar max-h-[clamp(3rem,25cqh,11rem)] min-h-[calc(2lh+--spacing(4))] flex-none resize-none overflow-y-auto overscroll-contain px-5 pt-3 pb-1"
              placeholder="Do anything"
              onChange={(event) => {
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
                      disabled={sending || !localAttachments}
                      onClick={() => void pickFiles()}
                    />
                  }
                >
                  <Plus aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>
                  {localAttachments ? "Attach files" : "Attachments unavailable for remote servers"}
                </TooltipContent>
              </Tooltip>
              <AgentSelector
                session={displayedSession}
                agents={agentCatalogQuery.data?.agents ?? []}
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
                ) : isWorking ? (
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
                    aria-label="Send message"
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
      </PopoverTrigger>
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
  loading,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectAgent,
  disabled,
}: {
  session: PalotSession;
  agents: PalotAgent[];
  loading: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectionComplete(): void;
  onSelectAgent(agent: PalotAgent): Promise<void>;
  disabled: boolean;
}) {
  const [switching, setSwitching] = useState(false);
  const available = agents.filter(
    (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
  );
  const selected = available.find((agent) => agent.id === session.agent) ?? null;
  const label = selected?.name ?? session.agent ?? "Default agent";
  const isDefaultAgent = !session.agent;

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
      <PopoverTrigger
        render={
          <InputGroupButton
            type="button"
            size="composer"
            className="max-w-40 gap-1 px-2"
            aria-label={`Agent: ${label}`}
            disabled={switching || disabled}
          />
        }
      >
        <Bot className="shrink-0" aria-hidden="true" />
        {isDefaultAgent ? null : <span className="truncate">{label}</span>}
        <ChevronDown className="shrink-0" aria-hidden="true" />
      </PopoverTrigger>
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
