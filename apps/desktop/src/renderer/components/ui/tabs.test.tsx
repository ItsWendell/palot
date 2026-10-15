import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

function renderTabs(variant: "default" | "line" | "subtle", onValueChange = vi.fn()) {
  render(
    <Tabs defaultValue="files" onValueChange={onValueChange}>
      <TabsList variant={variant} aria-label="Surfaces">
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="changes">Changes</TabsTrigger>
        <TabsTrigger value="terminal">Terminal</TabsTrigger>
      </TabsList>
      <TabsContent value="files">Files panel</TabsContent>
      <TabsContent value="changes">Changes panel</TabsContent>
      <TabsContent value="terminal">Terminal panel</TabsContent>
    </Tabs>,
  );
  return onValueChange;
}

it("subtle tabs keep tab semantics and select by pointer and keyboard", async () => {
  const user = userEvent.setup();
  const onValueChange = renderTabs("subtle");
  const list = screen.getByRole("tablist", { name: "Surfaces" });
  expect(list.getAttribute("data-variant")).toBe("subtle");
  expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");

  await user.click(screen.getByRole("tab", { name: "Changes" }));
  expect(onValueChange).toHaveBeenLastCalledWith("changes", expect.anything());
  expect(screen.getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("Changes panel");

  await user.keyboard("{ArrowRight}");
  const terminal = screen.getByRole("tab", { name: "Terminal" });
  expect(document.activeElement).toBe(terminal);
  // The hover pill follows keyboard focus along the strip.
  await waitFor(() => expect(list.getAttribute("data-fluid-hover-active-index")).toBe("2"));
  await user.keyboard("{Enter}");
  expect(terminal.getAttribute("aria-selected")).toBe("true");
});

it("subtle tabs register every tab as a fluid row and leave other variants alone", async () => {
  renderTabs("subtle");
  const tabs = screen.getAllByRole("tab");
  await waitFor(() => expect(tabs.every((tab) => tab.hasAttribute("data-fluid-item"))).toBe(true));
  cleanup();

  renderTabs("line");
  expect(screen.getByRole("tablist").getAttribute("data-variant")).toBe("line");
  expect(screen.getAllByRole("tab").some((tab) => tab.hasAttribute("data-fluid-item"))).toBe(false);
});

it("subtle tabs watch each tab's border box so padding-only growth moves the pill", async () => {
  // An active workbench tab grows through padding (room for its close button). The default
  // content-box observation never fires for that, which left the pill one selection behind.
  const observed: Array<ResizeObserverOptions | undefined> = [];
  const Original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(_target: Element, options?: ResizeObserverOptions) {
      observed.push(options);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    renderTabs("subtle");
    const tabs = screen.getAllByRole("tab");
    await waitFor(() =>
      expect(tabs.every((tab) => tab.hasAttribute("data-fluid-item"))).toBe(true),
    );
    expect(
      observed.filter((options) => options?.box === "border-box").length,
    ).toBeGreaterThanOrEqual(tabs.length);
  } finally {
    globalThis.ResizeObserver = Original;
  }
});
