import { Provider, createStore } from "jotai";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { PalotApi } from "../../shared";
import type { OpenCodeClient } from "@opencode/client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import type { PendingRequestView } from "../lib/view-models";
import { PendingRequests } from "./transcript/pending-requests";

// Seed before renderer modules load: the retired policy read its session map at import time.
const legacyApprovalKeys = vi.hoisted(() => {
  const preferences = {
    "palot.desktop.state.approval.modes": { version: 1, value: { ses_1: "approve" } },
    "palot.desktop.state.approval.default-mode": { version: 1, value: "approve" },
    "palot.approval-modes.v1": { version: 1, modes: { ses_1: "approve" } },
    "palot.approval.default-mode.v1": "approve",
  };
  for (const [key, value] of Object.entries(preferences)) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
  return Object.keys(preferences);
});

afterAll(() => {
  for (const key of legacyApprovalKeys) window.localStorage.removeItem(key);
});

function bridge(overrides: Record<string, unknown>): PalotApi {
  return {
    runtimeStatus: vi.fn(),
    ...overrides,
  } as unknown as PalotApi;
}

function client(overrides: Record<string, unknown>): OpenCodeClient {
  return overrides as unknown as OpenCodeClient;
}

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  delete (window as unknown as { palot?: PalotApi }).palot;
});

describe("PendingRequests", () => {
  it("routes a child's permission to its owner and leaves questions to the request panel", async () => {
    const user = userEvent.setup();
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ permission: { reply: replyPermission } }));
    const base = {
      id: "same-id",
      title: "Question",
      resources: [],
      savePatterns: [],
      fields: [],
      questions: [],
    };
    const { container } = render(
      <PendingRequests
        sessionID="parent"
        inline
        requests={[
          { ...base, type: "question", sessionID: "child-a", sessionTitle: "Mac capture" },
          { ...base, type: "permission", sessionID: "child-c", sessionTitle: "Run checks" },
        ]}
      />,
    );
    expect(container.querySelector('[data-palot-request-session-id="child-a"]')).toBeNull();
    const card = within(
      container.querySelector<HTMLElement>('[data-palot-request-session-id="child-c"]')!,
    );
    expect(screen.getByText("Subagent · Run checks")).toBeTruthy();
    await user.click(card.getByRole("button", { name: "Allow once" }));
    expect(replyPermission).toHaveBeenCalledWith({
      sessionID: "child-c",
      requestID: "same-id",
      decision: "once",
    });
  });

  it("does not render pending input as a standalone request card", () => {
    render(
      <PendingRequests
        sessionID="ses_1"
        requests={[
          {
            id: "msg_1",
            type: "input",
            title: "Pending input",
            detail: "Run tests after the current turn",
            resources: [],
            savePatterns: [],
            questions: [],
            fields: [],
            delivery: "queue",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("region", { name: "Pending input" })).toBeNull();
  });

  it.each([
    ["Allow once", "once"],
    ["Always allow for this project", "always"],
  ])("ignores saved auto-approval preferences until an explicit %s reply", async (label, reply) => {
    const user = userEvent.setup();
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ permission: { reply: replyPermission } }));
    const store = createStore();

    render(
      <Provider store={store}>
        <PendingRequests
          sessionID="ses_1"
          requests={[
            {
              id: "per_1",
              type: "permission",
              title: "shell",
              detail: undefined,
              resources: ["bun run test"],
              savePatterns: ["bun run *"],
              questions: [],
              fields: [],
              delivery: undefined,
            },
          ]}
        />
      </Provider>,
    );

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Deny" }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Allow once" }).disabled).toBe(
      false,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Always allow for this project" })
        .disabled,
    ).toBe(false);
    expect(replyPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: label }));

    await waitFor(() =>
      expect(replyPermission).toHaveBeenCalledExactlyOnceWith({
        sessionID: "ses_1",
        requestID: "per_1",
        decision: reply,
      }),
    );
  });
});

describe("PendingRequests exit", () => {
  function permission(id: string, title: string): PendingRequestView {
    return {
      id,
      type: "permission",
      title,
      detail: undefined,
      resources: [],
      savePatterns: [],
      questions: [],
      fields: [],
      delivery: undefined,
    };
  }

  function Dock({
    requests,
    onExitComplete,
  }: {
    requests: PendingRequestView[];
    onExitComplete?: () => void;
  }) {
    return (
      <>
        <div data-testid="dock">
          <PendingRequests sessionID="ses_1" requests={requests} onExitComplete={onExitComplete} />
        </div>
        <textarea aria-label="Message Palot" />
      </>
    );
  }

  it("keeps an answered card out of reach until it has faded, then closes the area", async () => {
    const onExitComplete = vi.fn();
    const { rerender } = render(
      <Dock requests={[permission("per_1", "Run tests")]} onExitComplete={onExitComplete} />,
    );
    const card = screen.getByRole("region", { name: "Run tests" });

    rerender(<Dock requests={[]} onExitComplete={onExitComplete} />);

    expect(card.isConnected).toBe(true);
    expect(screen.queryByRole("region", { name: "Run tests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("dock").childElementCount).toBe(0));
    expect(card.isConnected).toBe(false);
    expect(onExitComplete).toHaveBeenCalled();
  });

  it("moves focus from a leaving card to the composer", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dock requests={[permission("per_1", "Run tests")]} />);
    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(screen.getByRole("region", { name: "Run tests" }).contains(document.activeElement)).toBe(
      true,
    );

    rerender(<Dock requests={[]} />);

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message Palot" }));
  });

  it("shows a request that arrives while the previous card is leaving", async () => {
    const { rerender } = render(<Dock requests={[permission("per_1", "Run tests")]} />);
    const leaving = screen.getByRole("region", { name: "Run tests" });
    rerender(<Dock requests={[]} />);
    rerender(<Dock requests={[permission("per_2", "Edit files")]} />);

    const next = screen.getByRole("region", { name: "Edit files" });
    expect(within(next).getByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(document.querySelector('[data-palot-request-id="per_1"]')).toBeNull();
    await waitFor(() => expect(leaving.isConnected).toBe(false));
    expect(screen.getByRole("region", { name: "Edit files" })).toBe(next);
  });

  it("resolves a request moving to another area to its new card only", () => {
    const request = permission("per_1", "Run tests");
    const { rerender } = render(
      <>
        <PendingRequests sessionID="ses_1" requests={[request]} />
        <PendingRequests sessionID="ses_1" requests={[]} inline />
      </>,
    );
    rerender(
      <>
        <PendingRequests sessionID="ses_1" requests={[]} />
        <PendingRequests sessionID="ses_1" requests={[request]} inline />
      </>,
    );

    expect(document.querySelectorAll('[data-palot-request-id="per_1"]')).toHaveLength(1);
    expect(screen.getAllByRole("region", { name: "Run tests" })).toHaveLength(1);
  });
});
