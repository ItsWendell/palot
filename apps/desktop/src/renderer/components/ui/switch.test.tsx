import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Switch } from "./switch";

afterEach(cleanup);

function Controlled({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(false);
  return (
    <Switch aria-label="Notifications" checked={checked} disabled={disabled} onCheckedChange={setChecked} />
  );
}

it("toggles by pointer and keyboard and reports its state", async () => {
  const user = userEvent.setup();
  render(<Controlled />);
  const control = screen.getByRole("switch", { name: "Notifications" });
  expect(control.getAttribute("aria-checked")).toBe("false");

  await user.click(control);
  expect(control.getAttribute("aria-checked")).toBe("true");
  expect(control.hasAttribute("data-checked")).toBe(true);

  control.focus();
  await user.keyboard(" ");
  expect(control.getAttribute("aria-checked")).toBe("false");
});

it("ignores input while disabled", async () => {
  const user = userEvent.setup();
  const onCheckedChange = vi.fn();
  render(<Switch aria-label="Sync" disabled onCheckedChange={onCheckedChange} />);
  const control = screen.getByRole("switch", { name: "Sync" });
  await user.click(control);
  expect(onCheckedChange).not.toHaveBeenCalled();
  expect(control.getAttribute("aria-checked")).toBe("false");
  expect(control.getAttribute("aria-disabled")).toBe("true");
});
