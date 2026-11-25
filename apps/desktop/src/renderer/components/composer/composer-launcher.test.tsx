import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { PalotApi, PalotMessage, PalotSession } from "../../../shared";
import { reviewInstructionsAtom } from "../../atoms/review-instructions";
import { defaultDeliveryAtom } from "../../atoms/ui";
import { workbenchStateAtom } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { createWorkbenchState, workbenchScopeKey } from "../../lib/workbench-tabs";
import { loadPromptStash, savePromptStash } from "../../lib/prompt-stash";
import { createRendererQueryClient } from "../../lib/query-client";
import type { PendingRequestView } from "../../lib/view-models";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { palot } from "../../services/palot";
import { Composer } from "./composer-view";
import type { ComposerEditorElement } from "../../lib/composer-editor-element";

const session: PalotSession = {
  id: "session-launcher",
  parentID: null,
  projectID: "project-1",
  title: "Launcher",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

const permission: PendingRequestView = {
  id: "per_1",
  type: "permission",
  title: "Run a command",
  resources: ["bun test"],
  savePatterns: ["bun test *"],
  questions: [],
  fields: [],
};

const stashScope = JSON.stringify(["test-profile", session.projectID]);

function client(overrides: Record<string, unknown> = {}): OpenCodeClient {
  return {
    project: { list: vi.fn().mockResolvedValue([]) },
    model: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      default: vi.fn().mockResolvedValue({ data: null }),
    },
    provider: { list: vi.fn().mockResolvedValue({ data: [] }) },
    agent: {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: "build", name: "Build", mode: "primary", hidden: false, permissions: [] },
          { id: "explore", name: "Explore", mode: "subagent", hidden: false, permissions: [] },
        ],
      }),
    },
    reference: { list: vi.fn().mockResolvedValue({ data: [] }) },
    command: {
      list: vi.fn().mockResolvedValue({
        data: [
          { name: "review", description: "Review current changes" },
          { name: "init", description: "Guided AGENTS.md setup" },
        ],
      }),
    },
    skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
    file: { find: vi.fn().mockResolvedValue({ data: [] }) },
    session: {},
    ...overrides,
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

function renderComposer(props: Partial<ComponentProps<typeof Composer>> = {}) {
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
  store.set(workbenchStateAtom, createWorkbenchState());
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <Composer session={session} messages={[]} isWorking={false} {...props} />
      </Provider>
    </QueryClientProvider>,
  );
  const input = screen.getByRole<ComposerEditorElement>("textbox", { name: "Message Palot" });
  return { store, input };
}

const plusButton = () => screen.getByRole("button", { name: "Add files, commands and more" });
const launcher = () => screen.queryByRole("region", { name: "Add to message" });

function setDraft(input: ComposerEditorElement, text: string, caret = text.length) {
  fireEvent.change(input, { target: { value: text } });
  act(() => {
    input.setSelectionRange(caret, caret);
    fireEvent.select(input);
  });
}

describe("The + launcher", () => {
  it("opens over an empty draft as a search and closes back to an empty field", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.click(plusButton());

    expect(launcher()).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close launcher" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.placeholder).toBe("Type to search…");
    const first = screen.getByRole("option", { name: /^Attach files/ });
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
    expect(input.getAttribute("aria-controls")).toBe(
      screen.getByRole("listbox", { name: "Add to message" }).id,
    );
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText("Draft kept:")).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(launcher()).toBeNull());
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("sets a draft aside with its caret and puts it back exactly on close", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "Fix the login bug", 4);

    await user.click(plusButton());
    expect(input.value).toBe("");
    expect(screen.getByText("Draft kept:")).toBeTruthy();
    expect(screen.getByText("Fix the login bug")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close launcher" }));
    expect(input.value).toBe("Fix the login bug");
    expect(input.selectionStart).toBe(4);
    // A restored draft is not a typed trigger.
    await waitFor(() => expect(launcher()).toBeNull());
  });

  it("inserts a pick at the set-aside draft's caret and places the caret at once", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "Hello world", 5);

    await user.click(plusButton());
    await user.click(await screen.findByRole("option", { name: /^Mention a file/ }));
    await screen.findByRole("option", { name: /@explore/ });

    // The caret is in place in the same task as the key, so typing right after lands after it.
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.selectionStart).toBe("Hello @explore".length);
    });
    expect(input.value).toBe("Hello @explore world");
    expect(screen.getByRole("img", { name: /explore/ })).toBeTruthy();
    await waitFor(() => expect(launcher()).toBeNull());
  });

  it("toggles with Mod+/ in the composer, leaving Mod+K to the command palette", async () => {
    const { input } = renderComposer();
    expect(fireEvent.keyDown(input, { key: "k", ctrlKey: true })).toBe(true);
    expect(launcher()).toBeNull();

    expect(fireEvent.keyDown(input, { key: "/", ctrlKey: true })).toBe(false);
    expect(launcher()).toBeTruthy();
    fireEvent.keyDown(input, { key: "/", ctrlKey: true });
    await waitFor(() => expect(launcher()).toBeNull());
  });

  it("drills into a category and back by keyboard, landing on the category it left", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.click(plusButton());
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    const commands = screen.getByRole("option", { name: /^Commands/ });
    expect(commands.getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("option", { name: /\/review/ })).toBeTruthy();
    expect(within(launcher()!).getByText("Esc to go back")).toBeTruthy();

    // A query filters the category; Backspace edits it before it goes back.
    await user.keyboard("rev{Backspace}{Backspace}{Backspace}");
    expect(input.value).toBe("");
    await user.keyboard("{Backspace}");
    expect(screen.getByRole("option", { name: /^Commands/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(launcher()).toBeNull());
  });

  it("searches every category from the root", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.click(plusButton());
    await user.keyboard("rev");
    expect(await screen.findByRole("option", { name: /\/review/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Attach files/ })).toBeNull();
  });

  it("puts a command OpenCode runs at the draft's start, with the draft as its arguments", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "auth module");
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Commands/ }));
    await user.click(await screen.findByRole("option", { name: /\/init/ }));
    expect(input.value).toBe("/init auth module");
    expect(input.selectionStart).toBe("/init ".length);
  });

  it("runs a command Palot handles at once and keeps the draft", async () => {
    const user = userEvent.setup();
    const compact = vi.spyOn(palot, "compactSession").mockResolvedValue(undefined);
    const { input } = renderComposer();
    setDraft(input, "Keep me");
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Commands/ }));
    await user.click(await screen.findByRole("option", { name: /\/compact/ }));
    await waitFor(() => expect(compact).toHaveBeenCalledWith(session.id));
    expect(input.value).toBe("Keep me");
  });

  it("attaches files with the draft back in place", async () => {
    const user = userEvent.setup();
    const pick = vi.spyOn(palot, "pickFiles").mockResolvedValue({ files: [], errors: [] });
    const { input } = renderComposer();
    setDraft(input, "With files");
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Attach files/ }));
    expect(pick).toHaveBeenCalledOnce();
    expect(input.value).toBe("With files");
  });

  it("restores a stashed prompt and stashes the set-aside draft in its place", async () => {
    const user = userEvent.setup();
    savePromptStash(stashScope, [
      {
        id: "s1",
        createdAt: Date.now(),
        draft: { text: "Stashed idea", mentions: [], command: null },
        files: [],
      },
    ]);
    const { input } = renderComposer();
    setDraft(input, "Current work");
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Stashed prompts/ }));
    await user.click(await screen.findByRole("option", { name: /^Stashed idea/ }));
    expect(input.value).toBe("Stashed idea");
    expect(loadPromptStash(stashScope).map((entry) => entry.draft.text)).toEqual(["Current work"]);
  });

  describe("deleting a stashed prompt", () => {
    const entry = (id: string, text: string, age: number) => ({
      id,
      createdAt: Date.now() - age,
      draft: { text, mentions: [], command: null },
      files: [],
    });
    const stored = () => loadPromptStash(stashScope).map((item) => item.draft.text);
    const selected = () =>
      screen
        .getAllByRole("option")
        .filter((option) => option.getAttribute("aria-selected") === "true")
        .map((option) => option.querySelector('[data-slot="launcher-item-title"]')?.textContent);

    async function openStash(user: ReturnType<typeof userEvent.setup>) {
      await user.click(plusButton());
      await user.click(screen.getByRole("option", { name: /^Stashed prompts/ }));
      await screen.findByRole("option", { name: /^First idea/ });
    }

    beforeEach(() => {
      savePromptStash(stashScope, [
        entry("s1", "First idea", 1_000),
        entry("s2", "Second idea", 2_000),
        entry("s3", "Third idea", 3_000),
      ]);
    });

    it("deletes from the row's action, staying in the list", async () => {
      const user = userEvent.setup();
      const { input } = renderComposer();
      setDraft(input, "Keep me");
      await openStash(user);
      const second = screen.getByRole("option", { name: /^Second idea/ });
      await user.click(within(second).getByRole("button", { name: "Delete stashed prompt" }));

      expect(stored()).toEqual(["First idea", "Third idea"]);
      await waitFor(() =>
        expect(screen.queryByRole("option", { name: /^Second idea/ })).toBeNull(),
      );
      expect(screen.getByRole("listbox", { name: "Stashed prompts" })).toBeTruthy();
      expect(selected()).toEqual(["Third idea"]);
      // Nothing was restored: the set-aside draft comes back on close.
      await user.keyboard("{Escape}{Escape}");
      expect(input.value).toBe("Keep me");
    });

    it("deletes the highlighted row with Mod+Backspace, moving to the next", async () => {
      const user = userEvent.setup();
      const { input } = renderComposer();
      await openStash(user);
      expect(within(launcher()!).getByText(/to delete · Esc to go back/)).toBeTruthy();
      await user.keyboard("{Control>}{Backspace}{/Control}");
      expect(stored()).toEqual(["Second idea", "Third idea"]);
      await waitFor(() => expect(selected()).toEqual(["Second idea"]));
      // Plain Backspace still edits the query.
      await user.keyboard("thi{Backspace}");
      expect(input.value).toBe("th");
      expect(stored()).toHaveLength(2);
    });

    it("goes back to the launcher's root when the last one goes, and restore still works", async () => {
      const user = userEvent.setup();
      savePromptStash(stashScope, [entry("s1", "First idea", 1_000)]);
      const { input } = renderComposer();
      await openStash(user);
      await user.keyboard("{Control>}{Backspace}{/Control}");
      expect(stored()).toEqual([]);
      await waitFor(() =>
        expect(
          screen.getByRole("option", { name: /^Stashed prompts/ }).getAttribute("aria-selected"),
        ).toBe("true"),
      );
      expect(launcher()).toBeTruthy();
      expect(input.value).toBe("");
    });
  });

  it("enters shell mode from its row, keeping the draft", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "ls -la");
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Run a shell command/ }));
    const shell = screen.getByRole<ComposerEditorElement>("textbox", { name: "Shell command" });
    expect(shell.value).toBe("ls -la");
  });

  it("closes when shell mode starts from its shortcut, giving the draft back", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "git status");
    await user.click(plusButton());
    fireEvent.keyDown(window, { key: "X", code: "KeyX", ctrlKey: true, shiftKey: true });
    const shell = await screen.findByRole<ComposerEditorElement>("textbox", {
      name: "Shell command",
    });
    expect(shell.value).toBe("git status");
    await waitFor(() => expect(launcher()).toBeNull());
  });

  it("suggests reviewing the last turn's changes and opens them", async () => {
    const user = userEvent.setup();
    const message = (id: string, type: "user" | "assistant", data: unknown): PalotMessage => ({
      id,
      type,
      createdAt: 1,
      completedAt: 1,
      text: type === "user" ? "Fix it" : null,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: data as PalotMessage["data"],
    });
    const messages = [
      message("msg-user", "user", null),
      message("msg-reply", "assistant", { snapshot: { files: ["a.ts", "b.ts"] } }),
    ];
    const { store } = renderComposer({ messages });
    await user.click(plusButton());
    await user.click(
      screen.getByRole("option", { name: /^Review changes 2 files changed in the last turn/ }),
    );
    const tabs =
      store.get(workbenchStateAtom).scopes[
        workbenchScopeKey({ profileID: "test-profile", sessionID: session.id })
      ]?.right.tabs;
    expect(tabs).toMatchObject([{ kind: "turn-diff", resource: { userMessageID: "msg-user" } }]);
  });

  it("opens over a request panel, which comes back when it closes", async () => {
    const user = userEvent.setup();
    renderComposer({ requests: [permission], isWorking: true });
    expect(screen.getByRole("region", { name: "Pending request" })).toBeTruthy();

    await user.click(plusButton());
    expect(launcher()).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Pending request" })).toBeNull();

    // Escape closes the launcher; it never answers the request.
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("region", { name: "Pending request" })).toBeTruthy();
  });

  it("disables sending while it holds the field", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "Ready to send");
    await user.click(plusButton());
    await user.keyboard("query");
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      true,
    );
    // Mod+Enter does not send the search either.
    const send = vi.spyOn(palot, "sendComposerPrompt");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("The /review picker", () => {
  function reviewClient() {
    return client({
      vcs: { base: vi.fn().mockResolvedValue({ data: { ref: "origin/main" } }) },
    });
  }

  it("opens from the Commands list and runs a review of uncommitted changes, keeping the draft", async () => {
    setOpenCodeClientForTest(reviewClient());
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    const { input } = renderComposer();
    setDraft(input, "Keep me");
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Commands/ }));
    await user.click(await screen.findByRole("option", { name: /\/review/ }));

    const list = await screen.findByRole("listbox", { name: "Review" });
    expect(
      await within(list).findByRole("option", { name: /Everything since origin\/main/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Save instructions you reuse/)).toBeTruthy();
    await user.click(within(list).getByRole("option", { name: /Uncommitted changes/ }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: session.id, command: "review" }),
      ),
    );
    expect(run.mock.calls[0]![0]).not.toHaveProperty("arguments");
    expect(input.value).toBe("Keep me");
  });

  it("opens from a typed /review and runs saved instructions or the base branch", async () => {
    setOpenCodeClientForTest(reviewClient());
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    const { input, store } = renderComposer();
    store.set(reviewInstructionsAtom, [
      { id: "sec", name: "Security pass", instructions: "Look for injection.\nAnd secrets." },
    ]);
    const openPicker = async () => {
      await user.type(input, "/review");
      await screen.findByRole("option", { name: /\/review/ });
      await user.keyboard("{Enter}");
      return screen.findByRole("listbox", { name: "Review" });
    };

    let list = await openPicker();
    // The typed trigger leaves the field, which now holds the picker's search.
    expect(input.value).toBe("");
    await user.click(
      within(list).getByRole("option", { name: /Security pass.*Look for injection/ }),
    );
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "review",
          arguments: "Look for injection.\nAnd secrets.",
        }),
      ),
    );

    list = await openPicker();
    await user.click(await within(list).findByRole("option", { name: /Against the base branch/ }));
    await waitFor(() =>
      expect(run).toHaveBeenLastCalledWith(
        expect.objectContaining({ command: "review", arguments: "origin/main" }),
      ),
    );
  });

  it("puts /review in the draft for a commit hash", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.click(plusButton());
    await user.click(screen.getByRole("option", { name: /^Commands/ }));
    await user.click(await screen.findByRole("option", { name: /\/review/ }));
    await user.click(await screen.findByRole("option", { name: /A commit/ }));
    expect(input.value).toBe("/review ");
  });
});

describe("Approvals in the launcher", () => {
  const fullAccess = [{ action: "*", resource: "*", effect: "allow" as const }];

  async function openApprovals(user: ReturnType<typeof userEvent.setup>) {
    await user.click(plusButton());
    const entry = screen.getByRole("option", { name: /^Approvals/ });
    expect(entry.textContent).toContain("Defaults");
    await user.click(entry);
    return screen.findByRole("listbox", { name: "Approvals" });
  }

  it("arms Full access only when it is picked, after the confirmation", async () => {
    const user = userEvent.setup();
    const set = vi.spyOn(palot, "setSessionPermissions").mockResolvedValue(undefined);
    renderComposer();
    const list = await openApprovals(user);
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => [option.textContent, option.getAttribute("aria-current")]),
    ).toEqual([
      [expect.stringMatching(/^Defaults.*, current$/), "true"],
      [expect.stringMatching(/^Full access/), null],
    ]);

    // Moving the highlight onto Full access arms nothing.
    await user.keyboard("{ArrowDown}");
    expect(
      within(list)
        .getByRole("option", { name: /^Full access/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(set).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog", { name: "Enable Full access?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(set).not.toHaveBeenCalled();

    await openApprovals(user);
    await user.click(screen.getByRole("option", { name: /^Full access/ }));
    await user.click(await screen.findByRole("button", { name: "Enable Full access" }));
    await waitFor(() =>
      expect(set).toHaveBeenCalledExactlyOnceWith(
        { sessionID: session.id, permissions: fullAccess },
        "test",
      ),
    );
  });

  it("applies Defaults at once and says a preset replaces custom rules", async () => {
    const user = userEvent.setup();
    const set = vi.spyOn(palot, "setSessionPermissions").mockResolvedValue(undefined);
    renderComposer({
      session: { ...session, permissions: [{ action: "edit", resource: "*", effect: "deny" }] },
    });
    await user.click(screen.getByRole("button", { name: "Approvals: Custom" }));
    const list = await screen.findByRole("listbox", { name: "Approvals" });
    expect(
      screen.getByText("Custom session rules are active. Choosing a preset replaces them."),
    ).toBeTruthy();
    expect(within(list).queryByRole("option", { current: true })).toBeNull();

    await user.click(within(list).getByRole("option", { name: /^Defaults/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(set.mock.calls[0]?.[0].sessionID).toBe(session.id);
    await waitFor(() => expect(launcher()).toBeNull());
  });

  it("keeps a failed elevation in the dialog without claiming success", async () => {
    const user = userEvent.setup();
    vi.spyOn(palot, "setSessionPermissions").mockRejectedValue(new Error("Server unavailable"));
    renderComposer();
    await openApprovals(user);
    await user.click(screen.getByRole("option", { name: /^Full access/ }));
    await user.click(await screen.findByRole("button", { name: "Enable Full access" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Enable Full access?" });
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Server unavailable");
    expect(screen.queryByRole("button", { name: /^Approvals:/ })).toBeNull();
  });
});

describe("Typed triggers", () => {
  it.each([
    ["/", "Commands", /\/review/],
    ["@", "Mention a file, task or agent", /@explore/],
  ])("opens %s in its category without setting the draft aside", async (char, title, row) => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.type(input, char === "/" ? "/" : "Ask @");
    expect(await screen.findByRole("option", { name: row })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: title })).toBeTruthy();
    expect(input.value).toBe(char === "/" ? "/" : "Ask @");
    expect(screen.queryByText("Draft kept:")).toBeNull();
    expect(screen.queryByText("Esc to go back")).toBeNull();
  });

  it("opens $ in Skills", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.type(input, "Use $");
    expect(
      await within(await screen.findByRole("region", { name: "Add to message" })).findByText(
        "Skills",
      ),
    ).toBeTruthy();
  });

  it("stays closed after Escape until the trigger goes", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.type(input, "Ask @");
    await screen.findByRole("option", { name: /@explore/ });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(launcher()).toBeNull());
    await user.type(input, "ex", { skipClick: true });
    expect(launcher()).toBeNull();
    await user.type(input, " @", { skipClick: true });
    expect(await screen.findByRole("option", { name: /@explore/ })).toBeTruthy();
  });

  it("enters shell mode with ! on an empty draft, never from the launcher's search", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.click(plusButton());
    await user.keyboard("!");
    expect(input.value).toBe("!");
    await user.keyboard("{Escape}");
    expect(input.value).toBe("");
    await user.keyboard("!");
    expect(screen.getByRole("textbox", { name: "Shell command" })).toBeTruthy();
  });
});

describe("Mod+Enter", () => {
  it("queues when steering is the default", async () => {
    const prompt = vi.fn().mockResolvedValue({
      id: "message-queued",
      sessionID: session.id,
      type: "user" as const,
      delivery: "queue" as const,
      time: { created: 10_000 },
    });
    setOpenCodeClientForTest(client({ session: { prompt } }));
    const { store, input } = renderComposer({ isWorking: true });
    act(() => store.set(defaultDeliveryAtom, "steer"));
    fireEvent.change(input, { target: { value: "After this turn" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ delivery: "queue", text: "After this turn" }),
        expect.anything(),
      ),
    );
  });
});
