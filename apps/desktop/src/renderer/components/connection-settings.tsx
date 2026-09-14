import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe2,
  Laptop,
  LoaderCircle,
  Pencil,
  Plus,
  QrCode,
  Server,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { useAtom } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { SharedOpenCodeAction } from "./opencode-connection-alert";
import { LocalOpenCodeRuntimeSettings } from "./open-code-release-settings";
import { OpenCodeLoginAutostartSettings } from "./open-code-login-autostart-settings";
import { useNavigate } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  OpenCodeCredentialInput,
  OpenCodePairingInfo,
  OpenCodePairPayload,
  OpenCodeProfile,
  OpenCodeProfileCreateInput,
  OpenCodeProfileSnapshot,
  OpenCodeProfileUpdateInput,
  OpenCodeWebAccessInfo,
} from "../../shared";
import { writeClipboardText } from "../lib/clipboard";
import { pairingInfoForAddress, suggestedPairingAddress } from "../lib/pairing-address";
import { palot } from "../services/palot";
import { SettingsEmpty, SettingsGroup, SettingsSection } from "./settings-layout";
import { SshConnectionDialog } from "./ssh-connection-dialog";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
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

export function ConnectionSettings({ tab }: { tab: ConnectionTab }) {
  const navigate = useNavigate();
  const { connections, includedProfileIDs, setIncludedProfileIDs } = useConnectionOverview();
  const [snapshot, setSnapshot] = useState<OpenCodeProfileSnapshot | null>(null);
  const [webAccess, setWebAccess] = useState<OpenCodeWebAccessInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<OpenCodeProfile | null>(null);
  const [deleting, setDeleting] = useState<OpenCodeProfile | null>(null);
  const [busyID, setBusyID] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState<"enable" | "disable" | "restart" | null>(null);

  const reload = () => palot.listOpenCodeProfiles().then(setSnapshot);
  const reloadWebAccess = () => palot.openCodeWebAccessInfo().then(setWebAccess);
  useEffect(() => {
    void reload().catch(showError);
  }, []);
  useEffect(() => {
    if (tab !== "profiles") void reloadWebAccess().catch(showError);
  }, [tab]);

  const removeProfile = async (profile: OpenCodeProfile) => {
    setBusyID(profile.id);
    try {
      setSnapshot(await palot.deleteOpenCodeProfile(profile.id));
    } catch (error) {
      showError(error);
    } finally {
      setBusyID(null);
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
          <SettingsSection
            title="Servers"
            description="Enabled servers share one workspace. Opening a task uses its server automatically. Disabling a server only disconnects Palot; it does not stop the server."
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" /> Add HTTP server
                </Button>
                <Button type="button" size="sm" onClick={() => setSshOpen(true)}>
                  <Plus className="size-4" /> Add SSH connection
                </Button>
              </div>
            }
          >
            <SettingsGroup>
              {snapshot?.profiles.map((profile) => {
                const active = profile.id === snapshot.activeProfileID;
                const enabled = includedProfileIDs.includes(profile.id);
                const connection = connections.find((entry) => entry.profile.id === profile.id);
                return (
                  <div
                    key={profile.id}
                    className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-center @lg/settings:gap-6"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Server
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <h3 className="min-w-0 text-sm font-medium wrap-anywhere">
                          {profile.name}
                        </h3>
                        {enabled && connection ? (
                          <Badge variant="secondary">
                            {connection.runtime?.connected
                              ? "Connected"
                              : connection.phase === "loading"
                                ? "Connecting…"
                                : "Offline"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-compact leading-relaxed text-muted-foreground wrap-anywhere">
                        {profileDescription(profile)}
                      </p>
                      <p className="mt-1 text-meta text-muted-foreground">
                        {profile.kind === "local"
                          ? "Local service"
                          : profile.kind === "ssh"
                            ? "SSH tunnel · remote service stays running when disconnected"
                            : "Remote server"}
                      </p>
                      {profile.kind === "remote" &&
                      profile.urls.some((url) => url.startsWith("http://")) ? (
                        <p className="mt-2 text-compact leading-relaxed text-warning">
                          Plain HTTP can expose prompts, source, credentials, and terminal traffic.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 @lg/settings:justify-end">
                      <div className="flex items-center gap-2 text-compact text-muted-foreground">
                        {enabled ? "Enabled" : "Disabled"}
                        <Switch
                          aria-label={`Enable ${profile.name}`}
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            setIncludedProfileIDs((current) =>
                              checked
                                ? [...new Set([...current, profile.id])]
                                : current.filter((id) => id !== profile.id),
                            )
                          }
                        />
                      </div>
                      {profile.id !== "local-default" && !active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${profile.name}`}
                          disabled={busyID !== null}
                          onClick={() => setEditing(profile)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {profile.id !== "local-default" && !active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${profile.name}`}
                          disabled={busyID !== null}
                          onClick={() => setDeleting(profile)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!snapshot ? <SettingsEmpty>Loading connections…</SettingsEmpty> : null}
            </SettingsGroup>
          </SettingsSection>

          <SettingsSection
            title="Import a connection"
            description="Add credentials exported by `opencode2 pair` on another computer."
          >
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Plus className="size-4" /> Add paired server
              </Button>
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
      <PairDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        suggestedAddress={suggestedPairingAddress(webAccess)}
      />
      <ImportPairDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSaved={(value) => {
          setSnapshot(value);
          setImportOpen(false);
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
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the connection profile and its encrypted credential from Palot. It does
              not delete the OpenCode server, sessions, auth, configuration, or projects.
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
              Delete connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
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
            <QrCode className="size-4" /> Show login credentials
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
  const [starting, setStarting] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const startService = async () => {
    setStarting(true);
    try {
      setRuntime(await palot.connectOpenCode({ startLocalService: true }));
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

export function PairDialog({
  open,
  onOpenChange,
  suggestedAddress = null,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  suggestedAddress?: string | null;
}) {
  const [info, setInfo] = useState<OpenCodePairingInfo | null>(null);
  const [address, setAddress] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadRequest = useRef(0);
  const qrRequest = useRef(0);
  useEffect(() => {
    loadRequest.current += 1;
    qrRequest.current += 1;
    setInfo(null);
    setAddress(suggestedAddress ?? "");
    setQr(null);
    setShowQr(false);
    setRevealed(false);
    setLoading(false);
    return () => {
      loadRequest.current += 1;
      qrRequest.current += 1;
    };
  }, [open, suggestedAddress]);
  useEffect(() => {
    if (!info) return;
    const timeout = window.setTimeout(() => {
      qrRequest.current += 1;
      setInfo(null);
      setQr(null);
      setShowQr(false);
      setRevealed(false);
    }, 60_000);
    return () => window.clearTimeout(timeout);
  }, [info]);
  const pairing = useMemo(() => {
    if (!info) return { info: null, error: null };
    try {
      return { info: pairingInfoForAddress(info, address), error: null };
    } catch (error) {
      return { info: null, error: error instanceof Error ? error.message : "Invalid address" };
    }
  }, [info, address]);
  const changeAddress = (value: string) => {
    qrRequest.current += 1;
    setAddress(value);
    setQr(null);
    setShowQr(false);
  };
  const load = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    try {
      const pairingInfo = await palot.openCodePairingInfo();
      if (request === loadRequest.current) setInfo(pairingInfo);
    } catch (error) {
      if (request === loadRequest.current) showError(error);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };
  const toggleQr = async () => {
    const request = ++qrRequest.current;
    if (showQr) {
      setShowQr(false);
      setQr(null);
      return;
    }
    if (!pairing.info) return;
    try {
      const image = qr ?? (await QRCode.toDataURL(pairing.info.payload, { margin: 1, width: 320 }));
      if (request === qrRequest.current) {
        setQr(image);
        setShowQr(true);
      }
    } catch (error) {
      if (request === qrRequest.current) showError(error);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pair device</DialogTitle>
          <DialogDescription>
            The QR contains reusable OpenCode service credentials.
          </DialogDescription>
        </DialogHeader>
        {info ? (
          <div className="@container/pairing">
            <div className="grid gap-4 @md/pairing:grid-cols-[minmax(0,1fr)_12rem] @md/pairing:items-center">
              <div className="min-w-0 space-y-3 text-sm">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="pairing-address">
                    Address for pairing
                  </label>
                  <Input
                    id="pairing-address"
                    value={address}
                    onChange={(event) => changeAddress(event.target.value)}
                    placeholder="Use service addresses"
                    aria-invalid={Boolean(pairing.error)}
                    aria-describedby="pairing-address-help"
                  />
                  <p id="pairing-address-help" className="text-meta text-muted-foreground">
                    Use an HTTPS proxy you control that forwards to this service. Leave blank to use
                    the service addresses. This does not configure the proxy.
                  </p>
                  {address ? (
                    <Button variant="ghost" size="sm" onClick={() => changeAddress("")}>
                      Use service addresses
                    </Button>
                  ) : suggestedAddress ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => changeAddress(suggestedAddress)}
                    >
                      Use Tailscale address
                    </Button>
                  ) : null}
                  {pairing.error ? (
                    <p role="alert" className="text-meta text-destructive">
                      {pairing.error}
                    </p>
                  ) : null}
                </div>
                {pairing.info?.urls.map((url) => (
                  <p key={url} className="break-all text-code-compact">
                    {url}
                  </p>
                ))}
                <div className="space-y-2">
                  <PairingCredentialRow label="Username" value={info.username} />
                  <PairingCredentialRow
                    label="Password"
                    value={info.password}
                    concealed={!revealed}
                    onToggleConcealed={() => setRevealed((value) => !value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pairing.info}
                    onClick={() => void toggleQr()}
                  >
                    <QrCode className="size-4" />
                    {showQr ? "Hide QR" : "Show QR"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pairing.info}
                    onClick={() => {
                      if (pairing.info)
                        void writeClipboardText(pairing.info.payload).catch(showError);
                    }}
                  >
                    <Copy className="size-4" />
                    Copy pairing JSON
                  </Button>
                </div>
              </div>
              {qr && showQr ? (
                <img
                  src={qr}
                  alt="OpenCode pairing QR code"
                  className="w-48 max-w-full justify-self-center rounded-lg bg-white p-2"
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Reveal only when the other device is ready. The credentials can control this OpenCode
              service.
            </p>
            <Button type="button" disabled={loading} onClick={() => void load()}>
              {loading ? "Loading…" : "Reveal pairing credentials"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PairingCredentialRow({
  label,
  value,
  concealed = false,
  onToggleConcealed,
}: {
  label: string;
  value: string;
  concealed?: boolean;
  onToggleConcealed?: () => void;
}) {
  const { copiedKey, copy } = useClipboardCopy();
  const copied = copiedKey === "credential";

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-meta text-muted-foreground">{label}</p>
        <code className="block truncate text-code-compact">
          {concealed ? "••••••••••••" : value}
        </code>
      </div>
      {onToggleConcealed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${concealed ? "Show" : "Hide"} password`}
          onClick={onToggleConcealed}
        >
          {concealed ? <Eye /> : <EyeOff />}
          {concealed ? "Show" : "Hide"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        onClick={() => void copy(value, "credential")}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function ImportPairDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(value: OpenCodeProfileSnapshot): void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const payload = useMemo(() => {
    try {
      const value = JSON.parse(text) as OpenCodePairPayload;
      return Array.isArray(value.urls) && value.urls.every((url) => typeof url === "string")
        ? value
        : null;
    } catch {
      return null;
    }
  }, [text]);
  const insecure =
    payload?.urls.some(
      (url) => url.trim().toLowerCase().startsWith("http://") && !isLoopback(url),
    ) ?? false;
  const save = async () => {
    if (!payload) return;
    setBusy(true);
    try {
      onSaved(await palot.importOpenCodePairing({ payload, allowPlainHttp }));
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
          <DialogTitle>Add paired server</DialogTitle>
          <DialogDescription>Paste the JSON printed by `opencode2 pair`.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          placeholder={'{"urls":["http://host:4096"],"username":"opencode","password":"…"}'}
        />
        {payload ? (
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
            {payload.urls.map((url) => (
              <p key={url} className="break-all font-mono">
                {url}
              </p>
            ))}
          </div>
        ) : null}
        {insecure ? (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allowPlainHttp}
              onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
            />
            Allow plain HTTP. Pairing credentials, prompts, source, and terminal traffic can be
            observed or modified in transit.
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !payload || (insecure && !allowPlainHttp)}
            onClick={() => void save()}
          >
            Probe and import
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
  toast.add({
    type: "error",
    title: error instanceof Error ? error.message : "OpenCode server action failed",
  });
}
