import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { AutomationDraft, PalotMessage } from "../../shared";
import { usageRangeAtom } from "../atoms/ui";
import { runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { useAutomations } from "../hooks/use-automations";
import { useSessionInbox } from "../hooks/use-session-inbox";
import { useTriageDispatcher } from "../hooks/use-auto-settle";
import { usageLimitFailure } from "../lib/usage-limits";
import { showErrorToast } from "../lib/toast-error";
import { Button } from "./ui/button";
import { toast } from "./ui/toast";

export function UsageLimitActions({ message }: { message: PalotMessage | undefined }) {
  const failure = usageLimitFailure(message);
  return failure ? (
    <UsageLimitActionsContent messageID={message!.id} resetsAt={failure.resetsAt} />
  ) : null;
}

function UsageLimitActionsContent({
  messageID,
  resetsAt,
}: {
  messageID: string;
  resetsAt: number | null;
}) {
  const sessionID = useAtomValue(selectedSessionIDAtom);
  const runtime = useAtomValue(runtimeAtom);
  const days = useAtomValue(usageRangeAtom);
  const navigate = useNavigate();
  const { dispatch, snapshot } = useAutomations();
  const inbox = useSessionInbox();
  const item = [...inbox.pinned, ...inbox.inbox, ...inbox.snoozed, ...inbox.settled].find(
    (item) => item.session.id === sessionID,
  );
  const dispatchTriage = useTriageDispatcher();
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [scheduledKey, setScheduledKey] = useState<string | null>(null);
  const key = `${runtime?.connectionID}:${sessionID}:${messageID}`;

  useEffect(() => {
    if (resetsAt === null || resetsAt <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), resetsAt - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [resetsAt]);

  const canSchedule = sessionID && resetsAt !== null && resetsAt > Math.max(now, Date.now());
  // Survives leaving the task: a continuation already saved for this reset counts as scheduled.
  const saved =
    resetsAt !== null &&
    Boolean(
      snapshot?.automations.some(
        (automation) =>
          automation.status === "active" &&
          automation.destination.type === "session" &&
          automation.destination.sessionID === sessionID &&
          automation.trigger.type === "once" &&
          automation.trigger.at === resetsAt + 60_000,
      ),
    );
  const scheduled = saved || scheduledKey === key;
  const schedule = async (snooze = false) => {
    const profileID = runtime?.profileID;
    if (
      !sessionID ||
      resetsAt === null ||
      resetsAt <= Date.now() ||
      pending ||
      (scheduled && !snooze) ||
      !profileID ||
      (snooze && !item)
    )
      return;
    const draft: AutomationDraft = {
      name: "Continue after usage limit",
      status: "active",
      action: {
        prompt: "Continue where you left off; the usage limit has reset.",
        agent: null,
        model: null,
        skills: [],
      },
      destination: { type: "session", sessionID },
      trigger: {
        version: 1,
        type: "once",
        at: resetsAt + 60_000,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      missedRuns: { type: "catch-up-once", maxAgeMs: 24 * 60 * 60_000 },
      notifications: "background-only",
      createdFromSessionID: sessionID,
    };
    setPending(true);
    let continuationSaved = scheduled;
    try {
      if (!scheduled) await dispatch({ type: "create", draft });
      continuationSaved = true;
      setScheduledKey(key);
      if (snooze && item)
        await dispatchTriage(profileID, {
          type: "snooze",
          sessionID,
          at: Date.now(),
          until: resetsAt,
          through: item.activityThrough,
        });
      toast.add({
        type: "success",
        title: snooze
          ? "Task snoozed until reset; continuation scheduled"
          : "Continuation scheduled",
        actionProps: { children: "Scheduled", onClick: () => void navigate({ to: "/scheduled" }) },
      });
    } catch (error) {
      showErrorToast(
        continuationSaved && snooze
          ? "Continuation scheduled, but could not snooze task"
          : "Could not schedule continuation",
        error,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {canSchedule ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || scheduled || !runtime?.profileID}
          onClick={() => void schedule()}
        >
          {scheduled ? "Continuation scheduled" : "Continue when it resets"}
        </Button>
      ) : null}
      {canSchedule ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !runtime?.profileID || !item || item.snoozedUntil === resetsAt}
          onClick={() => void schedule(true)}
        >
          {item?.snoozedUntil === resetsAt ? "Snoozed until reset" : "Snooze until reset"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void navigate({ to: "/usage", search: { days } })}
      >
        View usage
      </Button>
    </div>
  );
}
