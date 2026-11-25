/**
 * Standing context: what the task carries besides the message, shown as tabs on the card's top
 * edge with one panel open at a time. The thread builds the tabs from real state (goal, plan,
 * voice, undo staged); the composer places them and owns which one is open. Running work changes
 * often, so it comes as an atom only its tab and panel read, never as a prop of the composer.
 */

import { atom, useAtom, useAtomValue, type Atom, type PrimitiveAtom } from "jotai";
import { ListChecks, Mic, Target, Terminal, Undo2 } from "lucide-react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PalotMessage, PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { useCacheSession } from "../../hooks/use-session-catalog";
import { useSessionGoal } from "../../hooks/use-session-goal";
import { useVoiceCall } from "../../hooks/use-voice-call";
import type { SessionGoal } from "../../lib/session-goal";
import { showErrorToast } from "../../lib/toast-error";
import { formatRelativeTime } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { voiceCall } from "../../services/voice-call";
import { GoalPanel, PlanPanel, UndoStagedPanel, VoicePanel } from "../composer-dock/tab-panels";
import { ComposerTab, ComposerTabDetail, ComposerTabLabel, ComposerTabs } from "../ui/composer";
import type { PlanItemView } from "../composer-dock/types";
import { RunningWorkPanel, type RunningWork } from "../running-work-control";
import type { BackgroundWorkItem } from "../subagent-activity";
import type { AgentPlan, PlanItemStatus } from "../transcript/plan";
import { VoiceOrb } from "../voice/voice-call-ui";
import type { ComposerPanelSlot } from "./composer-card";

type StandingTabValue = "goal" | "plan" | "voice" | "undo" | "background";

/** The order tabs show in on the card's top edge. */
const TAB_ORDER: readonly StandingTabValue[] = ["voice", "goal", "plan", "background", "undo"];

/**
 * The task's running work as the thread last projected it: the items a blocked steer waits on,
 * and the running-work tab's data (null without a connection).
 */
export interface ComposerRunningWork {
  items: BackgroundWorkItem[];
  work: RunningWork | null;
}

/** Stable for the composer's life; only the running-work tab, its panel and a waiting steer read it. */
export type ComposerRunningWorkAtom = Atom<ComposerRunningWork>;

/** One tab on the card's top edge and the panel behind it. */
export interface ComposerStandingTab {
  value: StandingTabValue;
  icon: ReactNode;
  /** The part that never truncates ("Plan · 3/7"). */
  label: string;
  /** The part that may truncate (the plan's current step). */
  detail?: string;
  tone?: "default" | "live" | "warning";
  /** The panel's accessible name. */
  title: string;
  content: ReactNode;
  /**
   * Set once the context is finished ("Plan · done", "Goal met"), keyed so a new plan or goal
   * starts over. The tab leaves shortly after, unless its panel is open.
   */
  settled?: string | null;
}

/** How long a finished plan or met goal keeps its tab. */
export const STANDING_SETTLED_MS = 8_000;

// The open tab is per task and lives as long as the window; it is never persisted.
const openTabAtoms = new Map<string, PrimitiveAtom<StandingTabValue | null>>();

export function composerOpenTabAtom(sessionID: string): PrimitiveAtom<StandingTabValue | null> {
  let value = openTabAtoms.get(sessionID);
  if (!value) {
    value = atom<StandingTabValue | null>(null);
    openTabAtoms.set(sessionID, value);
  }
  return value;
}

/**
 * The tabs still shown: a settled tab leaves `STANDING_SETTLED_MS` after it settled, unless its
 * panel is open (it leaves when the panel closes).
 */
function useVisibleStanding(
  tabs: readonly ComposerStandingTab[],
  open: StandingTabValue | null,
): ComposerStandingTab[] {
  const settledKeys = tabs.flatMap((tab) => (tab.settled ? [`${tab.value}:${tab.settled}`] : []));
  const signature = settledKeys.join("\n");
  const [expired, setExpired] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!signature) return;
    const timer = window.setTimeout(
      () => setExpired((current) => new Set([...current, ...signature.split("\n")])),
      STANDING_SETTLED_MS,
    );
    return () => window.clearTimeout(timer);
  }, [signature]);
  return useMemo(
    () =>
      tabs.filter(
        (tab) => !tab.settled || tab.value === open || !expired.has(`${tab.value}:${tab.settled}`),
      ),
    [expired, open, tabs],
  );
}

const PLAN_STATUS: Record<PlanItemStatus, PlanItemView["status"]> = {
  pending: "pending",
  in_progress: "running",
  completed: "done",
  cancelled: "cancelled",
};

function planTab(plan: AgentPlan): ComposerStandingTab {
  return {
    value: "plan",
    icon: <ListChecks aria-hidden="true" />,
    label: plan.complete ? "Plan · done" : `Plan · ${plan.done}/${plan.total}`,
    detail: plan.complete ? undefined : plan.inProgress?.content,
    title: "Plan",
    settled: plan.complete ? plan.sourceID : null,
    content: (
      <PlanPanel
        data-palot-plan-card={plan.complete ? "complete" : "active"}
        items={plan.items.map((item) => ({ text: item.content, status: PLAN_STATUS[item.status] }))}
      />
    ),
  };
}

type GoalAction = "pause" | "resume" | "clear" | "edit";

const GOAL_FAILURE: Record<GoalAction, string> = {
  pause: "Could not pause the goal",
  resume: "Could not resume the goal",
  clear: "Could not clear the goal",
  edit: "Could not change the goal",
};

/** What the reviewer or pause said, labelled for the goal's state. */
function goalReasonLabel(goal: SessionGoal): string | null {
  if (!goal.reason) return null;
  return goal.status === "paused" ? `Paused: ${goal.reason}` : `Reviewer: ${goal.reason}`;
}

/**
 * The task's `/goal`. OpenCode runs the loop; the panel sends `/goal pause|resume|clear`, and
 * Edit sends `/goal <objective>`, which sets the goal again (OpenCode has no in-place update).
 */
function useGoalTab(session: PalotSession): ComposerStandingTab | null {
  const goal = useSessionGoal(session.id, session.location);
  const runtime = useAtomValue(runtimeAtom);
  const [pending, setPending] = useState<GoalAction | null>(null);
  const connectionID = runtime?.connectionID;
  return useMemo(() => {
    if (!goal) return null;
    const run = async (action: GoalAction, objective?: string): Promise<boolean> => {
      setPending(action);
      try {
        await palot.runCommand(
          { sessionID: session.id, command: "goal", arguments: objective ?? action },
          connectionID,
        );
        return true;
      } catch (error) {
        showErrorToast(GOAL_FAILURE[action], error);
        return false;
      } finally {
        setPending(null);
      }
    };
    // A running goal names its round already; a paused or met one says how many it took.
    const rounds = goal.status === "active" ? null : `${goal.rounds} of ${goal.maxRounds} rounds`;
    const reason = [goalReasonLabel(goal), rounds, `Updated ${formatRelativeTime(goal.updatedAt)}`]
      .filter(Boolean)
      .join(" · ");
    return {
      value: "goal",
      icon: <Target aria-hidden="true" />,
      label:
        goal.status === "complete"
          ? "Goal met"
          : goal.status === "paused"
            ? "Goal · paused"
            : goal.rounds > 0
              ? `Goal · round ${goal.rounds} of ${goal.maxRounds}`
              : "Goal",
      tone: goal.status === "paused" ? "warning" : "default",
      title: "Goal",
      settled: goal.status === "complete" ? String(goal.updatedAt) : null,
      content: (
        <GoalPanel
          data-palot-goal-card={goal.status}
          goal={{
            objective: goal.objective,
            status: goal.status,
            round: goal.rounds,
            rounds: goal.maxRounds,
            reason,
          }}
          busy={pending !== null}
          onPause={() => void run("pause")}
          onResume={() => void run("resume")}
          onClear={() => void run("clear")}
          onEdit={(objective) => run("edit", objective)}
        />
      ),
    } satisfies ComposerStandingTab;
  }, [connectionID, goal, pending, session.id]);
}

/** The last turns' changes staged by `/undo`, with Restore and Finalize undo. */
function useUndoTab(
  session: PalotSession,
  messages: readonly PalotMessage[],
): ComposerStandingTab | null {
  const cacheSession = useCacheSession();
  const [action, setAction] = useState<"restore" | "commit" | null>(null);
  const revert = session.revert;
  return useMemo(() => {
    if (!revert) return null;
    const boundary = messages.findIndex((message) => message.id === revert.messageID);
    const affected =
      boundary < 0
        ? 0
        : messages.slice(boundary).filter((message) => message.type === "user").length;
    const count = Math.max(1, affected);
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
    return {
      value: "undo",
      icon: <Undo2 aria-hidden="true" />,
      label: files.length
        ? `Undo staged · ${files.length} ${files.length === 1 ? "file" : "files"}`
        : "Undo staged",
      tone: "warning",
      title: "Undo staged",
      content: (
        <UndoStagedPanel
          aria-live="polite"
          files={files.map((file) => file.file)}
          description={
            <>
              {count} {count === 1 ? "message" : "messages"}
              {files.length
                ? ` and ${files.length} changed ${files.length === 1 ? "file" : "files"}`
                : ""}{" "}
              staged for undo
              {files.length ? (
                <span className="ms-1.5 font-mono text-micro tabular-nums">
                  <span className="text-success">+{additions}</span>{" "}
                  <span className="text-destructive">-{deletions}</span>
                </span>
              ) : null}
            </>
          }
          busy={action !== null}
          onRestore={() => void run("restore")}
          onFinalize={() => void run("commit")}
        />
      ),
    } satisfies ComposerStandingTab;
  }, [action, cacheSession, messages, revert, session.id]);
}

/** A voice chat in this task. The mic in the row stays the start and end control. */
function useVoiceTab(sessionID: string): ComposerStandingTab | null {
  const { snapshot } = useVoiceCall();
  return useMemo(() => {
    if (snapshot.phase === "idle" || snapshot.sessionID !== sessionID) return null;
    const status =
      snapshot.phase === "starting"
        ? "Starting voice chat"
        : snapshot.phase === "stopping"
          ? "Ending voice chat…"
          : (snapshot.status ?? undefined);
    return {
      value: "voice",
      icon: <Mic aria-hidden="true" />,
      label: "Voice · live",
      tone: "live",
      title: "Voice chat",
      content: (
        <VoicePanel
          data-palot-voice-stage
          orb={<VoiceOrb size={32} activity={snapshot.activity} />}
          voice={{
            phase: snapshot.activity,
            micMuted: snapshot.micMuted,
            outputMuted: snapshot.outputMuted,
            starting: snapshot.phase === "starting",
            ending: snapshot.phase === "stopping",
            status,
            caption: snapshot.outputMuted ? (snapshot.caption ?? undefined) : undefined,
          }}
          onToggleMute={() => voiceCall.toggleMicrophone()}
          onToggleOutput={() => voiceCall.toggleOutput()}
          onEnd={() => void voiceCall.end()}
        />
      ),
    } satisfies ComposerStandingTab;
  }, [sessionID, snapshot]);
}

/** The running-work tab; its panel (`RunningWorkTabPanel`) reads the atom itself. */
function backgroundTab(work: RunningWork): ComposerStandingTab {
  return {
    value: "background",
    icon: <Terminal aria-hidden="true" />,
    label: work.label,
    title: "Running work",
    content: null,
  };
}

/**
 * The task's standing context, in the order the tabs show. Each source returns a memoised tab,
 * so the list keeps its identity until one of them changes.
 */
export function useStandingTabs({
  session,
  messages,
  plan,
}: {
  session: PalotSession;
  /** Messages for the undo summary; content changes inside a message do not matter. */
  messages: readonly PalotMessage[];
  plan: AgentPlan | null;
}): ComposerStandingTab[] {
  const goal = useGoalTab(session);
  const undo = useUndoTab(session, messages);
  const voice = useVoiceTab(session.id);
  const planned = useMemo(() => (plan ? planTab(plan) : null), [plan]);
  return useMemo(
    () => [voice, goal, planned, undo].filter((tab): tab is ComposerStandingTab => tab !== null),
    [goal, planned, undo, voice],
  );
}

/** The running-work tab while there is work to show, built from the atom. */
function useRunningWorkTab(runningWork: ComposerRunningWorkAtom): ComposerStandingTab | null {
  const { work } = useAtomValue(runningWork);
  return useMemo(() => (work?.visible ? backgroundTab(work) : null), [work]);
}

const NO_RUNNING_WORK = atom<ComposerRunningWork>({ items: [], work: null });

/** The running-work panel, which follows the atom while it is open. */
function RunningWorkTabPanel({
  runningWork,
  onClose,
}: {
  runningWork: ComposerRunningWorkAtom;
  onClose(): void;
}) {
  const { work } = useAtomValue(runningWork);
  return work ? <RunningWorkPanel work={work} onClose={onClose} /> : null;
}

/**
 * The tabs on the card's top edge. `inactive` keeps them visible but unusable (a request). It
 * alone reads running work, so a change there renders the tabs and not the composer.
 */
const ComposerStandingTabs = memo(function ComposerStandingTabs({
  standing,
  runningWork,
  value,
  inactive,
  onValueChange,
}: {
  standing: readonly ComposerStandingTab[];
  runningWork: ComposerRunningWorkAtom;
  value: StandingTabValue | null;
  inactive: boolean;
  onValueChange(value: StandingTabValue | null): void;
}) {
  const background = useRunningWorkTab(runningWork);
  const tabs = useMemo(
    () =>
      (background ? [...standing, background] : standing).toSorted(
        (left, right) => TAB_ORDER.indexOf(left.value) - TAB_ORDER.indexOf(right.value),
      ),
    [background, standing],
  );
  // Running work that ended takes its open state with it, as any tab that leaves does.
  const backgroundGone = value === "background" && !background;
  useEffect(() => {
    if (backgroundGone) onValueChange(null);
  }, [backgroundGone, onValueChange]);
  if (tabs.length === 0) return null;
  return (
    <ComposerTabs
      value={value}
      inactive={inactive}
      onValueChange={(next) => onValueChange(next as StandingTabValue | null)}
    >
      {tabs.map((tab) => (
        <ComposerTab key={tab.value} value={tab.value} tone={tab.tone ?? "default"}>
          {tab.icon}
          <ComposerTabLabel>{tab.label}</ComposerTabLabel>
          {tab.detail ? <ComposerTabDetail>{tab.detail}</ComposerTabDetail> : null}
        </ComposerTab>
      ))}
    </ComposerTabs>
  );
});

/**
 * The tabs on the card's top edge and the tab panel they open. A request owns the panel slot
 * while it is open; the tabs then stay in view but cannot be used.
 */
export function useStandingSlots(
  sessionID: string,
  standing: readonly ComposerStandingTab[],
  requestOpen: boolean,
  runningWork: ComposerRunningWorkAtom = NO_RUNNING_WORK,
): { tabs: ReactNode; panel: ComposerPanelSlot | null } {
  const [openTab, setOpenTab] = useAtom(composerOpenTabAtom(sessionID));
  const tabs = useVisibleStanding(standing, openTab);
  // The running-work tab's presence is the tabs' to judge; they close it when it leaves.
  const background = openTab === "background";
  const open = background ? null : (tabs.find((tab) => tab.value === openTab) ?? null);
  // A tab that left takes its open state with it, so it does not reopen when it comes back.
  useEffect(() => {
    if (openTab !== null && !background && !open) setOpenTab(null);
  }, [background, open, openTab, setOpenTab]);
  const close = () => setOpenTab(null);
  return {
    tabs: (
      <ComposerStandingTabs
        standing={tabs}
        runningWork={runningWork}
        value={openTab}
        inactive={requestOpen}
        onValueChange={setOpenTab}
      />
    ),
    panel: requestOpen
      ? null
      : background
        ? {
            key: "tab:background",
            label: "Running work",
            content: <RunningWorkTabPanel runningWork={runningWork} onClose={close} />,
            onClose: close,
          }
        : open
          ? { key: `tab:${open.value}`, label: open.title, content: open.content, onClose: close }
          : null,
  };
}
