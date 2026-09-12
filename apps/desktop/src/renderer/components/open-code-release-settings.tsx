import { useAtomValue } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import type { OpenCodeReleaseStatus } from "../../shared/opencode-release-contract";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { OpenCodeInstallationSettings } from "./open-code-installation-settings";
import { SettingsGroup, SettingsSection } from "./settings-layout";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Operation = "status" | "channel" | "check" | "prepare" | "reset";

/** Release operations only prepare a future runtime; service lifecycle stays with confirmed actions. */
export function OpenCodeReleaseSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const id = useId();
  const [status, setStatus] = useState<OpenCodeReleaseStatus | null>(null);
  const [busy, setBusy] = useState<Operation | null>("status");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState<OpenCodeReleaseStatus["offer"]>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const retry = useRef<(() => void) | null>(null);

  useEffect(() => {
    onBusyChange?.(busy !== null || consent !== null);
  }, [busy, consent, onBusyChange]);

  async function run(
    operation: Operation,
    request: () => Promise<OpenCodeReleaseStatus>,
    message?: string,
    retryAction?: () => void,
  ) {
    if (locked.current || (disabled && operation !== "status")) return;
    locked.current = true;
    const current = generation.current;
    setBusy(operation);
    setError(null);
    setNotice(null);
    retry.current = retryAction ?? (() => void run(operation, request, message));
    try {
      const result = await request();
      if (current !== generation.current) return;
      setStatus(result);
      setNotice(message ?? null);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "OpenCode release action failed.");
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  }

  useEffect(() => {
    // Local metadata only. Checking the release feed is always a user action.
    void run("status", () => palot.openCodeReleaseStatus());
    let request = 0;
    const current = generation.current;
    const refresh = () => {
      // The initiating operation already receives the authoritative result. Keep
      // sibling checks in sync without blurring an in-flight channel selection.
      if (locked.current) return;
      const sequence = ++request;
      void palot
        .openCodeReleaseStatus()
        .then((result) => {
          if (current === generation.current && sequence === request && !locked.current) {
            setStatus(result);
          }
        })
        .catch(() => {
          if (current === generation.current) setError("Could not refresh local release settings.");
        });
    };
    window.addEventListener("palot:opencode-release-changed", refresh);
    return () => {
      generation.current += 1;
      locked.current = false;
      window.removeEventListener("palot:opencode-release-changed", refresh);
    };
    // Initial load is intentionally independent of lifecycle control state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function prepare(offer: NonNullable<OpenCodeReleaseStatus["offer"]>, allowUntested = false) {
    if (locked.current || disabled) return;
    if (offer.requiresConfirmation && !allowUntested) {
      setConsent(offer);
      return;
    }
    setConsent(null);
    void run(
      "prepare",
      () =>
        palot.prepareOpenCodeRelease({
          version: offer.version,
          ...(allowUntested ? { allowUntested: true } : {}),
        }),
      `Palot runtime ${offer.version} is prepared as a fallback or for the Palot runtime source. The existing service is unchanged.`,
      () => prepare(offer),
    );
  }

  const blocked = disabled || busy !== null || consent !== null;
  // Keep the save's initiating trigger focusable for the popup's native focus
  // return. Read-only prevents another selection without blurring the keyboard user.
  const channelDisabled = disabled || consent !== null || (busy !== null && busy !== "channel");
  return (
    <SettingsSection
      title="OpenCode release"
      description="Choose the shared update channel and prepare an optional Palot fallback, separately from app updates."
    >
      <SettingsGroup>
        <div className="@container/release min-w-0 space-y-4 p-4">
          {status ? (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={id}>Preferred channel</FieldLabel>
                  <Select
                    value={status.channel}
                    disabled={channelDisabled}
                    readOnly={busy === "channel"}
                    onValueChange={(channel) => {
                      if (channel !== "stable" && channel !== "beta") return;
                      void run(
                        "channel",
                        () => palot.setOpenCodeReleaseChannel(channel),
                        "Channel saved. Your prepared runtime is unchanged. Check for a release when ready.",
                      );
                    }}
                  >
                    <SelectTrigger
                      id={id}
                      aria-describedby={`${id}-help`}
                      aria-busy={busy === "channel"}
                    >
                      <SelectValue>{status.channel === "beta" ? "Beta" : "Stable"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stable">Stable</SelectItem>
                      <SelectItem value="beta">Beta</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription id={`${id}-help`}>
                    Stable is the default. Beta is an experimental channel and may lag behind
                    Stable. Stable 2.x is supported; features added in a later release may require
                    that release. Changing channels does not download or replace a runtime.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <dl className="grid min-w-0 gap-3 text-sm @md/release:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-meta text-muted-foreground">
                    Currently running service version
                  </dt>
                  <dd className="mt-1 wrap-anywhere">
                    {runtime?.connected ? (runtime.version ?? "Unknown") : "Not connected"}
                    {runtime?.connected && runtime.source === "network-server"
                      ? " (remote service)"
                      : ""}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-meta text-muted-foreground">Prepared Palot runtime</dt>
                  <dd className="mt-1 wrap-anywhere">
                    {status.preparedVersion ?? status.bundledVersion}
                    {status.preparedVersion ? " (downloaded)" : " (bundled)"}
                  </dd>
                </div>
              </dl>
              <p className="text-compact leading-relaxed text-muted-foreground">
                Preparation and reset never start, stop, or change the shared service. An installed
                OpenCode is preferred by default. This runtime is used only as a fallback or when
                you select Palot runtime, on a separate confirmed start or restart.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => void run("check", () => palot.checkOpenCodeRelease())}
                >
                  {busy === "check" ? "Checking…" : "Check for release"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked || !status.preparedVersion}
                  onClick={() =>
                    void run(
                      "reset",
                      () => palot.resetOpenCodeRelease(),
                      `Bundled OpenCode ${status.bundledVersion} is the Palot fallback again. The installed CLI and existing service are unchanged.`,
                    )
                  }
                >
                  Reset to bundled {status.bundledVersion}
                </Button>
              </div>
              {status.offer ? (
                <div className="space-y-2">
                  <p className="text-compact wrap-anywhere">
                    {status.offer.channel === "beta" ? "Beta" : "Stable"} offers OpenCode{" "}
                    {status.offer.version} ·{" "}
                    {status.offer.tested
                      ? "Tested with Palot"
                      : status.offer.requiresConfirmation
                        ? "Compatibility unverified · not tested with Palot"
                        : "Compatible · not yet tested with this Palot build"}{" "}
                    · {(status.offer.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={blocked || status.preparedVersion === status.offer.version}
                    onClick={() => status.offer && prepare(status.offer)}
                  >
                    {busy === "prepare"
                      ? "Preparing…"
                      : `Download Palot fallback ${status.offer.version}`}
                  </Button>
                </div>
              ) : status.checkedAt ? (
                <p className="text-compact text-muted-foreground">
                  No release offered for this channel.
                </p>
              ) : null}
              <p className="text-meta text-muted-foreground">
                {status.checkedAt
                  ? `Last checked: ${new Date(status.checkedAt).toLocaleString()}`
                  : "Not checked yet. Releases are checked only when you ask."}
              </p>
            </>
          ) : busy ? (
            <p role="status" className="text-compact text-muted-foreground">
              Loading local release settings…
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-compact text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not update OpenCode release settings</AlertTitle>
              <AlertDescription>
                <p className="wrap-anywhere">{error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => retry.current?.()}
                >
                  Retry release action
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </SettingsGroup>
      <AlertDialog open={consent !== null} onOpenChange={(open) => !open && setConsent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prepare untested OpenCode {consent?.version}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {consent?.channel === "beta" ? "Beta" : "Stable"} release has not been tested
              with Palot. The current API has no feature manifest, so compatibility is not
              guaranteed and some features may fail. Downloading prepares it for a later confirmed
              start or restart; it does not change the running service. You can reset to the bundled
              runtime to roll back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || busy !== null}
              onClick={() => consent && prepare(consent, true)}
            >
              Continue and prepare
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

/** Accessible, lazy setup access even when the workspace has not connected yet. */
export function OpenCodeReleaseSetup() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value || !busy) setOpen(value);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        OpenCode release settings
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up local OpenCode</DialogTitle>
          <DialogDescription>
            Manage installed OpenCode or prepare a fallback without changing the shared service.
            Close this dialog to use the separate confirmed start or restart action.
          </DialogDescription>
        </DialogHeader>
        {open ? <LocalOpenCodeRuntimeSettings onBusyChange={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Share operation locks, not runtime ownership, between installation and release controls. */
export function LocalOpenCodeRuntimeSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const [installationBusy, setInstallationBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(installationBusy || releaseBusy);
  }, [installationBusy, releaseBusy, onBusyChange]);
  return (
    <div className="min-w-0 space-y-8">
      <OpenCodeInstallationSettings
        disabled={disabled || releaseBusy}
        onBusyChange={setInstallationBusy}
      />
      <OpenCodeReleaseSettings
        disabled={disabled || installationBusy}
        onBusyChange={setReleaseBusy}
      />
    </div>
  );
}
