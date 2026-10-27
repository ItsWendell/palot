import { cleanup, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationRecord, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { PermissionPreview } from "./permission-preview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PermissionPreview", () => {
  it("names the scheduled task an agent wants to change", async () => {
    vi.spyOn(palot, "loadAutomations").mockResolvedValue({
      profileID: "p1",
      automations: [{ id: "aut_1", name: "Daily CI check", status: "paused" } as AutomationRecord],
      runs: [],
    });
    const store = createStore();
    store.set(runtimeAtom, { profileID: "p1", connectionID: "c1" } as OpenCodeRuntimeStatus);
    render(
      <Provider store={store}>
        <PermissionPreview
          preview={{ label: "Details", text: "ID: aut_1", truncated: false, automationID: "aut_1" }}
        />
      </Provider>,
    );
    expect(await screen.findByText("“Daily CI check” (paused)")).toBeTruthy();
  });

  it("shows what is being scheduled without expanding the details", () => {
    render(
      <PermissionPreview
        preview={{
          label: "Details",
          text: "Name: Check CI",
          truncated: false,
          subject: "Check CI",
        }}
      />,
    );
    expect(screen.getByText("Check CI")).toBeTruthy();
  });
});
