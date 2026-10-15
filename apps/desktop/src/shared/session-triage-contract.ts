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

/** Most tasks one batch command may change. */
export const SESSION_TRIAGE_BATCH_LIMIT = 1_000;

/** Who settled a batch: a person from the Inbox menu, or the inactivity sweep. */
export type SessionSettleBatchTrigger = "bulk" | "auto";

export type SessionTriageCommand =
  | { type: "bootstrap"; profileID: string; at: number; through: ActivityWatermark }
  | (SessionTriageCommandBase & { type: "settle"; through: ActivityWatermark })
  | {
      type: "settle-many";
      profileID: string;
      at: number;
      trigger: SessionSettleBatchTrigger;
      sessions: Array<{ sessionID: string; through: ActivityWatermark }>;
    }
  | { type: "inbox-many"; profileID: string; at: number; sessionIDs: string[] }
  | (SessionTriageCommandBase & { type: "inbox"; activity?: ActivityWatermark })
  | (SessionTriageCommandBase & { type: "pin" | "unpin" | "wake" })
  | (SessionTriageCommandBase & {
      type: "snooze";
      until: number;
      through: ActivityWatermark;
    })
  | { type: "remove"; profileID: string; sessionID: string };
