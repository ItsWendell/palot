export type SidebarMode = "project" | "inbox";

export type SessionDisposition = "inbox" | "settled";

export interface ActivityWatermark {
  updatedAt: number;
  sessionID: string;
}

export interface SessionTriageRecord {
  sessionID: string;
  disposition: SessionDisposition | null;
  settledThrough: ActivityWatermark | null;
  pinnedAt: number | null;
  snoozedUntil: number | null;
  snoozedThrough: ActivityWatermark | null;
  updatedAt: number;
}

export interface SessionTriageSnapshot {
  profileID: string;
  bootstrapThrough: ActivityWatermark | null;
  sessions: SessionTriageRecord[];
}

export interface SessionTriageCommandBase {
  profileID: string;
  sessionID: string;
  at: number;
}

export type SessionTriageCommand =
  | { type: "bootstrap"; profileID: string; at: number; through: ActivityWatermark }
  | (SessionTriageCommandBase & { type: "settle"; through: ActivityWatermark })
  | (SessionTriageCommandBase & { type: "inbox"; activity?: ActivityWatermark })
  | (SessionTriageCommandBase & { type: "pin" | "unpin" | "wake" })
  | (SessionTriageCommandBase & {
      type: "snooze";
      until: number;
      through: ActivityWatermark;
    })
  | { type: "remove"; profileID: string; sessionID: string };
