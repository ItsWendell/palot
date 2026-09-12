import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "./sidebar";

describe("SidebarProvider", () => {
  it("handles the navigation shortcut with the latest change callback", async () => {
    const user = userEvent.setup();
    const firstOnOpenChange = vi.fn();
    const nextOnOpenChange = vi.fn();
    const view = render(
      <SidebarProvider open onOpenChange={firstOnOpenChange}>
        <span>Content</span>
      </SidebarProvider>,
    );

    view.rerender(
      <SidebarProvider open onOpenChange={nextOnOpenChange}>
        <span>Content</span>
      </SidebarProvider>,
    );
    await user.keyboard("{Meta>}b{/Meta}");

    expect(firstOnOpenChange).not.toHaveBeenCalled();
    expect(nextOnOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not handle the navigation shortcut when disabled", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <SidebarProvider open keyboardShortcut={false} onOpenChange={onOpenChange}>
        <span>Content</span>
      </SidebarProvider>,
    );

    await user.keyboard("{Meta>}b{/Meta}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
