import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationOpenAtom, sidebarModeAtom } from "../atoms/ui";
import { renderWithRouter } from "../test-utils/render-with-router";
import { NavigationRail } from "./navigation-rail";

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NavigationRail", () => {
  it("returns from Settings to the workspace when a column view is chosen", async () => {
    const store = createStore();
    store.set(sidebarModeAtom, "inbox");
    const { router } = renderWithRouter(<NavigationRail />, store, "/settings/general");

    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe(
      "page",
    );
    // Outside the workspace no column is visible, so neither view reads as pressed.
    expect(screen.getByRole("button", { name: "Show inbox" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    await userEvent.click(screen.getByRole("button", { name: "Show projects" }));

    expect(store.get(sidebarModeAtom)).toBe("project");
    expect(store.get(navigationOpenAtom)).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/new"));
    expect(screen.getByRole("button", { name: "Show projects" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("opens a hidden task column and toggles the active view's column", async () => {
    const store = createStore();
    store.set(sidebarModeAtom, "inbox");
    const changes: boolean[] = [];
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <NavigationRail
          navigationOpen={open}
          onNavigationOpenChange={(next) => {
            changes.push(next);
            setOpen(next);
          }}
        />
      );
    }
    renderWithRouter(<Harness />, store, "/new");

    // A hidden column reads as no view selected; choosing one opens it in that view.
    expect(screen.getByRole("button", { name: "Show inbox" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show projects" }));
    expect(store.get(sidebarModeAtom)).toBe("project");
    expect(changes).toEqual([true]);
    expect(screen.getByRole("button", { name: "Show projects" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    // Another view switches content without closing the column.
    await userEvent.click(screen.getByRole("button", { name: "Show inbox" }));
    expect(store.get(sidebarModeAtom)).toBe("inbox");
    expect(changes).toEqual([true]);

    // The active view closes the column again.
    await userEvent.click(screen.getByRole("button", { name: "Show inbox" }));
    expect(changes).toEqual([true, false]);
    expect(screen.getByRole("button", { name: "Show inbox" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
