/**
 * The request panel in the real app: the task's pending permissions, questions, forms and guest
 * messages (and its subagents'), one at a time in the order they arrived, in the composer's panel
 * slot. Replies go to the session that owns each request.
 *
 * Who owns the text field and the primary button follows `requestGuard`:
 * - a request that arrives while the user is typing (or within 1.5 s of a keystroke) does not
 *   answer on Enter until they pause;
 * - a draft that existed when the request arrived never becomes its feedback or answer: the
 *   panel then brings its own input and main action;
 * - Escape never approves and never denies;
 * - a request that has just come into view takes no click or key for a moment, so a second
 *   press meant for the previous one cannot answer it.
 */

import type { FormValue } from "@opencode/client";
import { useAtom } from "jotai";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { attentionTargetAtom } from "../../atoms/attention";
import type { OwnedPendingRequestView } from "../../lib/session-family-requests";
import { showErrorToast } from "../../lib/toast-error";
import type { PendingRequestView } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { requestGuard, type RequestGuard } from "../composer-dock/request-guard";
import { requestKeyAction, type RequestKeyAction } from "../composer-dock/request-keys";
import {
  EMPTY_ANSWER,
  RequestPanel,
  questionStepReady,
  requestFormId,
  requestTitle,
} from "../composer-dock/request-panel";
import type { QuestionAnswer, RequestView } from "../composer-dock/types";
import { LinkedText } from "../link-actions";
import { PermissionPreview } from "../permission-preview";
import {
  FormFieldControl,
  formSubmission,
  initialFormAnswers,
} from "../transcript/pending-requests";
import {
  Composer as ComposerSurface,
  ComposerDock,
  ComposerPanel,
  type ComposerPrimaryView,
} from "../ui/composer";

/** A pending request and, for a subagent's, the session that owns it. */
export type ComposerRequest = PendingRequestView &
  Partial<Pick<OwnedPendingRequestView, "sessionID" | "sessionTitle">>;

/** A guest's message waiting to be passed to the agent. */
interface ComposerGuestMessage {
  id: string;
  name: string;
  text: string;
  sending: boolean;
}

export interface ComposerGuests {
  messages: readonly ComposerGuestMessage[];
  busy: boolean;
  connected: boolean;
  approve(messageID: string): void;
  dismiss(messageID: string): void;
}

/**
 * The composer's text field as the request panel uses it. Absent where there is no composer
 * (a subagent task): the panel then always brings its own input.
 */
export interface RequestField {
  /** Whether the field holds a draft: text, attachments or comments. */
  hasDraft(): boolean;
  /** Whether the field holds text right now. */
  empty: boolean;
  text(): string;
  setText(text: string): void;
  focus(): void;
  /** When the last key was pressed in the field, or null. */
  lastKeystrokeAt(): number | null;
  /** The field's own suggestion list is open and takes Enter and the arrows. */
  suggestionsOpen(): boolean;
}

/** How long a request that has just come into view takes no click or key. */
export const REQUEST_SETTLE_MS = 500;
/** How long an answered request stays disabled while OpenCode has not yet removed it. */
const ANSWERED_HOLD_MS = 5_000;

interface Entry {
  key: string;
  /** The session the reply goes to (a subagent's, or `global` for location-wide MCP forms). */
  owner: string;
  view: RequestView;
  request: ComposerRequest | null;
  guest: ComposerGuestMessage | null;
}

interface Answers {
  answer?: QuestionAnswer;
  form?: Record<string, FormValue>;
  feedback?: string;
}

function permissionKind(request: PendingRequestView): "shell" | "edit" | "network" | "other" {
  const preview = request.permissionPreview;
  if (preview?.patch || preview?.file) return "edit";
  const title = request.title.toLowerCase();
  if (/\b(bash|shell|command|run)\b/.test(title)) return "shell";
  if (/\b(fetch|web|network|url)\b/.test(title)) return "network";
  if (/\b(edit|write|patch|file)\b/.test(title)) return "edit";
  return "other";
}

function requestView(
  request: ComposerRequest,
  owner: string,
  sessionID: string,
  agentOf: (sessionID: string) => string | null,
): RequestView {
  const source =
    owner !== sessionID && !request.locationDirectory
      ? (agentOf(owner) ?? request.sessionTitle ?? "a")
      : undefined;
  if (request.type === "permission") {
    return {
      kind: "permission",
      id: request.id,
      permission: permissionKind(request),
      title: request.title,
      // Every resource (`*`, as for a command OpenCode couldn't analyze) says less than the preview.
      subject:
        (request.resources.join("\n") === "*" ? request.permissionPreview?.subject : undefined) ||
        request.resources.join("\n") ||
        request.permissionPreview?.subject ||
        request.title,
      reason: request.detail,
      rule: request.savePatterns.join(", ") || undefined,
      source,
    };
  }
  if (request.type === "question") {
    return {
      kind: "question",
      id: request.id,
      steps: request.questions.map((question) => ({
        prompt: question.question,
        multiple: question.multiple,
        custom: question.custom,
        options: question.options.map((option) => ({
          label: option.label,
          description: option.description,
        })),
      })),
      source,
    };
  }
  return {
    kind: "form",
    id: request.id,
    title: request.title,
    server: request.locationDirectory ? "Server" : undefined,
    fields: [],
    source,
  };
}

/** What a question's answer sends: picked labels and the typed answer, per step. */
function questionReply(request: PendingRequestView, answer: QuestionAnswer) {
  return Object.fromEntries(
    request.questions.map((question, index) => {
      const picks = answer.choices[index] ?? [];
      const typed = answer.texts[index]?.trim();
      // A typed answer replaces a single pick; a multiple choice keeps both.
      const values = question.multiple
        ? [...picks, ...(typed ? [typed] : [])]
        : typed
          ? [typed]
          : picks.slice(0, 1);
      return [`q${index}`, question.multiple ? values : (values[0] ?? "")];
    }),
  );
}

function locationOf(request: PendingRequestView): { locationDirectory?: string } {
  return request.locationDirectory ? { locationDirectory: request.locationDirectory } : {};
}

/**
 * Orders the requests as they arrived. A request without a time keeps its place after the
 * timed ones; guest messages come last.
 */
function orderEntries(entries: Entry[]): Entry[] {
  const time = (entry: Entry) => entry.request?.createdAt ?? Number.POSITIVE_INFINITY;
  return entries
    .map((entry, index) => ({ entry, index }))
    .toSorted((left, right) => time(left.entry) - time(right.entry) || left.index - right.index)
    .map(({ entry }) => entry);
}

interface ComposerRequestsInput {
  /** The task the composer belongs to; requests without an owner are its own. */
  sessionID: string;
  requests: readonly ComposerRequest[];
  guests?: ComposerGuests | null;
  field: RequestField | null;
  /** A subagent's agent name for "From explore subagent". */
  agentOf?(sessionID: string): string | null;
  /** Sends the field's text as a message instead of as a permission's feedback. */
  sendInstead?: { label: string; run(): void } | null;
}

export interface RequestPrimary {
  view: ComposerPrimaryView;
  disabled: boolean;
  onPress(): void;
}

export function useComposerRequests({
  sessionID,
  requests,
  guests = null,
  field,
  agentOf = () => null,
  sendInstead = null,
}: ComposerRequestsInput) {
  const entries = useMemo(() => {
    const list: Entry[] = requests
      .filter((request) => request.type !== "input")
      .map((request) => {
        const owner = request.sessionID ?? sessionID;
        return {
          key: `${owner}:${request.type}:${request.id}`,
          owner,
          view: requestView(request, owner, sessionID, agentOf),
          request,
          guest: null,
        };
      });
    for (const message of guests?.messages ?? []) {
      list.push({
        key: `guest:${message.id}`,
        owner: sessionID,
        view: {
          kind: "guest",
          id: message.id,
          from: message.name,
          verified: false,
          text: message.text,
        },
        request: null,
        guest: message,
      });
    }
    return orderEntries(list);
    // `agentOf` names only; a new function each render must not rebuild the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests?.messages, requests, sessionID]);

  // Whether the field held a draft when each request arrived; recorded once, at first sight.
  const [arrivals] = useState(() => new Map<string, boolean>());
  for (const entry of entries) {
    if (!arrivals.has(entry.key)) arrivals.set(entry.key, field ? field.hasDraft() : true);
  }

  const [selected, setSelected] = useState<{ key: string; index: number } | null>(null);
  const foundIndex = selected ? entries.findIndex((entry) => entry.key === selected.key) : -1;
  const index =
    entries.length === 0
      ? -1
      : foundIndex >= 0
        ? foundIndex
        : Math.min(selected?.index ?? 0, entries.length - 1);
  const current = index >= 0 ? entries[index]! : null;
  const currentKey = current?.key ?? null;

  const [answers, setAnswers] = useState<Record<string, Answers>>({});
  const [responding, setResponding] = useState<ReadonlySet<string>>(() => new Set());
  const [answered, setAnswered] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const panelRef = useRef<HTMLElement>(null);
  const fieldRef = useRef(field);
  fieldRef.current = field;

  const draftAtArrival = currentKey ? (arrivals.get(currentKey) ?? true) : true;

  // Arms Enter once the typing has paused, and lets clicks in after the settle time.
  useLayoutEffect(() => {
    if (!currentKey) return;
    const shownAt = Date.now();
    let armTimer: number | undefined;
    const check = () => {
      const guard = requestGuard({
        shownAt,
        lastKeystrokeAt: fieldRef.current?.lastKeystrokeAt() ?? null,
        now: Date.now(),
        draftAtArrival: true,
      });
      if (guard.armed) setArmedKey(currentKey);
      else armTimer = window.setTimeout(check, Math.max(50, (guard.armsAt ?? 0) - Date.now()));
    };
    check();
    const settle = window.setTimeout(() => setSettledKey(currentKey), REQUEST_SETTLE_MS);
    return () => {
      window.clearTimeout(armTimer);
      window.clearTimeout(settle);
    };
  }, [currentKey]);

  // An answered request that OpenCode has not removed takes input again after a while.
  useEffect(() => {
    if (answered.size === 0) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setAnswered((current) => {
        const next = new Map([...current].filter(([, at]) => now - at < ANSWERED_HOLD_MS));
        return next.size === current.size ? current : next;
      });
    }, ANSWERED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [answered]);

  // The timer above decides `armed` (through `requestGuard`); the field's role is fixed at arrival.
  const role: RequestGuard["field"] = field && !draftAtArrival ? "feedback" : "message";
  const armed = current !== null && armedKey === currentKey;
  const guard = current ? { field: role, armed, ownsEnter: role === "feedback" && armed } : null;
  const settled = settledKey === currentKey;
  const busy = current
    ? responding.has(current.key) || answered.has(current.key) || (guests?.busy ?? false)
    : false;
  const waiting = !settled || busy;

  const [attentionTarget, setAttentionTarget] = useAtom(attentionTargetAtom);
  useEffect(() => {
    if (!attentionTarget || attentionTarget.type === "input") return;
    const target = entries.findIndex(
      (entry) =>
        entry.request !== null &&
        entry.owner === attentionTarget.sessionID &&
        entry.request.id === attentionTarget.requestID &&
        entry.request.type === attentionTarget.type,
    );
    if (target < 0) return;
    setSelected({ key: entries[target]!.key, index: target });
    setAttentionTarget(null);
    // The panel takes focus itself, never one of its buttons, so a key cannot answer it.
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: false }));
  }, [attentionTarget, entries, setAttentionTarget]);

  const patch = useCallback((key: string, next: Partial<Answers>) => {
    setAnswers((all) => ({ ...all, [key]: { ...all[key], ...next } }));
  }, []);

  const afterAnswer = useCallback(() => {
    // Focus returns to the field rather than to the next request's buttons.
    if (fieldRef.current) fieldRef.current.focus();
    else requestAnimationFrame(() => panelRef.current?.focus());
  }, []);

  const respond = useCallback(
    async (entry: Entry, action: () => Promise<void>, fallback: string): Promise<boolean> => {
      if (inFlight.current.has(entry.key) || answered.has(entry.key)) return false;
      inFlight.current.add(entry.key);
      setResponding((keys) => new Set(keys).add(entry.key));
      try {
        await action();
        setAnswered((all) => new Map(all).set(entry.key, Date.now()));
        afterAnswer();
        return true;
      } catch (error) {
        showErrorToast(fallback, error);
        return false;
      } finally {
        inFlight.current.delete(entry.key);
        setResponding((keys) => {
          const next = new Set(keys);
          next.delete(entry.key);
          return next;
        });
      }
    },
    [afterAnswer, answered],
  );

  const answerOf = (entry: Entry) => answers[entry.key]?.answer ?? EMPTY_ANSWER;
  const usesField = Boolean(field) && guard?.field === "feedback";

  /** Clears the field after its text was sent as feedback or an answer, unless it changed. */
  const clearSent = (sent: string) => {
    if (fieldRef.current && fieldRef.current.text() === sent) fieldRef.current.setText("");
  };

  const replyPermission = (entry: Entry, reply: "once" | "always" | "reject", message?: string) =>
    respond(
      entry,
      () =>
        palot.replyPermission({
          sessionID: entry.owner,
          requestID: entry.view.id,
          reply,
          ...(message ? { message } : {}),
        }),
      "Could not answer this request",
    );

  const deny = async (entry: Entry, panelFeedback?: string) => {
    const typed = usesField ? (fieldRef.current?.text() ?? "") : "";
    const reason = (usesField ? typed : (panelFeedback ?? answers[entry.key]?.feedback ?? ""))
      .trim()
      .slice(0, 10_000);
    if ((await replyPermission(entry, "reject", reason || undefined)) && usesField && typed) {
      clearSent(typed);
    }
  };

  const questionReady = (entry: Entry): boolean => {
    if (entry.view.kind !== "question") return false;
    const answer = answerOf(entry);
    const typed = usesField
      ? fieldRef.current && !fieldRef.current.empty
        ? "typed"
        : ""
      : (answer.texts[answer.step] ?? "");
    return questionStepReady(entry.view, answer, typed);
  };

  /** Next step, or submit on the last. With the field as the answer, its text is the step's. */
  const next = async (entry: Entry) => {
    if (entry.view.kind !== "question" || !entry.request || !questionReady(entry)) return;
    const answer = answerOf(entry);
    const texts = [...answer.texts];
    const step = entry.view.steps[answer.step];
    const typed = usesField && step?.custom ? (fieldRef.current?.text() ?? "") : null;
    if (typed !== null) texts[answer.step] = typed;
    const last = answer.step >= entry.view.steps.length - 1;
    if (!last) {
      patch(entry.key, { answer: { ...answer, texts, step: answer.step + 1 } });
      if (typed !== null) fieldRef.current?.setText(texts[answer.step + 1] ?? "");
      return;
    }
    const request = entry.request;
    const sent = await respond(
      entry,
      () =>
        palot.replyForm({
          sessionID: entry.owner,
          formID: request.id,
          answer: questionReply(request, { ...answer, texts }),
        }),
      "Could not submit these answers",
    );
    if (sent && typed) clearSent(typed);
    else if (!sent) patch(entry.key, { answer: { ...answer, texts } });
  };

  const back = (entry: Entry) => {
    if (entry.view.kind !== "question") return;
    const answer = answerOf(entry);
    if (answer.step === 0) return;
    const texts = [...answer.texts];
    if (usesField && entry.view.steps[answer.step]?.custom) {
      texts[answer.step] = fieldRef.current?.text() ?? "";
      fieldRef.current?.setText(texts[answer.step - 1] ?? "");
    }
    patch(entry.key, { answer: { ...answer, texts, step: answer.step - 1 } });
  };

  const pick = (entry: Entry, option: number) => {
    if (entry.view.kind !== "question") return;
    const answer = answerOf(entry);
    const step = entry.view.steps[answer.step];
    const label = step?.options[option]?.label;
    if (!step || label === undefined) return;
    const picked = answer.choices[answer.step] ?? [];
    const choices = [...answer.choices];
    choices[answer.step] = step.multiple
      ? picked.includes(label)
        ? picked.filter((value) => value !== label)
        : [...picked, label]
      : [label];
    patch(entry.key, { answer: { ...answer, choices } });
  };

  const page = (delta: -1 | 1) => {
    if (entries.length < 2) return;
    const target = (index + delta + entries.length) % entries.length;
    setSelected({ key: entries[target]!.key, index: target });
  };

  const run = (entry: Entry, action: RequestKeyAction) => {
    switch (action.type) {
      case "page":
        page(action.delta);
        return;
      case "allow-once":
        void replyPermission(entry, "once");
        return;
      case "always-allow":
        void replyPermission(entry, "always");
        return;
      case "deny":
      case "deny-with-feedback":
        void deny(entry);
        return;
      case "pick":
        pick(entry, action.index);
        return;
      case "back":
        back(entry);
        return;
      case "next":
        void next(entry);
    }
  };

  /**
   * The field's keydown, before the editor's own: the request's chords, and Enter and 1–9
   * when the request owns them. Returns whether the key was the request's.
   */
  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (!current || !guard || !field || field.suggestionsOpen()) return false;
    const action = requestKeyAction(event.nativeEvent, {
      request: current.view,
      count: entries.length,
      step: current.view.kind === "question" ? answerOf(current).step : 0,
      fieldEmpty: field.empty,
      ownsEnter: guard.ownsEnter,
    });
    if (!action) return false;
    event.preventDefault();
    event.stopPropagation();
    // Paging, picking and going back answer nothing; anything that does waits to settle.
    const answers = action.type !== "page" && action.type !== "pick" && action.type !== "back";
    if (answers && waiting) return true;
    run(current, action);
    return true;
  };

  const ownsPrimary =
    Boolean(current && guard && field) &&
    guard!.field === "feedback" &&
    guard!.armed &&
    (current!.view.kind === "permission" || current!.view.kind === "question");

  let primary: RequestPrimary | null = null;
  if (ownsPrimary && current) {
    if (current.view.kind === "permission") {
      const empty = field!.empty;
      primary = {
        view: empty
          ? { kind: "allow", label: "Allow once" }
          : {
              kind: "submit",
              label: "Deny and send",
              name: "Deny and send your text to the agent",
            },
        disabled: waiting,
        onPress: () => (empty ? void replyPermission(current, "once") : void deny(current)),
      };
    } else if (current.view.kind === "question") {
      const last = answerOf(current).step >= current.view.steps.length - 1;
      primary = {
        view: last
          ? { kind: "submit", label: "Submit answer" }
          : { kind: "submit", label: "Next", name: "Next question" },
        disabled: waiting || !questionReady(current),
        onPress: () => void next(current),
      };
    }
  }

  const placeholder =
    current && usesField
      ? current.view.kind === "permission"
        ? "Tell the agent what to do differently…"
        : current.view.kind === "question" && current.view.steps[answerOf(current).step]?.custom
          ? "Type your own answer…"
          : null
      : null;

  const blocksSend = requestsBlockSend(requests, sessionID);

  let content: ReactNode = null;
  if (current && guard) {
    const entry = current;
    const answer = answerOf(entry);
    const request = entry.request;
    const formAnswers =
      request && entry.view.kind === "form"
        ? (answers[entry.key]?.form ?? initialFormAnswers(request.fields))
        : null;
    const form = request && formAnswers ? formSubmission(request.fields, formAnswers) : null;
    content = (
      <RequestPanel
        ref={panelRef}
        tabIndex={-1}
        data-palot-composer-request
        data-palot-request-id={request?.id ?? entry.view.id}
        data-palot-request-session-id={entry.owner}
        data-palot-request-type={request?.type ?? "guest"}
        className="outline-none"
        request={entry.view}
        index={index}
        count={entries.length}
        onPage={page}
        guard={{ field: field ? guard.field : "message", armed: guard.armed }}
        fieldEmpty={field?.empty ?? true}
        busy={busy}
        disabled={!settled}
        renderText={(text) => <LinkedText text={text} />}
        detail={
          request && entry.view.kind === "permission" ? (
            <PermissionDetail request={request} />
          ) : null
        }
        feedback={answers[entry.key]?.feedback ?? ""}
        onFeedbackChange={(feedback) => patch(entry.key, { feedback })}
        onAllowOnce={() => void replyPermission(entry, "once")}
        onAlwaysAllow={() => void replyPermission(entry, "always")}
        onDeny={(feedback) => void deny(entry, feedback)}
        sendInsteadLabel={sendInstead?.label}
        onSendInstead={sendInstead?.run}
        answer={answer}
        onAnswerChange={(value) => {
          if (value.step !== answer.step && usesField) {
            // Moving between steps in the panel carries the field's text with the step.
            const texts = [...value.texts];
            if (entry.view.kind === "question" && entry.view.steps[answer.step]?.custom) {
              texts[answer.step] = fieldRef.current?.text() ?? "";
            }
            fieldRef.current?.setText(texts[value.step] ?? "");
            patch(entry.key, { answer: { ...value, texts } });
            return;
          }
          patch(entry.key, { answer: value });
        }}
        onNext={() => void next(entry)}
        onDismissQuestion={
          request
            ? () =>
                void respond(
                  entry,
                  () => palot.cancelForm({ sessionID: entry.owner, formID: request.id }),
                  "Could not dismiss this question",
                )
            : undefined
        }
        formBody={
          request && formAnswers && form ? (
            <RequestFormFields
              request={request}
              formID={requestFormId(entry.view)}
              answers={formAnswers}
              visible={form.visible}
              disabled={busy}
              onChange={(next) => patch(entry.key, { form: next })}
              onSubmit={() => {
                if (!form.valid || waiting) return;
                void respond(
                  entry,
                  () =>
                    palot.replyForm({
                      sessionID: entry.owner,
                      formID: request.id,
                      answer: form.answer,
                      ...locationOf(request),
                    }),
                  "Could not submit this form",
                );
              }}
            />
          ) : undefined
        }
        formReady={form?.valid ?? true}
        onCancelForm={
          request
            ? () =>
                void respond(
                  entry,
                  () =>
                    palot.cancelForm({
                      sessionID: entry.owner,
                      formID: request.id,
                      ...locationOf(request),
                    }),
                  "Could not cancel this form",
                )
            : undefined
        }
        onSendGuest={() => {
          if (entry.guest && guests?.connected && !entry.guest.sending) {
            guests.approve(entry.guest.id);
            afterAnswer();
          }
        }}
        onDismissGuest={() => {
          if (entry.guest && !entry.guest.sending) {
            guests?.dismiss(entry.guest.id);
            afterAnswer();
          }
        }}
      />
    );
  }

  return {
    open: current !== null,
    key: currentKey,
    count: entries.length,
    title: current ? requestTitle(current.view) : null,
    content,
    primary,
    placeholder,
    blocksSend,
    onFieldKeyDown,
  };
}

/** A permission's full preview, every resource it names and what Deny does. */
function PermissionDetail({ request }: { request: PendingRequestView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-meta text-muted-foreground">
      {request.permissionPreview ? <PermissionPreview preview={request.permissionPreview} /> : null}
      {request.savePatterns.length === 0 ? (
        <p className="m-0">
          Project-wide approval is unavailable because OpenCode did not provide a reusable pattern.
        </p>
      ) : null}
      <p className="m-0">Deny stops all pending protected actions in this task.</p>
    </div>
  );
}

/** An MCP or agent form's typed fields, with the same validation as before. */
function RequestFormFields({
  request,
  formID,
  answers,
  visible,
  disabled,
  onChange,
  onSubmit,
}: {
  request: PendingRequestView;
  formID: string;
  answers: Record<string, FormValue>;
  visible: PendingRequestView["fields"];
  disabled: boolean;
  onChange(answers: Record<string, FormValue>): void;
  onSubmit(): void;
}) {
  return (
    <form
      id={formID}
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {request.detail ? (
        <p className="m-0 text-compact text-muted-foreground">
          <LinkedText text={request.detail} />
        </p>
      ) : null}
      {visible.map((field) => (
        <FormFieldControl
          key={field.key}
          field={field}
          value={answers[field.key]}
          disabled={disabled}
          onChange={(value) => {
            const next = { ...answers };
            if (value === undefined) delete next[field.key];
            else next[field.key] = value;
            onChange(next);
          }}
        />
      ))}
    </form>
  );
}

/**
 * Whether the pending requests hold the message back: questions and forms, and any request of
 * a subagent or MCP server, wait for an answer before the task takes a new message. The task's
 * own permissions do not (a `/btw` side question is always allowed).
 */
export function requestsBlockSend(
  requests: readonly ComposerRequest[],
  sessionID: string,
): boolean {
  return requests.some(
    (request) =>
      request.type !== "input" &&
      (request.type !== "permission" || (request.sessionID ?? sessionID) !== sessionID),
  );
}

/**
 * A subagent task has no composer: its requests (and its own subagents') show in the same
 * panel, in a card above the read-only bar. The panel always brings its own input there.
 */
export function SubagentRequests({
  sessionID,
  requests,
  agentOf,
}: {
  sessionID: string;
  requests: readonly ComposerRequest[];
  agentOf?(sessionID: string): string | null;
}) {
  const panel = useComposerRequests({ sessionID, requests, field: null, agentOf });
  if (!panel.open) return null;
  return (
    <ComposerDock className="w-[calc(100%-40px)] max-w-[760px] pb-2 max-[720px]:w-[calc(100%-22px)]">
      <ComposerSurface mode="request">
        <ComposerPanel open aria-label="Pending request" className="border-b-0">
          <Fragment key={panel.key}>{panel.content}</Fragment>
        </ComposerPanel>
      </ComposerSurface>
    </ComposerDock>
  );
}
