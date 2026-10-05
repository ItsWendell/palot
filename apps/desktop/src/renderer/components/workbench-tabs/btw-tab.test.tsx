import { Provider, createStore } from "jotai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../../shared";
import { BtwTab } from "./btw-tab";
import type { BtwTab as BtwWorkbenchTab } from "../../lib/btw";
import { btwPendingAtom, btwRequestKey } from "../../atoms/btw";
import { runtimeAtom } from "../../atoms/workspace";

vi.mock("../markdown-content", () => ({
  MarkdownContent: ({ value }: { value: string }) => <div>{value}</div>,
}));

const tab: BtwWorkbenchTab = {
  id: "btw-one",
  kind: "btw",
  pinned: false,
  resource: {
    profileID: "owner",
    sessionID: "session",
    location: { directory: "/repo" },
    questionID: "one",
    question: "Why?",
  },
};
afterEach(cleanup);

describe("BTW tab", () => {
  it("shows pending, completed answers, and retryable interrupted questions after reload", () => {
    const store = createStore();
    store.set(btwPendingAtom, new Set([btwRequestKey(tab.resource, tab.id)]));
    const view = render(
      <Provider store={store}>
        <BtwTab tab={tab} />
      </Provider>,
    );
    expect(screen.getByRole("status").textContent).toContain("Answering");
    view.rerender(
      <Provider store={createStore()}>
        <BtwTab tab={{ ...tab, resource: { ...tab.resource, answer: "Because." } }} />
      </Provider>,
    );
    expect(screen.getByText("Because.")).toBeTruthy();
    view.rerender(
      <Provider store={createStore()}>
        <BtwTab tab={tab} />
      </Provider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("interrupted");
    expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps retry disabled on another server and displays the provider error", () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "other",
      connectionID: "other",
    } as OpenCodeRuntimeStatus);
    render(
      <Provider store={store}>
        <BtwTab tab={{ ...tab, resource: { ...tab.resource, error: "Provider unavailable" } }} />
      </Provider>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Provider unavailable");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.hasAttribute("disabled")).toBe(true);
    fireEvent.click(retry);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
