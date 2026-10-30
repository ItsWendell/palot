import { Camera, Mic } from "lucide-react";
import { useState } from "react";
import type {
  PalotBrowserMediaKind,
  PalotBrowserPermissionControl,
  PalotBrowserPermissionGrant,
  PalotBrowserPermissionRequest,
} from "../../../shared/browser-contract";
import { palot } from "../../services/palot";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const DEVICE_NAMES: Record<PalotBrowserMediaKind, string> = {
  microphone: "microphone",
  camera: "camera",
};

function devices(kinds: PalotBrowserMediaKind[]): string {
  return kinds.map((kind) => DEVICE_NAMES[kind]).join(" and ");
}

/** Shows the hostname, with the port for local servers, as Chrome's prompts do. */
export function permissionSiteLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function pageOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * A site's request for the microphone or camera. It sits above the page, outside it, so only
 * the person can answer: neither the page nor an agent driving it can press these buttons.
 */
export function BrowserPermissionPrompt({
  bindingID,
  request,
  onError,
}: {
  bindingID: string | null | undefined;
  request: PalotBrowserPermissionRequest | undefined;
  onError(message: string): void;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "allow" | "block") => {
    if (!bindingID || !request) return;
    setBusy(true);
    try {
      await palot.browserPermission(bindingID, { type: "decide", requestID: request.id, decision });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not answer the permission request");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Banner
      open={Boolean(request)}
      status="info"
      variant="section"
      icon={request?.kinds.includes("camera") ? Camera : Mic}
      title={
        request
          ? `${permissionSiteLabel(request.origin)} wants to use your ${devices(request.kinds)}`
          : undefined
      }
      actions={
        <>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => void decide("block")}
          >
            Block
          </Button>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={busy}
            onClick={() => void decide("allow")}
          >
            Allow
          </Button>
        </>
      }
    >
      Palot remembers your answer for this site in this task's browser.
    </Banner>
  );
}

/** The current site's microphone and camera answers, beside the address bar. */
export function BrowserSitePermissions({
  bindingID,
  grant,
  onError,
}: {
  bindingID: string | null | undefined;
  grant: PalotBrowserPermissionGrant | undefined;
  onError(message: string): void;
}) {
  if (!grant || !bindingID || (!grant.microphone && !grant.camera)) return null;
  const allowed = grant.microphone === "allow" || grant.camera === "allow";
  const Icon = grant.camera && !grant.microphone ? Camera : Mic;
  const control = (value: PalotBrowserPermissionControl) =>
    palot
      .browserPermission(bindingID, value)
      .catch((cause: unknown) =>
        onError(cause instanceof Error ? cause.message : "Could not reset site permissions"),
      );
  const site = permissionSiteLabel(grant.origin);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Site permissions for ${site}`}
            className={allowed ? "text-destructive hover:text-destructive" : undefined}
          />
        }
      >
        <Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{site}</DropdownMenuLabel>
          {(["microphone", "camera"] as const).flatMap((kind) =>
            grant[kind] ? (
              <DropdownMenuLabel key={kind} className="font-normal text-muted-foreground">
                {kind === "microphone" ? "Microphone" : "Camera"}:{" "}
                {grant[kind] === "allow" ? "Allowed" : "Blocked"}
              </DropdownMenuLabel>
            ) : (
              []
            ),
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void control({ type: "revoke", origin: grant.origin })}>
          Reset and reload page
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
