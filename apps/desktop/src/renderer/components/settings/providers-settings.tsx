import type { LocationRef } from "@opencode/client";
import {
  ArrowRight,
  Cable,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unplug,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type {
  PalotIntegration,
  PalotIntegrationConnection,
  PalotProject,
  PalotSettingsSnapshot,
} from "../../../shared";
import { modelPickerPreferencesAtom } from "../../atoms/ui";
import { useSettingsOwner } from "../../hooks/use-settings-owner";
import { cn } from "../../lib/cn";
import {
  modelPreferenceKey,
  modelProjectPreferenceKey,
  reconcileModelPreference,
} from "../../lib/model-preferences";
import { isPopularProvider, orderProviderIntegrations } from "../../lib/provider-presentation";
import { palot } from "../../services/palot";
import { useArmedConfirm } from "../pull-requests/use-armed-confirm";
import { ProviderConnectionDialog } from "../provider-connection-dialog";
import {
  SettingsDisclosure,
  SettingsEmpty,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "../settings-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { CopyField } from "../ui/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { ProviderIcon } from "../ui/provider-icon";
import { toast } from "../ui/toast";
import {
  PROVIDER_SOURCE_DESCRIPTION,
  PROVIDER_SOURCE_LABEL,
  connectable,
  connectedProviderEntries,
  envNames,
  providerPolicy,
  type ProviderEntry,
} from "./provider-model-data";
import { useModelProviderLinks } from "./settings-links";

const COLLAPSED_PROVIDER_COUNT = 8;
/** Disconnecting reads a sentence first, so it stays armed a little longer than row actions. */
const DISCONNECT_ARMED_MS = 5_000;

type CredentialActionTarget = {
  integration: PalotIntegration;
  connection: PalotIntegrationConnection;
};

type LocationInput = {
  connectionID: string | undefined;
  projectID: string;
  directory: string;
  workspaceID?: string;
};

export function ProviderSettings({
  project,
  location,
  snapshot,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  snapshot: PalotSettingsSnapshot | null;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const links = useModelProviderLinks(project.id);
  const preferences = useAtomValue(modelPickerPreferencesAtom);
  const [dialog, setDialog] = useState<PalotIntegration | null>(null);
  const [wellknownOpen, setWellknownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [busyCredentialID, setBusyCredentialID] = useState<string | null>(null);
  const [disconnectingID, setDisconnectingID] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CredentialActionTarget | null>(null);
  const [rename, setRename] = useState<{
    integrationName: string;
    credentialID: string;
    label: string;
  } | null>(null);
  const integrations = snapshot?.integrations ?? [];
  const configSources = snapshot?.configSources ?? [];
  const models = snapshot?.catalog.models ?? [];
  const hidden = new Set(
    reconcileModelPreference(
      models,
      preferences[modelProjectPreferenceKey(owner?.profileID ?? "disconnected", project.id)],
    ).hidden,
  );
  const entries = connectedProviderEntries({
    integrations,
    providers: snapshot?.catalog.providers ?? [],
    configSources,
  });
  const connectedIDs = new Set(entries.map((entry) => entry.id));
  const normalizedQuery = providerQuery.trim().toLowerCase();
  const matches = (name: string, id: string) =>
    !normalizedQuery || `${name} ${id}`.toLowerCase().includes(normalizedQuery);
  const available = orderProviderIntegrations(integrations).filter(
    (integration) => !connectedIDs.has(integration.id) && matches(integration.name, integration.id),
  );
  const popular = available
    .filter((integration) => isPopularProvider(integration.id))
    .slice(0, COLLAPSED_PROVIDER_COUNT);
  const browsing = expanded || Boolean(normalizedQuery);
  const visibleAvailable = browsing ? available : popular;
  const connectedMatches = normalizedQuery
    ? entries.filter((entry) => matches(entry.name, entry.id))
    : [];
  const storedCredentialCount = integrations.reduce(
    (count, integration) =>
      count +
      integration.connections.filter((connection) => connection.type === "credential").length,
    0,
  );
  const integrationsError = snapshot?.errors.find((error) => error.capability === "integrations");
  const locationInput: LocationInput = {
    connectionID: owner?.connectionID,
    projectID: project.id,
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };

  async function activate(connection: PalotIntegrationConnection) {
    if (!connection.id || connection.active) return;
    setBusyCredentialID(connection.id);
    try {
      await palot.activateCredential({ ...locationInput, credentialID: connection.id });
      await refresh();
      toast.add({ type: "success", title: `${connection.label} is now in use` });
    } catch (cause) {
      showError("Could not switch credential", cause);
    } finally {
      setBusyCredentialID(null);
    }
  }

  async function removeCredential(target: CredentialActionTarget) {
    if (!target.connection.id) return;
    const credentialID = target.connection.id;
    setRemoving(null);
    setBusyCredentialID(credentialID);
    try {
      await palot.removeCredential({ ...locationInput, credentialID });
      await refresh();
      toast.add({ type: "success", title: `${target.connection.label} removed` });
    } catch (cause) {
      showError("Could not remove credential", cause);
    } finally {
      setBusyCredentialID(null);
    }
  }

  async function disconnect(entry: ProviderEntry) {
    const credentials = (entry.integration?.connections ?? []).filter(
      (connection): connection is PalotIntegrationConnection & { id: string } =>
        connection.type === "credential" && Boolean(connection.id),
    );
    if (credentials.length === 0) return;
    setDisconnectingID(entry.id);
    try {
      for (const credential of credentials) {
        await palot.removeCredential({ ...locationInput, credentialID: credential.id });
      }
      toast.add({ type: "success", title: `${entry.name} disconnected` });
    } catch (cause) {
      showError(`Could not disconnect ${entry.name}`, cause);
    } finally {
      await refresh().catch(() => undefined);
      setDisconnectingID(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Connected providers"
        description="Credentials belong to this OpenCode service and are shared by every project connected to it."
        icon={Cable}
        action={
          <>
            <Badge variant="outline">
              {entries.length} connected · {storedCredentialCount} stored
            </Badge>
            {links.available ? (
              <Button type="button" variant="outline" size="sm" onClick={() => links.openModels()}>
                Choose models
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {integrationsError ? (
            <SettingsNotice
              status="error"
              title={
                integrations.length ? "Could not refresh providers" : "Could not load providers"
              }
            >
              {integrationsError.message}
            </SettingsNotice>
          ) : null}
          {entries.map((entry) => {
            const owned = new Set(entry.providers.map((provider) => provider.id));
            const providerModels = models.filter((model) => owned.has(model.providerID));
            return (
              <ConnectedProviderCard
                key={entry.id}
                entry={entry}
                shownModels={
                  providerModels.filter((model) => !hidden.has(modelPreferenceKey(model))).length
                }
                totalModels={providerModels.length}
                busyCredentialID={busyCredentialID}
                disconnecting={disconnectingID === entry.id}
                onOpenModels={links.available ? () => links.openModels(entry.id) : undefined}
                onActivate={(connection) => void activate(connection)}
                onConnect={() => entry.integration && setDialog(entry.integration)}
                onRename={(connection) =>
                  setRename({
                    integrationName: entry.name,
                    credentialID: connection.id!,
                    label: connection.label,
                  })
                }
                onRemove={(connection) =>
                  entry.integration && setRemoving({ integration: entry.integration, connection })
                }
                onDisconnect={() => void disconnect(entry)}
              />
            );
          })}
          {entries.length === 0 && !integrationsError ? (
            <SettingsGroup>
              <SettingsEmpty>
                {snapshot
                  ? "No providers are connected to this OpenCode service yet. Add one below."
                  : "Providers are unavailable. Refresh settings when OpenCode is connected."}
              </SettingsEmpty>
            </SettingsGroup>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Add a provider"
        description="Sign in, add an API key, or set an environment variable before OpenCode starts."
        icon={Plus}
        action={
          expanded || available.length > popular.length ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Popular only" : "Browse all"}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={providerQuery}
              placeholder="Search providers"
              aria-label="Search providers"
              className="h-8 pl-8"
              onChange={(event) => setProviderQuery(event.target.value)}
            />
          </div>
          {connectedMatches.length > 0 ? (
            <p className="text-meta text-muted-foreground">
              Already connected: {connectedMatches.map((entry) => entry.name).join(", ")}
            </p>
          ) : null}
          {visibleAvailable.length > 0 ? (
            <div
              role="list"
              aria-label={browsing ? "Available providers" : "Popular providers"}
              className="grid gap-px overflow-hidden rounded-xl border border-border bg-border @3xl/settings:grid-cols-2"
            >
              {visibleAvailable.map((integration, index) => (
                <AvailableProviderRow
                  key={integration.id}
                  integration={integration}
                  blocked={providerPolicy(configSources, integration.id)?.effect === "deny"}
                  className={cn(
                    visibleAvailable.length % 2 === 1 &&
                      index === visibleAvailable.length - 1 &&
                      "@3xl/settings:col-span-2",
                  )}
                  onConnect={() => setDialog(integration)}
                />
              ))}
            </div>
          ) : (
            <SettingsGroup>
              <SettingsEmpty>
                {!snapshot
                  ? "Providers are unavailable. Refresh settings when OpenCode is connected."
                  : normalizedQuery
                    ? "No other providers match this search."
                    : available.length > 0
                      ? "Every popular provider is connected. Browse all providers to add more."
                      : "OpenCode returned no other provider integrations."}
              </SettingsEmpty>
            </SettingsGroup>
          )}
          {!browsing && available.length > visibleAvailable.length ? (
            <p className="text-meta text-muted-foreground">
              {available.length - visibleAvailable.length} more providers, including ones you
              connect with an environment variable, are under Browse all.
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsDisclosure
        title="Advanced provider sources"
        description="Add a custom integration catalog from a trusted well-known URL. Most providers don't need this."
      >
        <SettingsRow
          title="Custom integration catalog"
          description="OpenCode fetches and keeps the integrations this source publishes. They appear in the lists above."
          control={
            <Button type="button" variant="outline" onClick={() => setWellknownOpen(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add source
            </Button>
          }
        />
        <SettingsNotice inGroup status="neutral">
          OpenCode doesn't list the sources already added, so Palot can't show or remove them here.
        </SettingsNotice>
      </SettingsDisclosure>

      <ProviderConnectionDialog
        key={`connect:${dialog?.id ?? "closed"}`}
        integration={dialog}
        projectID={project.id}
        location={location}
        onOpenChange={(open) => !open && setDialog(null)}
        onComplete={refresh}
      />
      <WellknownIntegrationDialog
        open={wellknownOpen}
        locationInput={locationInput}
        onOpenChange={setWellknownOpen}
        onComplete={refresh}
      />
      <CredentialLabelDialog
        key={`rename:${rename?.credentialID ?? "closed"}`}
        credential={rename}
        locationInput={locationInput}
        onOpenChange={(open) => !open && setRename(null)}
        onComplete={refresh}
      />
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.connection.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? credentialRemovalDescription(removing) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyCredentialID !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyCredentialID !== null}
              onClick={() => removing && void removeCredential(removing)}
            >
              Remove credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectedProviderCard({
  entry,
  shownModels,
  totalModels,
  busyCredentialID,
  disconnecting,
  onOpenModels,
  onActivate,
  onConnect,
  onRename,
  onRemove,
  onDisconnect,
}: {
  entry: ProviderEntry;
  shownModels: number;
  totalModels: number;
  busyCredentialID: string | null;
  disconnecting: boolean;
  onOpenModels?: () => void;
  onActivate(connection: PalotIntegrationConnection): void;
  onConnect(): void;
  onRename(connection: PalotIntegrationConnection): void;
  onRemove(connection: PalotIntegrationConnection): void;
  onDisconnect(): void;
}) {
  const connections = entry.integration?.connections ?? [];
  const credentials = connections.filter((connection) => connection.type === "credential");
  const environment = connections.filter((connection) => connection.type === "env");
  const confirmDisconnect = useArmedConfirm(onDisconnect, DISCONNECT_ARMED_MS);
  const summary =
    [
      credentials.length
        ? `${credentials.length} stored credential${credentials.length === 1 ? "" : "s"}`
        : null,
      environment.length
        ? `${environment.length} environment fallback${environment.length === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || PROVIDER_SOURCE_DESCRIPTION[entry.source];
  const off = Boolean(entry.blocked) || entry.disabled;
  const modelCount =
    totalModels > 0 ? `${shownModels} of ${totalModels} models shown` : "No models available";
  const remains = [
    environment.length
      ? `${entry.name} will fall back to ${environment[0]!.label} from the environment`
      : null,
    entry.source === "config" ? "its OpenCode config definition stays" : null,
  ].filter(Boolean);

  return (
    <article
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={`${entry.name} connections`}
      data-source={entry.source}
    >
      <header className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/55 text-foreground">
          <ProviderIcon id={entry.id} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold wrap-anywhere">{entry.name}</h3>
            <Badge variant="outline" size="sm" title={PROVIDER_SOURCE_DESCRIPTION[entry.source]}>
              {PROVIDER_SOURCE_LABEL[entry.source]}
            </Badge>
            {off ? (
              <Badge variant="warning" size="sm">
                Disabled by config
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-compact text-muted-foreground">{summary}</p>
          {off ? null : onOpenModels ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto px-0"
              onClick={onOpenModels}
            >
              {modelCount}
            </Button>
          ) : (
            <p className="mt-1 text-meta text-muted-foreground">{modelCount}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {entry.integration && connectable(entry.integration) ? (
            <Button type="button" variant="outline" size="sm" onClick={onConnect}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add credential
            </Button>
          ) : null}
          {credentials.length > 0 ? (
            <Button
              type="button"
              variant={confirmDisconnect.armed ? "destructive" : "ghost"}
              size="sm"
              disabled={disconnecting}
              {...confirmDisconnect.buttonProps}
            >
              {disconnecting ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              ) : (
                <Unplug data-icon="inline-start" aria-hidden="true" />
              )}
              {confirmDisconnect.armed ? "Confirm disconnect" : "Disconnect"}
            </Button>
          ) : null}
        </div>
      </header>
      {/* Kept mounted so the notice collapses with its exit motion when disarmed. */}
      <div className="px-4">
        <Banner
          status="warning"
          open={confirmDisconnect.armed}
          title={`Disconnect ${entry.name}?`}
          className="mb-3"
        >
          This removes {credentials.length} stored credential
          {credentials.length === 1 ? "" : "s"} from this OpenCode service.{" "}
          {remains.length
            ? `${capitalize(remains.join(", and "))}.`
            : "Environment variables and OpenCode config aren't changed."}{" "}
          Press Confirm disconnect to continue.
        </Banner>
      </div>
      {off ? (
        <div className="px-4 pb-3">
          <Banner status="warning" title="Disabled by config">
            {entry.blocked
              ? `A provider.use deny policy (${entry.blocked.resource}) in ${entry.blocked.path ?? "OpenCode config"} turns ${entry.name} off. Its credentials stay stored; remove the policy to use it again.`
              : `OpenCode config turns ${entry.name} off. Its credentials stay stored.`}
          </Banner>
        </div>
      ) : null}
      {connections.length > 0 ? (
        <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/10">
          {connections.map((connection) => {
            const selectable = connection.type === "credential" && !connection.active;
            const busy = connection.id !== null && connection.id === busyCredentialID;
            return (
              <div
                key={connection.id ?? `${connection.type}:${connection.label}`}
                role="group"
                aria-label={`${connection.label} connection`}
                className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
              >
                <span
                  className={cn(
                    "size-2.5 shrink-0",
                    connection.type === "env" ? "rotate-45 rounded-[2px]" : "rounded-full",
                    connection.active
                      ? "bg-primary ring-2 ring-primary/15"
                      : "border border-muted-foreground/45 bg-background",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium wrap-anywhere",
                        connection.type === "env" && "font-mono text-code-compact",
                      )}
                    >
                      {connection.label}
                    </span>
                    {connection.active ? <Badge variant="secondary">In use</Badge> : null}
                  </div>
                  <p className="mt-1 text-compact text-muted-foreground">
                    {connection.type === "credential"
                      ? connectionMethodLabel(connection)
                      : connection.active
                        ? "Environment variable"
                        : "Environment fallback · used when stored credentials are removed"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {selectable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyCredentialID !== null || disconnecting}
                      onClick={() => onActivate(connection)}
                    >
                      {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                      Use
                    </Button>
                  ) : null}
                  {connection.type === "credential" && connection.id ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Manage ${connection.label}`}
                            disabled={busy || disconnecting}
                          />
                        }
                      >
                        <Ellipsis aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => onRename(connection)}>
                          <Pencil aria-hidden="true" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRemove(connection)}
                        >
                          <Trash2 aria-hidden="true" />
                          Remove credential
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function AvailableProviderRow({
  integration,
  blocked,
  className,
  onConnect,
}: {
  integration: PalotIntegration;
  blocked: boolean;
  className?: string;
  onConnect(): void;
}) {
  const names = envNames(integration);
  const canConnect = connectable(integration);
  return (
    <div
      role="listitem"
      aria-label={integration.name}
      className={cn("flex min-w-0 flex-col gap-3 bg-card p-4", className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50 text-foreground">
          <ProviderIcon id={integration.id} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium wrap-anywhere">{integration.name}</span>
            {blocked ? (
              <Badge variant="warning" size="sm">
                Disabled by config
              </Badge>
            ) : null}
          </div>
          <div className="font-mono text-code-compact wrap-anywhere text-muted-foreground">
            {integration.id}
          </div>
        </div>
        {canConnect ? (
          <Button type="button" variant="ghost" size="sm" onClick={onConnect}>
            Connect
          </Button>
        ) : null}
      </div>
      {!canConnect && names.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-meta text-muted-foreground">
            Set {names.length === 1 ? "this variable" : "one of these variables"} where OpenCode
            runs, then restart it.
          </p>
          {names.map((name) => (
            <CopyField key={name} value={name} valueName={`${name} variable name`} />
          ))}
        </div>
      ) : canConnect && names.length > 0 ? (
        <p className="text-meta text-muted-foreground">
          Or set <span className="font-mono text-code-compact">{names.join(", ")}</span> where
          OpenCode runs.
        </p>
      ) : !canConnect ? (
        <p className="text-meta text-muted-foreground">
          Palot can't connect this provider. Set it up in OpenCode config.
        </p>
      ) : null}
    </div>
  );
}

function connectionMethodLabel(connection: PalotIntegrationConnection): string {
  if (connection.method === "oauth") return "Account sign-in";
  if (connection.method === "key") return "Stored API key";
  if (connection.method === "external") return "External credential";
  return "Stored credential";
}

function credentialRemovalDescription({ integration, connection }: CredentialActionTarget): string {
  if (!connection.active) {
    return `This removes the stored credential from OpenCode. ${integration.name} will keep using its current credential.`;
  }
  const next = integration.connections.find(
    (candidate) => candidate.id !== connection.id && candidate.type === "credential",
  );
  if (next) {
    return `“${next.label}” will become active for ${integration.name} across this OpenCode service.`;
  }
  const environment = integration.connections.find((candidate) => candidate.type === "env");
  if (environment) {
    return `${integration.name} will fall back to ${environment.label} from the environment across this OpenCode service.`;
  }
  return `${integration.name} will no longer have a connection on this OpenCode service.`;
}

function WellknownIntegrationDialog({
  open,
  locationInput,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  locationInput: LocationInput;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await palot.addWellknownIntegration({ ...locationInput, url: url.trim() });
      await onComplete();
      setUrl("");
      onOpenChange(false);
      toast.add({ type: "success", title: "Integration source added" });
    } catch (cause) {
      showError("Could not add integration source", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add integration source</DialogTitle>
          <DialogDescription>
            OpenCode fetches the source's well-known document and persists the discovered
            integration configuration.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          Source URL
          <Input
            type="url"
            value={url}
            placeholder="https://example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !validHttpUrl(url)} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Add source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialLabelDialog({
  credential,
  locationInput,
  onOpenChange,
  onComplete,
}: {
  credential: { integrationName: string; credentialID: string; label: string } | null;
  locationInput: LocationInput;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [label, setLabel] = useState(() => credential?.label ?? "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!credential) return;
    setBusy(true);
    try {
      await palot.updateCredential({
        ...locationInput,
        credentialID: credential.credentialID,
        label: label.trim(),
      });
      await onComplete();
      onOpenChange(false);
      toast.add({ type: "success", title: `${credential.integrationName} credential renamed` });
    } catch (cause) {
      showError("Could not rename credential", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={Boolean(credential)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename credential</DialogTitle>
          <DialogDescription>
            The secret stays in OpenCode. Only its display label changes.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          Label
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !label.trim()} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function showError(title: string, cause: unknown) {
  toast.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "OpenCode rejected the request.",
  });
}
