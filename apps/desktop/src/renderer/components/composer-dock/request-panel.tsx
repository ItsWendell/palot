/**
 * The request panel: permissions, questions, forms and guest messages, everything that needs
 * the user's decision. It sits in the composer's panel slot above the text field, which stays
 * usable. Props in, callbacks out; no atoms or services.
 *
 * Who owns the text field and the primary button follows `requestGuard`: when the field was
 * empty as the request arrived it doubles as feedback or the typed answer and the primary
 * button becomes the request's main action, so the panel shows only its other buttons. When a
 * draft was already there, the field and the primary stay the message's and the panel brings
 * its own feedback input and main action.
 */

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  Globe,
  MessageCircleQuestion,
  Plug,
  ShieldQuestion,
  SquareTerminal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ComposerPanelBody, ComposerShortcut, shortcutGlyphs } from "@/components/ui/composer";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/cn";
import { shortcutAriaKeys, type ShortcutKeys } from "@/lib/keyboard-shortcuts";
import type { RequestGuard } from "./request-guard";
import { REQUEST_SHORTCUTS, requestKeyAction } from "./request-keys";
import type {
  FormRequestView,
  FormValues,
  GuestRequestView,
  PermissionRequestView,
  QuestionAnswer,
  QuestionRequestView,
  RequestView,
} from "./types";

/** Lines of a diff shown before "Show all N lines". */
const DIFF_PREVIEW_LINES = 4;

interface RequestPanelProps extends Omit<React.ComponentProps<"section">, "onSubmit" | "children"> {
  request: RequestView;
  /** This request's place among the pending ones, from 0. */
  index?: number;
  count?: number;
  onPage?: (delta: -1 | 1) => void;
  guard: Pick<RequestGuard, "field" | "armed">;
  /** Whether the composer's text field is empty right now. */
  fieldEmpty: boolean;
  /** A reply is on its way; the buttons wait. */
  busy?: boolean;
  /** The buttons wait without saying why (a request that has only just appeared). */
  disabled?: boolean;
  /** Renders text the agent or a guest wrote, such as linking its URLs. Plain by default. */
  renderText?: (text: string) => React.ReactNode;
  /**
   * Richer detail under a permission's subject, from the caller: the full preview of the
   * action, every resource it names and its saved patterns.
   */
  detail?: React.ReactNode;

  /** The panel's own feedback, used when a draft keeps the text field. */
  feedback?: string;
  onFeedbackChange?: (feedback: string) => void;
  onAllowOnce?: () => void;
  onAlwaysAllow?: () => void;
  /** Deny, with the reason the user typed, if any. */
  onDeny?: (feedback?: string) => void;
  /** When the text field holds feedback: send it as a message instead ("Steer it instead"). */
  sendInsteadLabel?: string;
  onSendInstead?: () => void;

  answer?: QuestionAnswer;
  onAnswerChange?: (answer: QuestionAnswer) => void;
  /** Go on from the current step: the next step, or submit on the last. */
  onNext?: () => void;
  /** Dismiss the question without answering. */
  onDismissQuestion?: () => void;

  values?: FormValues;
  onValuesChange?: (values: FormValues) => void;
  onSubmitForm?: () => void;
  onCancelForm?: () => void;
  /**
   * The caller's own form for typed fields the built-in body does not cover. It must be a
   * `<form id={requestFormId(request)}>`, so the panel's Submit submits it.
   */
  formBody?: React.ReactNode;
  /** Whether the form can be submitted as it stands. */
  formReady?: boolean;

  onSendGuest?: () => void;
  onDismissGuest?: () => void;
}

const plainText = (text: string): React.ReactNode => text;

export const EMPTY_ANSWER: QuestionAnswer = { step: 0, choices: [], texts: [] };

/** The id of a form request's `<form>`, which the panel's Submit button submits. */
export function requestFormId(request: Pick<RequestView, "id">): string {
  return `request-form-${request.id}`;
}

/** Whether the current question step can go on: a pick, or typed text where it counts. */
export function questionStepReady(
  request: QuestionRequestView,
  answer: QuestionAnswer,
  typed: string,
): boolean {
  const step = request.steps[answer.step];
  if (!step) return false;
  if ((answer.choices[answer.step] ?? []).length > 0) return true;
  return step.custom && typed.trim().length > 0;
}

export function requestTitle(request: RequestView): string {
  switch (request.kind) {
    case "permission":
    case "form":
      return request.title;
    case "question":
      return request.steps.length > 1 ? "A few questions" : "The agent has a question";
    case "guest":
      return `Guest message from ${request.from}`;
  }
}

function requestIcon(request: RequestView): LucideIcon {
  switch (request.kind) {
    case "permission":
      return request.permission === "edit"
        ? FileDiff
        : request.permission === "network"
          ? Globe
          : request.permission === "shell"
            ? SquareTerminal
            : ShieldQuestion;
    case "question":
      return MessageCircleQuestion;
    case "form":
      return Plug;
    case "guest":
      return UserRound;
  }
}

export function RequestPanel({
  request,
  index = 0,
  count = 1,
  onPage,
  guard,
  fieldEmpty,
  busy: replying = false,
  disabled = false,
  renderText = plainText,
  detail,
  feedback = "",
  onFeedbackChange,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
  sendInsteadLabel,
  onSendInstead,
  answer = EMPTY_ANSWER,
  onAnswerChange,
  onNext,
  onDismissQuestion,
  values = {},
  onValuesChange,
  onSubmitForm,
  onCancelForm,
  formBody,
  formReady = true,
  onSendGuest,
  onDismissGuest,
  className,
  onKeyDown,
  ...props
}: RequestPanelProps) {
  const titleId = React.useId();
  const busy = replying || disabled;
  // A kept draft owns the text field, so the panel brings its own input and main action.
  const ownsField = guard.field === "message";
  const step = request.kind === "question" ? answer.step : 0;

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || busy) return;
    // Enter and 1–9 belong to the focused control here; only the chords act panel-wide.
    const action = requestKeyAction(event, {
      request,
      count,
      step,
      fieldEmpty: true,
      ownsEnter: false,
    });
    if (!action) return;
    event.preventDefault();
    if (action.type === "deny") onDeny?.(feedback.trim() || undefined);
    else if (action.type === "always-allow") onAlwaysAllow?.();
    else if (action.type === "page") onPage?.(action.delta);
    else if (action.type === "back") onAnswerChange?.({ ...answer, step: Math.max(0, step - 1) });
  };

  return (
    <section
      aria-labelledby={titleId}
      data-slot="request-panel"
      data-kind={request.kind}
      className={cn("flex min-h-0 flex-col", className)}
      onKeyDown={onPanelKeyDown}
      {...props}
    >
      <ComposerPanelBody>
        <div className="flex flex-col gap-2 px-4 pt-3 pb-2">
          <RequestHeader
            request={request}
            titleId={titleId}
            index={index}
            count={count}
            onPage={onPage}
          />
          {request.kind === "permission" ? (
            <PermissionBody
              key={request.id}
              request={request}
              ownsField={ownsField}
              feedback={feedback}
              busy={busy}
              detail={detail}
              renderText={renderText}
              onFeedbackChange={onFeedbackChange}
              onAllowOnce={onAllowOnce}
              onDeny={onDeny}
            />
          ) : request.kind === "question" ? (
            <QuestionBody
              request={request}
              renderText={renderText}
              answer={answer}
              ownsField={ownsField}
              // Picking is no answer; only a reply on its way holds the choices.
              busy={replying}
              onAnswerChange={onAnswerChange}
              onNext={onNext}
            />
          ) : request.kind === "form" ? (
            (formBody ?? (
              <FormBody
                request={request}
                renderText={renderText}
                values={values}
                busy={busy}
                onValuesChange={onValuesChange}
                onSubmitForm={onSubmitForm}
              />
            ))
          ) : (
            <GuestBody request={request} renderText={renderText} />
          )}
        </div>
      </ComposerPanelBody>
      <footer className="flex min-h-10 shrink-0 items-center gap-1 px-3 pb-1.5">
        <p className="m-0 min-w-0 flex-1 truncate pl-1 text-meta text-muted-foreground @max-[25rem]/composer:invisible">
          <EnterHint
            request={request}
            guard={guard}
            fieldEmpty={fieldEmpty}
            step={step}
            sendInsteadLabel={sendInsteadLabel}
            onSendInstead={onSendInstead}
          />
        </p>
        <RequestActions
          request={request}
          ownsField={ownsField}
          busy={busy}
          replying={replying}
          formReady={formReady}
          feedback={feedback}
          answer={answer}
          onAllowOnce={onAllowOnce}
          onAlwaysAllow={onAlwaysAllow}
          onDeny={onDeny}
          onAnswerChange={onAnswerChange}
          onNext={onNext}
          onDismissQuestion={onDismissQuestion}
          onCancelForm={onCancelForm}
          onSendGuest={onSendGuest}
          onDismissGuest={onDismissGuest}
        />
      </footer>
    </section>
  );
}

function RequestHeader({
  request,
  titleId,
  index,
  count,
  onPage,
}: {
  request: RequestView;
  titleId: string;
  index: number;
  count: number;
  onPage?: (delta: -1 | 1) => void;
}) {
  const Icon = requestIcon(request);
  const source = request.kind === "guest" ? null : request.source;
  return (
    <header className="flex min-h-6 min-w-0 items-center gap-2">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-warning" />
      <h2 id={titleId} className="m-0 min-w-0 truncate text-sm font-medium">
        {requestTitle(request)}
      </h2>
      {source ? (
        <Badge size="sm" variant="info" className="shrink-0">
          <span className="@max-[34rem]/composer:hidden">From </span>
          {source}
          <span className="@max-[34rem]/composer:hidden"> subagent</span>
        </Badge>
      ) : null}
      {request.kind === "guest" && !request.verified ? (
        <Badge size="sm" variant="warning" className="shrink-0">
          Unverified
        </Badge>
      ) : null}
      {request.kind === "form" && request.server ? (
        <Badge size="sm" variant="neutral" className="shrink-0">
          {request.server} MCP
        </Badge>
      ) : null}
      {count > 1 ? (
        <div className="ms-auto flex shrink-0 items-center gap-0.5 text-meta text-muted-foreground tabular-nums">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous request"
            aria-keyshortcuts={shortcutAriaKeys(REQUEST_SHORTCUTS.previous)}
            disabled={!onPage}
            onClick={() => onPage?.(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span aria-live="polite">
            {index + 1} of {count}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next request"
            aria-keyshortcuts={shortcutAriaKeys(REQUEST_SHORTCUTS.next)}
            disabled={!onPage}
            onClick={() => onPage?.(1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </header>
  );
}

const FIELD_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-input bg-input/20 px-2.5 text-compact outline-none placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring/20 dark:bg-input/30";

function PermissionBody({
  request,
  ownsField,
  feedback,
  busy,
  detail,
  renderText,
  onFeedbackChange,
  onAllowOnce,
  onDeny,
}: {
  request: PermissionRequestView;
  ownsField: boolean;
  feedback: string;
  busy: boolean;
  detail?: React.ReactNode;
  renderText: (text: string) => React.ReactNode;
  onFeedbackChange?: (feedback: string) => void;
  onAllowOnce?: () => void;
  onDeny?: (feedback?: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const diff = request.diff ?? [];
  const lines = expanded ? diff : diff.slice(0, DIFF_PREVIEW_LINES);
  return (
    <div className="flex flex-col gap-1.5">
      {/* What is approved is never cut off: the subject wraps and scrolls instead. */}
      <code className="block max-h-24 overflow-y-auto rounded-md border border-border/70 bg-muted/50 px-2.5 py-1.5 font-mono text-code break-all whitespace-pre-wrap">
        {request.subject}
      </code>
      {diff.length ? (
        <div
          role="group"
          aria-label="Proposed change"
          className="overflow-hidden rounded-md border border-border/70 font-mono text-code-compact"
        >
          {lines.map((line, lineIndex) => (
            <div
              // Diff lines have no identity beyond their place.
              key={lineIndex}
              className={cn(
                "flex gap-2 px-2.5 whitespace-pre",
                line.type === "add" &&
                  "bg-success/10 text-[color-mix(in_oklch,var(--success)_70%,var(--foreground))]",
                line.type === "del" &&
                  "bg-destructive/10 text-[color-mix(in_oklch,var(--destructive)_70%,var(--foreground))]",
              )}
            >
              <span aria-hidden="true" className="w-2 shrink-0 opacity-60">
                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
              </span>
              <span className="sr-only">
                {line.type === "add" ? "Added: " : line.type === "del" ? "Removed: " : ""}
              </span>
              <span className="min-w-0 truncate">{line.text || " "}</span>
            </div>
          ))}
          {diff.length > DIFF_PREVIEW_LINES ? (
            <button
              type="button"
              aria-expanded={expanded}
              className="w-full border-t border-border/60 px-2.5 py-1 text-left font-sans text-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : `Show all ${diff.length} lines`}
            </button>
          ) : null}
        </div>
      ) : null}
      {detail}
      {request.reason ? (
        <p className="m-0 text-compact text-muted-foreground">{renderText(request.reason)}</p>
      ) : null}
      {ownsField ? (
        <input
          value={feedback}
          disabled={busy}
          aria-label="Tell the agent what to do differently"
          placeholder="Tell the agent what to do differently…"
          className={FIELD_CLASS}
          onChange={(event) => onFeedbackChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            const text = feedback.trim();
            if (text) onDeny?.(text);
            else onAllowOnce?.();
          }}
        />
      ) : null}
    </div>
  );
}

function QuestionBody({
  request,
  renderText,
  answer,
  ownsField,
  busy,
  onAnswerChange,
  onNext,
}: {
  request: QuestionRequestView;
  renderText: (text: string) => React.ReactNode;
  answer: QuestionAnswer;
  ownsField: boolean;
  busy: boolean;
  onAnswerChange?: (answer: QuestionAnswer) => void;
  onNext?: () => void;
}) {
  const items = React.useMemo(
    () =>
      request.steps.map((step, index) => ({
        name: `q${index}`,
        required: !step.custom,
        choices: step.options.map((option) => ({ value: option.label })),
      })),
    [request.steps],
  );
  const update = (step: number, change: Partial<{ choices: string[]; text: string }>) => {
    const choices = [...answer.choices];
    const texts = [...answer.texts];
    if (change.choices) choices[step] = change.choices;
    if (change.text !== undefined) texts[step] = change.text;
    onAnswerChange?.({ ...answer, choices, texts });
  };
  return (
    <Questionnaire
      items={items}
      item={`q${answer.step}`}
      shortcuts="numbers"
      onItemChange={(name) => onAnswerChange?.({ ...answer, step: Number(name.slice(1)) })}
      onSubmit={(event) => {
        event.preventDefault();
        onNext?.();
      }}
      className="gap-1.5"
    >
      {request.steps.length > 1 ? (
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          <span className="tabular-nums">
            {answer.step + 1} of {request.steps.length}
          </span>
          <div className="flex gap-1" aria-hidden="true">
            {request.steps.map((_, index) => (
              <span
                // Steps have no identity beyond their place.
                key={index}
                className={cn(
                  "h-1 w-5 rounded-full bg-muted",
                  index <= answer.step && "bg-foreground/50",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
      {request.steps.map((step, stepIndex) => {
        const picked = answer.choices[stepIndex] ?? [];
        return (
          <QuestionnaireItem
            // Steps have no identity beyond their place.
            key={stepIndex}
            name={`q${stepIndex}`}
            multiple={step.multiple}
            required={!step.custom}
            disabled={busy}
          >
            <QuestionnaireTitle className="text-sm font-normal leading-snug">
              {renderText(step.prompt)}
            </QuestionnaireTitle>
            {step.multiple ? (
              <QuestionnaireDescription>Select multiple</QuestionnaireDescription>
            ) : null}
            <QuestionnaireChoices className="mt-0.5 gap-0.5">
              {step.options.map((option) => (
                <QuestionnaireChoice
                  key={option.label}
                  value={option.label}
                  checked={picked.includes(option.label)}
                  className="px-1.5"
                  onChange={(event) => {
                    const checked = event.target.checked;
                    const next = step.multiple
                      ? checked
                        ? [...picked, option.label]
                        : picked.filter((label) => label !== option.label)
                      : checked
                        ? [option.label]
                        : [];
                    update(stepIndex, { choices: next });
                  }}
                >
                  {/* The description follows the label and wraps: an answer is never cut off. */}
                  <span className="min-w-0 text-foreground">
                    {option.label}
                    {option.description ? (
                      <QuestionnaireChoiceDescription className="text-compact">
                        <span aria-hidden="true"> · </span>
                        <span>{renderText(option.description)}</span>
                      </QuestionnaireChoiceDescription>
                    ) : null}
                  </span>
                </QuestionnaireChoice>
              ))}
              {step.custom && ownsField ? (
                <QuestionnaireInput
                  value={answer.texts[stepIndex] ?? ""}
                  placeholder={step.options.length ? "Something else…" : "Type your answer…"}
                  aria-label="Your own answer"
                  className="h-8 text-compact"
                  onChange={(event) => update(stepIndex, { text: event.target.value })}
                />
              ) : null}
            </QuestionnaireChoices>
          </QuestionnaireItem>
        );
      })}
    </Questionnaire>
  );
}

function FormBody({
  request,
  renderText,
  values,
  busy,
  onValuesChange,
  onSubmitForm,
}: {
  request: FormRequestView;
  renderText: (text: string) => React.ReactNode;
  values: FormValues;
  busy: boolean;
  onValuesChange?: (values: FormValues) => void;
  onSubmitForm?: () => void;
}) {
  const formId = requestFormId(request);
  const set = (id: string, value: string | boolean) => onValuesChange?.({ ...values, [id]: value });
  return (
    <form
      id={formId}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitForm?.();
      }}
    >
      {request.description ? (
        <p className="m-0 text-compact text-muted-foreground">{renderText(request.description)}</p>
      ) : null}
      <FieldGroup className="gap-2">
        {request.fields.map((field) => {
          const id = `${formId}-${field.id}`;
          if (field.type === "checkbox") {
            return (
              <Field key={field.id} orientation="horizontal" className="gap-2">
                <Checkbox
                  id={id}
                  disabled={busy}
                  checked={values[field.id] === true}
                  onCheckedChange={(checked) => set(field.id, checked)}
                />
                <FieldLabel htmlFor={id} className="text-compact font-normal">
                  {field.label}
                </FieldLabel>
              </Field>
            );
          }
          return (
            <Field key={field.id} orientation="horizontal" className="gap-3">
              <FieldLabel
                htmlFor={id}
                className="w-20 shrink-0 text-compact font-normal text-muted-foreground"
              >
                {field.label}
              </FieldLabel>
              {field.type === "text" ? (
                <Input
                  id={id}
                  disabled={busy}
                  required={field.required}
                  value={String(values[field.id] ?? "")}
                  placeholder={field.placeholder}
                  className="h-8 text-compact"
                  onChange={(event) => set(field.id, event.target.value)}
                  onKeyDown={(event) => {
                    // Enter submits from any text field, however many the form has.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
                />
              ) : (
                <NativeSelect
                  id={id}
                  disabled={busy}
                  required={field.required}
                  className="w-48"
                  value={String(values[field.id] ?? field.options[0] ?? "")}
                  onChange={(event) => set(field.id, event.target.value)}
                >
                  {field.options.map((option) => (
                    <NativeSelectOption key={option} value={option}>
                      {option}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </Field>
          );
        })}
      </FieldGroup>
    </form>
  );
}

function GuestBody({
  request,
  renderText,
}: {
  request: GuestRequestView;
  renderText: (text: string) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <blockquote className="m-0 max-h-32 overflow-y-auto border-l-2 border-border pl-3 text-sm leading-snug break-words whitespace-pre-wrap">
        {renderText(request.text)}
      </blockquote>
      <p className="m-0 text-meta text-muted-foreground">
        Guests can't reach the agent until you send their message on.
      </p>
    </div>
  );
}

/** What Enter does right now, so a request never surprises someone mid-sentence. */
function EnterHint({
  request,
  guard,
  fieldEmpty,
  step,
  sendInsteadLabel,
  onSendInstead,
}: {
  request: RequestView;
  guard: Pick<RequestGuard, "field" | "armed">;
  fieldEmpty: boolean;
  step: number;
  sendInsteadLabel?: string;
  onSendInstead?: () => void;
}) {
  const enter = shortcutGlyphs(["Enter"]);
  if (request.kind === "form" || request.kind === "guest" || guard.field === "message") {
    return <>The message box below stays yours</>;
  }
  if (!guard.armed) {
    return <>{enter} still sends your message · it answers once you pause typing</>;
  }
  if (request.kind === "permission") {
    if (fieldEmpty) return <>{enter} allows once</>;
    return (
      <>
        {enter} denies and sends your text
        {onSendInstead && sendInsteadLabel ? (
          <>
            {" · "}
            <button
              type="button"
              className="font-medium text-foreground/80 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
              onClick={onSendInstead}
            >
              {sendInsteadLabel}
            </button>
          </>
        ) : null}
      </>
    );
  }
  const options = request.steps[step]?.options.length ?? 0;
  return options ? (
    <>
      1–{Math.min(9, options)} pick while the box is empty · {enter} goes on
    </>
  ) : (
    <>{enter} goes on</>
  );
}

const ACTION_CLASS = "rounded-full px-3 text-compact";

function ActionButton({
  shortcut,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { shortcut?: ShortcutKeys }) {
  return (
    <Button
      aria-keyshortcuts={shortcut ? shortcutAriaKeys(shortcut) : undefined}
      className={cn(ACTION_CLASS, className)}
      {...props}
    >
      {children}
      {shortcut ? <ComposerShortcut keys={shortcut} /> : null}
    </Button>
  );
}

/** The request's buttons. The main action is here only while the composer's primary is not. */
function RequestActions({
  request,
  ownsField,
  busy,
  replying,
  formReady,
  feedback,
  answer,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
  onAnswerChange,
  onNext,
  onDismissQuestion,
  onCancelForm,
  onSendGuest,
  onDismissGuest,
}: {
  request: RequestView;
  ownsField: boolean;
  busy: boolean;
  /** A reply is on its way (`busy` also covers a request that has only just appeared). */
  replying: boolean;
  formReady: boolean;
  feedback: string;
  answer: QuestionAnswer;
  onAllowOnce?: () => void;
  onAlwaysAllow?: () => void;
  onDeny?: (feedback?: string) => void;
  onAnswerChange?: (answer: QuestionAnswer) => void;
  onNext?: () => void;
  onDismissQuestion?: () => void;
  onCancelForm?: () => void;
  onSendGuest?: () => void;
  onDismissGuest?: () => void;
}) {
  switch (request.kind) {
    case "permission":
      return (
        <>
          <ActionButton
            variant="ghost"
            disabled={busy}
            shortcut={REQUEST_SHORTCUTS.deny}
            onClick={() => onDeny?.(feedback.trim() || undefined)}
          >
            Deny
          </ActionButton>
          {/* Without a pattern OpenCode can't save the approval, so there is nothing to offer. */}
          {request.rule ? (
            <ActionButton
              variant="outline"
              disabled={busy}
              title={`Saves “always allow ${request.rule}” for this project`}
              shortcut={REQUEST_SHORTCUTS.alwaysAllow}
              className="max-w-72 min-w-0"
              onClick={() => onAlwaysAllow?.()}
            >
              <span className="shrink-0">Always allow</span>
              <span className="min-w-0 truncate font-mono text-code-compact text-muted-foreground @max-[25rem]/composer:hidden">
                {request.rule}
              </span>
            </ActionButton>
          ) : null}
          {ownsField ? (
            <ActionButton disabled={busy} onClick={() => onAllowOnce?.()}>
              Allow once
            </ActionButton>
          ) : null}
        </>
      );
    case "question": {
      const last = answer.step >= request.steps.length - 1;
      return (
        <>
          {onDismissQuestion ? (
            <ActionButton variant="ghost" disabled={busy} onClick={() => onDismissQuestion()}>
              Dismiss
            </ActionButton>
          ) : null}
          {answer.step > 0 ? (
            <ActionButton
              variant="ghost"
              disabled={busy}
              shortcut={REQUEST_SHORTCUTS.back}
              onClick={() => onAnswerChange?.({ ...answer, step: answer.step - 1 })}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </ActionButton>
          ) : null}
          {ownsField ? (
            <ActionButton disabled={busy} onClick={() => onNext?.()}>
              {last ? "Submit answer" : "Next"}
            </ActionButton>
          ) : null}
        </>
      );
    }
    case "form":
      return (
        <>
          <ActionButton variant="ghost" disabled={busy} onClick={() => onCancelForm?.()}>
            Cancel
          </ActionButton>
          <ActionButton type="submit" form={requestFormId(request)} disabled={busy || !formReady}>
            {replying ? "Submitting" : "Submit"}
          </ActionButton>
        </>
      );
    case "guest":
      return (
        <>
          <ActionButton variant="ghost" disabled={busy} onClick={() => onDismissGuest?.()}>
            Dismiss
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => onSendGuest?.()}>
            Send to the agent
          </ActionButton>
        </>
      );
  }
}
