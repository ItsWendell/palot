import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Link2, Unlink } from "lucide-react";
import QRCode from "qrcode";
import type { PalotSession } from "../../shared";
import type {
  GuestLinksCommand,
  GuestLinksState,
  GuestShare,
} from "../../shared/guest-links-contract";
import { palot } from "../services/palot";
import { runtimeAtom } from "../atoms/workspace";
import { showErrorToast } from "../lib/toast-error";
import { Button } from "./ui/button";
import { CopyField } from "./ui/copy-field";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { DropdownMenuItem } from "./ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";

const key = ["guest-links"];
const empty: GuestLinksState = { enabled: false, shares: [], pending: [] };
function useGuestLinks() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => palot.guestLinks.command({ type: "state" }),
  });
  useEffect(
    () =>
      palot.guestLinks.onChanged(() => {
        void client.invalidateQueries({ queryKey: key });
      }),
    [client],
  );
  const mutation = useMutation({
    mutationFn: (command: GuestLinksCommand) => palot.guestLinks.command(command),
    onSuccess: (state) => client.setQueryData(key, state),
    onError: (error) => showErrorToast("Guest links", error),
  });
  return {
    state: query.data ?? empty,
    loading: query.isPending,
    busy: mutation.isPending,
    command: mutation.mutate,
  };
}

export function GuestLinksSettings() {
  const { state, loading, busy, command } = useGuestLinks();
  return (
    <SettingsSection
      title="Guest links (beta)"
      description="Share one task with a guest in their browser. Off by default; nothing is published automatically."
    >
      <SettingsGroup>
        <SettingsRow
          title="Guest links (beta)"
          description="Guests see recent messages and live replies, but not attachments or tool output. Their messages wait for your Send approval. Turning this off ends every link and discards pending guest messages."
          control={
            <Switch
              aria-label="Guest links (beta)"
              checked={state.enabled}
              disabled={loading || busy}
              onCheckedChange={(enabled) => command({ type: "enable", enabled })}
            />
          }
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

export function useGuestSharing(session: PalotSession) {
  const runtime = useAtomValue(runtimeAtom);
  const { state, busy, command } = useGuestLinks();
  const [open, setOpen] = useState(false);
  const share = state.shares.find(
    (share) => share.sessionID === session.id && share.connectionID === runtime?.connectionID,
  );
  return {
    items: state.enabled ? (
      <>
        <DropdownMenuItem disabled={!runtime?.connected} onClick={() => setOpen(true)}>
          <Link2 aria-hidden="true" />
          {share ? "Guest link…" : "Share with a guest…"}
        </DropdownMenuItem>
        {share ? (
          <DropdownMenuItem
            disabled={busy}
            onClick={() => command({ type: "revoke", shareID: share.id })}
          >
            <Unlink aria-hidden="true" />
            Stop sharing
          </DropdownMenuItem>
        ) : null}
      </>
    ) : null,
    dialog: (
      <GuestShareDialog
        open={open && state.enabled}
        onOpenChange={setOpen}
        share={share}
        state={state}
        busy={busy}
        command={command}
        create={(hours) => {
          if (runtime?.connectionID)
            command({
              type: "create",
              connectionID: runtime.connectionID,
              sessionID: session.id,
              hours,
            });
        }}
      />
    ),
  };
}

function GuestShareDialog({
  open,
  onOpenChange,
  share,
  state,
  busy,
  command,
  create,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  share?: GuestShare;
  state: GuestLinksState;
  busy: boolean;
  command(command: GuestLinksCommand): void;
  create(hours: 1 | 24 | 168 | null): void;
}) {
  const [hours, setHours] = useState<1 | 24 | 168 | null>(24);
  const [consent, setConsent] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const url = share?.publishedUrl ?? share?.localUrl;
  useEffect(() => {
    setQr(null);
    setConsent(false);
  }, [url, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] min-w-0 overflow-x-hidden overflow-y-auto">
        <DialogHeader className="min-w-0">
          <DialogTitle>Share with a guest</DialogTitle>
          <DialogDescription>
            Anyone with this link can read this task. Messages can contain private code or secrets.
            Guest names are not verified. Palot must stay open.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          {share ? (
            <>
              <CopyField value={share.localUrl} label="Local guest link" secret />
              <p className="text-meta text-muted-foreground">
                Local links work only on this computer.{" "}
                {share.expiresAt
                  ? `Expires ${new Date(share.expiresAt).toLocaleString()}.`
                  : "No expiry."}{" "}
                Stopping sharing ends access immediately.
              </p>
              {share.publishedUrl ? (
                <CopyField value={share.publishedUrl} label="Published guest link" secret />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (url)
                      void QRCode.toDataURL(url, { margin: 2, width: 240 })
                        .then(setQr)
                        .catch((error) => showErrorToast("Could not create QR code", error));
                  }}
                >
                  Show QR code
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => command({ type: "publish-options" })}
                >
                  Publishing options
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => command({ type: "revoke", shareID: share.id })}
                >
                  Stop sharing
                </Button>
              </div>
              {qr ? (
                <img src={qr} alt="Guest link QR code" className="mx-auto size-60 rounded-md" />
              ) : null}
              {state.transports && !share.publishedUrl ? (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-compact text-muted-foreground">
                    Tailscale uses your tailnet on HTTPS port 8443, separate from OpenCode web
                    access. OpenTunnel publishes to the public internet and may start a login
                    service in the dedicated palot-guests profile. Its identity and service can
                    remain after sharing ends; Palot removes only its guest route. No Funnel is
                    enabled.
                  </p>
                  <label className="flex items-start gap-2 text-compact">
                    <Checkbox
                      checked={consent}
                      onCheckedChange={(checked) => setConsent(checked === true)}
                    />
                    I understand that anyone with the link can see this task.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!consent || busy || !state.transports.tailscale}
                      onClick={() =>
                        command({
                          type: "publish",
                          shareID: share.id,
                          transport: "tailscale",
                          confirmed: true,
                        })
                      }
                    >
                      Publish with Tailscale
                    </Button>
                    {state.transports.opentunnel ? (
                      <Button
                        variant="outline"
                        disabled={!consent || busy}
                        onClick={() =>
                          command({
                            type: "publish",
                            shareID: share.id,
                            transport: "opentunnel",
                            confirmed: true,
                          })
                        }
                      >
                        Publish with OpenTunnel
                      </Button>
                    ) : null}
                  </div>
                  {!state.transports.tailscale && !state.transports.opentunnel ? (
                    <p className="text-meta text-muted-foreground">
                      Install Tailscale or OpenTunnel yourself to publish this link.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="block space-y-2 text-compact">
                Link expiry
                <Select
                  value={hours === null ? "none" : String(hours)}
                  onValueChange={(value) =>
                    setHours(value === "none" ? null : (Number(value) as 1 | 24 | 168))
                  }
                >
                  <SelectTrigger aria-label="Link expiry">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hour</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="168">7 days</SelectItem>
                    <SelectItem value="none">No expiry</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <Button disabled={busy} onClick={() => create(hours)}>
                {busy ? "Creating…" : "Create guest link"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GuestPendingMessages({ sessionID }: { sessionID: string }) {
  const runtime = useAtomValue(runtimeAtom);
  const { state, busy, command } = useGuestLinks();
  const messages = state.pending.filter(
    (message) => message.sessionID === sessionID && message.connectionID === runtime?.connectionID,
  );
  if (!messages.length) return null;
  return (
    <section
      aria-label="Pending guest messages"
      className="mx-auto mb-2 max-h-64 w-full max-w-3xl space-y-2 overflow-y-auto px-4"
    >
      {messages.map((message) => (
        <div key={message.id} className="space-y-2 rounded-md border border-border bg-card p-3">
          <p className="text-compact font-medium">
            Guest message from {message.name}{" "}
            <span className="text-meta font-normal text-muted-foreground">· Unverified</span>
          </p>
          <p className="max-h-32 overflow-y-auto text-compact whitespace-pre-wrap break-words">
            {message.text}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || message.sending || !runtime?.connected}
              onClick={() => command({ type: "approve", messageID: message.id })}
            >
              {message.sending ? "Sending…" : "Send"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || message.sending}
              onClick={() => command({ type: "dismiss", messageID: message.id })}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
