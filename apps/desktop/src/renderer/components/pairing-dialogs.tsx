import { Check, Copy, Eye, EyeOff, Link2, LoaderCircle, QrCode, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  OpenCodeConnectionProblem,
  OpenCodeConnectionStep,
  OpenCodePairImportResult,
  OpenCodePairingInfo,
  OpenCodeProfile,
  OpenCodeProfileSnapshot,
} from "../../shared";
import { normalizeServerName, SERVER_NAME_MAX_LENGTH } from "../../shared/server-name";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { cn } from "../lib/cn";
import { ipcErrorMessage } from "../lib/ipc-error";
import {
  pairingCopyPayload,
  pairingInfoForAddress,
  pairingQRCodePayload,
} from "../lib/pairing-address";
import { parsePairingText } from "../lib/pairing-import";
import { palot } from "../services/palot";
import { Badge } from "./ui/badge";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
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
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Textarea } from "./ui/textarea";

const STEP_LABELS: Record<OpenCodeConnectionStep, string> = {
  address: "Reaching the address",
  tunnel: "Tunnel or proxy",
  certificate: "HTTPS certificate",
  code: "Pairing code",
  credentials: "Sign-in",
  version: "OpenCode version",
  security: "Secure connection",
  server: "Server",
};

/** One failed connection step: what broke, then the fix in plain words. */
export function ConnectionProblemNotice({
  problem,
  actions,
  className,
}: {
  problem: OpenCodeConnectionProblem;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Banner status="error" title={problem.title} actions={actions} className={className}>
      <span className="block">{problem.fix}</span>
      <span className="mt-1 block text-meta text-muted-foreground">
        Failed at: {STEP_LABELS[problem.step]}
      </span>
    </Banner>
  );
}

type StepState = "done" | "current" | "upcoming";

function Steps({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-5 p-0" aria-label={label}>
      {children}
    </ol>
  );
}

function Step({
  index,
  title,
  state,
  aside,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3"
      aria-label={title}
      aria-current={state === "current" ? "step" : undefined}
    >
      <span
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-full text-micro font-medium tabular-nums",
          state === "done"
            ? "bg-success/15 text-success"
            : state === "current"
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {state === "done" ? <Check className="size-3" /> : index}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3
            className={cn(
              "m-0 text-sm font-medium",
              state === "upcoming" && "text-muted-foreground",
            )}
          >
            {title}
          </h3>
          {aside}
        </div>
        {state === "upcoming" ? null : children}
      </div>
    </li>
  );
}

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Credentials from servers older than one-time codes are only shown for this long. */
const CREDENTIAL_REVEAL_MS = 60_000;

/**
 * Share this computer's OpenCode: create a one-time code on request, name it, then scan or copy.
 * The code is never printed; it lives only in the QR image and the clipboard, and is dropped when
 * it expires or the dialog closes.
 */
export function ShareComputerDialog({
  open,
  onOpenChange,
  suggestedAddress = null,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  suggestedAddress?: string | null;
}) {
  const [info, setInfo] = useState<OpenCodePairingInfo | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [showAddress, setShowAddress] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const qrRequest = useRef(0);
  const { copiedKey, copy } = useClipboardCopy();

  useEffect(() => {
    loadRequest.current += 1;
    qrRequest.current += 1;
    setInfo(null);
    setExpired(false);
    setName("");
    setAddress(suggestedAddress ?? "");
    setShowAddress(false);
    setRevealed(false);
    setQr(null);
    setLoading(false);
    setLoadError(null);
    return () => {
      loadRequest.current += 1;
      qrRequest.current += 1;
    };
  }, [open, suggestedAddress]);

  useEffect(() => {
    if (!info) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current < expiresAt) return;
      qrRequest.current += 1;
      setInfo(null);
      setQr(null);
      setRevealed(false);
      setExpired(true);
    };
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [info, expiresAt]);

  const pairing = useMemo(() => {
    if (!info) return { info: null, error: null };
    try {
      return { info: pairingInfoForAddress(info, address), error: null };
    } catch (error) {
      return { info: null, error: error instanceof Error ? error.message : "Invalid address" };
    }
  }, [info, address]);
  const label = normalizeServerName(name);
  const qrPayload = pairing.info ? pairingQRCodePayload(pairing.info, label) : null;

  useEffect(() => {
    const request = ++qrRequest.current;
    setQr(null);
    if (!qrPayload) return;
    QRCode.toDataURL(qrPayload, { margin: 1, width: 320 }).then(
      (image) => {
        if (request === qrRequest.current) setQr(image);
      },
      (error: unknown) => {
        if (request === qrRequest.current)
          setLoadError(ipcErrorMessage(error, "Couldn't draw the QR code"));
      },
    );
  }, [qrPayload]);

  const load = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const pairingInfo = await palot.openCodePairingInfo();
      if (request !== loadRequest.current) return;
      setInfo(pairingInfo);
      setExpired(false);
      setRevealed(false);
      setExpiresAt(
        Date.now() +
          (pairingInfo.mode === "link" ? pairingInfo.expiresIn * 1_000 : CREDENTIAL_REVEAL_MS),
      );
      setName((current) => current || pairingInfo.name || "");
    } catch (error) {
      if (request === loadRequest.current)
        setLoadError(ipcErrorMessage(error, "Couldn't create a pairing code"));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };

  const remaining = formatRemaining(expiresAt - now);
  const reachable = Boolean(qrPayload);
  const linkMode = info?.mode === "link";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share this computer</DialogTitle>
          <DialogDescription>
            Pair a phone, tablet or another computer with this computer’s OpenCode. Share codes only
            with your own devices: whoever uses one can run tasks here.
          </DialogDescription>
        </DialogHeader>
        <Steps label="Share this computer">
          <Step
            index={1}
            title="Create a pairing code"
            state={info ? "done" : "current"}
            aside={
              info ? (
                <Badge variant={linkMode ? "neutral" : "warning"} size="sm">
                  {linkMode ? `Expires in ${remaining}` : `Hidden in ${remaining}`}
                </Badge>
              ) : null
            }
          >
            {info ? (
              <div className="flex flex-wrap items-center gap-2 text-compact text-muted-foreground">
                <span>
                  {linkMode
                    ? "Works once. The device that uses it stays signed in for up to 30 days."
                    : "This OpenCode is older than one-time codes, so these details hold its reusable password."}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
                  <RefreshCw /> New code
                </Button>
              </div>
            ) : (
              <>
                <p className="text-compact text-muted-foreground">
                  Create it when the other device is ready. A code works once and expires after 5
                  minutes.
                </p>
                {expired ? (
                  <Banner status="warning" title="That code expired">
                    Nothing can use it now. Create a new one when the other device is ready.
                  </Banner>
                ) : null}
                {loadError ? (
                  <Banner status="error" title="Couldn't create a pairing code">
                    {loadError}
                  </Banner>
                ) : null}
                <div>
                  <Button type="button" disabled={loading} onClick={() => void load()}>
                    {loading ? <LoaderCircle className="animate-spin" /> : <QrCode />}
                    {loading ? "Creating…" : expired ? "Create new code" : "Create pairing code"}
                  </Button>
                </div>
              </>
            )}
          </Step>
          <Step index={2} title="Name this computer" state={info ? "current" : "upcoming"}>
            <div className="space-y-1.5">
              <label className="text-meta text-muted-foreground" htmlFor="pairing-name">
                Name on the other device
              </label>
              <Input
                id="pairing-name"
                value={name}
                maxLength={SERVER_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder="For example, Studio Mac"
              />
              <p className="text-meta text-muted-foreground">
                Travels only inside the code. Leave it empty and the other device shows this
                computer’s address instead.
              </p>
            </div>
          </Step>
          <Step
            index={3}
            title="Scan or paste it on the other device"
            state={info ? "current" : "upcoming"}
          >
            {info && linkMode && pairing.info && !reachable ? <UnreachableNotice /> : null}
            <div className="@container/pairing">
              <div
                className={cn(
                  "grid gap-4",
                  qr && "@md/pairing:grid-cols-[12rem_minmax(0,1fr)] @md/pairing:items-start",
                )}
              >
                {qr ? (
                  <img
                    src={qr}
                    alt={
                      linkMode ? "OpenCode one-time pairing QR code" : "OpenCode pairing QR code"
                    }
                    className="w-48 max-w-full justify-self-center rounded-lg bg-white p-2"
                  />
                ) : null}
                <div className="min-w-0 space-y-3 text-compact">
                  <ul className="m-0 list-disc space-y-1 pl-4 text-muted-foreground">
                    <li>OpenCode app: scan the code.</li>
                    <li>
                      Palot: Settings → Connections → <b>Connect to another computer</b>, then
                      paste.
                    </li>
                    {linkMode ? <li>A browser: open the link.</li> : null}
                  </ul>
                  {info?.mode === "credentials" && pairing.info?.mode === "credentials" ? (
                    <div className="space-y-2">
                      <PairingCredentialRow label="Username" value={pairing.info.username} />
                      <PairingCredentialRow
                        label="Password"
                        value={pairing.info.password}
                        concealed={!revealed}
                        onToggleConcealed={() => setRevealed((value) => !value)}
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!pairing.info}
                      onClick={() => {
                        if (pairing.info)
                          void copy(pairingCopyPayload(pairing.info, label), "details");
                      }}
                    >
                      {copiedKey === "details" ? <Check /> : <Copy />}
                      {copiedKey === "details" ? "Copied" : "Copy pairing code"}
                    </Button>
                    {linkMode ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!pairing.info}
                        onClick={() => {
                          if (pairing.info) void copy(pairing.info.payload, "link");
                        }}
                      >
                        {copiedKey === "link" ? <Check /> : <Link2 />}
                        {copiedKey === "link" ? "Copied" : "Copy link"}
                      </Button>
                    ) : null}
                  </div>
                  {pairing.info ? (
                    <p className="text-meta wrap-anywhere text-muted-foreground">
                      {pairing.info.urls.length === 1 ? "Address: " : "Addresses: "}
                      {pairing.info.urls.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {showAddress || address ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="pairing-address">
                    Address for pairing
                  </label>
                  <Input
                    id="pairing-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="https://opencode.example.com"
                    aria-invalid={Boolean(pairing.error)}
                    aria-describedby="pairing-address-help"
                  />
                  <p id="pairing-address-help" className="text-meta text-muted-foreground">
                    An HTTPS proxy you already run in front of this computer’s OpenCode. Palot
                    doesn’t set one up. Leave empty to use OpenCode’s own addresses, including its
                    remote access address when that’s on.
                  </p>
                  {pairing.error ? (
                    <p role="alert" className="text-meta text-destructive">
                      {pairing.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {address ? (
                  <Button variant="ghost" size="sm" onClick={() => setAddress("")}>
                    Use service addresses
                  </Button>
                ) : showAddress ? null : (
                  <Button variant="ghost" size="sm" onClick={() => setShowAddress(true)}>
                    Use a different address…
                  </Button>
                )}
                {!address && suggestedAddress ? (
                  <Button variant="ghost" size="sm" onClick={() => setAddress(suggestedAddress)}>
                    Use Tailscale address
                  </Button>
                ) : null}
              </div>
            </div>
          </Step>
        </Steps>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnreachableNotice() {
  return (
    <Banner status="warning" title="Other devices can’t reach this computer yet">
      <span className="block">
        OpenCode only accepts connections from this computer. Pick one, then create a new code:
      </span>
      <span className="mt-2 block space-y-2">
        <CopyField
          label="Same network: listen on every network address"
          value="opencode service set hostname 0.0.0.0"
          valueName="network command"
        />
        <CopyField
          label="From anywhere: remote access through an encrypted tunnel (restarts OpenCode)"
          value="opencode pair --remote"
          valueName="remote access command"
        />
        <span className="block text-meta">
          On a tailnet, turn on Tailscale under Web access and use its address. Over SSH, forward
          the port and paste the copied code on the other computer.
        </span>
      </span>
    </Banner>
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

function isLoopback(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Connect to another computer from its pairing code: paste, name, connect. Nothing is sent until
 * Connect is pressed, and the code is sent only to the one address shown. Once pasted the code is
 * masked; once used it is dropped.
 */
export function ConnectComputerDialog({
  open,
  onOpenChange,
  onSaved,
  profiles = [],
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(value: OpenCodeProfileSnapshot): void;
  profiles?: readonly OpenCodeProfile[];
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<OpenCodeConnectionProblem | null>(null);
  const [connected, setConnected] = useState<Extract<
    OpenCodePairImportResult,
    { ok: true }
  > | null>(null);

  const reset = () => {
    setText("");
    setAllowPlainHttp(false);
    setSelectedAddress("");
    setName(null);
    setProblem(null);
    setConnected(null);
  };
  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { value: parsePairingText(text, selectedAddress), error: null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Invalid pairing details",
      };
    }
  }, [text, selectedAddress]);
  const value = parsed?.value ?? null;
  const targets = value ? (value.selectedAddress ? [value.selectedAddress] : value.urls) : [];
  const insecure = targets.some((url) => url.startsWith("http://") && !isLoopback(url));
  const existing = value
    ? profiles.find(
        (profile): profile is Extract<OpenCodeProfile, { kind: "remote" }> =>
          profile.kind === "remote" && profile.urls.some((url) => value.urls.includes(url)),
      )
    : undefined;
  const defaultName =
    value?.name ?? existing?.name ?? (targets[0] ? new URL(targets[0]).hostname : "");
  const effectiveName = name ?? defaultName;
  const nameValid = normalizeServerName(effectiveName) !== null;
  const oneTime = value ? "link" in value.input : false;

  const changeText = (next: string) => {
    setText(next);
    setAllowPlainHttp(false);
    setSelectedAddress("");
    setProblem(null);
  };

  const connect = async () => {
    if (!value || busy || (insecure && !allowPlainHttp) || !nameValid) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await palot.importOpenCodePairing({
        ...value.input,
        allowPlainHttp,
        name: normalizeServerName(effectiveName)!,
      });
      if (result.ok) {
        setText("");
        setConnected(result);
        onSaved(result.snapshot);
      } else {
        setProblem(result.problem);
        // A used code is worthless; drop it so it can't be retried by accident.
        if (result.problem.codeSpent) setText("");
      }
    } catch (error) {
      setProblem({
        step: "server",
        title: "Couldn’t connect.",
        fix: ipcErrorMessage(error, "Try again."),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>Connect to another computer</DialogTitle>
          <DialogDescription>
            Use a pairing code from the computer you want to work on. Nothing is sent until you
            press Connect.
          </DialogDescription>
        </DialogHeader>
        {connected ? (
          <div className="space-y-4">
            <Banner
              status="success"
              title={
                connected.updated
                  ? `Renewed the sign-in for ${connected.name}`
                  : `Connected to ${connected.name}`
              }
            >
              {connected.updated
                ? "Its tasks are still here."
                : "It’s in your server list and its tasks show in the task list."}
            </Banner>
            <dl className="grid min-w-0 gap-3 text-compact @container sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <dt className="sr-only">Address</dt>
                <dd className="m-0">
                  <CopyField label="Address" value={connected.url} valueName="address" />
                </dd>
              </div>
              <div>
                <dt className="text-meta text-muted-foreground">OpenCode</dt>
                <dd className="m-0 mt-1 font-mono text-code-compact">{connected.version}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <Steps label="Connect to another computer">
            <Step
              index={1}
              title="Get a code on the other computer"
              state={value ? "done" : "current"}
            >
              <p className="text-compact leading-relaxed text-muted-foreground">
                In Palot there: Settings → Connections → <b>Share this computer</b>. Without Palot,
                run <code className="text-code-compact">opencode pair</code> in a terminal (add{" "}
                <code className="text-code-compact">--remote</code> to connect from anywhere).
              </p>
            </Step>
            <Step index={2} title="Paste it here" state={value ? "done" : "current"}>
              {value ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-compact">
                  <span className="min-w-0 flex-1">
                    {oneTime ? "One-time pairing code" : "Saved password (older OpenCode)"}{" "}
                    <span aria-hidden="true" className="tracking-widest text-muted-foreground">
                      ••••••••
                    </span>
                    <span className="sr-only">hidden</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => changeText("")}
                  >
                    Paste a different code
                  </Button>
                </div>
              ) : (
                <>
                  <Textarea
                    value={text}
                    onChange={(event) => changeText(event.target.value)}
                    disabled={busy}
                    aria-label="Pairing code or link"
                    rows={4}
                    placeholder="Paste the pairing code or link"
                  />
                  {parsed?.error ? (
                    <p role="alert" className="text-meta text-destructive">
                      {parsed.error}
                    </p>
                  ) : null}
                </>
              )}
              {problem?.codeSpent && !value ? <ConnectionProblemNotice problem={problem} /> : null}
            </Step>
            <Step index={3} title="Name it and connect" state={value ? "current" : "upcoming"}>
              {value ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      className="text-meta text-muted-foreground"
                      htmlFor="pairing-import-name"
                    >
                      Name in Palot
                    </label>
                    <Input
                      id="pairing-import-name"
                      value={effectiveName}
                      maxLength={SERVER_NAME_MAX_LENGTH}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                      aria-invalid={!nameValid}
                    />
                    {value.name && name === null ? (
                      <p className="text-meta text-muted-foreground">
                        Named by the other computer.
                      </p>
                    ) : null}
                  </div>
                  {value.selectedAddress ? (
                    <div className="space-y-1.5">
                      <label
                        className="text-meta text-muted-foreground"
                        htmlFor="pairing-import-address"
                      >
                        Redeem at this address
                      </label>
                      <NativeSelect
                        id="pairing-import-address"
                        className="w-full"
                        value={value.selectedAddress}
                        disabled={busy}
                        onChange={(event) => {
                          setSelectedAddress(event.target.value);
                          setAllowPlainHttp(false);
                          setProblem(null);
                        }}
                      >
                        {value.urls.map((url) => (
                          <NativeSelectOption key={url} value={url}>
                            {url}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <p className="text-meta text-muted-foreground">
                        Only this address receives the one-time code. Other addresses are not tried
                        automatically.
                      </p>
                    </div>
                  ) : (
                    <p className="text-meta wrap-anywhere text-muted-foreground">
                      {value.urls.length === 1 ? "Address: " : "Addresses: "}
                      {value.urls.join(", ")}
                    </p>
                  )}
                  {existing ? (
                    <Banner
                      status="info"
                      title={`You’ve connected to this server as ${existing.name}`}
                    >
                      Connecting renews its sign-in instead of adding a second copy. Its tasks stay.
                    </Banner>
                  ) : null}
                  {insecure ? (
                    <label className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={allowPlainHttp}
                        disabled={busy}
                        onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
                      />
                      Allow plain HTTP. The pairing code or credentials, prompts, source, and
                      terminal traffic can be observed or modified in transit.
                    </label>
                  ) : null}
                  {busy ? (
                    <p
                      role="status"
                      className="flex items-center gap-2 text-compact text-muted-foreground"
                    >
                      <LoaderCircle className="size-4 animate-spin" />
                      {oneTime ? "Sending the code and signing in…" : "Signing in…"}
                    </p>
                  ) : null}
                  {problem && !busy ? <ConnectionProblemNotice problem={problem} /> : null}
                </div>
              ) : null}
            </Step>
          </Steps>
        )}
        <DialogFooter>
          {connected ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !value || (insecure && !allowPlainHttp) || !nameValid}
                onClick={() => void connect()}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                {busy ? "Connecting…" : problem && !problem.codeSpent ? "Try again" : "Connect"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
