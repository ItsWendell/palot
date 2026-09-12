import { Provider, createStore } from "jotai";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotApi } from "../../shared";
import { resetOpenCodeClientForTest } from "../services/opencode-client";
import { PendingRequests } from "./thread";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});
it("cancels without answering and sends the trimmed reason through the official client transport", async () => {
  const user = userEvent.setup();
  const reply = vi.fn(
    async (_request: { method: string; path: string; body: ArrayBuffer | null }) => ({
      status: 204,
      statusText: "No Content",
      headers: {},
      body: new ArrayBuffer(0),
    }),
  );
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      runtimeStatus: vi.fn(),
      openCodeRequest: reply,
      cancelOpenCodeRequest: vi.fn(),
    } as unknown as PalotApi,
  });
  const store = createStore();
  render(
    <Provider store={store}>
      <PendingRequests
        sessionID="permission-reason"
        requests={[
          {
            id: "request-reason",
            type: "permission",
            title: "shell",
            resources: ["echo test"],
            savePatterns: [],
            questions: [],
            fields: [],
          },
        ]}
      />
    </Provider>,
  );
  await user.click(screen.getByRole("button", { name: "Deny" }));
  await user.type(
    screen.getByRole("textbox", { name: "Rejection reason (optional)" }),
    "  Use a read-only command  ",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(reply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Deny" }));
  await user.click(screen.getByRole("button", { name: "Confirm denial" }));
  await waitFor(() => expect(reply).toHaveBeenCalledOnce());
  const request = reply.mock.calls[0]![0];
  expect(request).toMatchObject({
    method: "POST",
    path: "/api/session/permission-reason/permission/request-reason/reply",
  });
  expect(JSON.parse(new TextDecoder().decode(request.body!))).toEqual({
    reply: "reject",
    message: "Use a read-only command",
  });
});
