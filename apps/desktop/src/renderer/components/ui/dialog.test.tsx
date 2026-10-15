import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

afterEach(cleanup);

it("keeps its slots and unmounts after the exit motion", async () => {
  const user = userEvent.setup();
  render(
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Rename task</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  await user.click(screen.getByRole("button", { name: "Open" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename task" });
  expect(dialog.getAttribute("data-slot")).toBe("dialog-content");
  expect(dialog.className).toContain("sm:max-w-md");
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
});

it("closes an alert dialog from its cancel action", async () => {
  const user = userEvent.setup();
  render(
    <AlertDialog>
      <AlertDialogTrigger>Delete</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete worktree?</AlertDialogTitle>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>,
  );
  await user.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete worktree?" });
  expect(dialog.getAttribute("data-slot")).toBe("alert-dialog-content");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});
