import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewCommentEditor } from "./review-comment-editor";

afterEach(cleanup);

it("requires a nonempty line comment and saves the selected range", () => {
  const save = vi.fn();
  render(
    <ReviewCommentEditor
      path="src/a.ts"
      range={{ start: 4, end: 2, side: "additions" }}
      onSave={save}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText("src/a.ts · lines 2–4")).toBeTruthy();
  const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Add comment" });
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Line comment" }), {
    target: { value: "Handle null" },
  });
  fireEvent.click(submit);
  expect(save).toHaveBeenCalledWith("Handle null");
});

it("sends just this comment with Mod+Enter and keeps it for a retry when sending fails", async () => {
  const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const save = vi.fn();
  render(
    <ReviewCommentEditor
      path="src/a.ts"
      range={{ start: 2, end: 2, side: "additions" }}
      onSave={save}
      onSend={send}
      onCancel={vi.fn()}
    />,
  );
  const comment = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Line comment" });
  fireEvent.change(comment, { target: { value: "Handle null" } });
  await act(async () => {
    fireEvent.keyDown(comment, { key: "Enter", ctrlKey: true });
  });
  expect(send).toHaveBeenCalledWith("Handle null");
  expect(screen.getByRole("alert").textContent).toBe(
    "Couldn't send. Your comment is still here. Try again.",
  );
  expect(comment.value).toBe("Handle null");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send now/ }));
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it("offers Send now only when the task's composer can send", () => {
  render(
    <ReviewCommentEditor
      path="src/a.ts"
      range={{ start: 2, end: 2, side: "additions" }}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: /^Send now/ })).toBeNull();
});
