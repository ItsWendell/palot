import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it } from "vitest";
import { reviewInstructionsAtom } from "../../atoms/review-instructions";
import { ReviewInstructionsSettings } from "./review-instructions-settings";

afterEach(cleanup);

it("adds, edits and removes saved review instructions", async () => {
  const user = userEvent.setup();
  const store = createStore();
  store.set(reviewInstructionsAtom, []);
  render(
    <Provider store={store}>
      <ReviewInstructionsSettings />
    </Provider>,
  );
  await user.click(screen.getByRole("button", { name: "Add instructions" }));
  const form = screen.getByRole("form", { name: "New review instructions" });
  const save = within(form).getByRole("button", { name: "Save" });
  expect(save).toHaveProperty("disabled", true);
  await user.type(within(form).getByRole("textbox", { name: "Name" }), "Security pass");
  await user.type(
    within(form).getByRole("textbox", { name: "Instructions" }),
    "Look for injection and leaked secrets.",
  );
  await user.click(save);
  expect(store.get(reviewInstructionsAtom)).toEqual([
    expect.objectContaining({
      name: "Security pass",
      instructions: "Look for injection and leaked secrets.",
    }),
  ]);

  // A second entry may not reuse the name.
  await user.click(screen.getByRole("button", { name: "Add instructions" }));
  const second = screen.getByRole("form", { name: "New review instructions" });
  await user.type(within(second).getByRole("textbox", { name: "Name" }), "security PASS");
  await user.type(within(second).getByRole("textbox", { name: "Instructions" }), "x");
  expect(within(second).getByText("Another saved review already has this name.")).toBeTruthy();
  await user.click(within(second).getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Edit Security pass" }));
  const edit = screen.getByRole("form", { name: "Edit review instructions" });
  const name = within(edit).getByRole("textbox", { name: "Name" });
  await user.clear(name);
  await user.type(name, "Security");
  await user.click(within(edit).getByRole("button", { name: "Save" }));
  expect(store.get(reviewInstructionsAtom).map((entry) => entry.name)).toEqual(["Security"]);

  await user.click(screen.getByRole("button", { name: "Remove Security" }));
  expect(store.get(reviewInstructionsAtom)).toEqual([]);
  expect(screen.getByText("No saved instructions")).toBeTruthy();
});
