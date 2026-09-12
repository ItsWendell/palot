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
