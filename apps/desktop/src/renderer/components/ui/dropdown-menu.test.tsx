import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

function renderMenu(onArchive = vi.fn()) {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Task</DropdownMenuLabel>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>Archive</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  return onArchive;
}

it("lights the row Base UI highlights from the keyboard with the one fluid highlight", async () => {
  const user = userEvent.setup();
  renderMenu();
  screen.getByRole("button", { name: "Actions" }).focus();
  await user.keyboard("{Enter}");
  const menu = await screen.findByRole("menu");
  const rows = screen.getAllByRole("menuitem");
  const list = menu.querySelector('[data-slot="fluid-list"]');
  if (!list) throw new Error("fluid list missing");

  // Rows join the list in DOM order; labels and separators are not rows.
  await waitFor(() => expect(rows.every((row) => row.hasAttribute("data-fluid-item"))).toBe(true));
  expect(menu.querySelectorAll("[data-fluid-item]")).toHaveLength(3);

  await user.keyboard("{ArrowDown}");
  await waitFor(() => {
    const highlighted = rows.findIndex((row) => row.hasAttribute("data-highlighted"));
    expect(highlighted).toBeGreaterThanOrEqual(0);
    expect(list.getAttribute("data-fluid-hover-active-index")).toBe(String(highlighted));
    expect(rows[highlighted]?.hasAttribute("data-fluid-hover-active")).toBe(true);
  });

  await user.keyboard("{End}");
  await waitFor(() => expect(list.getAttribute("data-fluid-hover-active-index")).toBe("2"));
  expect(rows[2]?.getAttribute("data-variant")).toBe("destructive");
});

it("keeps item activation and menu semantics", async () => {
  const user = userEvent.setup();
  const onArchive = renderMenu();
  await user.click(screen.getByRole("button", { name: "Actions" }));
  await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
  expect(onArchive).toHaveBeenCalledOnce();
});
