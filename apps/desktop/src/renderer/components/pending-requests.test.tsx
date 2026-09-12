import { Provider, createStore } from "jotai";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { PalotApi } from "../../shared";
import type { OpenCodeClient } from "@opencode/client";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { PendingInputTaskbarItem } from "./composer";
import { PendingRequests } from "./thread";

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
  it("routes child answers, dismissal and permissions to their owners from the parent", async () => {
    const user = userEvent.setup();
    const replyForm = vi.fn().mockResolvedValue(undefined);
    const cancelForm = vi.fn().mockResolvedValue(undefined);
    const replyPermission = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(
      client({
        form: { reply: replyForm, cancel: cancelForm },
        permission: { reply: replyPermission },
      }),
    );
    const base = {
      id: "same-id",
      title: "Question",
      resources: [],
      savePatterns: [],
      fields: [],
      questions: [
        {
          header: "Ready",
          question: "Ready to capture?",
          multiple: false,
          custom: false,
          options: [{ label: "Ready" }],
        },
      ],
    };
    const { container } = render(
      <PendingRequests
        sessionID="parent"
        inline
        requests={[
          { ...base, type: "question", sessionID: "child-a", sessionTitle: "Mac capture" },
          { ...base, type: "question", sessionID: "child-b", sessionTitle: "Mac verification" },
          {
            ...base,
            type: "permission",
            questions: [],
            sessionID: "child-c",
            sessionTitle: "Run checks",
          },
        ]}
      />,
    );
    const card = (id: string) =>
      within(container.querySelector<HTMLElement>(`[data-palot-request-session-id="${id}"]`)!);
    expect(screen.getByText("Subagent · Mac capture")).toBeTruthy();
    await user.click(card("child-a").getByRole("radio", { name: "Ready" }));
    await user.click(card("child-a").getByRole("button", { name: "Send" }));
    expect(replyForm).toHaveBeenCalledWith({
      sessionID: "child-a",
      formID: "same-id",
      answer: { q0: "Ready" },
    });
    await user.click(card("child-b").getByRole("button", { name: "Dismiss" }));
    expect(cancelForm).toHaveBeenCalledWith({ sessionID: "child-b", formID: "same-id" });
    await user.click(card("child-c").getByRole("button", { name: "Allow once" }));
    expect(replyPermission).toHaveBeenCalledWith({
      sessionID: "child-c",
      requestID: "same-id",
      reply: "once",
    });
  });

  it("submits selected and custom question answers", async () => {
    const user = userEvent.setup();
    const replyForm = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ form: { reply: replyForm } }));

    render(
      <PendingRequests
        sessionID="ses_1"
        requests={[
          {
            id: "que_1",
            type: "question",
            title: "Approach",
            detail: undefined,
            resources: [],
            savePatterns: [],
            fields: [],
            delivery: undefined,
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
          },
        ]}
      />,
    );

    expect(screen.getByRole("progressbar").textContent).toBe("1/2");
    expect(screen.getByRole("group", { name: "Which approach should I use?" })).toBeTruthy();
    await user.click(screen.getByText("Minimal"));
    expect(replyForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("progressbar").textContent).toBe("2/2");
    expect(screen.getByText("Select multiple")).toBeTruthy();
    await user.click(screen.getByText("Tests"));
    await user.type(screen.getByLabelText("Checks custom answer"), "Build");
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Minimal/ }).checked).toBe(true);
    expect(screen.getByRole("progressbar").textContent).toBe("1/2");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Tests" }).checked).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Checks custom answer" }).value,
    ).toBe("Build");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(replyForm).toHaveBeenCalledWith({
        sessionID: "ses_1",
        formID: "que_1",
        answer: { q0: "Minimal", q1: ["Tests", "Build"] },
      }),
    );
  });

  it("keeps number shortcuts and explicit submission in the compact single-question view", async () => {
    const user = userEvent.setup();
    const replyForm = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ form: { reply: replyForm } }));
    render(
      <PendingRequests
        sessionID="ses_1"
        inline
        requests={[
          {
            id: "que_shortcuts",
            type: "question",
            title: "Questions",
            resources: [],
            savePatterns: [],
            fields: [],
            questions: [
              {
                header: "Approach",
                question: "Which approach?",
                multiple: false,
                custom: true,
                options: [
                  { label: "Minimal", description: "Preserves the existing behavior" },
                  { label: "Redesign" },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole("progressbar").textContent).toBe("1/1");
    expect(screen.queryByText("Questions")).toBeNull();
    expect(screen.getByText("Preserves the existing behavior")).toBeTruthy();
    expect(screen.getByPlaceholderText("Other answer…")).toBeTruthy();
    await user.tab();
    await user.keyboard("2");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Redesign" }).checked).toBe(true);
    expect(replyForm).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(replyForm).toHaveBeenCalledWith({
        sessionID: "ses_1",
        formID: "que_shortcuts",
        answer: { q0: "Redesign" },
      }),
    );
  });

  it("dismisses a question once while cancellation is pending", async () => {
    const user = userEvent.setup();
    let resolveCancel!: () => void;
    const cancelForm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ form: { cancel: cancelForm } }));

    render(
      <PendingRequests
        sessionID="ses_1"
        requests={[
          {
            id: "que_1",
            type: "question",
            title: "Approach",
            detail: undefined,
            resources: [],
            savePatterns: [],
            fields: [],
            delivery: undefined,
            questions: [
              {
                header: "Approach",
                question: "Which approach?",
                multiple: false,
                custom: false,
                options: [{ label: "Minimal" }],
              },
            ],
          },
        ]}
      />,
    );

    const dismiss = screen.getByRole<HTMLButtonElement>("button", { name: "Dismiss" });
    await user.click(dismiss);
    await user.click(dismiss);

    expect(cancelForm).toHaveBeenCalledOnce();
    expect(cancelForm).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "que_1" });
    expect(dismiss.disabled).toBe(true);
    resolveCancel();
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

  it("renders queued message actions compactly and supports every action", async () => {
    const user = userEvent.setup();
    const updatePending = vi.fn().mockResolvedValue(undefined);
    const editPending = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(
      client({
        session: { inbox: { steer: updatePending, queue: updatePending, cancel: updatePending } },
      }),
    );

    render(
      <PendingInputTaskbarItem
        sessionID="ses_1"
        request={{
          id: "msg_1",
          type: "input",
          title: "Pending input",
          detail: "Run tests after the current turn",
          resources: [],
          savePatterns: [],
          questions: [],
          fields: [],
          delivery: "queue",
        }}
        onEdit={editPending}
        queuedPosition={2}
        queuedCount={3}
      />,
    );

    const pending = screen.getByRole("region", {
      name: "Pending message actions: Run tests after the current turn",
    });
    expect(within(pending).getByText("Queued · 2")).toBeTruthy();
    expect(within(pending).queryByRole("button", { name: "Run after current turn" })).toBeNull();
    await user.click(within(pending).getByRole("button", { name: "Steer next" }));

    await waitFor(() => expect(updatePending).toHaveBeenCalledTimes(1));
    await user.click(within(pending).getByRole("button", { name: "More pending message actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Cancel and edit" }));

    await waitFor(() =>
      expect(editPending).toHaveBeenCalledWith(expect.objectContaining({ id: "msg_1" })),
    );
    await user.click(within(pending).getByRole("button", { name: "More pending message actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Cancel pending message" }));

    await waitFor(() => {
      expect(updatePending).toHaveBeenNthCalledWith(1, {
        sessionID: "ses_1",
        inboxID: "msg_1",
      });
      expect(updatePending).toHaveBeenNthCalledWith(2, {
        sessionID: "ses_1",
        inboxID: "msg_1",
      });
    });
  });

  it("can move a steering message to the queue", async () => {
    const user = userEvent.setup();
    const updatePending = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(
      client({
        session: { inbox: { steer: updatePending, queue: updatePending, cancel: updatePending } },
      }),
    );

    render(
      <PendingInputTaskbarItem
        sessionID="ses_1"
        request={{
          id: "msg_2",
          type: "input",
          title: "Pending input",
          detail: "Queue this instead",
          resources: [],
          savePatterns: [],
          questions: [],
          fields: [],
          delivery: "steer",
        }}
        queuedCount={0}
      />,
    );

    const pending = screen.getByRole("region", {
      name: "Pending message actions: Queue this instead",
    });
    expect(within(pending).getByText("Steering")).toBeTruthy();
    expect(within(pending).queryByRole("button", { name: "Send now" })).toBeNull();
    await user.click(within(pending).getByRole("button", { name: "Run after current turn" }));

    await waitFor(() =>
      expect(updatePending).toHaveBeenCalledWith({
        sessionID: "ses_1",
        inboxID: "msg_2",
      }),
    );
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
        reply,
      }),
    );
  });

  it("submits form values with conditional and custom fields", async () => {
    const user = userEvent.setup();
    const replyForm = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ form: { reply: replyForm } }));

    render(
      <PendingRequests
        sessionID="ses_1"
        requests={[
          {
            id: "form_1",
            type: "form",
            title: "Configure deployment",
            detail: undefined,
            resources: [],
            savePatterns: [],
            questions: [],
            delivery: undefined,
            fields: [
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
            ],
          },
        ]}
      />,
    );

    const form = within(screen.getByRole("region", { name: "Configure deployment" }));
    const submit = form.getByRole<HTMLButtonElement>("button", { name: "Submit" });
    expect(submit.disabled).toBe(true);
    await user.click(form.getByText("Europe"));
    const notes = form
      .getAllByRole<HTMLInputElement>("textbox")
      .find((input) => !input.hasAttribute("aria-label"));
    expect(notes).toBeTruthy();
    await user.type(notes!, "Primary region");
    expect(form.getByLabelText("Regions custom value")).toBeTruthy();
    expect(notes?.value).toBe("Primary region");
    expect(form.getByRole<HTMLInputElement>("checkbox", { name: "Europe" }).checked).toBe(true);
    await waitFor(() =>
      expect(form.getByRole<HTMLButtonElement>("button", { name: "Submit" }).disabled).toBe(false),
    );
    await user.click(form.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(replyForm).toHaveBeenCalledWith({
        sessionID: "ses_1",
        formID: "form_1",
        answer: { regions: ["eu"], notes: "Primary region", notify: false },
      }),
    );
  });

  it("cancels a form once while the request is pending", async () => {
    const user = userEvent.setup();
    let resolveCancel!: () => void;
    const cancelForm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    (window as unknown as { palot?: PalotApi }).palot = bridge({});
    setOpenCodeClientForTest(client({ form: { cancel: cancelForm } }));

    render(
      <PendingRequests
        sessionID="ses_1"
        requests={[
          {
            id: "form_1",
            type: "form",
            title: "Configure deployment",
            detail: undefined,
            resources: [],
            savePatterns: [],
            questions: [],
            delivery: undefined,
            fields: [],
          },
        ]}
      />,
    );

    const form = within(screen.getByRole("region", { name: "Configure deployment" }));
    const cancel = form.getByRole<HTMLButtonElement>("button", { name: "Cancel" });
    await user.click(cancel);
    await user.click(cancel);

    expect(cancelForm).toHaveBeenCalledOnce();
    expect(cancelForm).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "form_1" });
    expect(cancel.disabled).toBe(true);
    resolveCancel();
  });

  it("shows neq fields before the controlling answer is set", () => {
    render(
      <PendingRequests
        sessionID="ses_1"
        requests={[
          {
            id: "form_neq",
            type: "form",
            title: "Conditional form",
            detail: undefined,
            resources: [],
            savePatterns: [],
            questions: [],
            delivery: undefined,
            fields: [
              {
                key: "details",
                type: "string",
                title: "Details",
                required: true,
                options: [],
                custom: false,
                when: [{ key: "mode", op: "neq", value: "automatic" }],
              },
            ],
          },
        ]}
      />,
    );

    expect(
      within(screen.getByRole("region", { name: "Conditional form" })).getByText("Details"),
    ).toBeTruthy();
  });
});
