import { describe, expect, it, vi } from "vitest";
import type { DesktopNotificationSettings, PalotEvent } from "../../shared";
import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  NOTIFICATION_SOUND_STALE_MS,
  createNotificationSoundController,
  type NotificationSoundPreferences,
} from "./notification-sounds";

const NOW = 1_000_000_000;

function event(
  id: string,
  type: string,
  data: Record<string, unknown>,
  createdAt = NOW,
): PalotEvent {
  return { id, type, data, createdAt, receiveSequence: 1, created: createdAt } as PalotEvent;
}

const succeeded = (id: string, sessionID = "ses_1", createdAt = NOW) =>
  event(id, "session.execution.succeeded", { sessionID }, createdAt);
const failed = (id: string, errorType = "ProviderError") =>
  event(id, "session.execution.failed", {
    sessionID: "ses_1",
    error: { type: errorType, message: "boom" },
  });
const permission = (id: string) =>
  event(id, "permission.asked", { id: `per_${id}`, sessionID: "ses_1", action: "edit" });
const form = (id: string, kind?: string) =>
  event(id, "form.created", {
    form: { id: `frm_${id}`, sessionID: "ses_1", ...(kind ? { metadata: { kind } } : {}) },
  });

function setup(
  overrides: {
    preferences?: Partial<NotificationSoundPreferences>;
    desktop?: Partial<DesktopNotificationSettings>;
    focused?: boolean;
    owner?: boolean;
    children?: string[];
  } = {},
) {
  let now = NOW;
  const play = vi.fn();
  const controller = createNotificationSoundController({
    preferences: () => ({
      ...DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
      turnCompleted: "chime",
      turnFailed: "pop",
      permission: "bell",
      question: "ripple",
      ...overrides.preferences,
    }),
    desktopSettings: () => ({
      turnCompletion: "always",
      permissionRequests: true,
      questionRequests: true,
      ...overrides.desktop,
    }),
    focused: () => overrides.focused ?? false,
    owner: () => overrides.owner ?? true,
    isChildSession: (_connectionID, sessionID) => overrides.children?.includes(sessionID) ?? false,
    play,
    now: () => now,
  });
  return {
    play,
    handle: (...events: PalotEvent[]) => controller.handle("connection-1", events),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("notification sound controller", () => {
  it("plays the chosen sound once per qualifying event", () => {
    const sounds = setup();
    sounds.handle(succeeded("evt_1"));
    sounds.advance(1_000);
    sounds.handle(succeeded("evt_1"));
    sounds.handle(failed("evt_2"));
    sounds.advance(1_000);
    sounds.handle(permission("evt_3"));
    sounds.advance(1_000);
    sounds.handle(form("evt_4", "question"));
    sounds.advance(1_000);
    sounds.handle(form("evt_5"));
    expect(sounds.play.mock.calls.map(([sound]) => sound)).toEqual([
      "chime",
      "pop",
      "bell",
      "ripple",
      "ripple",
    ]);
  });

  it("ignores user interruptions, subagent turns, and unrelated events", () => {
    const sounds = setup({ children: ["ses_child"] });
    sounds.handle(failed("evt_1", "MessageAbortedError"));
    sounds.handle(succeeded("evt_2", "ses_child"));
    sounds.handle(event("evt_3", "session.execution.interrupted", { sessionID: "ses_1" }));
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it("never plays for old history replayed into the stream", () => {
    const sounds = setup();
    sounds.handle(succeeded("evt_1", "ses_1", NOW - NOTIFICATION_SOUND_STALE_MS - 1));
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it("respects Off, background-only turn notifications, and window ownership", () => {
    const off = setup({ preferences: { turnCompleted: "off" } });
    off.handle(succeeded("evt_1"));
    expect(off.play).not.toHaveBeenCalled();

    const focused = setup({ desktop: { turnCompletion: "unfocused" }, focused: true });
    focused.handle(succeeded("evt_1"));
    expect(focused.play).not.toHaveBeenCalled();
    // Attention sounds are not tied to the turn completion timing.
    focused.handle(permission("evt_2"));
    expect(focused.play).toHaveBeenCalledWith("bell");

    const background = setup({ desktop: { turnCompletion: "unfocused" }, focused: false });
    background.handle(succeeded("evt_1"));
    expect(background.play).toHaveBeenCalledWith("chime");

    const otherWindow = setup({ owner: false });
    otherWindow.handle(succeeded("evt_1"));
    expect(otherWindow.play).not.toHaveBeenCalled();
  });

  it("throttles bursts", () => {
    const sounds = setup();
    sounds.handle(succeeded("evt_1"), permission("evt_2"));
    sounds.advance(399);
    sounds.handle(form("evt_3"));
    expect(sounds.play).toHaveBeenCalledTimes(1);
    sounds.advance(1);
    sounds.handle(form("evt_4"));
    expect(sounds.play).toHaveBeenCalledTimes(2);
  });
});
