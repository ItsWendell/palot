import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import type { OpenCodeRuntimeStatus, PalotMessage } from "../../shared";
import { btwFocusRequestAtom } from "../atoms/btw";
import { flushWorkbenchPersistence, workbenchStateAtom } from "../atoms/workbench";
import { runtimeAtom } from "../atoms/workspace";
import { showErrorToast } from "../lib/toast-error";
import { createSessionTranscriptProjector } from "../lib/turn-projection";
import { createWorkbenchState, workbenchScopeKey } from "../lib/workbench-tabs";
import { openCodeClient } from "../services/opencode-client";
import { RESPONSE_QUOTE_HIGHLIGHT } from "../lib/response-quote-highlight";
import { updateBtwTab } from "../lib/btw";
import {
  ResponseSelectionAsk,
  readResponseSelection,
  responsePromptID,
  responseRowIndex,
  responseSelectionSource,
} from "./response-selection-ask";

vi.mock("../services/opencode-client", () => ({ openCodeClient: vi.fn() }));
vi.mock("../lib/toast-error", () => ({ showErrorToast: vi.fn() }));

const owner = { profileID: "profile", sessionID: "session", connectionID: "connection" };

function message(input: Pick<PalotMessage, "id" | "type" | "createdAt"> & Partial<PalotMessage>) {
  return {
    completedAt: input.createdAt + 1,
    text: null,
    agent: input.type === "assistant" ? "build" : null,
    model: null,
    tokens: null,
    finish: input.type === "assistant" ? "stop" : null,
    content: [],
    data: null,
    ...input,
  } as PalotMessage;
}
const reply = (id: string, createdAt: number, text: string) =>
  message({ id, type: "assistant", createdAt, content: [{ type: "text", text }] });
// Chronological projection: every prompt and reply is its own row.
const rows = createSessionTranscriptProjector().project({
  messages: [
    message({ id: "msg_u1", type: "user", createdAt: 10, text: "Log design?" }),
    reply("msg_a", 11, "Use a ring buffer for the log."),
    message({ id: "msg_u2", type: "user", createdAt: 20, text: "And then?" }),
    message({
      id: "msg_tools",
      type: "assistant",
      createdAt: 21,
      finish: "tool-calls",
      content: [{ type: "tool", id: "t", name: "read", state: { status: "completed", input: {} } }],
    }),
    reply("msg_b", 22, "Then flush on idle."),
  ],
}).rows;

function Transcript() {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={rootRef}>
        <div {...responseSelectionSource("msg_a")}>
          <p data-testid="a">Use a ring buffer for the log.</p>
        </div>
        <div {...responseSelectionSource("msg_b")}>
          <p data-testid="b">Then flush on idle.</p>
        </div>
        <p data-testid="user">A user prompt</p>
      </div>
      <ResponseSelectionAsk
        rootRef={rootRef}
        rows={rows}
        sessionID="session"
        location={{ directory: "/r" }}
      />
    </div>
  );
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function setup() {
  const store = createStore();
  store.set(workbenchStateAtom, createWorkbenchState());
  store.set(runtimeAtom, { ...owner, connected: true } as unknown as OpenCodeRuntimeStatus);
  render(
    <Provider store={store}>
      <Transcript />
    </Provider>,
  );
  return store;
}

async function selectionChanged() {
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getSelection()?.removeAllRanges();
  flushWorkbenchPersistence();
});

describe("response sources in a chronological projection", () => {
  it("finds a reply in its own row and the prompt it answered across tool rows", () => {
    expect(rows.find((row) => row.turn.final?.message.id === "msg_a")?.turn.user).toBeNull();
    expect(responseRowIndex(rows, "msg_a")).toBeGreaterThan(-1);
    expect(responsePromptID(rows, "msg_a")).toBe("msg_u1");
    expect(responsePromptID(rows, "msg_b")).toBe("msg_u2");
    expect(responsePromptID(rows, "missing")).toBeUndefined();
  });
});

describe("readResponseSelection", () => {
  it("quotes text within one response", () => {
    setup();
    const root = screen.getByTestId("a").parentElement!.parentElement!;
    const text = screen.getByTestId("a").firstChild!;
    expect(readResponseSelection(select(text, 4, text, 17), root)).toMatchObject({
      kind: "quote",
      quote: { text: "a ring buffer", messageID: "msg_a" },
    });
  });

  it("rejects whitespace, selections outside responses, and selections across responses", () => {
    setup();
    const root = screen.getByTestId("a").parentElement!.parentElement!;
    const a = screen.getByTestId("a").firstChild!;
    const b = screen.getByTestId("b").firstChild!;
    const user = screen.getByTestId("user").firstChild!;
    expect(readResponseSelection(select(a, 3, a, 4), root)).toBeNull();
    expect(readResponseSelection(select(user, 0, user, 6), root)).toBeNull();
    expect(readResponseSelection(select(a, 0, b, 4), root)?.kind).toBe("outside");
    expect(readResponseSelection(select(a, 0, user, 4), root)?.kind).toBe("outside");
  });
});

describe("Ask about selection", () => {
  it.each(["submit", "cancel"])("clears the pending quote highlight on %s", async (action) => {
    const highlights = new Map<string, Set<Range>>();
    vi.stubGlobal("CSS", { ...CSS, highlights });
    vi.stubGlobal(
      "Highlight",
      class extends Set<Range> {
        constructor(...ranges: Range[]) {
          super(ranges);
        }
      },
    );
    const store = setup();
    const text = screen.getByTestId("a").firstChild!;
    select(text, 4, text, 17);
    await selectionChanged();
    fireEvent.click(screen.getByRole("button", { name: "Ask about selection" }));
    const tab = store.get(workbenchStateAtom).scopes[workbenchScopeKey(owner)]!.right.tabs[0]!;
    expect([...highlights.get(RESPONSE_QUOTE_HIGHLIGHT)!][0]!.toString()).toBe("a ring buffer");
    expect(document.getSelection()!.rangeCount).toBe(0);
    act(() => {
      store.set(workbenchStateAtom, (state) =>
        action === "cancel"
          ? createWorkbenchState()
          : updateBtwTab(state, owner, tab.id, (current) => ({
              ...current,
              resource: { ...current.resource, question: "Why?" },
            })),
      );
    });
    expect(highlights.has(RESPONSE_QUOTE_HIGHLIGHT)).toBe(false);
  });

  it("opens a side question about the selected text without generating an answer", async () => {
    const store = setup();
    const text = screen.getByTestId("a").firstChild!;
    select(text, 4, text, 17);
    await selectionChanged();
    fireEvent.click(screen.getByRole("button", { name: "Ask about selection" }));
    const tabs = store.get(workbenchStateAtom).scopes[workbenchScopeKey(owner)]!.right.tabs;
    expect(tabs).toMatchObject([
      {
        kind: "btw",
        resource: {
          question: "",
          quote: { text: "a ring buffer", messageID: "msg_a", turnMessageID: "msg_u1" },
        },
      },
    ]);
    expect(store.get(btwFocusRequestAtom)).toBe(tabs[0]!.id);
    expect(openCodeClient).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Ask about selection" })).toBeNull();
  });

  it("explains that a selection must stay inside one response", async () => {
    setup();
    select(screen.getByTestId("a").firstChild!, 0, screen.getByTestId("b").firstChild!, 4);
    await selectionChanged();
    expect(screen.getByRole("status").textContent).toContain("inside one response");
    expect(screen.queryByRole("button", { name: "Ask about selection" })).toBeNull();
  });

  it("refuses a selection that the streaming response changed before the click", async () => {
    const store = setup();
    const text = screen.getByTestId("a").firstChild!;
    select(text, 4, text, 17);
    await selectionChanged();
    const action = screen.getByRole("button", { name: "Ask about selection" });
    // The response re-rendered and the selection now covers different text.
    select(text, 0, text, 3);
    fireEvent.click(action);
    expect(showErrorToast).toHaveBeenCalledWith("Select the text again", expect.any(Error));
    expect(store.get(workbenchStateAtom).scopes[workbenchScopeKey(owner)]).toBeUndefined();
  });

  it("dismisses on Escape", async () => {
    setup();
    const text = screen.getByTestId("a").firstChild!;
    select(text, 4, text, 17);
    await selectionChanged();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Ask about selection" })).toBeNull();
  });
});
