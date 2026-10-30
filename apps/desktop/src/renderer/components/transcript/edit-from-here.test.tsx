import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotMessage, PalotSession } from "../../../shared";
import { composerStateAtomFamily } from "../../atoms/composer-state";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { composerScope } from "../../lib/composer-scope";
import { palot } from "../../services/palot";
import { EditFromHereButton, EditFromHereProvider } from "./edit-from-here";

const mocks = vi.hoisted(() => ({ cache: vi.fn() }));
vi.mock("../../hooks/use-session-catalog", () => ({ useCacheSession: () => mocks.cache }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const session = { id: "session-edit", location: { directory: "/repo" } } as PalotSession;
const message = {
  id: "user-edit",
  type: "user",
  text: "Original prompt",
  files: [],
  content: [],
} as unknown as PalotMessage;
function setup(running = false) {
  const store = createStore();
  store.set(runtimeAtom, {
    profileID: "edit-profile",
    connectionID: "edit-owner",
    connected: true,
  } as OpenCodeRuntimeStatus);
  const scope = composerScope("edit-profile", `session:${session.id}`);
  store.set(composerDraftAtomFamily(scope), { text: "Prior draft", mentions: [], command: null });
  render(
    <Provider store={store}>
      <EditFromHereProvider session={session} running={running}>
        <EditFromHereButton message={message} />
      </EditFromHereProvider>
    </Provider>,
  );
  return { store, scope, button: screen.getByRole("button", { name: "Edit from here" }) };
}

it("confirms, stages file revert on the owning server, and restores the prompt into its draft", async () => {
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
  const stage = vi.spyOn(palot, "stageSessionRevert").mockResolvedValue(session);
  const { store, scope, button } = setup();
  fireEvent.click(button);
  await waitFor(() =>
    expect(store.get(composerDraftAtomFamily(scope)).text).toBe("Original prompt"),
  );
  expect(stage).toHaveBeenCalledExactlyOnceWith(
    { sessionID: session.id, messageID: message.id, files: true },
    "edit-owner",
  );
  expect(mocks.cache).toHaveBeenCalledWith(session);
  expect(store.get(composerStateAtomFamily(scope)).sending).toBe(false);
});

it("does not discard a draft or rewind history when confirmation is cancelled", () => {
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => false) });
  const stage = vi.spyOn(palot, "stageSessionRevert");
  const { store, scope, button } = setup();
  fireEvent.click(button);
  expect(stage).not.toHaveBeenCalled();
  expect(store.get(composerDraftAtomFamily(scope)).text).toBe("Prior draft");
});

it("disables history editing while work is running", () => {
  const stage = vi.spyOn(palot, "stageSessionRevert");
  const { button } = setup(true);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(stage).not.toHaveBeenCalled();
});
