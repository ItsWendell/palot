import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { phaseAtom, runtimeAtom } from "../atoms/workspace";
import { renderWithRouter } from "../test-utils/render-with-router";
import { Workspace } from "./workspace";
import { palot } from "../services/palot";
import type { AutomationNotificationTarget, OpenCodeRuntimeStatus } from "../../shared";

// This suite verifies pane ownership; native E2E covers ScrollArea layout and animations.
vi.mock("./ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children?: import("react").ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");

  return {
    Group: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Panel: ({
      children,
      id,
      panelRef,
    }: {
      children?: React.ReactNode;
      id: string;
      panelRef?: React.MutableRefObject<unknown>;
    }) => {
      const elementRef = React.useRef<HTMLDivElement>(null);
      React.useLayoutEffect(() => {
        if (!panelRef) return;
        panelRef.current = {
          collapse: () => elementRef.current?.setAttribute("data-collapsed", "true"),
          expand: () => elementRef.current?.setAttribute("data-collapsed", "false"),
          getSize: () => ({ inPixels: 0 }),
        };
        return () => {
          panelRef.current = null;
        };
      }, [panelRef]);
      return (
        <div ref={elementRef} data-collapsed="false" data-testid={`${id}-panel`}>
          {children}
        </div>
      );
    },
    Separator: () => <div />,
    usePanelRef: () => React.useRef(null),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Workspace pane visibility", () => {
  it.each(["schedule", "request"] as const)(
    "routes an automation %s notification to its owner instead of the selected server",
    async (kind) => {
      const store = createStore();
      store.set(runtimeAtom, {
        profileID: "selected",
        connectionID: "selected",
        connected: true,
      } as OpenCodeRuntimeStatus);
      vi.spyOn(palot, "takeAutomationNotificationTarget").mockResolvedValue(null);
      let listener!: (target: AutomationNotificationTarget) => void;
      vi.spyOn(palot, "onAutomationNotificationOpened").mockImplementation((callback) => {
        listener = callback;
        return () => {};
      });
      const { router } = renderWithRouter(<Workspace content={null} />, store);
      const navigate = vi.spyOn(router, "navigate").mockResolvedValue();
      act(() =>
        listener({
          profileID: "owner",
          automationID: "automation",
          runID: "run",
          sessionID: "session",
          requestID: kind === "request" ? "request" : null,
          requestType: kind === "request" ? "permission" : null,
        }),
      );
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          search: expect.objectContaining({
            profileID: "owner",
            ...(kind === "request"
              ? { requestID: "request" }
              : { automationID: "automation", runID: "run" }),
          }),
        }),
      );
    },
  );
  it("collapses closed workbench panes when panels mount after loading", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const store = createStore();
    renderWithRouter(<Workspace content={null} />, store);

    expect(screen.getByLabelText("Loading Palot")).toBeTruthy();
    expect(screen.getByText("Palot", { exact: true })).toBeTruthy();
    expect(screen.getByText("Preparing your workspace")).toBeTruthy();

    act(() => store.set(phaseAtom, "ready"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hide navigation" }).querySelector("svg")).not.toBe(
        null,
      );
      expect(screen.getByRole("button", { name: "Show projects" }).querySelector("svg")).not.toBe(
        null,
      );
      expect(screen.getByTestId("right-workbench-panel").getAttribute("data-collapsed")).toBe(
        "true",
      );
      expect(screen.getByTestId("bottom-workbench-panel").getAttribute("data-collapsed")).toBe(
        "true",
      );
    });
  });

  it("describes service startup without showing fake progress", () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "local-default",
      contractVersion: "test",
      phase: "starting",
      connected: false,
      binaryPath: null,
      version: "test",
      pid: null,
      managed: true,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    });
    renderWithRouter(<Workspace content={null} />, store);
    expect(screen.getByRole("status", { name: "Loading Palot" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.getByText("Starting OpenCode")).toBeTruthy();
  });
});
