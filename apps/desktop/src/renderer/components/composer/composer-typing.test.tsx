import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, atom, createStore } from "jotai";
import { Profiler, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { PalotApi, PalotModel, PalotSession } from "../../../shared";
import { composerDraftAtomFamily } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { composerScope } from "../../lib/composer-scope";
import { createRendererQueryClient } from "../../lib/query-client";
import type { PendingRequestView } from "../../lib/view-models";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { palot } from "../../services/palot";

/** Commits per part, counted with React's Profiler around each part's subtree. */
const commits = vi.hoisted(() => ({
  view: 0,
  row: 0,
  queue: 0,
  suggestions: 0,
  editor: 0,
  request: 0,
  tab: 0,
}));

function counted<P extends object>(
  name: keyof typeof commits,
  Component: (props: P) => React.ReactNode,
) {
  return function Counted(props: P) {
    return (
      <Profiler id={name} onRender={() => (commits[name] += 1)}>
        <Component {...props} />
      </Profiler>
    );
  };
}

vi.mock("./composer-row", async (original) => {
  const actual = await original<typeof import("./composer-row")>();
  return { ...actual, ComposerRow: counted("row", actual.ComposerRow) };
});
vi.mock("../composer-queue", async (original) => {
  const actual = await original<typeof import("../composer-queue")>();
  return { ...actual, ComposerQueue: counted("queue", actual.ComposerQueue) };
});
vi.mock("../composer-dock/request-panel", async (original) => {
  const actual = await original<typeof import("../composer-dock/request-panel")>();
  return { ...actual, RequestPanel: counted("request", actual.RequestPanel) };
});
// The suggestion list is the launcher's panel, which typed `/`, `@` and `$` open.
vi.mock("./composer-launcher-panel", async (original) => {
  const actual = await original<typeof import("./composer-launcher-panel")>();
  const Panel = actual.ComposerLauncherPanel;
  return {
    ...actual,
    ComposerLauncherPanel: counted("suggestions", (props: ComponentProps<typeof Panel>) => (
      <Panel {...props} />
    )),
  };
});
// The running-work panel lists processes and opens tasks; here it only counts its renders.
vi.mock("../running-work-control", async (original) => {
  const actual = await original<typeof import("../running-work-control")>();
  return {
    ...actual,
    RunningWorkPanel: counted("tab", ({ work }: { work: { label: string } }) => (
      <p>{work.label}</p>
    )),
  };
});
vi.mock("./composer-editor-field", async (original) => {
  const actual = await original<typeof import("./composer-editor-field")>();
  return { ...actual, ComposerEditorField: counted("editor", actual.ComposerEditorField) };
});
vi.mock("./use-composer", async (original) => {
  const actual = await original<typeof import("./use-composer")>();
  return {
    ...actual,
    useComposer: (props: ComponentProps<typeof import("./composer-view").Composer>) => {
      commits.view += 1;
      return actual.useComposer(props);
    },
  };
});

import type { RunningWork } from "../running-work-control";
import {
  composerOpenTabAtom,
  type ComposerRunningWork,
  type ComposerStandingTab,
} from "./composer-standing";
import { Composer } from "./composer-view";
import type { ComposerEditorElement } from "../../lib/composer-editor-element";

const outside = () => ({
  view: commits.view,
  row: commits.row,
  queue: commits.queue,
  suggestions: commits.suggestions,
  request: commits.request,
  tab: commits.tab,
});
const NOTHING = { view: 0, row: 0, queue: 0, suggestions: 0, request: 0, tab: 0 };

const permission: PendingRequestView = {
  id: "per_1",
  type: "permission",
  title: "Run a command",
  resources: ["bun test"],
  savePatterns: ["bun test *"],
  questions: [],
  fields: [],
};

const planTab: ComposerStandingTab = {
  value: "plan",
  icon: null,
  label: "Plan · 1/3",
  title: "Plan",
  content: (
    <Profiler id="tab" onRender={() => (commits.tab += 1)}>
      <ol>
        <li>Write tests</li>
      </ol>
    </Profiler>
  ),
};

function queuedInput(id: string, detail: string): PendingRequestView {
  return { ...queued, id, detail };
}

const session: PalotSession = {
  id: "session-typing",
  parentID: null,
  projectID: "project-1",
  title: "Typing",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

const model: PalotModel = {
  id: "fast",
  modelID: "fast",
  providerID: "openai",
  name: "Fast",
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 100_000,
  outputLimit: 10_000,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
};

const queued: PendingRequestView = {
  id: "msg-queued",
  type: "input",
  title: "Pending input",
  detail: "Run the tests afterwards",
  resources: [],
  savePatterns: [],
  questions: [],
  fields: [],
  delivery: "queue",
};

const commandList = vi.fn();

function client(): OpenCodeClient {
  return {
    project: { list: vi.fn().mockResolvedValue([]) },
    model: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      default: vi.fn().mockResolvedValue({ data: null }),
    },
    provider: { list: vi.fn().mockResolvedValue({ data: [] }) },
    agent: { list: vi.fn().mockResolvedValue({ data: [] }) },
    command: { list: commandList.mockResolvedValue({ data: [] }) },
    skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
    file: { find: vi.fn().mockResolvedValue({ data: [] }) },
    session: {},
  } as unknown as OpenCodeClient;
}

beforeEach(() => {
  window.localStorage.clear();
  setOpenCodeClientForTest(client());
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      runtimeStatus: vi.fn(),
      onOpenCodeEvents: vi.fn(() => () => undefined),
      onAttachmentProgress: vi.fn(() => () => undefined),
      cancelAttachmentUpload: vi.fn().mockResolvedValue(undefined),
    } as unknown as PalotApi,
  });
  vi.spyOn(palot, "listModels").mockResolvedValue({
    models: [model],
    defaultModel: model,
    providers: [],
    errors: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

async function renderSettled(
  draft: string,
  props: Partial<ComponentProps<typeof Composer>> = {},
  prepare?: (store: ReturnType<typeof createStore>) => void,
) {
  const store = createStore();
  store.set(runtimeAtom, {
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
  });
  store.set(composerDraftAtomFamily(composerScope("test-profile", `session:${session.id}`)), {
    text: draft,
    mentions: [],
    command: null,
  });
  prepare?.(store);
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <Composer session={session} messages={[]} isWorking pendingInputs={[queued]} {...props} />
      </Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Model: Fast" });
  // The idle prefetch loads the command catalog; let it land before counting.
  await waitFor(() => expect(commandList).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  for (const key of Object.keys(commits) as (keyof typeof commits)[]) commits[key] = 0;
  return screen.getByRole<ComposerEditorElement>("textbox", { name: "Message Palot" });
}

describe("Composer typing isolation", () => {
  it("re-renders only the editor while typing into a draft", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Draft");
    const typed = "the quick brown fox jumps over the lazy dog again!".slice(0, 50);
    expect(typed).toHaveLength(50);

    await user.type(input, typed);

    expect(input.value).toBe(`Draft${typed}`);
    expect(commits.editor).toBeGreaterThanOrEqual(50);
    expect({
      view: commits.view,
      row: commits.row,
      queue: commits.queue,
      suggestions: commits.suggestions,
    }).toEqual({ view: 0, row: 0, queue: 0, suggestions: 0 });
  });

  it("commits nothing outside the editor when the caret moves", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Move the caret through this draft");

    await user.click(input);
    await user.keyboard("{ArrowLeft}{ArrowLeft}{Home}{End}");
    act(() => {
      input.setSelectionRange(4, 4);
      fireEvent.select(input);
    });

    expect({
      view: commits.view,
      row: commits.row,
      queue: commits.queue,
      suggestions: commits.suggestions,
    }).toEqual({ view: 0, row: 0, queue: 0, suggestions: 0 });
  });

  it("renders the suggestion list, and not the row, once a trigger is typed", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Draft ");

    await user.type(input, "@src");

    expect(commits.suggestions).toBeGreaterThan(0);
    expect({ view: commits.view, row: commits.row, queue: commits.queue }).toEqual({
      view: 0,
      row: 0,
      queue: 0,
    });
  });

  it("commits nothing outside the editor while typing with a request panel open", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Draft", { requests: [permission] });
    expect(screen.getByRole("region", { name: "Pending request" })).toBeTruthy();
    await user.type(input, " and more words");
    expect(commits.editor).toBeGreaterThan(0);
    expect(outside()).toEqual(NOTHING);
  });

  it("commits nothing outside the editor while typing with a tab panel open", async () => {
    const user = userEvent.setup();
    const standing = [planTab];
    const input = await renderSettled("Draft", { standing }, (store) =>
      store.set(composerOpenTabAtom(session.id), "plan"),
    );
    expect(screen.getByRole("region", { name: "Plan" })).toBeTruthy();
    await user.type(input, " and more words");
    expect(commits.editor).toBeGreaterThan(0);
    expect(outside()).toEqual(NOTHING);
  });

  it("commits only the editor and the launcher list while typing a query under +", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Draft");
    await user.click(screen.getByRole("button", { name: "Add files, commands and more" }));
    // The first letter makes the emptied field non-empty, which the row reads, as for any draft.
    await user.type(input, "r", { skipClick: true });
    for (const key of Object.keys(commits) as (keyof typeof commits)[]) commits[key] = 0;

    await user.type(input, "eview the diff", { skipClick: true });

    expect(input.value).toBe("review the diff");
    expect(commits.editor).toBeGreaterThan(0);
    expect(commits.suggestions).toBeGreaterThan(0);
    expect({ ...outside(), suggestions: 0 }).toEqual(NOTHING);
  });

  it("commits only the editor and the list while typing with a trigger open", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Draft ");
    await user.type(input, "@s");
    for (const key of Object.keys(commits) as (keyof typeof commits)[]) commits[key] = 0;

    await user.type(input, "rc/comp", { skipClick: true });

    expect(commits.editor).toBeGreaterThan(0);
    expect(commits.suggestions).toBeGreaterThan(0);
    expect({ ...outside(), suggestions: 0 }).toEqual(NOTHING);
  });

  it("opens with prefetched data in place, without a request", async () => {
    commandList.mockResolvedValue({ data: [{ name: "review", description: "Review changes" }] });
    const input = await renderSettled("");
    const requests = commandList.mock.calls.length;

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add files, commands and more" }));
    });
    expect(screen.getByRole("option", { name: /^Attach files/ })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    act(() => {
      fireEvent.change(input, { target: { value: "/" } });
    });
    expect(screen.getByRole("option", { name: /\/review/ })).toBeTruthy();
    expect(commandList).toHaveBeenCalledTimes(requests);
  });

  it("commits nothing outside the editor while typing with a three-row queue", async () => {
    const user = userEvent.setup();
    const input = await renderSettled("Draft", {
      pendingInputs: [
        queuedInput("q1", "First"),
        queuedInput("q2", "Second"),
        queuedInput("q3", "Third"),
      ],
    });
    expect(screen.getByRole("region", { name: "Pending messages" })).toBeTruthy();
    await user.type(input, " and more words");
    expect(commits.editor).toBeGreaterThan(0);
    expect(outside()).toEqual(NOTHING);
  });
  it("re-renders only the running-work tab and its panel when running work changes", async () => {
    const work = (label: string) =>
      ({ label, visible: true, active: 1, agents: [] }) as unknown as RunningWork;
    const runningWork = atom<ComposerRunningWork>({ items: [], work: work("1 running") });
    let store!: ReturnType<typeof createStore>;
    await renderSettled("Draft", { runningWork }, (value) => {
      store = value;
      value.set(composerOpenTabAtom(session.id), "background");
    });
    expect(screen.getByRole("region", { name: "Running work" })).toBeTruthy();

    act(() => store.set(runningWork, { items: [], work: work("2 running") }));

    expect(
      document.querySelector('[data-slot="composer-tab"][data-value="background"]')?.textContent,
    ).toBe("2 running");
    expect(commits.tab).toBeGreaterThan(0);
    expect({
      view: commits.view,
      editor: commits.editor,
      row: commits.row,
      queue: commits.queue,
    }).toEqual({ view: 0, editor: 0, row: 0, queue: 0 });
  });
});
