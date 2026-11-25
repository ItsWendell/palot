import {
  Activity,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Globe2,
  Laptop,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import type { ConnectionOverview } from "../lib/connection-overview";
import { useAtom, useSetAtom } from "jotai";
import { includeStartedProfileAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { SharedOpenCodeAction } from "./opencode-connection-alert";
import { LocalOpenCodeRuntimeSettings } from "./open-code-release-settings";
import { OpenCodeLoginAutostartSettings } from "./open-code-login-autostart-settings";
import { useNavigate } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  WEAK_CREDENTIAL_STORAGE_MESSAGE,
  type OpenCodeConnectionCheck,
  type OpenCodeCredentialInput,
  type OpenCodeCredentialProtection,
  type OpenCodeProfile,
  type OpenCodeProfileCreateInput,
  type OpenCodeProfileSnapshot,
  type OpenCodeProfileUpdateInput,
  type OpenCodeWebAccessInfo,
} from "../../shared";
import { normalizeServerName, SERVER_NAME_MAX_LENGTH } from "../../shared/server-name";
import { writeClipboardText } from "../lib/clipboard";
import { ipcErrorMessage } from "../lib/ipc-error";
import { suggestedPairingAddress } from "../lib/pairing-address";
import { palot } from "../services/palot";
import {
  ConnectComputerDialog,
  ConnectionProblemNotice,
  ShareComputerDialog,
} from "./pairing-dialogs";
import { SettingsEmpty, SettingsGroup, SettingsNotice, SettingsSection } from "./settings-layout";
import { SshConnectionDialog } from "./ssh-connection-dialog";
import { Badge } from "./ui/badge";
import { Banner } from "./ui/banner";
import { Button, buttonVariants } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { CopyField } from "./ui/copy-field";
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { toast } from "./ui/toast";
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

type ConnectionTab = "profiles" | "web-access" | "local-service";

const TAB_ROUTES: Record<ConnectionTab, string> = {
  profiles: "/settings/connections/profiles",
  "web-access": "/settings/connections/web-access",
  "local-service": "/settings/connections/local-service",
};

/** Warns when saved server credentials are only obfuscated on disk. */
export function CredentialStorageNotice({
  protection,
}: {
  protection: OpenCodeCredentialProtection | null;
}) {
  if (protection !== "basic-text") return null;
  return (
    <SettingsNotice status="warning" title="Saved credentials are not encrypted">
      {WEAK_CREDENTIAL_STORAGE_MESSAGE}
    </SettingsNotice>
  );
}

export function ConnectionSettings({ tab }: { tab: ConnectionTab }) {
  const navigate = useNavigate();
  const { connections, includedProfileIDs, setIncludedProfileIDs, connect } =
    useConnectionOverview();
  const [snapshot, setSnapshot] = useState<OpenCodeProfileSnapshot | null>(null);
  const [protection, setProtection] = useState<OpenCodeCredentialProtection | null>(null);
  const [webAccess, setWebAccess] = useState<OpenCodeWebAccessInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<OpenCodeProfile | null>(null);
  const [renaming, setRenaming] = useState<OpenCodeProfile | null>(null);
  const [deleting, setDeleting] = useState<OpenCodeProfile | null>(null);
  const [busyID, setBusyID] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, ConnectionCheckState>>({});
  const [accessBusy, setAccessBusy] = useState<"enable" | "disable" | "restart" | null>(null);

  const reload = () => palot.listOpenCodeProfiles().then(setSnapshot);
  const reloadWebAccess = () => palot.openCodeWebAccessInfo().then(setWebAccess);
  useEffect(() => {
    void reload().catch(showError);
    // Separate from the profile list: it may wait on a system keyring prompt.
    void palot
      .openCodeCredentialProtection()
      .then(setProtection)
      .catch(() => setProtection(null));
  }, []);
  useEffect(() => {
    // Sharing needs to know whether a Tailscale address can be suggested.
    void reloadWebAccess().catch(tab === "profiles" ? () => undefined : showError);
  }, [tab]);

  const removeProfile = async (profile: OpenCodeProfile) => {
    setBusyID(profile.id);
    try {
      setSnapshot(await palot.deleteOpenCodeProfile(profile.id));
      toast.add({ type: "success", title: `Removed ${profile.name}` });
    } catch (error) {
      showError(error);
    } finally {
      setBusyID(null);
    }
  };

  const checkProfile = async (profile: OpenCodeProfile) => {
    setChecks((current) => ({ ...current, [profile.id]: { status: "checking" } }));
    try {
      const result = await palot.checkOpenCodeProfile(profile.id);
      setChecks((current) => ({ ...current, [profile.id]: { status: "done", result } }));
    } catch (error) {
      setChecks((current) => ({
        ...current,
        [profile.id]: {
          status: "done",
          result: {
            ok: false,
            problem: {
              step: "server",
              title: "Couldn’t test this connection.",
              fix: ipcErrorMessage(error, "Try again."),
            },
          },
        },
      }));
    }
  };

  const updateTailscale = async (enabled: boolean) => {
    setAccessBusy(enabled ? "enable" : "disable");
    try {
      setWebAccess(
        enabled
          ? await palot.enableOpenCodeTailscaleAccess()
          : await palot.disableOpenCodeTailscaleAccess(),
      );
      toast.add({
        type: "success",
        title: enabled ? "OpenCode is available on your tailnet" : "Tailscale access disabled",
      });
    } catch (error) {
      showError(error);
    } finally {
      setAccessBusy(null);
    }
  };

  const restartService = async () => {
    setAccessBusy("restart");
    try {
      await palot.restartLocalOpenCodeService();
      await reloadWebAccess();
      toast.add({ type: "success", title: "Local OpenCode service restarted" });
    } catch (error) {
      showError(error);
    } finally {
      setAccessBusy(null);
    }
  };

  const shareUnavailable = webAccess && !webAccess.local.pairingAvailable;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) =>
        void navigate({
          to: TAB_ROUTES[value as ConnectionTab],
          search: (previous) => previous,
        })
      }
      className="min-w-0 gap-6"
    >
      <div className="min-w-0 overflow-x-auto p-1">
        <TabsList aria-label="Connection settings">
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="web-access">Web access</TabsTrigger>
          <TabsTrigger value="local-service">Local service</TabsTrigger>
        </TabsList>
      </div>

      {tab === "profiles" ? (
        <div className="space-y-8">
          <CredentialStorageNotice protection={protection} />
          <SettingsSection
            title="Servers"
            description="Enabled servers share one workspace. Opening a task uses its server automatically. Disabling a server only disconnects Palot; it does not stop the server."
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setImportOpen(true)}>
                  <Link2 className="size-4" /> Connect to another computer
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="More ways to add a server"
                      />
                    }
                  >
                    <Plus className="size-4" /> Add
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => setAddOpen(true)}>
                      <Globe2 aria-hidden="true" /> Add by address…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSshOpen(true)}>
                      <Server aria-hidden="true" /> Add SSH connection…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          >
            <SettingsGroup>
              {snapshot?.profiles.map((profile) => (
                <ServerRow
                  key={profile.id}
                  profile={profile}
                  active={profile.id === snapshot.activeProfileID}
                  enabled={includedProfileIDs.includes(profile.id)}
                  connection={connections.find((entry) => entry.profile.id === profile.id)}
                  busy={busyID !== null}
                  check={checks[profile.id]}
                  onEnabledChange={(checked) =>
                    setIncludedProfileIDs((current) =>
                      checked
                        ? [...new Set([...current, profile.id])]
                        : current.filter((id) => id !== profile.id),
                    )
                  }
                  onReconnect={() => void connect(profile.id).catch(() => undefined)}
                  onCheck={() => void checkProfile(profile)}
                  onDismissCheck={() =>
                    setChecks((current) => {
                      const next = { ...current };
                      delete next[profile.id];
                      return next;
                    })
                  }
                  onRename={() => setRenaming(profile)}
                  onEdit={() => setEditing(profile)}
                  onPairAgain={() => setImportOpen(true)}
                  onRemove={() => setDeleting(profile)}
                />
              ))}
              {!snapshot ? <SettingsEmpty>Loading connections…</SettingsEmpty> : null}
            </SettingsGroup>
          </SettingsSection>

          <SettingsSection
            title="Share this computer"
            description="Let another computer, phone or tablet use this computer’s OpenCode with a one-time pairing code."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={shareUnavailable === true}
                onClick={() => setPairOpen(true)}
              >
                <QrCode className="size-4" /> Share this computer
              </Button>
              {shareUnavailable ? (
                <span className="text-compact text-muted-foreground">
                  {webAccess?.local.reason ?? "Connect to this computer’s OpenCode first."}
                </span>
              ) : null}
            </div>
          </SettingsSection>
        </div>
      ) : null}

      {tab === "web-access" ? (
        <WebAccessSettings
          info={webAccess}
          pairingAvailable={webAccess?.local.pairingAvailable ?? false}
          busy={accessBusy}
          onRefresh={() => void reloadWebAccess().catch(showError)}
          onPair={() => setPairOpen(true)}
          onEnable={() => void updateTailscale(true)}
          onDisable={() => void updateTailscale(false)}
        />
      ) : null}

      {tab === "local-service" ? (
        <LocalServiceSettings
          info={webAccess}
          busy={accessBusy === "restart"}
          onRefresh={() => void reloadWebAccess().catch(showError)}
          onRestart={() => void restartService()}
        />
      ) : null}

      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(value) => {
          setSnapshot(value);
          setAddOpen(false);
        }}
      />
      <ShareComputerDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        suggestedAddress={suggestedPairingAddress(webAccess)}
      />
      <ConnectComputerDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        profiles={snapshot?.profiles}
        onSaved={(value) => {
          setSnapshot(value);
          setChecks({});
        }}
      />
      <RenameServerDialog
        profile={renaming}
        taken={snapshot?.profiles.map((profile) => profile.name) ?? []}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onSaved={(value) => {
          setSnapshot(value);
          setRenaming(null);
        }}
      />
      <EditServerDialog
        profile={editing?.kind === "ssh" ? null : editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={(value) => {
          setSnapshot(value);
          setEditing(null);
        }}
      />
      {sshOpen || editing?.kind === "ssh" ? (
        <SshConnectionDialog
          key={editing?.id ?? "new"}
          profile={editing?.kind === "ssh" ? editing : undefined}
          onClose={() => {
            setSshOpen(false);
            setEditing(null);
          }}
          onSaved={(value) => {
            setSnapshot(value);
            setSshOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Palot forgets this connection and its saved sign-in. Nothing changes on the server:
              its OpenCode, tasks, and projects stay. The sign-in itself stays valid on that server
              until it expires, because OpenCode can’t sign out one device; change the server’s
              password to end every paired sign-in at once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyID !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyID !== null}
              onClick={() => {
                if (!deleting) return;
                const profile = deleting;
                setDeleting(null);
                void removeProfile(profile);
              }}
            >
              Remove connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}

type ConnectionCheckState =
  | { status: "checking" }
  | { status: "done"; result: OpenCodeConnectionCheck };

function connectionBadge(
  enabled: boolean,
  connection: ConnectionOverview | undefined,
): { label: string; variant: "success" | "neutral" | "warning" | "secondary" } {
  if (!enabled) return { label: "Disabled", variant: "neutral" };
  if (connection?.runtime?.connected) return { label: "Connected", variant: "success" };
  if (connection?.phase === "loading") return { label: "Connecting…", variant: "secondary" };
  return { label: "Offline", variant: "warning" };
}

function ServerRow({
  profile,
  active,
  enabled,
  connection,
  busy,
  check,
  onEnabledChange,
  onReconnect,
  onCheck,
  onDismissCheck,
  onRename,
  onEdit,
  onPairAgain,
  onRemove,
}: {
  profile: OpenCodeProfile;
  active: boolean;
  enabled: boolean;
  connection: ConnectionOverview | undefined;
  busy: boolean;
  check: ConnectionCheckState | undefined;
  onEnabledChange(checked: boolean): void;
  onReconnect(): void;
  onCheck(): void;
  onDismissCheck(): void;
  onRename(): void;
  onEdit(): void;
  onPairAgain(): void;
  onRemove(): void;
}) {
  const badge = connectionBadge(enabled, connection);
  const connected = enabled && connection?.runtime?.connected === true;
  const address =
    profile.kind === "remote" ? (profile.lastSuccessfulUrl ?? profile.urls[0] ?? null) : null;
  const version = connected ? connection?.runtime?.version : null;
  const offlineReason =
    enabled && !connected && connection?.phase !== "loading"
      ? (connection?.error ?? connection?.runtime?.error ?? null)
      : null;
  const isDefault = profile.id === "local-default";
  return (
    <div
      className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-start @lg/settings:gap-6"
      aria-label={profile.name}
      role="group"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h3 className="min-w-0 text-sm font-medium wrap-anywhere">{profile.name}</h3>
          <Badge variant={badge.variant} size="sm">
            {badge.label}
          </Badge>
        </div>
        <p className="mt-1 text-meta text-muted-foreground">
          {profile.kind === "local"
            ? "This computer · connects to the shared OpenCode service; Palot doesn’t start it automatically"
            : profile.kind === "ssh"
              ? `SSH · ${profileDescription(profile)} · the remote service keeps running when disconnected`
              : "Paired or added by address"}
          {version ? ` · OpenCode ${version}` : ""}
        </p>
        {address ? (
          <CopyField
            className="mt-2 max-w-md"
            value={address}
            valueName={`${profile.name} address`}
          />
        ) : null}
        {profile.kind === "remote" &&
        profile.urls.some((url) => url.startsWith("http://") && !isLoopback(url)) ? (
          <p className="mt-2 text-compact leading-relaxed text-warning">
            Plain HTTP can expose prompts, source, credentials, and terminal traffic.
          </p>
        ) : null}
        {offlineReason && check?.status !== "done" ? (
          <p className="mt-2 text-compact leading-relaxed text-muted-foreground wrap-anywhere">
            {offlineReason}
          </p>
        ) : null}
        {check?.status === "checking" ? (
          <p
            role="status"
            className="mt-2 flex items-center gap-2 text-compact text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" /> Testing {profile.name}…
          </p>
        ) : check?.status === "done" ? (
          check.result.ok ? (
            <Banner
              className="mt-2"
              status={check.result.supported ? "success" : "warning"}
              title={
                check.result.supported
                  ? `Reached ${profile.name}`
                  : `Reached ${profile.name}, but its OpenCode version isn’t supported`
              }
              dismissible
              onDismiss={onDismissCheck}
            >
              {`OpenCode ${check.result.version} at ${check.result.url}${check.result.secure ? "" : " over plain HTTP"}.`}
            </Banner>
          ) : (
            <ConnectionProblemNotice
              className="mt-2"
              problem={check.result.problem}
              actions={
                check.result.problem.step === "credentials" ? (
                  <Button type="button" size="sm" variant="outline" onClick={onPairAgain}>
                    Pair again
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={onCheck}>
                    Test again
                  </Button>
                )
              }
            />
          )
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 @lg/settings:justify-end">
        {enabled && !connected && connection?.phase !== "loading" ? (
          <Button type="button" size="sm" variant="outline" onClick={onReconnect}>
            <RefreshCw className="size-4" /> Reconnect
          </Button>
        ) : null}
        <div className="flex items-center gap-2 text-compact text-muted-foreground">
          <Switch
            aria-label={`Enable ${profile.name}`}
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Manage ${profile.name}`}
                disabled={busy}
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {!isDefault ? (
              <DropdownMenuItem onClick={onRename}>
                <Pencil aria-hidden="true" /> Rename…
              </DropdownMenuItem>
            ) : null}
            {profile.kind !== "ssh" ? (
              <DropdownMenuItem disabled={check?.status === "checking"} onClick={onCheck}>
                <Activity aria-hidden="true" /> Test connection
              </DropdownMenuItem>
            ) : null}
            {profile.kind === "remote" ? (
              <DropdownMenuItem onClick={onPairAgain}>
                <Link2 aria-hidden="true" /> Pair again…
              </DropdownMenuItem>
            ) : null}
            {!isDefault && !active ? (
              <DropdownMenuItem onClick={onEdit}>
                <Settings2 aria-hidden="true" />
                {profile.kind === "ssh" ? "Edit SSH connection…" : "Edit address and sign-in…"}
              </DropdownMenuItem>
            ) : null}
            {!isDefault ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={active} onClick={onRemove}>
                  <Trash2 aria-hidden="true" />
                  {active ? "Remove (open a task on another server first)" : "Remove…"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function RenameServerDialog({
  profile,
  taken,
  onOpenChange,
  onSaved,
}: {
  profile: OpenCodeProfile | null;
  taken: string[];
  onOpenChange(open: boolean): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (profile) setName(profile.name);
  }, [profile]);
  if (!profile) return null;
  const normalized = normalizeServerName(name);
  const duplicate =
    normalized !== null &&
    normalized.toLocaleLowerCase() !== profile.name.toLocaleLowerCase() &&
    taken.some((value) => value.toLocaleLowerCase() === normalized.toLocaleLowerCase());
  const save = async () => {
    if (!normalized || duplicate) return;
    setBusy(true);
    try {
      const input: OpenCodeProfileUpdateInput =
        profile.kind === "remote"
          ? {
              id: profile.id,
              kind: "remote",
              name: normalized,
              urls: profile.urls,
              allowPlainHttp: profile.allowPlainHttp,
            }
          : profile.kind === "ssh"
            ? { id: profile.id, kind: "ssh", name: normalized, ssh: profile.ssh }
            : { id: profile.id, kind: "local", name: normalized };
      onSaved(await palot.updateOpenCodeProfile(input));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename {profile.name}</DialogTitle>
            <DialogDescription>
              The name shows in the task list, server menus and task destinations. It stays in
              Palot; the server isn’t told.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-meta text-muted-foreground" htmlFor="server-rename">
              Name
            </label>
            <Input
              id="server-rename"
              value={name}
              maxLength={SERVER_NAME_MAX_LENGTH}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              aria-invalid={!normalized || duplicate}
            />
            {duplicate ? (
              <p role="alert" className="text-meta text-destructive">
                Another server already uses this name.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !normalized || duplicate}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WebAccessSettings({
  info,
  pairingAvailable,
  busy,
  onRefresh,
  onPair,
  onEnable,
  onDisable,
}: {
  info: OpenCodeWebAccessInfo | null;
  pairingAvailable: boolean;
  busy: "enable" | "disable" | "restart" | null;
  onRefresh(): void;
  onPair(): void;
  onEnable(): void;
  onDisable(): void;
}) {
  const local = info?.local;
  const tailscale = info?.tailscale;
  const [publicQr, setPublicQr] = useState<string | null>(null);
  const [showPublicQr, setShowPublicQr] = useState(false);
  useEffect(() => {
    setPublicQr(null);
    setShowPublicQr(false);
  }, [tailscale?.publicUrl]);
  const togglePublicQr = async () => {
    if (showPublicQr) {
      setShowPublicQr(false);
      return;
    }
    if (!tailscale?.publicUrl) return;
    try {
      setPublicQr(
        publicQr ?? (await QRCode.toDataURL(tailscale.publicUrl, { margin: 1, width: 320 })),
      );
      setShowPublicQr(true);
    } catch (error) {
      showError(error);
    }
  };
  return (
    <div className="min-w-0 space-y-8">
      <ConnectionCard
        icon={Laptop}
        title="This computer"
        description="Open the same OpenCode service and sessions in your local browser."
        badge={local?.available ? "Available" : "Unavailable"}
      >
        {local?.url ? <CodeValue value={local.url} /> : null}
        {local?.reason ? <InlineNotice>{local.reason}</InlineNotice> : null}
        <div className="flex flex-wrap gap-2">
          {local?.url ? (
            <a
              href={local.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              <ExternalLink className="size-4" /> Open OpenCode Web
            </a>
          ) : null}
          <Button type="button" variant="outline" disabled={!pairingAvailable} onClick={onPair}>
            <QrCode className="size-4" /> Share this computer
          </Button>
          <Button type="button" variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </ConnectionCard>

      <ConnectionCard
        icon={Globe2}
        title="Tailscale"
        description="Share the local web interface over HTTPS with devices allowed by your tailnet."
        badge={tailscaleBadge(tailscale)}
      >
        {tailscale?.publicUrl && tailscale.serveState === "active" ? (
          <CodeValue value={tailscale.publicUrl} />
        ) : null}
        {tailscale?.serveState === "conflict" ? (
          <InlineNotice>
            Tailscale Serve already uses the root web address for{" "}
            {tailscale.proxyTarget ?? "another service"}. Palot will not replace it.
          </InlineNotice>
        ) : null}
        {tailscale?.error ? <InlineNotice>{tailscale.error}</InlineNotice> : null}
        {!local?.available ? (
          <InlineNotice>
            Switch to the local OpenCode profile before enabling Tailscale access.
          </InlineNotice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {tailscale?.serveState === "active" && tailscale.publicUrl ? (
            <a
              href={tailscale.publicUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              <ExternalLink className="size-4" /> Open tailnet URL
            </a>
          ) : null}
          {tailscale?.serveState !== "active" ? (
            <Button
              type="button"
              disabled={
                busy !== null ||
                !local?.available ||
                tailscale?.connectionState !== "connected" ||
                tailscale?.serveState === "conflict"
              }
              onClick={onEnable}
            >
              {busy === "enable" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
              Enable tailnet access
            </Button>
          ) : null}
          {tailscale?.managedByPalot ? (
            <Button type="button" variant="outline" disabled={busy !== null} onClick={onDisable}>
              {busy === "disable" ? <LoaderCircle className="animate-spin" /> : <WifiOff />}
              Disable
            </Button>
          ) : null}
          {tailscale?.serveState === "active" && tailscale.publicUrl ? (
            <Button type="button" variant="outline" onClick={() => void togglePublicQr()}>
              <QrCode /> {showPublicQr ? "Hide phone QR" : "Show phone QR"}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        {showPublicQr && publicQr ? (
          <div className="w-fit rounded-lg border border-border/70 bg-white p-2">
            <img src={publicQr} alt="Tailscale OpenCode web address QR code" className="size-44" />
          </div>
        ) : null}
        <p className="text-compact leading-relaxed text-muted-foreground">
          OpenCode stays bound to loopback. Tailscale terminates HTTPS and applies your tailnet
          access rules. Funnel and public internet exposure are never enabled.
        </p>
      </ConnectionCard>
    </div>
  );
}

export function LocalServiceSettings({
  info,
  busy,
  onRefresh,
  onRestart,
}: {
  info: OpenCodeWebAccessInfo | null;
  busy: boolean;
  onRefresh(): void;
  onRestart(): void;
}) {
  const local = info?.local;
  const [runtime, setRuntime] = useAtom(runtimeAtom);
  const includeStartedProfile = useSetAtom(includeStartedProfileAtom);
  const [starting, setStarting] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const startService = async () => {
    setStarting(true);
    try {
      const started = await palot.connectOpenCode({ startLocalService: true });
      includeStartedProfile(started);
      setRuntime(started);
      onRefresh();
    } catch (error) {
      setRuntime(await palot.runtimeStatus().catch(() => runtime));
      showError(error);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="min-w-0 space-y-8">
      <LocalOpenCodeRuntimeSettings
        disabled={busy || starting || loginBusy}
        onBusyChange={setReleaseBusy}
      />
      <OpenCodeLoginAutostartSettings
        disabled={busy || starting || releaseBusy}
        onBusyChange={setLoginBusy}
      />
      <ConnectionCard
        icon={Server}
        title="Shared OpenCode service"
        description="Palot and other local OpenCode clients use this background service."
        badge={local?.available ? "Connected" : "Unavailable"}
      >
        {local?.url ? <CodeValue value={local.url} /> : null}
        <dl className="grid min-w-0 gap-4 text-sm @lg/settings:grid-cols-3">
          <ServiceDatum label="Running service version" value={local?.version ?? "Unknown"} />
          <ServiceDatum label="Process" value={local?.pid ? String(local.pid) : "Unknown"} />
          <ServiceDatum
            label="Lifecycle"
            value={local?.managed ? "Started by Palot" : "Shared service"}
          />
        </dl>
        {local?.reason ? <InlineNotice>{local.reason}</InlineNotice> : null}
        <div className="flex flex-wrap gap-2">
          {!runtime?.connected && runtime?.canStartLocalService ? (
            <SharedOpenCodeAction
              disabled={busy || starting || releaseBusy || loginBusy}
              onConfirm={() => void startService()}
            />
          ) : null}
          <SharedOpenCodeAction
            action="restart"
            disabled={busy || starting || releaseBusy || loginBusy || !local?.restartAvailable}
            onConfirm={onRestart}
          />
          <Button type="button" variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        <p className="text-compact leading-relaxed text-muted-foreground">
          Palot only connects to an existing shared service by default. Starting or recovering it
          requires confirmation and may interrupt other clients. Persistent hostname, port,
          password, and environment settings remain owned by OpenCode. Login startup only registers
          the installed CLI with your user service manager.
        </p>
      </ConnectionCard>
    </div>
  );
}

function ConnectionCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: typeof Server;
  title: string;
  description: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      icon={Icon}
      title={title}
      description={description}
      action={<Badge variant="outline">{badge}</Badge>}
    >
      <SettingsGroup>
        <div className="min-w-0 space-y-4 p-4">{children}</div>
      </SettingsGroup>
    </SettingsSection>
  );
}

function CodeValue({ value }: { value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 py-1 text-code-compact wrap-anywhere">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy address"
        onClick={() => void writeClipboardText(value)}
      >
        <Copy />
      </Button>
    </div>
  );
}

function InlineNotice({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-start gap-2 text-compact leading-relaxed text-muted-foreground">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </p>
  );
}

function ServiceDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium wrap-anywhere">{value}</dd>
    </div>
  );
}

function tailscaleBadge(info: OpenCodeWebAccessInfo["tailscale"] | undefined): string {
  if (!info) return "Checking";
  if (info.connectionState === "unavailable") return "Not installed";
  if (info.connectionState === "disconnected") return "Disconnected";
  if (info.serveState === "active")
    return info.managedByPalot ? "Shared by Palot" : "Already shared";
  if (info.serveState === "conflict") return "Root address in use";
  return "Connected";
}

function EditServerDialog({
  profile,
  onOpenChange,
  onSaved,
}: {
  profile: OpenCodeProfile | null;
  onOpenChange(open: boolean): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const [auth, setAuth] = useState<"none" | "basic" | "bearer">("none");
  const [username, setUsername] = useState("opencode");
  const [secret, setSecret] = useState("");
  const [replaceCredential, setReplaceCredential] = useState(false);
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setUrls(profile.kind === "remote" ? profile.urls.join("\n") : "");
    setAllowPlainHttp(profile.kind === "remote" && profile.allowPlainHttp);
    setAuth("none");
    setUsername("opencode");
    setSecret("");
    setReplaceCredential(false);
    setTested(null);
  }, [profile]);

  if (!profile || profile.kind !== "remote") return null;
  const remoteUrls = splitUrls(urls);
  const credentialInput = credential(auth, username, secret);
  const update: OpenCodeProfileUpdateInput = {
    id: profile.id,
    kind: "remote",
    name: name.trim(),
    urls: remoteUrls,
    allowPlainHttp,
    ...(replaceCredential ? { credential: credentialInput } : {}),
  };

  const test = async () => {
    setBusy(true);
    setTested(null);
    try {
      const result = await palot.testOpenCodeProfile({
        kind: "remote",
        name: name.trim(),
        urls: remoteUrls,
        credential: replaceCredential ? credentialInput : { type: "none" },
        allowPlainHttp,
      });
      setTested(`OpenCode ${result.version} at ${result.url}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await palot.updateOpenCodeProfile(update));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const canTest = (profile.credentialID === null || replaceCredential) && remoteUrls.length > 0;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit OpenCode server</DialogTitle>
          <DialogDescription>
            Changes take effect the next time this profile connects.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Server name"
          />
          <Textarea
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            rows={3}
            placeholder="One server URL per line"
          />
          {profile.credentialID ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={replaceCredential}
                onCheckedChange={(checked) => {
                  const replacing = checked === true;
                  setReplaceCredential(replacing);
                  if (replacing) setAllowPlainHttp(false);
                }}
              />
              Replace stored credentials
            </label>
          ) : null}
          {profile.credentialID === null || replaceCredential ? (
            <>
              <Select value={auth} onValueChange={(value) => setAuth(value as typeof auth)}>
                <SelectTrigger aria-label="Authentication">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No authentication</SelectItem>
                  <SelectItem value="basic">Username and password</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                </SelectContent>
              </Select>
              {auth === "basic" ? (
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Username"
                />
              ) : null}
              {auth !== "none" ? (
                <Input
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={auth === "bearer" ? "Token" : "Password"}
                />
              ) : null}
            </>
          ) : null}
          {remoteUrls.some((url) => url.startsWith("http://") && !isLoopback(url)) ? (
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allowPlainHttp}
                onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
              />
              Allow plain HTTP. Traffic and credentials can be observed or modified in transit.
            </label>
          ) : null}
          {profile.credentialID && !replaceCredential ? (
            <p className="text-xs text-muted-foreground">
              Testing requires replacing the stored credential; Palot never returns it to the
              renderer.
            </p>
          ) : null}
          {tested ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              {tested}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !canTest}
            onClick={() => void test()}
          >
            Test
          </Button>
          <Button
            type="button"
            disabled={busy || !name.trim() || remoteUrls.length === 0}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddServerDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"none" | "basic" | "bearer">("none");
  const [username, setUsername] = useState("opencode");
  const [secret, setSecret] = useState("");
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const input = useMemo<OpenCodeProfileCreateInput>(() => {
    return {
      kind: "remote",
      name: name.trim() || new URL(url || "http://localhost").hostname,
      urls: [url],
      credential: credential(auth, username, secret),
      allowPlainHttp,
    };
  }, [allowPlainHttp, auth, name, secret, url, username]);

  const test = async () => {
    setBusy(true);
    setTested(null);
    try {
      const result = await palot.testOpenCodeProfile(input);
      setTested(`OpenCode ${result.version} at ${result.url}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await palot.createOpenCodeProfile(input));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add OpenCode server</DialogTitle>
          <DialogDescription>
            Remote servers run tools and read files on the server machine.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Server name"
          />
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://192.168.1.40:4096"
          />
          <Select value={auth} onValueChange={(value) => setAuth(value as typeof auth)}>
            <SelectTrigger aria-label="Authentication">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No authentication</SelectItem>
              <SelectItem value="basic">Username and password</SelectItem>
              <SelectItem value="bearer">Bearer token</SelectItem>
            </SelectContent>
          </Select>
          {auth === "basic" ? (
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
            />
          ) : null}
          {auth !== "none" ? (
            <Input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={auth === "bearer" ? "Token" : "Password"}
            />
          ) : null}
          {url.trim().toLowerCase().startsWith("http://") && !isLoopback(url) ? (
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allowPlainHttp}
                onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
              />
              Allow plain HTTP. Traffic and credentials can be observed or modified in transit.
            </label>
          ) : null}
          {tested ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              {tested}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !url}
            onClick={() => void test()}
          >
            Test
          </Button>
          <Button type="button" disabled={busy || !name.trim() || !url} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function credential(
  type: "none" | "basic" | "bearer",
  username: string,
  secret: string,
): OpenCodeCredentialInput {
  if (type === "basic") return { type, username, password: secret };
  if (type === "bearer") return { type, token: secret };
  return { type };
}

function splitUrls(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function profileDescription(profile: OpenCodeProfile): string {
  if (profile.kind === "ssh")
    return `${profile.ssh.target}${profile.ssh.port ? ` (port ${profile.ssh.port})` : ""}`;
  if (profile.kind === "remote")
    return profile.lastSuccessfulUrl ?? profile.urls[0] ?? "Remote OpenCode server";
  return "Connect to the existing shared OpenCode service on this computer. Palot does not start it automatically.";
}

function isLoopback(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function showError(error: unknown): void {
  toast.add({ type: "error", title: ipcErrorMessage(error, "OpenCode server action failed") });
}
