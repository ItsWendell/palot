import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { PalotApi, PalotSession } from "../../../shared";
import { attentionTargetAtom } from "../../atoms/attention";
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
import { ENTER_GUARD_MS } from "../composer-dock/request-guard";
import { REQUEST_SETTLE_MS, SubagentRequests, type ComposerRequest } from "./composer-requests";
import { Composer } from "./composer-view";
import type { ComposerEditorElement } from "../../lib/composer-editor-element";

const session: PalotSession = {
  id: "ses_parent",
  parentID: null,
  projectID: "project-1",
  title: "Requests",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

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

const base = {
  resources: [],
  savePatterns: [],
  questions: [],
  fields: [],
} satisfies Partial<PendingRequestView>;

function permission(id: string, overrides: Partial<ComposerRequest> = {}): ComposerRequest {
  return {
    ...base,
    id,
    type: "permission",
    title: "Run a command",
    resources: ["bun test"],
    savePatterns: ["bun test *"],
    createdAt: 1,
    ...overrides,
  };
}

function question(id: string, overrides: Partial<ComposerRequest> = {}): ComposerRequest {
  return {
    ...base,
    id,
    type: "question",
    title: "Approach",
    createdAt: 1,
    questions: [
      {
        header: "Approach",
        question: "Which approach should I use?",
        multiple: false,
        custom: true,
        options: [
          { label: "Minimal", description: "Only change the broken path" },
          { label: "Redesign" },
        ],
      },
    ],
    ...overrides,
  };
}

const replies = () => ({
  permission: vi.spyOn(palot, "replyPermission").mockResolvedValue(undefined),
  form: vi.spyOn(palot, "replyForm").mockResolvedValue(undefined),
  cancel: vi.spyOn(palot, "cancelForm").mockResolvedValue(undefined),
});

function setup(
  props: Partial<React.ComponentProps<typeof Composer>> = {},
  { draft = "" }: { draft?: string } = {},
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
  if (draft) {
    store.set(composerDraftAtomFamily(composerScope("test-profile", `session:${session.id}`)), {
      text: draft,
      mentions: [],
      command: null,
    });
  }
  const queryClient = createRendererQueryClient();
  const wrap = (next: Partial<React.ComponentProps<typeof Composer>>): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <Composer session={session} messages={[]} isWorking={false} {...next} />
      </Provider>
    </QueryClientProvider>
  );
  const view = render(wrap(props));
  return { ...view, store, update: (next: typeof props) => view.rerender(wrap(next)) };
}

const field = () => screen.getByRole<ComposerEditorElement>("textbox", { name: "Message Palot" });
const panel = () => screen.getByRole("region", { name: "Pending request" });
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_SETTLE_MS + 50));
  });

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("the request panel in the composer", () => {
  it("lets an empty field's Enter allow once after the request settles, then returns focus", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({ requests: [permission("per_1")] });
    expect(within(panel()).getByText("bun test")).toBeTruthy();
    // The field stays usable beside the request.
    expect(field().hasAttribute("disabled")).toBe(false);
    const primary = screen.getByRole("button", { name: "Allow once" });
    expect(primary.hasAttribute("disabled")).toBe(true);
    await settle();
    expect(primary.hasAttribute("disabled")).toBe(false);
    act(() => field().focus());
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith({
        sessionID: "ses_parent",
        requestID: "per_1",
        reply: "once",
      }),
    );
    expect(reply.permission).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("turns the empty field into feedback: Enter denies with the typed text and clears it", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({ requests: [permission("per_1")] });
    expect(field().getAttribute("data-placeholder")).toBe("Tell the agent what to do differently…");
    await settle();
    await user.click(field());
    await user.type(field(), "Use the watch mode instead");
    expect(
      screen.getByRole("button", { name: "Deny and send your text to the agent" }),
    ).toBeTruthy();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith({
        sessionID: "ses_parent",
        requestID: "per_1",
        reply: "reject",
        message: "Use the watch mode instead",
      }),
    );
    await waitFor(() => expect(field().value).toBe(""));
  });

  it("never turns a draft that was already there into feedback", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({ requests: [permission("per_1")] }, { draft: "My own message" });
    await settle();
    // The field keeps its own placeholder and the primary stays the message's.
    expect(field().getAttribute("data-placeholder")).toBe("Do anything");
    expect(screen.queryByRole("button", { name: /Deny and send/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
    // The panel brings its own feedback input and main action.
    const own = within(panel()).getByRole("textbox", {
      name: "Tell the agent what to do differently",
    });
    await user.type(own, "Not now");
    await user.click(within(panel()).getByRole("button", { name: /^Deny/ }));
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith({
        sessionID: "ses_parent",
        requestID: "per_1",
        reply: "reject",
        message: "Not now",
      }),
    );
    expect(field().value).toBe("My own message");
  });

  it("waits for a pause before Enter answers a request that arrived mid-typing", async () => {
    const reply = replies();
    const user = userEvent.setup();
    const { update } = setup({ requests: [] });
    await user.click(field());
    await user.type(field(), "a");
    await user.keyboard("{Backspace}");
    // The request arrives right after a keystroke; the field is empty, so it is the feedback.
    update({ requests: [permission("per_1")] });
    await settle();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(within(panel()).getByText(/still sends your message/)).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(reply.permission).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ENTER_GUARD_MS + 100));
    });
    expect(screen.getByRole("button", { name: "Allow once" })).toBeTruthy();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith(expect.objectContaining({ reply: "once" })),
    );
  });

  it("never approves or denies on Escape, in the field or in the panel", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({ requests: [permission("per_1")] });
    await settle();
    await user.click(field());
    await user.keyboard("{Escape}");
    fireEvent.keyDown(panel(), { key: "Escape" });
    await user.click(within(panel()).getByRole("button", { name: /Always allow/ }).parentElement!);
    fireEvent.keyDown(panel(), { key: "Escape" });
    expect(reply.permission).not.toHaveBeenCalled();
    expect(panel()).toBeTruthy();
  });

  it("takes no click on a request that has only just come into view", async () => {
    const reply = replies();
    const user = userEvent.setup();
    const { update } = setup({ requests: [permission("per_1")] });
    await settle();
    // The first is answered and the second takes its place under the pointer.
    update({ requests: [permission("per_2", { resources: ["rm -rf build"] })] });
    const shown = panel().querySelector<HTMLElement>('[data-palot-request-id="per_2"]')!;
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    await user.click(within(shown).getByRole("button", { name: /Always allow/ }));
    expect(reply.permission).not.toHaveBeenCalled();
  });

  it("pages through several requests in arrival order and answers the one shown", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({
      requests: [
        permission("per_2", { createdAt: 20, resources: ["second"] }),
        permission("per_1", { createdAt: 10, resources: ["first"] }),
        question("que_1", { createdAt: 30 }),
      ],
    });
    expect(within(panel()).getByText("1 of 3")).toBeTruthy();
    expect(within(panel()).getByText("first")).toBeTruthy();
    await user.click(within(panel()).getByRole("button", { name: "Next request" }));
    expect(within(panel()).getByText("2 of 3")).toBeTruthy();
    expect(within(panel()).getByText("second")).toBeTruthy();
    await user.click(field());
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(within(panel()).getByText("3 of 3")).toBeTruthy();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(within(panel()).getByText("first")).toBeTruthy();
    // Paging is a keystroke too: the request shown waits for the pause before it answers.
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ENTER_GUARD_MS + 100));
    });
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith(
        expect.objectContaining({ requestID: "per_1", reply: "once" }),
      ),
    );
  });

  it("keeps the shown request when a new one arrives", async () => {
    replies();
    const { update } = setup({ requests: [permission("per_1", { resources: ["first"] })] });
    update({
      requests: [
        permission("per_1", { resources: ["first"] }),
        permission("per_2", { createdAt: 2, resources: ["second"] }),
      ],
    });
    expect(within(panel()).getByText("first")).toBeTruthy();
    expect(within(panel()).getByText("1 of 2")).toBeTruthy();
  });

  it("routes a subagent's request to the session that owns it and names the subagent", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({
      requests: [permission("same-id", { sessionID: "ses_child", sessionTitle: "Run checks" })],
      agentOf: (id) => (id === "ses_child" ? "explore" : null),
    });
    expect(within(panel()).getByText("explore")).toBeTruthy();
    await settle();
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith({
        sessionID: "ses_child",
        requestID: "same-id",
        reply: "once",
      }),
    );
  });

  it("names the nested subagent that asked, not the subagent that started it", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({
      requests: [permission("nested-id", { sessionID: "ses_grand", sessionTitle: "Read tests" })],
      agentOf: (id) => (id === "ses_child" ? "explore" : id === "ses_grand" ? "review" : null),
    });
    expect(within(panel()).getByText("review")).toBeTruthy();
    expect(within(panel()).queryByText("explore")).toBeNull();
    await settle();
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith({
        sessionID: "ses_grand",
        requestID: "nested-id",
        reply: "once",
      }),
    );
  });

  it("saves the rule with Always allow from the field's chord", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({ requests: [permission("per_1")] }, { draft: "Keep typing" });
    await settle();
    await user.click(field());
    await user.keyboard("{Control>}{Shift>}{Enter}{/Shift}{/Control}");
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith(expect.objectContaining({ reply: "always" })),
    );
    expect(field().value).toBe("Keep typing");
  });

  it("takes a typed answer from the empty field, and picks with digits", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({ requests: [question("que_1")] });
    expect(field().getAttribute("data-placeholder")).toBe("Type your own answer…");
    await settle();
    await user.click(field());
    await user.keyboard("2");
    expect(within(panel()).getByRole<HTMLInputElement>("radio", { name: /Redesign/ }).checked).toBe(
      true,
    );
    expect(field().value).toBe("");
    await user.type(field(), "Something smaller");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(reply.form).toHaveBeenCalledWith({
        sessionID: "ses_parent",
        formID: "que_1",
        answer: { q0: "Something smaller" },
      }),
    );
    await waitFor(() => expect(field().value).toBe(""));
  });

  it("submits picked and own answers over several steps when a draft keeps the field", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup(
      {
        requests: [
          question("que_1", {
            questions: [
              {
                header: "Approach",
                question: "Which approach should I use?",
                multiple: false,
                custom: true,
                options: [{ label: "Minimal", description: "Only change the broken path" }],
              },
              {
                header: "Checks",
                question: "Which checks should I run?",
                multiple: true,
                custom: true,
                options: [{ label: "Tests" }, { label: "Typecheck" }],
              },
            ],
          }),
        ],
      },
      { draft: "Unrelated draft" },
    );
    await settle();
    await user.click(within(panel()).getByText("Minimal"));
    await user.click(within(panel()).getByRole("button", { name: "Next" }));
    expect(within(panel()).getByText("Select multiple")).toBeTruthy();
    await user.click(within(panel()).getByText("Tests"));
    await user.type(within(panel()).getByRole("textbox", { name: "Your own answer" }), "Build");
    await user.click(within(panel()).getByRole("button", { name: /Back/ }));
    expect(within(panel()).getByRole<HTMLInputElement>("radio", { name: /Minimal/ }).checked).toBe(
      true,
    );
    await user.click(within(panel()).getByRole("button", { name: "Next" }));
    await user.click(within(panel()).getByRole("button", { name: "Submit answer" }));
    await waitFor(() =>
      expect(reply.form).toHaveBeenCalledWith({
        sessionID: "ses_parent",
        formID: "que_1",
        answer: { q0: "Minimal", q1: ["Tests", "Build"] },
      }),
    );
    expect(field().value).toBe("Unrelated draft");
  });

  it("dismisses a question once while the cancellation is pending", async () => {
    let finish!: () => void;
    const cancel = vi.spyOn(palot, "cancelForm").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    setup({ requests: [question("que_1")] });
    await settle();
    const dismiss = within(panel()).getByRole<HTMLButtonElement>("button", { name: "Dismiss" });
    await user.click(dismiss);
    await user.click(dismiss);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ sessionID: "ses_parent", formID: "que_1" });
    expect(dismiss.disabled).toBe(true);
    finish();
  });

  it("submits an MCP form's visible fields through its location and blocks invalid ones", async () => {
    const reply = replies();
    const user = userEvent.setup();
    setup({
      requests: [
        {
          ...base,
          id: "form_1",
          type: "form",
          title: "Create an issue",
          sessionID: "global",
          locationDirectory: "/workspace",
          fields: [
            {
              key: "title",
              type: "string",
              title: "Title",
              required: true,
              options: [],
              custom: false,
              when: [],
            },
            {
              key: "secret",
              type: "string",
              title: "Hidden",
              hidden: true,
              required: false,
              defaultValue: "kept",
              options: [],
              custom: false,
              when: [],
            },
          ],
        },
      ],
    });
    await settle();
    const submit = within(panel()).getByRole("button", { name: "Submit" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.type(within(panel()).getByRole("textbox"), "Broken build");
    await user.click(submit);
    await waitFor(() =>
      expect(reply.form).toHaveBeenCalledWith({
        sessionID: "global",
        formID: "form_1",
        answer: { title: "Broken build", secret: "kept" },
        locationDirectory: "/workspace",
      }),
    );
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("links the URLs an MCP form's message, field and option descriptions name", async () => {
    replies();
    const open = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    const user = userEvent.setup();
    setup({
      requests: [
        {
          ...base,
          id: "form_links",
          type: "form",
          title: "Approve the release",
          detail: "Read https://example.com/releases/v2 first.",
          sessionID: "global",
          fields: [
            {
              key: "notes",
              type: "string",
              title: "Notes",
              description: "See https://example.com/docs/notes",
              required: false,
              options: [],
              custom: false,
              when: [],
            },
            {
              key: "targets",
              type: "multiselect",
              title: "Targets",
              required: false,
              options: [{ label: "npm", description: "Approve at https://example.com/npm" }],
              custom: false,
              when: [],
            },
          ],
        },
      ],
    });
    await settle();
    for (const url of [
      "https://example.com/releases/v2",
      "https://example.com/docs/notes",
      "https://example.com/npm",
    ]) {
      expect(within(panel()).getByRole("link", { name: url }).getAttribute("href")).toBe(url);
    }
    await user.click(within(panel()).getByRole("link", { name: "https://example.com/npm" }));
    expect(open).toHaveBeenCalledWith("https://example.com/npm");
  });

  it("holds the message back for a question but not for the task's own permission", async () => {
    replies();
    const { update } = setup({ requests: [permission("per_1")] }, { draft: "Ship it" });
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      false,
    );
    update({ requests: [question("que_1")] });
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("shows the request that the transcript's waiting line asks for, focusing the panel", async () => {
    replies();
    const { store } = setup({
      requests: [
        permission("per_1", { resources: ["first"] }),
        permission("per_2", { createdAt: 2, resources: ["second"] }),
      ],
    });
    act(() =>
      store.set(attentionTargetAtom, {
        sessionID: "ses_parent",
        requestID: "per_2",
        type: "permission",
      }),
    );
    await waitFor(() => expect(within(panel()).getByText("second")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(panel().querySelector("section")));
    expect(store.get(attentionTargetAtom)).toBeNull();
  });

  it("sends a guest message on, or dismisses it, from the panel", async () => {
    const approve = vi.fn();
    const dismiss = vi.fn();
    const user = userEvent.setup();
    setup({
      guests: {
        messages: [{ id: "g1", name: "Sam", text: "Can you add a test?", sending: false }],
        busy: false,
        connected: true,
        approve,
        dismiss,
      },
    });
    const region = screen.getByRole("region", { name: "Guest message from Sam" });
    expect(panel().contains(region)).toBe(true);
    expect(within(region).getByText("Unverified")).toBeTruthy();
    expect(within(region).getByText("Can you add a test?")).toBeTruthy();
    await settle();
    await user.click(within(region).getByRole("button", { name: "Send to the agent" }));
    expect(approve).toHaveBeenCalledWith("g1");
  });
});

describe("a subagent task's requests", () => {
  it("shows them in a card with the panel's own feedback and routes the reply to the owner", async () => {
    const reply = replies();
    const user = userEvent.setup();
    render(
      <Provider store={createStore()}>
        <SubagentRequests
          sessionID="ses_child"
          requests={[permission("per_grandchild", { sessionID: "ses_grandchild" })]}
        />
      </Provider>,
    );
    const region = screen.getByRole("region", { name: "Run a command" });
    expect(
      within(region).getByRole("textbox", { name: "Tell the agent what to do differently" }),
    ).toBeTruthy();
    await settle();
    await user.click(within(region).getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(reply.permission).toHaveBeenCalledWith({
        sessionID: "ses_grandchild",
        requestID: "per_grandchild",
        reply: "once",
      }),
    );
  });

  it("shows nothing without requests", () => {
    const { container } = render(
      <Provider store={createStore()}>
        <SubagentRequests sessionID="ses_child" requests={[]} />
      </Provider>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("forms in the request panel", () => {
  function renderForm(request: ComposerRequest) {
    return render(
      <Provider store={createStore()}>
        <SubagentRequests sessionID="ses_1" requests={[request]} />
      </Provider>,
    );
  }

  const deployment = (fields: PendingRequestView["fields"]): ComposerRequest => ({
    ...base,
    id: "form_1",
    type: "form",
    title: "Configure deployment",
    fields,
  });

  it("submits visible fields and hidden defaults without exposing hidden prompts", async () => {
    const reply = replies();
    const user = userEvent.setup();
    renderForm(
      deployment([
        {
          key: "token",
          type: "string",
          title: "Internal token",
          hidden: true,
          defaultValue: "server-default",
          required: true,
          options: [],
          custom: false,
          when: [],
        },
        {
          key: "regions",
          type: "multiselect",
          title: "Regions",
          required: true,
          options: [{ label: "Europe", value: "eu" }],
          custom: true,
          when: [],
        },
        {
          key: "notes",
          type: "string",
          title: "Notes",
          required: true,
          options: [],
          custom: false,
          when: [{ key: "regions", op: "eq", value: "eu" }],
        },
        {
          key: "notify",
          type: "boolean",
          title: "Notify me",
          required: true,
          options: [],
          custom: false,
          when: [],
        },
      ]),
    );
    await settle();
    const form = within(screen.getByRole("region", { name: "Configure deployment" }));
    expect(form.queryByText("Internal token")).toBeNull();
    expect(form.getByRole<HTMLButtonElement>("button", { name: "Submit" }).disabled).toBe(true);
    await user.click(form.getByText("Europe"));
    const notes = form
      .getAllByRole<HTMLInputElement>("textbox")
      .find((input) => !input.hasAttribute("aria-label"));
    await user.type(notes!, "Primary region");
    expect(form.getByLabelText("Regions custom value")).toBeTruthy();
    expect(form.getByRole<HTMLInputElement>("checkbox", { name: "Europe" }).checked).toBe(true);
    await waitFor(() =>
      expect(form.getByRole<HTMLButtonElement>("button", { name: "Submit" }).disabled).toBe(false),
    );
    await user.click(form.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(reply.form).toHaveBeenCalledWith({
        sessionID: "ses_1",
        formID: "form_1",
        answer: {
          regions: ["eu"],
          notes: "Primary region",
          notify: false,
          token: "server-default",
        },
      }),
    );
  });

  it("cancels a form once while the cancellation is pending", async () => {
    let finish!: () => void;
    const cancel = vi.spyOn(palot, "cancelForm").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderForm(deployment([]));
    await settle();
    const form = within(screen.getByRole("region", { name: "Configure deployment" }));
    const button = form.getByRole<HTMLButtonElement>("button", { name: "Cancel" });
    await user.click(button);
    await user.click(button);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "form_1" });
    expect(button.disabled).toBe(true);
    finish();
  });

  it("shows neq fields before the controlling answer is set", () => {
    renderForm(
      deployment([
        {
          key: "details",
          type: "string",
          title: "Details",
          required: true,
          options: [],
          custom: false,
          when: [{ key: "mode", op: "neq", value: "automatic" }],
        },
      ]),
    );
    expect(
      within(screen.getByRole("region", { name: "Configure deployment" })).getByText("Details"),
    ).toBeTruthy();
  });

  it("routes a child's question and its dismissal to the child", async () => {
    const reply = replies();
    const user = userEvent.setup();
    render(
      <Provider store={createStore()}>
        <SubagentRequests
          sessionID="parent"
          requests={[
            question("same-id", { sessionID: "child-a", sessionTitle: "Mac capture" }),
            question("same-id", { sessionID: "child-b", sessionTitle: "Mac verify", createdAt: 2 }),
          ]}
        />
      </Provider>,
    );
    await settle();
    const region = () => screen.getByRole("region", { name: "Pending request" });
    await user.click(within(region()).getByText("Minimal"));
    await user.click(within(region()).getByRole("button", { name: "Submit answer" }));
    await waitFor(() =>
      expect(reply.form).toHaveBeenCalledWith({
        sessionID: "child-a",
        formID: "same-id",
        answer: { q0: "Minimal" },
      }),
    );
    await user.click(within(region()).getByRole("button", { name: "Next request" }));
    await settle();
    await user.click(within(region()).getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(reply.cancel).toHaveBeenCalledWith({ sessionID: "child-b", formID: "same-id" }),
    );
  });
});
