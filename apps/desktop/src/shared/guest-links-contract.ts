export const GUEST_LINKS_IPC_CHANNELS = {
  guestLinksCommand: "palot:guest-links:command",
  guestLinksChanged: "palot:guest-links:changed",
} as const;

export interface GuestTarget {
  connectionID: string;
  sessionID: string;
}
export interface GuestTranscript {
  title: string;
  status: "working" | "idle" | "offline";
  rows: { id: string; role: "user" | "assistant" | "tool"; text: string }[];
}
export interface GuestPendingMessage extends GuestTarget {
  id: string;
  shareID: string;
  name: string;
  text: string;
  sending: boolean;
}
export interface GuestShare extends GuestTarget {
  id: string;
  localUrl: string;
  expiresAt: number | null;
  publishedUrl?: string;
}
export interface GuestLinksState {
  enabled: boolean;
  shares: GuestShare[];
  pending: GuestPendingMessage[];
  transports?: { tailscale: boolean; opentunnel: boolean };
}
export type GuestLinksCommand =
  | { type: "state" }
  | { type: "enable"; enabled: boolean }
  | ({ type: "create"; hours: 1 | 24 | 168 | null } & GuestTarget)
  | { type: "revoke"; shareID: string }
  | { type: "publish-options" }
  | { type: "publish"; shareID: string; transport: "tailscale" | "opentunnel"; confirmed: true }
  | { type: "approve" | "dismiss"; messageID: string };

export interface PalotGuestLinksApi {
  command(command: GuestLinksCommand): Promise<GuestLinksState>;
  onChanged(listener: () => void): () => void;
}
