import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

afterEach(cleanup);

it("keeps the fluid highlight on the option Base UI highlights from the keyboard", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  render(
    <Select defaultValue="medium" onValueChange={onValueChange}>
      <SelectTrigger aria-label="Effort">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="medium">Medium</SelectItem>
        <SelectItem value="high">High</SelectItem>
      </SelectContent>
    </Select>,
  );

  await user.click(screen.getByRole("combobox", { name: "Effort" }));
  const listbox = await screen.findByRole("listbox");
  const options = screen.getAllByRole("option");
  await waitFor(() =>
    expect(options.every((option) => option.hasAttribute("data-fluid-item"))).toBe(true),
  );

  await user.keyboard("{ArrowDown}");
  await waitFor(() => {
    const highlighted = options.findIndex((option) => option.hasAttribute("data-highlighted"));
    expect(highlighted).toBeGreaterThanOrEqual(0);
    expect(listbox.getAttribute("data-fluid-hover-active-index")).toBe(String(highlighted));
  });

  await user.keyboard("{End}");
  await waitFor(() => expect(listbox.getAttribute("data-fluid-hover-active-index")).toBe("2"));
  await user.keyboard("{Enter}");
  expect(onValueChange).toHaveBeenCalledWith("high", expect.anything());
});
