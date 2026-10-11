import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopNotificationDeliveryStatus } from "../../shared";
import { notificationSoundPreferencesAtom } from "../atoms/notification-sounds";
import { NotificationSoundSettings } from "./notification-sound-settings";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderSounds(deliveryStatus: DesktopNotificationDeliveryStatus | null = null) {
  const store = createStore();
  const play = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <Provider store={store}>
      <NotificationSoundSettings deliveryStatus={deliveryStatus} play={play} />
    </Provider>,
  );
  return { store, play, user, view };
}

it("chooses and previews a sound per event", async () => {
  const { store, play, user } = renderSounds();
  const preview = screen.getByRole("button", { name: "Play turn completed sound" });
  expect((preview as HTMLButtonElement).disabled).toBe(true);

  await user.click(screen.getByRole("combobox", { name: "Turn completed sound" }));
  await user.click(await screen.findByRole("option", { name: "Bell" }));

  expect(store.get(notificationSoundPreferencesAtom).turnCompleted).toBe("bell");
  await user.click(screen.getByRole("button", { name: "Play turn completed sound" }));
  expect(play).toHaveBeenCalledWith("bell");
});

it("explains that only sounds arrive while macOS alerts are off", () => {
  const status: DesktopNotificationDeliveryStatus = {
    authorization: "authorized",
    delivery: "off",
  };
  const { store, view } = renderSounds(status);
  expect(screen.queryByRole("note")).toBeNull();

  store.set(notificationSoundPreferencesAtom, (current) => ({ ...current, permission: "pop" }));
  view.rerender(
    <Provider store={store}>
      <NotificationSoundSettings deliveryStatus={status} />
    </Provider>,
  );
  expect(screen.getByRole("note").textContent).toMatch(/only play a sound/);
});
