import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationOpenAtom } from "../atoms/ui";
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
  it("returns from Settings to the workspace when Tasks is chosen", async () => {
    const store = createStore();
    store.set(navigationOpenAtom, false);
    const { router } = renderWithRouter(<NavigationRail />, store, "/settings/general");

    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe(
      "page",
    );
    // Outside the workspace no column is visible, so Tasks does not read as pressed.
    expect(screen.getByRole("button", { name: "Show tasks" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    await userEvent.click(screen.getByRole("button", { name: "Show tasks" }));

    expect(store.get(navigationOpenAtom)).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/new"));
    expect(screen.getByRole("button", { name: "Show tasks" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("opens a hidden task column and hides it again", async () => {
    const store = createStore();
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

    const tasks = () => screen.getByRole("button", { name: "Show tasks" });
    expect(tasks().getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(tasks());
    expect(changes).toEqual([true]);
    expect(tasks().getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(tasks());
    expect(changes).toEqual([true, false]);
    expect(tasks().getAttribute("aria-pressed")).toBe("false");
  });
});
