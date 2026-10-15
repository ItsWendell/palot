import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CheckList, type CheckListOption } from "./check-list";

afterEach(cleanup);

type Tool = "read" | "edit" | "bash" | "web";

const options: CheckListOption<Tool>[] = [
  { value: "read", label: "Read files", description: "Open files in the project" },
  { value: "edit", label: "Edit files" },
  { value: "bash", label: "Run commands" },
  { value: "web", label: "Fetch the web", disabled: true, disabledReason: "Blocked by policy" },
];

function Controlled({ initial }: { initial: ReadonlySet<Tool> | Tool[] }) {
  const [value, setValue] = useState<ReadonlySet<Tool> | Tool[]>(initial);
  return (
    <CheckList
      aria-label="Tools"
      options={options}
      value={value}
      onValueChange={setValue}
      selectAll
    />
  );
}

const box = (name: string) => screen.getByRole("checkbox", { name });

it("toggles by value and reports values in option order", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  render(
    <CheckList
      aria-label="Tools"
      options={options}
      value={new Set<Tool>(["bash", "web"])}
      onValueChange={onValueChange}
    />,
  );
  expect(box("Run commands").getAttribute("aria-checked")).toBe("true");
  await user.click(box("Read files"));
  expect(onValueChange).toHaveBeenLastCalledWith(["read", "bash", "web"]);
  await user.click(box("Run commands"));
  expect(onValueChange).toHaveBeenLastCalledWith(["web"]);
  await user.click(box("Fetch the web"));
  expect(onValueChange).toHaveBeenCalledTimes(2);
});

it("moves focus with arrows and toggles with Space", async () => {
  const user = userEvent.setup();
  render(<Controlled initial={[]} />);
  box("Read files").focus();
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(box("Edit files"));
  await user.keyboard(" ");
  expect(box("Edit files").getAttribute("aria-checked")).toBe("true");
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(box("Select all"));
});

it("selects all enabled options, then clears them, keeping disabled values", async () => {
  const user = userEvent.setup();
  render(<Controlled initial={["web", "read"]} />);
  const all = box("Select all");
  expect(all.getAttribute("aria-checked")).toBe("mixed");
  await user.click(all);
  expect(all.getAttribute("aria-checked")).toBe("true");
  expect(box("Edit files").getAttribute("aria-checked")).toBe("true");
  await user.click(all);
  expect(all.getAttribute("aria-checked")).toBe("false");
  expect(box("Read files").getAttribute("aria-checked")).toBe("false");
  expect(box("Fetch the web").getAttribute("aria-checked")).toBe("true");
});
