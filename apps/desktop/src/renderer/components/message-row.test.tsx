import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { MessageRow } from "./thread";

describe("MessageRow", () => {
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

  it("renders user attachments inside the bottom of the message bubble", () => {
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
    expect(bubble?.lastElementChild).toBe(attachments);
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
    expect(attachments.previousElementSibling?.contains(readMore)).toBe(true);
    expect(row.querySelector("[inert]")?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(readMore);

    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(row.querySelector("[inert]")).toBeNull();
  });
});
