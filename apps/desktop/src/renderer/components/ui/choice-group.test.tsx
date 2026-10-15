import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ChoiceGroup, type ChoiceOption } from "./choice-group";

afterEach(cleanup);

type Mode = "system" | "light" | "dark" | "contrast";

const options: ChoiceOption<Mode>[] = [
  { value: "system", label: "System", description: "Follow the OS" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  {
    value: "contrast",
    label: "High contrast",
    disabled: true,
    disabledReason: "Not available in this theme",
  },
];

function Controlled({
  initial = null,
  variant,
  onChange,
}: {
  initial?: Mode | null;
  variant?: "list" | "card";
  onChange?: (value: Mode) => void;
}) {
  const [value, setValue] = useState<Mode | null>(initial);
  return (
    <ChoiceGroup
      aria-label="Appearance"
      options={options}
      value={value}
      variant={variant}
      onValueChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

it("keeps one roving tab stop: the first option until one is chosen", async () => {
  const user = userEvent.setup();
  render(<Controlled />);
  expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
  expect(radio("System").tabIndex).toBe(0);
  expect(radio("Light").tabIndex).toBe(-1);

  await user.click(radio("Dark"));
  expect(radio("Dark").getAttribute("aria-checked")).toBe("true");
  expect(radio("System").getAttribute("aria-checked")).toBe("false");
  expect(radio("Dark").tabIndex).toBe(0);
  expect(radio("System").tabIndex).toBe(-1);
});

it("moves and selects with arrows, Home and End, skipping disabled options", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Controlled initial="light" variant="card" onChange={onChange} />);
  radio("Light").focus();

  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(radio("Dark"));
  expect(radio("Dark").getAttribute("aria-checked")).toBe("true");

  // The disabled option is skipped and the selection wraps to the first.
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(radio("System"));
  expect(radio("System").getAttribute("aria-checked")).toBe("true");

  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(radio("Dark"));

  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(radio("System"));
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(radio("Dark"));
  expect(onChange.mock.calls.map(([value]) => value)).toEqual([
    "dark",
    "system",
    "dark",
    "system",
    "dark",
  ]);
});

it("explains and ignores a disabled option", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Controlled initial="system" onChange={onChange} />);
  const disabled = radio("High contrast");
  expect(disabled.getAttribute("aria-disabled")).toBe("true");
  const reasonId = disabled.getAttribute("aria-describedby");
  expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
    "Not available in this theme",
  );
  await user.click(disabled);
  expect(onChange).not.toHaveBeenCalled();
  expect(radio("System").getAttribute("aria-describedby")).toBeTruthy();
});

it("selects the focused option with Space", async () => {
  const user = userEvent.setup();
  render(<Controlled />);
  radio("System").focus();
  await user.keyboard(" ");
  expect(radio("System").getAttribute("aria-checked")).toBe("true");
});
