import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { OpenCodeRuntimeStatus, PalotApi, PalotMessage, PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { lastMessageLimit } from "../../lib/usage-limit-reset";
import { providerLimit } from "../../../shared/provider-limit";
import { CONNECTION_NOTICE_DELAY_MS } from "./composer-notice";
import { Composer } from "./composer-view";

const session: PalotSession = {
  id: "ses_notice",
  parentID: null,
  projectID: "project-1",
  title: "Notices",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

const runtime: OpenCodeRuntimeStatus = {
  connectionID: "test",
  profileID: "test-profile",
  contractVersion: "test",
  phase: "connected",
  connected: true,
  binaryPath: "/usr/local/bin/opencode2",
  version: "test",
  pid: 1,
  managed: true,
  lastConnectedAt: 1,
  error: null,
  versionMismatch: null,
} as OpenCodeRuntimeStatus;

function client(): OpenCodeClient {
  return {
    project: { list: vi.fn().mockResolvedValue([]) },
    model: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      default: vi.fn().mockResolvedValue({ data: null }),
    },
    provider: { list: vi.fn().mockResolvedValue({ data: [] }) },
    agent: { list: vi.fn().mockResolvedValue({ data: [] }) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
    file: { find: vi.fn().mockResolvedValue({ data: [] }) },
    session: {},
  } as unknown as OpenCodeClient;
}

/** A usage limit (`provider.quota`) that lifts at `resetsAt`, or none. */
function quota(resetsAt: number | null) {
  return resetsAt === null
    ? null
    : providerLimit({ type: "provider.quota", retryAfterMs: 60_000 }, resetsAt - 60_000);
}

function setup(
  status: Partial<OpenCodeRuntimeStatus>,
  usageLimitResetsAt: number | null,
  limit = quota(usageLimitResetsAt),
) {
  const store = createStore();
  store.set(runtimeAtom, { ...runtime, ...status } as OpenCodeRuntimeStatus);
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <Composer session={session} messages={[]} isWorking={false} usageLimit={limit} />
      </Provider>
    </QueryClientProvider>,
  );
  return store;
}

beforeEach(() => {
  window.localStorage.clear();
  setOpenCodeClientForTest(client());
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      runtimeStatus: vi.fn().mockResolvedValue(runtime),
      connectOpenCode: vi.fn().mockResolvedValue(runtime),
      onOpenCodeEvents: vi.fn(() => () => undefined),
      onAttachmentProgress: vi.fn(() => () => undefined),
      cancelAttachmentUpload: vi.fn().mockResolvedValue(undefined),
    } as unknown as PalotApi,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

const notice = () => screen.getByRole("status");

describe("the notice line", () => {
  it("names a usage limit with its reset time and opens the model popover", async () => {
    const user = userEvent.setup();
    const resetsAt = Date.now() + 3 * 60 * 60_000;
    setup({}, resetsAt);
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(resetsAt);
    expect(notice().textContent).toContain("Usage limit reached");
    if (new Date(resetsAt).toDateString() === new Date().toDateString()) {
      expect(notice().textContent).toContain(`resets ${time}`);
    }
    await user.click(within(notice()).getByRole("button", { name: "Switch model" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("names the specific limit and asks for the workspace admin when only they can raise it", () => {
    const body = JSON.stringify({ metadata: { limitName: "weekly", workspace: "wrk_1" } });
    setup({}, null, providerLimit({ type: "provider.go-limit", body }, Date.now()));
    expect(notice().textContent).toContain("OpenCode Go weekly limit reached");
    cleanup();
    setup({}, null, providerLimit({ type: "provider.chatgpt-workspace-limit" }, Date.now()));
    expect(notice().textContent).toContain(
      "ChatGPT workspace limit reached · ask your workspace admin",
    );
    cleanup();
    // A rate limit without a reset says nothing worth keeping on the line.
    setup({}, null, providerLimit({ type: "provider.rate-limit" }, Date.now()));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows nothing once the limit has reset", () => {
    setup({}, Date.now() - 1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows one notice at a time by priority, with +1 for the one waiting", async () => {
    const user = userEvent.setup();
    setup({ connected: false, phase: "reconnecting" }, Date.now() + 60 * 60_000);
    // A short reconnect does not flash: the connection notice waits a moment.
    expect(notice().textContent).toContain("Usage limit reached");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, CONNECTION_NOTICE_DELAY_MS + 50));
    });
    await waitFor(() => expect(notice().textContent).toContain("Reconnecting to OpenCode"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const more = within(notice()).getByRole("button", { name: "1 more notice" });
    expect(more.textContent).toBe("+1");
    await user.click(more);
    expect(notice().textContent).toContain("Usage limit reached");
    await user.click(within(notice()).getByRole("button", { name: "1 more notice" }));
    expect(notice().textContent).toContain("OpenCode");
  });

  it("retries the connection from the notice", async () => {
    const user = userEvent.setup();
    setup({ connected: false, phase: "error" }, null);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, CONNECTION_NOTICE_DELAY_MS + 50));
    });
    await user.click(within(notice()).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(window.palot.connectOpenCode).toHaveBeenCalled());
  });
});

describe("lastMessageLimit", () => {
  const failed = (at: number, retryAfterMs: number): PalotMessage =>
    ({
      id: "a1",
      type: "assistant",
      createdAt: at,
      completedAt: at,
      content: [],
      data: { error: { type: "provider.quota", retryAfterMs } },
    }) as unknown as PalotMessage;

  it("reads the last turn's usage-limit failure", () => {
    expect(lastMessageLimit([failed(1_000, 60_000)])).toMatchObject({
      kind: "quota",
      resetsAt: 61_000,
    });
  });

  it("forgets it once the user sent something after it", () => {
    expect(
      lastMessageLimit([
        failed(1_000, 60_000),
        { id: "u1", type: "user", createdAt: 2_000, content: [] } as unknown as PalotMessage,
      ]),
    ).toBeNull();
  });
});

describe("the card's drop state", () => {
  it("marks the card while files from the OS are dragged over it, and clears it on leave", () => {
    setup({}, null);
    const card = document.querySelector<HTMLElement>('[data-slot="composer"]')!;
    const files = { types: ["Files"], files: [], dropEffect: "none", getData: () => "" };
    expect(card.hasAttribute("data-drag-over")).toBe(false);
    fireEvent.dragOver(card, { dataTransfer: files });
    expect(card.hasAttribute("data-drag-over")).toBe(true);
    fireEvent.dragLeave(card, { dataTransfer: files, relatedTarget: document.body });
    expect(card.hasAttribute("data-drag-over")).toBe(false);
  });
});
