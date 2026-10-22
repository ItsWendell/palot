import { Provider, createStore } from "jotai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../../shared";
import { BtwTab } from "./btw-tab";
import type { BtwTab as BtwWorkbenchTab } from "../../lib/btw";
import { btwFocusRequestAtom, btwPendingAtom, btwRequestKey } from "../../atoms/btw";
import { transcriptJumpTargetAtom } from "../../atoms/workbench";
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

describe("BTW tab about a selection", () => {
  const selection: BtwWorkbenchTab = {
    ...tab,
    resource: {
      ...tab.resource,
      question: "",
      quote: { text: "Use a ring buffer.", messageID: "msg_a", turnMessageID: "msg_u" },
    },
  };
  function connected() {
    const store = createStore();
    store.set(runtimeAtom, {
      connected: true,
      profileID: "owner",
      connectionID: "connection",
    } as OpenCodeRuntimeStatus);
    return store;
  }

  it("shows the quote, focuses the question field on request, and jumps to the source turn", () => {
    const store = connected();
    store.set(btwFocusRequestAtom, selection.id);
    render(
      <Provider store={store}>
        <BtwTab tab={selection} />
      </Provider>,
    );
    expect(screen.getByText("Use a ring buffer.")).toBeTruthy();
    const field = screen.getByRole("textbox", { name: "Question about this selection" });
    expect(document.activeElement).toBe(field);
    expect(store.get(btwFocusRequestAtom)).toBeNull();
    expect(screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show in conversation" }));
    expect(store.get(transcriptJumpTargetAtom)).toEqual({
      sessionID: "session",
      messageID: "msg_a",
      fallbackMessageID: "msg_u",
    });
  });

  it("links back to the response even without a known prompt", () => {
    const store = connected();
    const { turnMessageID: _prompt, ...quote } = selection.resource.quote!;
    render(
      <Provider store={store}>
        <BtwTab tab={{ ...selection, resource: { ...selection.resource, quote } }} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show in conversation" }));
    expect(store.get(transcriptJumpTargetAtom)).toEqual({
      sessionID: "session",
      messageID: "msg_a",
    });
  });

  it("lists earlier exchanges and offers a follow-up field after an answer", () => {
    const store = connected();
    render(
      <Provider store={store}>
        <BtwTab
          tab={{
            ...selection,
            resource: {
              ...selection.resource,
              question: "Why?",
              answer: "Bounded memory.",
              followUps: [{ id: "f1", question: "How big?", answer: "About 1 MiB." }],
            },
          }}
        />
      </Provider>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Why?" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "How big?" })).toBeTruthy();
    expect(screen.getByText("About 1 MiB.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Ask a follow-up" })).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
  });

  it("offers Stop while answering and only Retry after a failure", () => {
    const store = connected();
    const asked = { ...selection, resource: { ...selection.resource, question: "Why?" } };
    store.set(btwPendingAtom, new Set([btwRequestKey(asked.resource, asked.id)]));
    const view = render(
      <Provider store={store}>
        <BtwTab tab={asked} />
      </Provider>,
    );
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask" }).hasAttribute("disabled")).toBe(true);
    store.set(btwPendingAtom, new Set());
    view.rerender(
      <Provider store={store}>
        <BtwTab tab={{ ...asked, resource: { ...asked.resource, error: "Stopped." } }} />
      </Provider>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Stopped.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
