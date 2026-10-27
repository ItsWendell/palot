import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerDiscovery, type ComposerDiscoveryItem } from "./composer-discovery";

const items: ComposerDiscoveryItem[] = [
  {
    kind: "command",
    key: "command:review",
    name: "review",
    description: "Review current changes",
    detail: "build",
  },
  {
    kind: "skill",
    key: "skill:code-review",
    id: "code-review",
    name: "Code review",
    description: "Review changes against standards and a spec",
  },
  {
    kind: "file",
    key: "file:src/composer.tsx",
    path: "src/composer.tsx",
    name: "composer.tsx",
  },
];

afterEach(cleanup);

describe("ComposerDiscovery", () => {
  it("groups tasks separately from files and shows the task title and project", () => {
    const task: ComposerDiscoveryItem = {
      kind: "task",
      key: "task:1",
      id: "ses_0123456789abcdefghijklmnop",
      name: "Fix hydration",
      description: "Palot",
    };
    const onSelect = vi.fn();
    render(
      <ComposerDiscovery
        id="tasks"
        items={[items[2]!, task]}
        activeIndex={1}
        loading={false}
        error={null}
        onActiveIndexChange={vi.fn()}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("group", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Files" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Fix hydration Palot" }));
    expect(onSelect).toHaveBeenCalledWith(task);
  });

  it("renders type-specific labels and the active option", () => {
    render(
      <ComposerDiscovery
        id="composer-suggestions"
        items={items}
        activeIndex={1}
        loading={false}
        error={null}
        onActiveIndexChange={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByRole("option", { name: /\/review/i }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(
      screen.getByRole("option", { name: /\$code-review/i }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("option", { name: /@composer\.tsx/i })).toBeTruthy();
  });

  it("preserves focus ownership on pointer down and selects on click", () => {
    const onSelect = vi.fn();
    render(
      <ComposerDiscovery
        id="composer-suggestions"
        items={items}
        activeIndex={0}
        loading={false}
        error={null}
        onActiveIndexChange={() => undefined}
        onSelect={onSelect}
      />,
    );

    const option = screen.getByRole("option", { name: /\/review/i });
    const pointerDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(pointerDown);
    fireEvent.click(option);

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
});
