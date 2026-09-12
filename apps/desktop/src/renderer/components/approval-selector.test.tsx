import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionApprovalMode } from "../lib/session-permissions";
import { ApprovalSelector } from "./approval-selector";

vi.mock("../lib/toast-error", () => ({ showErrorToast: vi.fn() }));
afterEach(cleanup);

function setup(
  mode: SessionApprovalMode = "normal",
  onSelect = vi.fn().mockResolvedValue(undefined),
  disabled = false,
) {
  const focus = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <ApprovalSelector
        mode={mode}
        busy={false}
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
        onSelect={onSelect}
        onSelectionComplete={focus}
      />
    );
  }
  render(<Harness />);
  return { onSelect, focus };
}

describe("ApprovalSelector", () => {
  it("requires confirmation before elevating access, and cancellation leaves rules alone", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Approvals: Defaults" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Full access/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Enable Full access?" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/including Plan edit restrictions/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies Full access only after confirmation and returns focus", async () => {
    const { onSelect, focus } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Approvals: Defaults" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Full access/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Enable Full access" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("full"));
    expect(focus).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows Custom honestly and can replace it with Defaults", async () => {
    const { onSelect } = setup("custom");
    await userEvent.click(screen.getByRole("button", { name: "Approvals: Custom" }));
    expect(await screen.findByText(/Choosing a preset replaces them/)).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio", { checked: false })).toHaveLength(2);
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^Defaults/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("normal"));
  });

  it("keeps failed elevation visible without claiming success", async () => {
    const { onSelect, focus } = setup(
      "normal",
      vi.fn().mockRejectedValue(new Error("Server unavailable")),
    );
    await userEvent.click(screen.getByRole("button", { name: "Approvals: Defaults" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^Full access/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Enable Full access" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Server unavailable");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Approvals: Defaults" })).toBeTruthy();
  });

  it("disables changes when the connection or composer is unavailable", () => {
    setup("normal", vi.fn(), true);
    expect(
      (screen.getByRole("button", { name: "Approvals: Defaults" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
