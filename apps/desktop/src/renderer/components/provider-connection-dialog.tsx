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
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import type {
  OpenCodeRuntimeStatus,
  PalotFormField,
  PalotIntegration,
  PalotIntegrationMethod,
} from "../../shared";
import { useSettingsOwner } from "../hooks/use-settings-owner";
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
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import { CheckList } from "./ui/check-list";
import { Checkbox } from "./ui/checkbox";
import { ChoiceGroup } from "./ui/choice-group";
import { CopyField } from "./ui/copy-field";
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
  owner,
}: {
  integration: PalotIntegration | null;
  projectID: string;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
  owner?: OpenCodeRuntimeStatus | null;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [methodID, setMethodID] = useState<string>(() => {
    const method = integration?.methods.find((item) => item.type !== "env");
    return method ? methodKey(method) : "";
  });
  const [attempt, setAttempt] = useState<IntegrationConnectionAttempt | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const methodLabelID = useId();
  const workflow = useMemo(() => new IntegrationConnectionWorkflow(palot), []);
  const selectedRuntime = useSettingsOwner();
  const runtime = owner === undefined ? selectedRuntime : owner;
  const runtimeConnectionID = runtime?.connectionID ?? null;
  const previousConnectionID = useRef(runtimeConnectionID);
  const availableMethods = integration?.methods.filter((item) => item.type !== "env") ?? [];
  const method =
    availableMethods.find((item) => methodKey(item) === methodID) ??
    availableMethods.find((item) => item.type !== "unsupported") ??
    availableMethods[0];

  useEffect(() => () => workflow.dispose(), [workflow]);
  useEffect(() => {
    workflow.dispose();
    setAttempt(null);
    setBusy(false);
    setCode("");
    setMethodID("");
  }, [integration?.id, workflow]);
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
    if (!integration || !method || !runtime?.connected) return;
    await workflow.start(
      {
        integration,
        method,
        ...input,
        connectionID: runtime.connectionID,
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
        {integration && availableMethods.length > 1 && !attempt ? (
          <div className="grid gap-2">
            <p id={methodLabelID} className="text-xs font-medium">
              Choose a connection method
            </p>
            <ChoiceGroup
              aria-labelledby={methodLabelID}
              variant="card"
              disabled={busy}
              value={method ? methodKey(method) : null}
              onValueChange={setMethodID}
              options={availableMethods.map((item) => ({
                value: methodKey(item),
                label: item.label,
                description: connectionMethodDescription(item),
                icon: connectionMethodIcon(item),
              }))}
            />
          </div>
        ) : null}
        {!attempt ? (
          method ? (
            <ConnectionMethodForm
              key={`${runtimeConnectionID}:${integration?.id}:${methodKey(method)}`}
              method={method}
              busy={busy || !runtime?.connected}
              onCancel={() => void close()}
              onSubmit={submit}
            />
          ) : (
            <div className="grid gap-3">
              <Banner status="neutral">
                No connection methods are available here. Configure this integration in OpenCode.
              </Banner>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => void close()}>
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          )
        ) : (
          <div className="grid gap-3">
            <Banner
              status={
                attempt.status === "pending"
                  ? "info"
                  : attempt.status === "complete"
                    ? "success"
                    : "error"
              }
              icon={attempt.status === "pending" ? PendingIcon : undefined}
              title={
                attempt.status === "pending"
                  ? "Waiting for authorization"
                  : attempt.status === "complete"
                    ? "Authorized"
                    : attempt.status === "expired"
                      ? "Authorization expired"
                      : "Authorization failed"
              }
              aria-busy={attempt.status === "pending"}
            >
              {attempt.instructions || attempt.message ? (
                <>
                  {attempt.instructions ? (
                    <p className="whitespace-pre-wrap">{attempt.instructions}</p>
                  ) : null}
                  {attempt.message ? <p>{attempt.message}</p> : null}
                </>
              ) : undefined}
            </Banner>
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
            ) : null}
            {attempt.url ? (
              <CopyField label="Authorization URL" value={attempt.url} monospace />
            ) : null}
            {attempt.status === "pending" && deviceCode(attempt) ? (
              <CopyField label="Device code" value={deviceCode(attempt)!} />
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

  if (method.type === "unsupported") {
    return (
      <>
        <Banner status="neutral">
          Palot does not support the {method.label} connection method ({method.methodType}). Connect
          it in OpenCode instead.
        </Banner>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

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
          <CopyField label="Command OpenCode runs" value={method.command.join(" ")} />
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
  const labelID = useId();
  if (!formFieldVisible(field, answers)) return null;
  if (field.type === "external") {
    return (
      <div className="grid gap-2">
        {validHttpUrl(field.url) ? (
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
        ) : (
          <div className="rounded-lg border px-3 py-2 text-xs">
            <span className="block font-medium">{field.title ?? "External step"}</span>
            {field.description ? (
              <span className="mt-0.5 block text-muted-foreground">{field.description}</span>
            ) : null}
            <code className="mt-1 block break-all text-micro text-muted-foreground">
              {field.url}
            </code>
          </div>
        )}
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={answers[field.key] === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <span>I completed this step: {field.title ?? field.key}</span>
        </label>
      </div>
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
    const custom = selected.filter(
      (value) => !field.options.some((option) => option.value === value),
    );
    return (
      <div className="grid gap-2 rounded-lg border p-2 text-xs">
        <span id={labelID} className="px-1 pt-1 font-medium">
          {title}
        </span>
        {field.description ? <span className="px-1">{description}</span> : null}
        <CheckList
          aria-labelledby={labelID}
          options={field.options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          }))}
          value={selected}
          onValueChange={(next) => onChange(next)}
        />
        {field.custom ? (
          <div className="flex gap-2 px-1 pb-1">
            <Input
              value={customValue}
              placeholder="Custom value"
              aria-label={`Custom ${title}`}
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
        {custom.length ? (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1">
            {custom.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Remove ${value}`}
                className="flex items-center gap-1 rounded-md border px-2 py-1 text-micro"
                onClick={() => onChange(selected.filter((item) => item !== value))}
              >
                {value}
                <X className="size-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
  const type = method.type === "unsupported" ? method.methodType : method.type;
  return `${type}:${method.id ?? "default"}`;
}

function connectionMethodIcon(
  method: Exclude<PalotIntegrationMethod, { type: "env" }>,
): ComponentType<{ className?: string }> {
  if (method.type === "key") return KeyRound;
  if (method.type === "command") return Terminal;
  if (method.type === "external") return ExternalLink;
  if (method.type === "unsupported") return CircleAlert;
  return LogIn;
}

function PendingIcon({ className }: { className?: string }) {
  return <LoaderCircle className={cn(className, "animate-spin")} aria-hidden="true" />;
}

/**
 * The code a device flow asks people to enter: the `user_code` URL parameter, or a short
 * code at the end of the instructions ("Enter code: ABCD-1234").
 */
function deviceCode(attempt: IntegrationConnectionAttempt): string | null {
  if (attempt.url) {
    try {
      const code = new URL(attempt.url).searchParams.get("user_code");
      if (code) return code;
    } catch {
      // Not a URL; fall back to the instructions.
    }
  }
  const match = attempt.instructions?.match(/:\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})*)\s*$/);
  return match?.[1] ?? null;
}

function connectionMethodDescription(
  method: Exclude<PalotIntegrationMethod, { type: "env" }>,
): string {
  if (method.type === "key") return "Enter an API key from the provider.";
  if (method.type === "command") return "Authorize with the provider's command-line flow.";
  if (method.type === "external") return "Connect credentials managed outside OpenCode.";
  if (method.type === "unsupported") return "Not supported in Palot. Connect it in OpenCode.";
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
