import type { FormValue, LocationRef } from "@opencode/client";
import {
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogIn,
  Terminal,
  X,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PalotFormField, PalotIntegration, PalotIntegrationMethod } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import {
  defaultFormAnswers,
  formFieldVisible,
  integrationFormValid,
  visibleAnswers,
} from "../lib/integration-form";
import {
  IntegrationConnectionWorkflow,
  type IntegrationConnectionAttempt,
} from "../lib/integration-connection-workflow";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ProviderIcon } from "./ui/provider-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "./ui/toast";

export function ProviderConnectionDialog({
  integration,
  projectID,
  location,
  onOpenChange,
  onComplete,
}: {
  integration: PalotIntegration | null;
  projectID: string;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [methodID, setMethodID] = useState<string>(() => {
    const method = integration?.methods.find((item) => item.type !== "env");
    return method ? methodKey(method) : "";
  });
  const [attempt, setAttempt] = useState<IntegrationConnectionAttempt | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const workflow = useMemo(() => new IntegrationConnectionWorkflow(palot), []);
  const runtime = useAtomValue(runtimeAtom);
  const runtimeConnectionID = runtime?.connectionID ?? null;
  const previousConnectionID = useRef(runtimeConnectionID);
  const supportedMethods = integration?.methods.filter((item) => item.type !== "env") ?? [];
  const method =
    supportedMethods.find((item) => methodKey(item) === methodID) ?? supportedMethods[0];

  useEffect(() => () => workflow.dispose(), [workflow]);
  useEffect(() => {
    if (integration && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
  }, [integration]);
  useEffect(() => {
    const connectionChanged = previousConnectionID.current !== runtimeConnectionID;
    previousConnectionID.current = runtimeConnectionID;
    if (runtime?.connected && !connectionChanged) return;
    workflow.dispose();
    setAttempt(null);
    setBusy(false);
  }, [runtime?.connected, runtimeConnectionID, workflow]);

  const callbacks = {
    setAttempt,
    setBusy,
    showError: showErrorToast,
    showSuccess(title: string) {
      toast.add({ type: "success", title });
    },
    close() {
      onOpenChange(false);
    },
    invalidate: onComplete,
  };

  async function submit(input: { key: string; label: string; answer: Record<string, FormValue> }) {
    if (!integration || !method) return;
    await workflow.start(
      {
        integration,
        method,
        ...input,
        projectID,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      },
      callbacks,
    );
  }

  async function completeOAuth() {
    if (!integration || !attempt || attempt.type !== "oauth") return;
    await workflow.completeOAuth(code, callbacks);
  }

  async function close() {
    await workflow.close(callbacks);
  }

  return (
    <Dialog open={Boolean(integration)} onOpenChange={(open) => !open && void close()}>
      <DialogContent
        className="sm:max-w-md"
        finalFocus={() => (returnFocusRef.current?.isConnected ? returnFocusRef.current : false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {integration ? <ProviderIcon id={integration.id} className="size-5" /> : null}
            Add {integration?.name} credential
          </DialogTitle>
          <DialogDescription>
            OpenCode stores this credential for the service. Adding it makes it active across all
            connected projects.
          </DialogDescription>
        </DialogHeader>
        {integration && supportedMethods.length > 1 && !attempt ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium">Choose a connection method</legend>
            {supportedMethods.map((item) => {
              const selected = methodKey(item) === methodKey(method!);
              return (
                <button
                  key={methodKey(item)}
                  type="button"
                  aria-pressed={selected}
                  className="group grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/75 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-pressed:border-foreground/20 aria-pressed:bg-muted/45"
                  onClick={() => setMethodID(methodKey(item))}
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground group-aria-pressed:text-foreground">
                    <ConnectionMethodIcon method={item} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {connectionMethodDescription(item)}
                    </span>
                  </span>
                </button>
              );
            })}
          </fieldset>
        ) : null}
        {!attempt ? (
          method ? (
            <ConnectionMethodForm
              key={methodKey(method)}
              method={method}
              busy={busy}
              onCancel={() => void close()}
              onSubmit={submit}
            />
          ) : null
        ) : (
          <div className="grid gap-3">
            <div
              className="rounded-xl border bg-muted/25 p-3 text-xs"
              role={attempt.status === "pending" ? "status" : "alert"}
              aria-live={attempt.status === "pending" ? "polite" : "assertive"}
              aria-busy={attempt.status === "pending"}
            >
              <div className="flex items-center gap-2">
                {attempt.status === "pending" ? (
                  <LoaderCircle className="size-4 animate-spin text-info" aria-hidden="true" />
                ) : (
                  <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
                )}
                <span className="font-medium">
                  {attempt.status === "pending" ? "Waiting for authorization" : attempt.status}
                </span>
              </div>
              {attempt.instructions ? (
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {attempt.instructions}
                </p>
              ) : null}
              {attempt.message ? <p className="mt-2 text-destructive">{attempt.message}</p> : null}
            </div>
            {attempt.url && validHttpUrl(attempt.url) ? (
              <a
                href={attempt.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-xs font-medium hover:bg-accent"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open authorization page
              </a>
            ) : attempt.url ? (
              <code className="block break-all rounded-lg border px-3 py-2 text-micro text-muted-foreground">
                {attempt.url}
              </code>
            ) : null}
            {attempt.type === "oauth" && attempt.mode === "code" ? (
              <label className="grid gap-1.5 text-xs font-medium">
                Authorization code
                <Input value={code} onChange={(event) => setCode(event.target.value)} />
              </label>
            ) : null}
          </div>
        )}
        {attempt ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void close()}>
              Cancel
            </Button>
            {attempt.type === "oauth" && attempt.mode === "code" ? (
              <Button
                type="button"
                disabled={busy || !code.trim()}
                onClick={() => void completeOAuth()}
              >
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                Complete
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionMethodForm({
  method,
  busy,
  onCancel,
  onSubmit,
}: {
  method: Exclude<PalotIntegrationMethod, { type: "env" }>;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: { key: string; label: string; answer: Record<string, FormValue> }): Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [answers, setAnswers] = useState<Record<string, FormValue>>(() =>
    defaultFormAnswers(method.form),
  );

  return (
    <>
      <div className="grid gap-3">
        {method.form.map((field) => (
          <IntegrationFormField
            key={field.key}
            field={field}
            answers={answers}
            onChange={(value) =>
              setAnswers((current) => {
                const next = { ...current };
                if (value === undefined) delete next[field.key];
                else next[field.key] = value;
                return next;
              })
            }
          />
        ))}
        {method.type === "key" ? (
          <label className="grid gap-1.5 text-xs font-medium">
            API key
            <Input
              type="password"
              value={key}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
        ) : null}
        <label className="grid gap-1.5 text-xs font-medium">
          Credential label <span className="font-normal text-muted-foreground">Optional</span>
          <Input
            value={label}
            placeholder="Work or Personal"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        {method.type === "command" ? (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-code-compact text-muted-foreground">
            {method.command.join(" ")}
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={
            busy ||
            (method.type === "key" && !key.trim()) ||
            !integrationFormValid(method.form, answers)
          }
          onClick={() =>
            void onSubmit({ key, label, answer: visibleAnswers(method.form, answers) })
          }
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          Add and use
        </Button>
      </DialogFooter>
    </>
  );
}

function IntegrationFormField({
  field,
  answers,
  onChange,
}: {
  field: PalotFormField;
  answers: Record<string, FormValue>;
  onChange(value: FormValue | undefined): void;
}) {
  const [customValue, setCustomValue] = useState("");
  if (!formFieldVisible(field, answers)) return null;
  if (field.type === "external") {
    if (!validHttpUrl(field.url)) {
      return (
        <div className="rounded-lg border px-3 py-2 text-xs">
          <span className="block font-medium">{field.title ?? "External step"}</span>
          {field.description ? (
            <span className="mt-0.5 block text-muted-foreground">{field.description}</span>
          ) : null}
          <code className="mt-1 block break-all text-micro text-muted-foreground">{field.url}</code>
        </div>
      );
    }
    return (
      <a
        href={field.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted/30"
      >
        <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="block font-medium">{field.title ?? "Open instructions"}</span>
          {field.description ? (
            <span className="mt-0.5 block text-muted-foreground">{field.description}</span>
          ) : null}
        </span>
      </a>
    );
  }
  const title = field.title ?? field.key;
  const description = field.description ? (
    <span className="text-micro font-normal text-muted-foreground">{field.description}</span>
  ) : null;
  if (field.type === "boolean") {
    return (
      <label className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
        <Checkbox
          checked={Boolean(answers[field.key])}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
        <span>
          <span className="block font-medium">{title}</span>
          {description}
        </span>
      </label>
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(answers[field.key]) ? (answers[field.key] as string[]) : [];
    return (
      <fieldset className="grid gap-2 rounded-lg border p-3 text-xs">
        <legend className="px-1 font-medium">{title}</legend>
        {description}
        {field.options.map((option) => (
          <label key={option.value} className="flex items-start gap-2">
            <Checkbox
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            />
            <span>
              <span className="block font-medium">{option.label}</span>
              {option.description ? (
                <span className="block text-micro text-muted-foreground">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
        {field.custom ? (
          <div className="flex gap-2">
            <Input
              value={customValue}
              placeholder="Custom value"
              onChange={(event) => setCustomValue(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!customValue.trim() || selected.includes(customValue.trim())}
              onClick={() => {
                onChange([...selected, customValue.trim()]);
                setCustomValue("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
        {selected
          .filter((value) => !field.options.some((option) => option.value === value))
          .map((value) => (
            <button
              key={value}
              type="button"
              className="flex items-center gap-1 justify-self-start rounded-md border px-2 py-1 text-micro"
              onClick={() => onChange(selected.filter((item) => item !== value))}
            >
              {value}
              <X className="size-3" aria-hidden="true" />
            </button>
          ))}
      </fieldset>
    );
  }
  if (field.type === "string" && field.options.length > 0 && !field.custom) {
    return (
      <label className="grid gap-1.5 text-xs font-medium">
        {title}
        <Select
          value={String(answers[field.key] ?? "")}
          onValueChange={(value) => onChange(String(value))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description}
      </label>
    );
  }
  const numeric = field.type === "number" || field.type === "integer";
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {title}
      <Input
        type={
          numeric
            ? "number"
            : field.type === "string" && field.format === "email"
              ? "email"
              : "text"
        }
        value={answers[field.key] === undefined ? "" : String(answers[field.key])}
        placeholder={field.type === "string" ? (field.placeholder ?? undefined) : undefined}
        min={numeric ? (field.minimum ?? undefined) : undefined}
        max={numeric ? (field.maximum ?? undefined) : undefined}
        step={field.type === "integer" ? 1 : undefined}
        onChange={(event) =>
          onChange(
            numeric
              ? event.target.value === ""
                ? undefined
                : Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {description}
    </label>
  );
}

function methodKey(method: PalotIntegrationMethod): string {
  return `${method.type}:${method.id ?? "default"}`;
}

function ConnectionMethodIcon({
  method,
}: {
  method: Exclude<PalotIntegrationMethod, { type: "env" }>;
}) {
  if (method.type === "key") return <KeyRound className="size-4" aria-hidden="true" />;
  if (method.type === "command") return <Terminal className="size-4" aria-hidden="true" />;
  return <LogIn className="size-4" aria-hidden="true" />;
}

function connectionMethodDescription(
  method: Exclude<PalotIntegrationMethod, { type: "env" }>,
): string {
  if (method.type === "key") return "Enter an API key from the provider.";
  if (method.type === "command") return "Authorize with the provider's command-line flow.";
  return "Authorize with the provider's sign-in flow.";
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
