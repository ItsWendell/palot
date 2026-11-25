import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ANSWER, RequestPanel, questionStepReady } from "./request-panel";
import { requestKeyAction, type RequestKeyEvent } from "./request-keys";
import type { QuestionAnswer, QuestionRequestView, RequestView } from "./types";

afterEach(cleanup);

const SHELL: RequestView = {
  kind: "permission",
  id: "shell",
  permission: "shell",
  title: "Run a command",
  subject: "bun run test:e2e",
  reason: "Updates 4 snapshot files.",
  rule: "bun run test:e2e *",
  source: "explore",
};

const EDIT: RequestView = {
  kind: "permission",
  id: "edit",
  permission: "edit",
  title: "Edit a file",
  subject: "src/composer-queue.tsx",
  diff: Array.from({ length: 6 }, (_, index) => ({
    type: index === 1 ? ("del" as const) : index === 2 ? ("add" as const) : ("ctx" as const),
    text: `line ${index + 1}`,
  })),
};

const QUESTION: QuestionRequestView = {
  kind: "question",
  id: "question",
  steps: [
    {
      prompt: "What should I do?",
      multiple: false,
      custom: true,
      options: [
        { label: "Update the snapshots", description: "The new collapse is intended" },
        { label: "Collapse at four instead" },
      ],
    },
    {
      prompt: "Which platforms?",
      multiple: true,
      custom: false,
      options: [{ label: "Linux" }, { label: "macOS" }],
    },
  ],
};

const FORM: RequestView = {
  kind: "form",
  id: "form",
  server: "linear",
  title: "Create a Linear issue",
  fields: [
    { id: "title", type: "text", label: "Title" },
    { id: "assign", type: "checkbox", label: "Assign to me" },
  ],
};

const GUEST: RequestView = {
  kind: "guest",
  id: "guest",
  from: "Maya",
  verified: false,
  text: "Check Windows too.",
};

const FEEDBACK = { field: "feedback", armed: true } as const;
const KEPT = { field: "message", armed: true } as const;

function key(key: string, modifiers: Partial<RequestKeyEvent> = {}): RequestKeyEvent {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers };
}

describe("requestKeyAction", () => {
  const permission = { request: SHELL, count: 1, fieldEmpty: true, ownsEnter: true };

  it("Enter allows once on an empty field and denies with the text as feedback otherwise", () => {
    expect(requestKeyAction(key("Enter"), permission)).toEqual({ type: "allow-once" });
    expect(requestKeyAction(key("Enter"), { ...permission, fieldEmpty: false })).toEqual({
      type: "deny-with-feedback",
    });
  });

  it("Enter stays the message's while typing defers the request or a draft owns the field", () => {
    expect(requestKeyAction(key("Enter"), { ...permission, ownsEnter: false })).toBeNull();
    expect(requestKeyAction(key("Enter", { shiftKey: true }), permission)).toBeNull();
  });

  it("Escape never approves and never denies", () => {
    expect(requestKeyAction(key("Escape"), permission)).toBeNull();
    expect(
      requestKeyAction(key("Escape"), { ...permission, request: QUESTION, fieldEmpty: true }),
    ).toBeNull();
  });

  it("the chords deny and always allow, with Ctrl or ⌘", () => {
    expect(
      requestKeyAction(key("Backspace", { ctrlKey: true, shiftKey: true }), permission),
    ).toEqual({ type: "deny" });
    expect(requestKeyAction(key("Enter", { metaKey: true, shiftKey: true }), permission)).toEqual({
      type: "always-allow",
    });
    // Without a reusable pattern there is nothing to always allow.
    expect(
      requestKeyAction(key("Enter", { metaKey: true, shiftKey: true }), {
        ...permission,
        request: { ...SHELL, rule: undefined },
      }),
    ).toBeNull();
  });

  it("pages between pending requests with Alt+↑/↓", () => {
    const several = { ...permission, count: 3 };
    expect(requestKeyAction(key("ArrowDown", { altKey: true }), several)).toEqual({
      type: "page",
      delta: 1,
    });
    expect(requestKeyAction(key("ArrowUp", { altKey: true }), several)).toEqual({
      type: "page",
      delta: -1,
    });
    expect(requestKeyAction(key("ArrowUp", { altKey: true }), permission)).toBeNull();
  });

  it("1–9 pick an option only while the field is empty, and Alt+← goes back a step", () => {
    const question = { request: QUESTION, count: 1, fieldEmpty: true, ownsEnter: true };
    expect(requestKeyAction(key("2"), question)).toEqual({ type: "pick", index: 1 });
    expect(requestKeyAction(key("3"), question)).toBeNull();
    expect(requestKeyAction(key("1"), { ...question, fieldEmpty: false })).toBeNull();
    expect(requestKeyAction(key("1"), { ...question, ownsEnter: false })).toBeNull();
    expect(requestKeyAction(key("Enter"), question)).toEqual({ type: "next" });
    expect(requestKeyAction(key("ArrowLeft", { altKey: true }), { ...question, step: 1 })).toEqual({
      type: "back",
    });
    expect(requestKeyAction(key("ArrowLeft", { altKey: true }), question)).toBeNull();
  });

  it("ignores keys during IME composition", () => {
    expect(requestKeyAction(key("Enter", { isComposing: true }), permission)).toBeNull();
  });

  it("leaves Enter to the message for forms and guest messages", () => {
    expect(requestKeyAction(key("Enter"), { ...permission, request: FORM })).toBeNull();
    expect(requestKeyAction(key("Enter"), { ...permission, request: GUEST })).toBeNull();
  });
});

describe("RequestPanel: permissions", () => {
  it("with an empty field, leaves the main action to the composer and says what Enter does", () => {
    render(<RequestPanel request={SHELL} guard={FEEDBACK} fieldEmpty />);
    expect(screen.getByRole("region", { name: "Run a command" })).toBeTruthy();
    expect(screen.getByText("From")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/allows once/)).toBeTruthy();
    const deny = screen.getByRole("button", { name: "Deny" });
    expect(deny.getAttribute("aria-keyshortcuts")).toBeTruthy();
  });

  it("with feedback typed in the field, offers to send it as a message instead", async () => {
    const onSendInstead = vi.fn();
    const user = userEvent.setup();
    render(
      <RequestPanel
        request={SHELL}
        guard={FEEDBACK}
        fieldEmpty={false}
        sendInsteadLabel="Steer it instead"
        onSendInstead={onSendInstead}
      />,
    );
    expect(screen.getByText(/denies and sends your text/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Steer it instead" }));
    expect(onSendInstead).toHaveBeenCalled();
  });

  it("while the user is still typing, says Enter still sends their message", () => {
    render(<RequestPanel request={SHELL} guard={{ field: "feedback", armed: false }} fieldEmpty />);
    expect(screen.getByText(/still sends your message/)).toBeTruthy();
  });

  it("with a kept draft, brings its own feedback input and main action", async () => {
    const onDeny = vi.fn();
    const onAllowOnce = vi.fn();
    const user = userEvent.setup();
    function Kept() {
      const [feedback, setFeedback] = useState("");
      return (
        <RequestPanel
          request={SHELL}
          guard={KEPT}
          fieldEmpty={false}
          feedback={feedback}
          onFeedbackChange={setFeedback}
          onDeny={onDeny}
          onAllowOnce={onAllowOnce}
        />
      );
    }
    render(<Kept />);
    expect(screen.getByText("The message box below stays yours")).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Tell the agent what to do differently" });
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(onAllowOnce).toHaveBeenCalledTimes(1);
    await user.type(input, "Use the unit tests instead{Enter}");
    expect(onDeny).toHaveBeenCalledWith("Use the unit tests instead");
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onAllowOnce).toHaveBeenCalledTimes(2);
  });

  it("denies and always allows with the chords from inside the panel", () => {
    const onDeny = vi.fn();
    const onAlwaysAllow = vi.fn();
    render(
      <RequestPanel
        request={SHELL}
        guard={FEEDBACK}
        fieldEmpty
        onDeny={onDeny}
        onAlwaysAllow={onAlwaysAllow}
      />,
    );
    const deny = screen.getByRole("button", { name: "Deny" });
    fireEvent.keyDown(deny, { key: "Backspace", ctrlKey: true, shiftKey: true });
    expect(onDeny).toHaveBeenCalledWith(undefined);
    fireEvent.keyDown(deny, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(onAlwaysAllow).toHaveBeenCalled();
    fireEvent.keyDown(deny, { key: "Escape" });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("shows a compact diff with Show all N lines", async () => {
    const user = userEvent.setup();
    render(<RequestPanel request={EDIT} guard={FEEDBACK} fieldEmpty />);
    expect(screen.queryByText("line 6")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show all 6 lines" }));
    expect(screen.getByText("line 6")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("offers no Always allow without a reusable pattern", () => {
    render(<RequestPanel request={{ ...SHELL, rule: undefined }} guard={FEEDBACK} fieldEmpty />);
    expect(screen.queryByRole("button", { name: /Always allow/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Deny/ })).toBeTruthy();
  });

  it("pages with the buttons and Alt+↑/↓", async () => {
    const onPage = vi.fn();
    const user = userEvent.setup();
    render(
      <RequestPanel
        request={SHELL}
        guard={FEEDBACK}
        fieldEmpty
        index={0}
        count={3}
        onPage={onPage}
      />,
    );
    expect(screen.getByText("1 of 3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next request" }));
    expect(onPage).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "Deny" }), {
      key: "ArrowUp",
      altKey: true,
    });
    expect(onPage).toHaveBeenLastCalledWith(-1);
  });
});

describe("RequestPanel: questions", () => {
  function Question({
    guard = FEEDBACK,
    onNext = () => {},
  }: {
    guard?: typeof FEEDBACK | typeof KEPT;
    onNext?: () => void;
  }) {
    const [answer, setAnswer] = useState<QuestionAnswer>(EMPTY_ANSWER);
    return (
      <>
        <RequestPanel
          request={QUESTION}
          guard={guard}
          fieldEmpty
          answer={answer}
          onAnswerChange={setAnswer}
          onNext={() => {
            onNext();
            setAnswer((current) => ({ ...current, step: current.step + 1 }));
          }}
        />
        <output>{JSON.stringify(answer.choices)}</output>
      </>
    );
  }

  it("picks options and steps forward and back", async () => {
    const user = userEvent.setup();
    render(<Question guard={KEPT} />);
    expect(screen.getByText("A few questions")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /Collapse at four instead/ }));
    expect(screen.getByText('[["Collapse at four instead"]]')).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Linux" }));
    await user.click(screen.getByRole("checkbox", { name: "macOS" }));
    expect(screen.getByText('[["Collapse at four instead"],["Linux","macOS"]]')).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("with an empty field, lets the field carry the typed answer and the composer go on", () => {
    render(<Question />);
    expect(screen.queryByRole("textbox", { name: "Your own answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByText(/pick while the box is empty/)).toBeTruthy();
  });

  it("with a kept draft, takes the typed answer in the panel", () => {
    render(<Question guard={KEPT} />);
    expect(screen.getByRole("textbox", { name: "Your own answer" })).toBeTruthy();
  });

  it("knows when a step can go on", () => {
    expect(questionStepReady(QUESTION, EMPTY_ANSWER, "")).toBe(false);
    expect(questionStepReady(QUESTION, EMPTY_ANSWER, "Something else")).toBe(true);
    expect(questionStepReady(QUESTION, { step: 1, choices: [[], []], texts: [] }, "typed")).toBe(
      false,
    );
  });
});

describe("RequestPanel: forms and guests", () => {
  it("submits a form with Enter in a field and with Submit, and cancels", async () => {
    const onSubmitForm = vi.fn();
    const onCancelForm = vi.fn();
    const user = userEvent.setup();
    function Form() {
      const [values, setValues] = useState<Record<string, string | boolean>>({});
      return (
        <RequestPanel
          request={FORM}
          guard={FEEDBACK}
          fieldEmpty
          values={values}
          onValuesChange={setValues}
          onSubmitForm={onSubmitForm}
          onCancelForm={onCancelForm}
        />
      );
    }
    render(<Form />);
    expect(screen.getByText("linear MCP")).toBeTruthy();
    expect(screen.getByText("The message box below stays yours")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Queue collapses{Enter}");
    expect(onSubmitForm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("checkbox", { name: "Assign to me" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmitForm).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelForm).toHaveBeenCalled();
  });

  it("renders a form's description through renderText", () => {
    render(
      <RequestPanel
        request={{ ...FORM, description: "Docs at https://example.com/docs" } as RequestView}
        guard={FEEDBACK}
        fieldEmpty
        renderText={(text) => <mark>{text}</mark>}
      />,
    );
    expect(screen.getByText("Docs at https://example.com/docs").tagName).toBe("MARK");
  });

  it("sends or dismisses a guest message", async () => {
    const onSendGuest = vi.fn();
    const onDismissGuest = vi.fn();
    const user = userEvent.setup();
    render(
      <RequestPanel
        request={GUEST}
        guard={FEEDBACK}
        fieldEmpty
        onSendGuest={onSendGuest}
        onDismissGuest={onDismissGuest}
      />,
    );
    expect(screen.getByRole("region", { name: "Guest message from Maya" })).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send to the agent" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onSendGuest).toHaveBeenCalled();
    expect(onDismissGuest).toHaveBeenCalled();
  });
});
