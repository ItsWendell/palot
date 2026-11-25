import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import { MessageRow } from "./transcript/message-row";
import { MessageQuoteOpenerContext } from "./transcript/user-message-quotes";

const openScheduled = vi.fn();
vi.mock("../hooks/use-navigation", () => ({ usePalotNavigation: () => ({ openScheduled }) }));

describe("MessageRow", () => {
  it("attributes an OpenCode automation's prompt to it and links to Scheduled", () => {
    const text = "Check the nightly build";
    const message: PalotMessage = {
      id: "msg_auto",
      type: "user",
      createdAt: 1,
      completedAt: 1,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text }],
      data: {
        metadata: {
          automation: { id: "aut_1", name: "Nightly check", run: 2, dueAt: 1, late: true },
        },
      },
    };
    const view = render(<MessageRow message={message} label="Steer" />);
    const row = within(view.container).getByRole("article", { name: "user message" });
    const link = within(row).getByRole("button", { name: "Automation · Nightly check · ran late" });
    expect(row.textContent).toContain("Steer ·");
    fireEvent.click(link);
    expect(openScheduled).toHaveBeenCalledWith({});
  });

  it("keeps a growing assistant response uncollapsed and preserves its full text on completion", () => {
    const text = Array.from({ length: 20 }, (_, index) => `Assistant paragraph ${index}.`).join(
      "\n\n",
    );
    const message: PalotMessage = {
      id: "long-assistant-message",
      type: "assistant",
      createdAt: 1,
      completedAt: null,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text }],
      data: null,
    };
    const view = render(<MessageRow message={message} />);
    const row = within(view.container).getByRole("article", { name: "assistant message" });
    expect(row.textContent).toContain("Assistant paragraph 0.");
    expect(row.textContent).toContain("Assistant paragraph 19.");
    expect(within(row).queryByRole("button", { name: "Read more" })).toBeNull();
    expect(row.querySelector("[inert]")).toBeNull();

    const completedText = `${text}\n\nFinal assistant paragraph.`;
    view.rerender(
      <MessageRow
        message={{
          ...message,
          text: completedText,
          content: [{ type: "text", text: completedText }],
          completedAt: 2,
        }}
      />,
    );
    expect(row.textContent).toContain("Assistant paragraph 0.");
    expect(row.textContent).toContain("Final assistant paragraph.");
    expect(within(row).queryByRole("button", { name: "Read more" })).toBeNull();
    expect(row.querySelector("[inert]")).toBeNull();
  });

  it("copies a long user prompt in full while it is collapsed", () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", { configurable: true, value: { writeClipboardText } });
    const text = Array.from({ length: 30 }, (_, index) => `Prompt line ${index}`).join("\n");
    const message: PalotMessage = {
      id: "long-user-message",
      type: "user",
      createdAt: 1,
      completedAt: 2,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text }],
      data: null,
    };
    const view = render(<MessageRow message={message} />);
    fireEvent.click(within(view.container).getByRole("button", { name: "Copy prompt" }));
    expect(writeClipboardText).toHaveBeenCalledWith(text);
    expect(within(view.container).getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows a sent PR repair context compactly and the exact text it supplied on press", async () => {
    const block =
      '<pr-context label="PR #34 · 1 failing check">\nFix the 1 failing check on pull request #34.\n\n1. build (failed)\n</pr-context>';
    const text = `Please look.\n\n${block}\n\n`;
    const message: PalotMessage = {
      id: "repair-message",
      type: "user",
      createdAt: 1,
      completedAt: 2,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text }],
      data: null,
    };
    const view = render(<MessageRow message={message} />);
    const row = within(view.container).getByRole("article", { name: "user message" });
    expect(row.textContent).toContain("Please look.");
    expect(row.textContent).not.toContain("1. build (failed)");
    fireEvent.click(
      within(row).getByRole("button", {
        name: "Pull request context: PR #34 · 1 failing check. Show the text it supplied",
      }),
    );
    expect((await screen.findByLabelText("Text sent to the agent")).textContent).toBe(block);
  });

  it("shows review comments as quote chips that open their lines", () => {
    const text =
      "Tidy up\nThe user made the following comment regarding lines 12 through 18 of src/a.ts (removed lines, old version): Keep this guard";
    const message: PalotMessage = {
      id: "quoted-message",
      type: "user",
      createdAt: 1,
      completedAt: 2,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
    };
    const open = vi.fn();
    const view = render(
      <MessageQuoteOpenerContext.Provider value={open}>
        <MessageRow message={message} />
      </MessageQuoteOpenerContext.Provider>,
    );
    const row = within(view.container).getByRole("article", { name: "user message" });
    expect(row.textContent).toContain("Tidy up");
    expect(row.textContent).not.toContain("The user made the following comment");
    const chip = within(row).getByRole("button", {
      name: "Open the change to src/a.ts:L12–18. Comment: Keep this guard",
    });
    expect(chip.textContent).toContain("removed");
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "review", path: "src/a.ts", startLine: 12, removed: true }),
      expect.anything(),
    );
  });

  it("keeps single tildes the user typed, but not in assistant answers", () => {
    const text = "move ~/foo to (~/bar)";
    const message = (type: "user" | "assistant"): PalotMessage => ({
      id: `${type}-tilde`,
      type,
      createdAt: 1,
      completedAt: 2,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text }],
      data: null,
    });
    const user = render(<MessageRow message={message("user")} />);
    const prompt = within(user.container).getByRole("article", { name: "user message" });
    expect(prompt.textContent).toContain(text);
    expect(prompt.querySelector("del")).toBeNull();
    user.unmount();

    const assistant = render(<MessageRow message={message("assistant")} />);
    expect(assistant.container.querySelector("del")).not.toBeNull();
  });

  it("does not animate an unfinished user message", () => {
    const message: PalotMessage = {
      id: "unfinished-user-message",
      type: "user",
      createdAt: 1,
      completedAt: null,
      text: "Static user text",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text: "Static user text" }],
      data: null,
    };

    const view = render(<MessageRow message={message} />);

    expect(view.container.querySelector("[data-markdown-stream-word]")).toBeNull();
  });

  it("renders user attachments at the top of the message bubble", () => {
    const message: PalotMessage = {
      id: "user-message",
      type: "user",
      createdAt: 1,
      completedAt: 1,
      text: "Review this file",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text: "Review this file" }],
      files: [
        {
          uri: "file:///repo/notes.txt",
          name: "notes.txt",
          mime: "text/plain",
          size: 12,
        },
      ],
      data: null,
    };

    render(<MessageRow message={message} />);

    const bubble = screen.getByText("Review this file").closest('[data-slot="bubble-content"]');
    const attachments = screen.getByLabelText("Attachments");
    expect(bubble?.contains(attachments)).toBe(true);
    expect(bubble?.firstElementChild).toBe(attachments);
    expect(attachments.classList.contains("justify-start")).toBe(true);
    expect(attachments.querySelector('[data-slot="attachment"]')?.getAttribute("data-size")).toBe(
      "sm",
    );
  });

  it("collapses long user messages without clipping their attachments", () => {
    const text = Array.from({ length: 20 }, (_, index) => `Long user-message line ${index}`).join(
      "\n",
    );
    const message: PalotMessage = {
      id: "long-user-message",
      type: "user",
      createdAt: 1,
      completedAt: 1,
      text,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [{ type: "text", text }],
      files: [
        {
          uri: "file:///repo/notes.txt",
          name: "notes.txt",
          mime: "text/plain",
          size: 12,
        },
      ],
      data: null,
    };

    render(<MessageRow message={message} />);

    const row = screen.getAllByRole("article", { name: "user message" }).at(-1)!;
    const readMore = within(row).getByRole("button", { name: "Read more" });
    const attachments = within(row).getByLabelText("Attachments");
    expect(readMore.getAttribute("aria-expanded")).toBe("false");
    expect(attachments.nextElementSibling?.contains(readMore)).toBe(true);
    expect(row.querySelector("[inert]")?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(readMore);

    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(row.querySelector("[inert]")).toBeNull();
  });
});
