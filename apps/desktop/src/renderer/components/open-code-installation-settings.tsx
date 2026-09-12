import { useEffect, useId, useRef, useState } from "react";
import type {
  OpenCodeInstallation as Installation,
  OpenCodeInstallationStatus as Status,
  OpenCodeInstallMethod as Method,
} from "../../shared/opencode-installation-contract";
import type { OpenCodeReleaseStatus } from "../../shared/opencode-release-contract";
import { palot } from "../services/palot";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Operation = "inspect" | "preference" | "selection" | "check" | "upgrade";
const methods: Method[] = ["auto", "npm", "bun", "pnpm", "yarn", "curl"];

/** Local discovery and explicit official-CLI upgrades; never controls the shared service. */
export function OpenCodeInstallationSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [release, setRelease] = useState<OpenCodeReleaseStatus | null>(null);
  const [busy, setBusy] = useState<Operation | null>("inspect");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("auto");
  const [consent, setConsent] = useState<{
    installation: Installation;
    offer: NonNullable<OpenCodeReleaseStatus["offer"]>;
  } | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const releaseRequest = useRef(0);
  const installationRequest = useRef(0);

  useEffect(() => {
    onBusyChange?.(busy !== null || consent !== null);
  }, [busy, consent, onBusyChange]);

  async function run(operation: Operation, request: () => Promise<void>) {
    if (locked.current || (disabled && operation !== "inspect")) return;
    locked.current = true;
    installationRequest.current += 1;
    setBusy(operation);
    setError(null);
    setNotice(null);
    const current = generation.current;
    try {
      await request();
    } catch {
      // CLI output can include environment details. Never render raw process output.
      if (current === generation.current)
        setError(
          operation === "upgrade"
            ? "The installed OpenCode update could not be completed. Refresh installations to verify the version, or update manually using the official instructions."
            : "Could not read or save OpenCode settings. Try again when ready.",
        );
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  }

  useEffect(() => {
    const current = generation.current;
    const loadRelease = () => {
      const request = ++releaseRequest.current;
      void palot
        .openCodeReleaseStatus()
        .then((result) => {
          if (current === generation.current && request === releaseRequest.current)
            setRelease(result);
        })
        .catch(() => {
          if (current === generation.current)
            setError("Could not read the preferred release channel. Check for updates when ready.");
        });
    };
    // Local --version scans and cached release metadata only; no network on mount.
    void run("inspect", async () => {
      const result = await palot.inspectOpenCodeInstallations();
      if (current === generation.current) setStatus(result);
    });
    loadRelease();
    const refreshCached = () => {
      loadRelease();
      const request = ++installationRequest.current;
      void palot
        .openCodeInstallationStatus()
        .then((result) => {
          if (
            current === generation.current &&
            request === installationRequest.current &&
            !locked.current
          )
            setStatus(result);
        })
        .catch(() => {
          if (current === generation.current)
            setError(
              "Could not refresh local installation settings. Refresh installations when ready.",
            );
        });
    };
    window.addEventListener("palot:opencode-release-changed", refreshCached);
    return () => {
      generation.current += 1;
      locked.current = false;
      window.removeEventListener("palot:opencode-release-changed", refreshCached);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected =
    status?.installations.find((item) => item.id === status.selectedID) ??
    status?.installations.find((item) => item.compatible || item.approved) ??
    status?.installations[0];
  const selectedUsable = Boolean(selected && (selected.compatible || selected.approved));
  const blocked = disabled || busy !== null || consent !== null;
  const selectionDisabled = (operation: Operation) =>
    disabled || consent !== null || (busy !== null && busy !== operation);

  return (
    <SettingsSection
      title="Local OpenCode runtime"
      description="Prefer your installed OpenCode. Palot's bundled runtime is available as a fallback."
    >
      <SettingsGroup>
        <div className="min-w-0 space-y-4 p-4">
          {status ? (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${id}-source`}>Runtime source</FieldLabel>
                  <Select
                    value={status.preference}
                    disabled={selectionDisabled("preference")}
                    readOnly={busy === "preference"}
                    onValueChange={(preference) => {
                      if (preference !== "installed" && preference !== "palot") return;
                      void run("preference", async () => {
                        setStatus(await palot.setOpenCodeRuntimePreference(preference));
                        setNotice(
                          "Runtime source saved. Nothing was downloaded or restarted. Start or restart the service separately to apply a change.",
                        );
                      });
                    }}
                  >
                    <SelectTrigger
                      id={`${id}-source`}
                      aria-busy={busy === "preference"}
                      aria-describedby={`${id}-source-help`}
                    >
                      <SelectValue>
                        {status.preference === "installed"
                          ? "Installed OpenCode (recommended)"
                          : "Palot runtime"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="installed">Installed OpenCode (recommended)</SelectItem>
                      <SelectItem value="palot">Palot runtime</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription id={`${id}-source-help`}>
                    This selects the runtime for a separate confirmed start or restart. It never
                    changes a running service or installs OpenCode globally.
                  </FieldDescription>
                </Field>
                {status.installations.length > 1 ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-installation`}>Installed OpenCode</FieldLabel>
                    <Select
                      value={selected?.id ?? ""}
                      disabled={selectionDisabled("selection")}
                      readOnly={busy === "selection"}
                      onValueChange={(value) => {
                        if (!value) return;
                        void run("selection", async () => {
                          setStatus(await palot.selectOpenCodeInstallation(value));
                          setNotice("Installation selected. The running service is unchanged.");
                        });
                      }}
                    >
                      <SelectTrigger
                        id={`${id}-installation`}
                        aria-busy={busy === "selection"}
                        className="min-w-0 max-w-full"
                      >
                        <SelectValue className="min-w-0">
                          <span className="truncate">
                            {selected
                              ? `${selected.version} · ${selected.path}`
                              : "Select installation"}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {status.installations.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.version} · {item.path}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </FieldGroup>
              {selected ? (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-meta text-muted-foreground">Installed CLI version</dt>
                    <dd className="wrap-anywhere">
                      {selected.version}
                      {selected.compatible
                        ? ""
                        : selected.approved
                          ? " (approved beta)"
                          : " (not compatible)"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta text-muted-foreground">Installed CLI path</dt>
                    <dd className="text-code-compact wrap-anywhere">{selected.path}</dd>
                  </div>
                </dl>
              ) : null}
              {!selectedUsable ? (
                <p className="text-compact text-muted-foreground">
                  {selected
                    ? "No compatible selected installation is available."
                    : "No installed OpenCode was found."}{" "}
                  The bundled Palot runtime is already available as a fallback. Palot will not
                  install OpenCode globally automatically. To install or repair OpenCode manually,
                  follow the official installation instructions, then refresh installations.
                </p>
              ) : null}
              {status.error ? (
                <p role="alert" className="text-compact text-muted-foreground">
                  Some installations could not be inspected. Refresh installations or follow the
                  official instructions.
                </p>
              ) : null}
            </>
          ) : busy === "inspect" ? (
            <p role="status" className="text-compact text-muted-foreground">
              Inspecting local OpenCode installations…
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() =>
                void run("inspect", async () => {
                  setStatus(await palot.inspectOpenCodeInstallations());
                })
              }
            >
              Refresh installations
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() =>
                void run("check", async () => {
                  setRelease(await palot.checkOpenCodeRelease());
                })
              }
            >
              {busy === "check" ? "Checking…" : "Check for updates"}
            </Button>
          </div>
          <p className="text-meta text-muted-foreground">
            Updates use the shared preferred channel
            {release ? `: ${release.channel === "beta" ? "Beta" : "Stable"}` : ""}. Change it in
            OpenCode release below. Checks happen only when you ask.
          </p>
          {release?.offer && selected && selectedUsable ? (
            selected.version === release.offer.version ? (
              <p role="status" className="text-compact text-muted-foreground">
                Installed OpenCode is up to date
              </p>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={blocked}
                onClick={() => {
                  if (!release.offer || blocked) return;
                  setMethod("auto");
                  setConsent({ installation: selected, offer: release.offer });
                }}
              >
                Update installed OpenCode to {release.offer.version}
              </Button>
            )
          ) : null}
          {busy === "upgrade" ? (
            <p role="status" className="text-compact text-muted-foreground">
              Updating installed OpenCode… This can take several minutes and has a bounded timeout.
              There is no cancel action. The running service will not be restarted.
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-compact text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>OpenCode installation action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <a
            href="https://opencode.ai/v2/docs/"
            target="_blank"
            rel="noreferrer"
            className="text-compact underline underline-offset-4"
          >
            Official OpenCode installation instructions
          </a>
        </div>
      </SettingsGroup>
      <AlertDialog
        open={consent !== null}
        onOpenChange={(open) => {
          if (!open) setConsent(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Update installed OpenCode to {consent?.offer.version}?
            </AlertDialogTitle>
            <AlertDialogDescription className="wrap-anywhere">
              Run the official CLI upgrade for {consent?.installation.path}, from{" "}
              {consent?.installation.version} to {consent?.offer.version}. This changes an
              installation outside Palot and can take several minutes. It does not restart the
              shared service. Restart separately to apply the service change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {consent?.offer.requiresConfirmation ? (
            <Alert>
              <AlertTitle>Untested release</AlertTitle>
              <AlertDescription>
                This {consent.offer.channel === "beta" ? "Beta" : "Stable"} release has not been
                tested with Palot. Compatibility is not guaranteed and some features may fail.
                Confirm only if you accept that risk.
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-method`}>Install method</FieldLabel>
              <Select
                value={method}
                onValueChange={(value) => {
                  if (methods.includes(value as Method)) setMethod(value as Method);
                }}
              >
                <SelectTrigger id={`${id}-method`} aria-describedby={`${id}-method-help`}>
                  <SelectValue>
                    {method === "auto" ? "Auto (official CLI detects)" : method}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {methods.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "auto" ? "Auto (official CLI detects)" : value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${id}-method-help`}>
                Auto uses the official CLI's package-manager detection, which is not specific to an
                installation prefix. With multiple installations it may update a different
                installation. Override the method if needed, or update manually using the official
                instructions.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || busy !== null}
              onClick={() => {
                if (!consent || locked.current || disabled) return;
                const target = consent;
                setConsent(null);
                void run("upgrade", async () => {
                  const result = await palot.upgradeOpenCodeInstallation({
                    id: target.installation.id,
                    currentVersion: target.installation.version,
                    version: target.offer.version,
                    method,
                    ...(target.offer.requiresConfirmation ? { allowUntested: true } : {}),
                  });
                  setStatus(result);
                  setNotice(
                    "Installed OpenCode update completed. The running service is unchanged. Restart it separately to apply the service change.",
                  );
                });
              }}
            >
              Confirm installed update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
