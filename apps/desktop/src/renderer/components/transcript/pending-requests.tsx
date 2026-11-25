import type { FormValue } from "@opencode/client";
import { useAtom } from "jotai";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { attentionTargetAtom } from "../../atoms/attention";
import { exitFallbackMs, spring } from "../../lib/springs";
import { LinkedText } from "../link-actions";
import type { OwnedPendingRequestView } from "../../lib/session-family-requests";
import { cn } from "../../lib/cn";
import { showErrorToast } from "../../lib/toast-error";
import { type PendingFormFieldView, type PendingRequestView } from "../../lib/view-models";
import { palot } from "../../services/palot";
import { PermissionPreview } from "../permission-preview";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

const COMPOSER_TEXTBOX = '[aria-label="Message Palot"]';

/**
 * Keeps a request area mounted while its last card fades out. `settle` ends the exit; a timer
 * also ends it because a hidden window can stall the animation.
 */
function useRequestAreaExit(hasCards: boolean): [shown: boolean, settle: () => void] {
  const [leaving, setLeaving] = useState(false);
  const [hadCards, setHadCards] = useState(hasCards);
  if (hadCards !== hasCards) {
    setHadCards(hasCards);
    setLeaving(!hasCards);
  }
  const settle = useCallback(() => setLeaving(false), []);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(settle, exitFallbackMs(spring.moderate));
    return () => window.clearTimeout(timer);
  }, [leaving, settle]);
  return [hasCards || leaving, settle];
}

/** Moves focus out of a leaving card to the nearest composer, or drops it when none is shown. */
function releaseFocus(card: HTMLElement) {
  for (let scope = card.parentElement; scope; scope = scope.parentElement) {
    const composer = [...scope.querySelectorAll<HTMLElement>(COMPOSER_TEXTBOX)].find(
      (element) => !card.contains(element),
    );
    if (composer) {
      composer.focus();
      return;
    }
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function RequestPresence({
  children,
  requestID,
  sessionID,
  type,
}: {
  children: ReactNode;
  requestID: string;
  sessionID: string;
  type: PendingRequestView["type"];
}) {
  const isPresent = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    // Focus leaves before the card turns inert, so the browser does not drop it on the page.
    if (!isPresent && card.contains(document.activeElement)) releaseFocus(card);
    card.inert = !isPresent;
  }, [isPresent]);
  // A leaving card is no longer the request: a request moving between the dock and the
  // transcript must resolve to its new card only.
  return (
    <motion.div
      ref={ref}
      data-palot-request-id={isPresent ? requestID : undefined}
      data-palot-request-session-id={isPresent ? sessionID : undefined}
      data-palot-request-type={isPresent ? type : undefined}
      aria-hidden={isPresent ? undefined : true}
      className={isPresent ? undefined : "pointer-events-none"}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: spring.moderate.exit }}
      transition={spring.moderate}
    >
      {children}
    </motion.div>
  );
}

export const PendingRequests = memo(function PendingRequests({
  sessionID,
  requests,
  inline = false,
  onExitComplete,
}: {
  sessionID: string;
  requests: Array<
    PendingRequestView & Partial<Pick<OwnedPendingRequestView, "sessionID" | "sessionTitle">>
  >;
  inline?: boolean;
  /** Called once the last card has left, for an owner that keeps its own area open meanwhile. */
  onExitComplete?: () => void;
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

  // Questions and forms answer in the composer's request panel; only permissions show here.
  const cardRequests = requests.filter((request) => request.type === "permission");
  const [shown, settle] = useRequestAreaExit(cardRequests.length > 0);
  if (!shown) return null;
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
      <AnimatePresence
        onExitComplete={() => {
          settle();
          onExitComplete?.();
        }}
      >
        {cardRequests.map((request) => {
          const ownerSessionID = request.sessionID ?? sessionID;
          const responseKey = `${ownerSessionID}:${request.type}:${request.id}`;
          const disabled = responding.has(responseKey);
          const contentKey = JSON.stringify({
            questions: request.questions,
            fields: request.fields,
            delivery: request.delivery,
          });
          // One card per request: changed content resets the card in place instead of
          // showing the old version leaving beside the new one.
          return (
            <RequestPresence
              key={responseKey}
              requestID={request.id}
              sessionID={ownerSessionID}
              type={request.type}
            >
              <Fragment key={contentKey}>
                {request.locationDirectory ? (
                  <p className="mb-1 truncate px-1 text-meta font-medium text-muted-foreground">
                    MCP server request
                  </p>
                ) : ownerSessionID !== sessionID ? (
                  <p
                    className="mb-1 truncate px-1 text-meta font-medium text-warning"
                    title={request.sessionTitle}
                  >
                    Subagent · {request.sessionTitle ?? "Delegated task"}
                  </p>
                ) : null}
                <PermissionRequestCard
                  request={request}
                  disabled={disabled}
                  onReply={(value, message) =>
                    replyPermission(ownerSessionID, responseKey, request.id, value, message)
                  }
                />
              </Fragment>
            </RequestPresence>
          );
        })}
      </AnimatePresence>
    </div>
  );
});

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
        {request.detail ? (
          <span>
            <LinkedText text={request.detail} />
          </span>
        ) : null}
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
          {request.savePatterns.length > 0 ? (
            <Button
              type="button"
              size="xs"
              disabled={disabled}
              title="Save these patterns for every task in this project"
              onClick={() => void onReply("always")}
            >
              Always allow for this project
            </Button>
          ) : null}
        </div>
      )}
    </RequestCard>
  );
}

export function initialFormAnswers(fields: PendingFormFieldView[]): Record<string, FormValue> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field.defaultValue !== undefined) return [[field.key, field.defaultValue]];
      return field.type === "boolean" ? [[field.key, false]] : [];
    }),
  );
}

export function formFieldVisible(
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

export function formFieldValid(field: PendingFormFieldView, value: FormValue | undefined): boolean {
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

/** The fields a form shows now, whether they are all valid, and the answer to send. */
export function formSubmission(
  fields: PendingFormFieldView[],
  answers: Record<string, FormValue>,
): { visible: PendingFormFieldView[]; valid: boolean; answer: Record<string, FormValue> } {
  const enabled = fields.filter((field) => formFieldVisible(field, answers));
  const visible = enabled.filter((field) => !field.hidden);
  return {
    visible,
    valid: visible.every((field) => formFieldValid(field, answers[field.key])),
    answer: Object.fromEntries(
      enabled.flatMap((field) => {
        const value = answers[field.key];
        return value === undefined || field.type === "external" ? [] : [[field.key, value]];
      }),
    ),
  };
}

export function FormFieldControl({
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
          <span className="text-micro text-muted-foreground">
            <LinkedText text={field.description} />
          </span>
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
            <span className="text-micro text-muted-foreground">
              <LinkedText text={field.description} />
            </span>
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
          <span className="text-micro text-muted-foreground">
            <LinkedText text={field.description} />
          </span>
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
                  <span className="text-muted-foreground">
                    <LinkedText text={option.description} />
                  </span>
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
        <span className="text-micro text-muted-foreground">
          <LinkedText text={field.description} />
        </span>
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
