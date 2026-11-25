import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Composer,
  ComposerActions,
  ComposerContextPie,
  ComposerDock,
  ComposerFoldable,
  ComposerFooter,
  ComposerOverflow,
  ComposerOverflowItem,
  ComposerPanel,
  ComposerPill,
  ComposerPillDetail,
  ComposerPillLabel,
  ComposerPrimary,
  ComposerQueue,
  ComposerQueueRow,
  ComposerQueueRowActions,
  ComposerQueueRowText,
  ComposerTab,
  ComposerTabLabel,
  ComposerTabs,
} from "./composer";
import { fitCount, foldedAt, nextFooterLevel, splitVisible } from "./composer/fit";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reducedMotion;
});

/* Layout doubles: happy-dom has no layout, so widths come from `data-test-width`. */

const restorers: (() => void)[] = [];

function stubWidth(
  property: "offsetWidth" | "clientWidth" | "scrollWidth",
  get: (element: HTMLElement) => number | undefined,
) {
  // happy-dom defines some of these on Element, others on HTMLElement.
  let owner: object | null = HTMLElement.prototype;
  while (owner && !Object.getOwnPropertyDescriptor(owner, property))
    owner = Object.getPrototypeOf(owner);
  const original = Object.getOwnPropertyDescriptor(owner!, property)!;
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get(this: HTMLElement) {
      return get(this) ?? original.get!.call(this);
    },
  });
  restorers.push(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
    if (owner === HTMLElement.prototype)
      Object.defineProperty(HTMLElement.prototype, property, original);
  });
}

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
});

describe("fitting rules", () => {
  it("keeps every item when they fit and folds the rest behind the overflow trigger", () => {
    expect(fitCount([100, 100], 300, 4, 44)).toBe(2);
    // 44 (+N) + 4 + 100 + 4 + 100 = 252 fits 300; a third does not.
    expect(fitCount([100, 100, 100, 100], 300, 4, 44)).toBe(2);
    expect(fitCount([500], 300, 4, 44)).toBe(1);
  });

  it("only grows back with a pixel to spare", () => {
    expect(fitCount([100, 100], 204, 4, 44, 1)).toBe(1);
    expect(fitCount([100, 100], 205, 4, 44, 1)).toBe(2);
    expect(fitCount([100, 100], 204, 4, 44, 2)).toBe(2);
  });

  it("keeps the open item visible in the last visible place", () => {
    expect(splitVisible(4, 2, 3)).toEqual({ shown: [0, 3], folded: [1, 2] });
    expect(splitVisible(4, 2, 1)).toEqual({ shown: [0, 1], folded: [2, 3] });
  });

  it("steps the control row up when it overflows and back down once a lower level fits", () => {
    const known = new Map<number, number>();
    expect(nextFooterLevel(0, 3, 500, 400, known)).toBe(1);
    known.set(0, 500);
    expect(nextFooterLevel(1, 3, 380, 400, known)).toBe(1);
    expect(nextFooterLevel(1, 3, 380, 501, known)).toBe(0);
    // A lower level that was never measured is tried once.
    expect(nextFooterLevel(2, 3, 300, 400, new Map([[0, 500]]))).toBe(1);
    expect(nextFooterLevel(3, 3, 900, 400, known)).toBe(3);
  });

  it("folds the lowest priority first, later registrations first among equals", () => {
    const items = [
      { value: "context", priority: 2, order: 0 },
      { value: "voice", priority: 1, order: 1 },
      { value: "stash", priority: 1, order: 2 },
    ];
    expect([...foldedAt(items, 1)]).toEqual([]);
    expect([...foldedAt(items, 2)]).toEqual(["stash"]);
    expect([...foldedAt(items, 3)]).toEqual(["stash", "voice"]);
  });
});

describe("ComposerPanel", () => {
  function Slot({ open, slot }: { open: boolean; slot: "plan" | "goal" }) {
    return (
      <ComposerDock>
        <Composer>
          <ComposerPanel open={open} aria-label="Panel">
            {slot === "plan" ? <p key="plan">Plan steps</p> : <p key="goal">Goal objective</p>}
          </ComposerPanel>
        </Composer>
      </ComposerDock>
    );
  }

  it("has its content in the DOM on the first render after opening", () => {
    const { rerender } = render(<Slot open={false} slot="plan" />);
    expect(screen.queryByText("Plan steps")).toBeNull();
    rerender(<Slot open slot="plan" />);
    expect(screen.getByText("Plan steps")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Panel" }).getAttribute("data-state")).toBe("open");
  });

  it("swaps content without closing the panel", async () => {
    const { rerender } = render(<Slot open slot="plan" />);
    const panel = screen.getByRole("region", { name: "Panel" });
    rerender(<Slot open slot="goal" />);
    // The new content is there at once and the panel itself never left.
    expect(screen.getByText("Goal objective")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Panel" })).toBe(panel);
    expect(panel.getAttribute("data-state")).toBe("open");
    await waitFor(() => expect(screen.queryByText("Plan steps")).toBeNull());
  });

  it("closes, keeping its last content while it leaves and taking no input", async () => {
    const { rerender } = render(<Slot open slot="plan" />);
    rerender(<Slot open={false} slot="plan" />);
    const leaving = screen.queryByText("Plan steps")?.closest("[data-slot=composer-panel]");
    if (leaving) {
      expect(leaving.getAttribute("data-state")).toBe("closed");
      expect(leaving.hasAttribute("inert")).toBe(true);
    }
    await waitFor(() => expect(screen.queryByText("Plan steps")).toBeNull());
  });

  it("works uncontrolled and closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(
      <Composer>
        <ComposerPanel defaultOpen onOpenChange={onOpenChange} aria-label="Panel">
          <button type="button">Inside</button>
        </ComposerPanel>
      </Composer>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Inside" })).toBeNull());
  });

  it("under reduced motion still shows content on the first frame and leaves at once", async () => {
    document.documentElement.dataset.reducedMotion = "true";
    const { rerender } = render(<Slot open={false} slot="plan" />);
    rerender(<Slot open slot="plan" />);
    expect(screen.getByText("Plan steps")).toBeTruthy();
    rerender(<Slot open={false} slot="plan" />);
    await waitFor(() => expect(screen.queryByText("Plan steps")).toBeNull());
  });
});

describe("ComposerTabs", () => {
  beforeEach(() => {
    // Every tab is 100px wide at its natural size; the row has 300px.
    stubWidth("offsetWidth", (element) =>
      element.parentElement?.dataset.slot === "composer-tabs-measure" ? 100 : undefined,
    );
    stubWidth("clientWidth", (element) =>
      element.dataset.slot === "composer-tabs" ? 300 : undefined,
    );
  });

  function Tabs({ initial = null }: { initial?: string | null }) {
    const [value, setValue] = useState<string | null>(initial);
    return (
      <ComposerDock>
        <ComposerTabs value={value} onValueChange={setValue}>
          {["Plan", "Background", "Undo", "Goal"].map((label) => (
            <ComposerTab key={label} value={label.toLowerCase()}>
              <ComposerTabLabel>{label}</ComposerTabLabel>
            </ComposerTab>
          ))}
        </ComposerTabs>
        <p>Open: {value ?? "none"}</p>
      </ComposerDock>
    );
  }

  it("folds tabs that do not fit into +N and keeps the open tab visible", async () => {
    const user = userEvent.setup();
    render(<Tabs initial="goal" />);
    const toolbar = screen.getByRole("toolbar", { name: "Task context" });
    const visible = Array.from(toolbar.querySelectorAll(":scope > button[data-slot=composer-tab]"));
    expect(visible.map((tab) => tab.textContent)).toEqual(["Plan", "Goal"]);
    expect(screen.getByRole("button", { name: "Goal" }).getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "2 more" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Background", "Undo"]);
    await user.click(items[1]!);
    expect(screen.getByText("Open: undo")).toBeTruthy();
  });

  it("toggles: pressing the open tab closes it", async () => {
    const user = userEvent.setup();
    render(<Tabs initial="plan" />);
    await user.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByText("Open: none")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("points the open tab at the dock's panel slot", () => {
    render(
      <ComposerDock>
        <ComposerTabs defaultValue="plan">
          <ComposerTab value="plan">Plan</ComposerTab>
        </ComposerTabs>
        <Composer>
          <ComposerPanel open aria-label="Plan">
            <p>Steps</p>
          </ComposerPanel>
        </Composer>
      </ComposerDock>,
    );
    const controls = screen.getByRole("button", { name: "Plan" }).getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)?.textContent).toBe("Steps");
  });

  it("stays visible but unusable while a request owns the panel", () => {
    render(
      <ComposerTabs value="plan" inactive>
        <ComposerTab value="plan">Plan</ComposerTab>
      </ComposerTabs>,
    );
    const tab = screen.getByRole("button", { name: "Plan" });
    expect((tab as HTMLButtonElement).disabled).toBe(true);
    expect(tab.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ComposerFooter", () => {
  let available = 1000;
  const WIDTHS: Record<string, [full: number, compact: number]> = {
    plus: [28, 28],
    agent: [80, 40],
    model: [200, 120],
    context: [60, 60],
    voice: [28, 28],
    more: [28, 28],
    send: [70, 70],
  };

  function widthOf(element: HTMLElement): number {
    if (element.classList.contains("hidden")) return 0;
    const id = element.dataset.testId;
    const compact = element.closest("[data-slot=composer-footer]")?.hasAttribute("data-compact");
    if (id && WIDTHS[id]) return WIDTHS[id]![compact ? 1 : 0];
    if (element.dataset.slot === "composer-foldable" || element.dataset.slot === "composer-actions")
      return Array.from(element.children, (child) => widthOf(child as HTMLElement)).reduce(
        (sum, width) => sum + width,
        0,
      );
    return 0;
  }

  beforeEach(() => {
    available = 1000;
    stubWidth("scrollWidth", (element) =>
      element.dataset.slot === "composer-actions" ? widthOf(element) : undefined,
    );
    stubWidth("clientWidth", (element) =>
      element.dataset.slot === "composer-footer" ? available : undefined,
    );
  });

  function Row({ width }: { width: number }) {
    return (
      <ComposerFooter data-width={width}>
        <ComposerActions align="start">
          <button type="button" data-test-id="plus" aria-label="Add" />
          <ComposerPill compact="icon" data-test-id="agent" aria-label="Agent: Build">
            <ComposerPillLabel>Build</ComposerPillLabel>
          </ComposerPill>
        </ComposerActions>
        <ComposerActions align="end">
          <ComposerPill data-test-id="model" aria-label="Model">
            <ComposerPillLabel>Claude Sonnet 4.6</ComposerPillLabel>
            <ComposerPillDetail>High</ComposerPillDetail>
          </ComposerPill>
          <ComposerFoldable value="context" priority={2}>
            <ComposerContextPie value={0.4} data-test-id="context" />
          </ComposerFoldable>
          <ComposerFoldable value="voice" priority={1}>
            <button type="button" data-test-id="voice" aria-label="Start voice call" />
          </ComposerFoldable>
          <ComposerOverflow data-test-id="more">
            <ComposerOverflowItem value="context">Context 40% full</ComposerOverflowItem>
            <ComposerOverflowItem value="voice">Start voice call</ComposerOverflowItem>
          </ComposerOverflow>
          <ComposerPrimary kind="send" label="Send" data-test-id="send" />
        </ComposerActions>
      </ComposerFooter>
    );
  }

  function layout(width: number, rerender?: (ui: ReactNode) => void) {
    available = width;
    if (rerender) rerender(<Row width={width} />);
    else return render(<Row width={width} />);
  }

  const footer = () => document.querySelector<HTMLElement>("[data-slot=composer-footer]")!;
  const shown = (name: string) =>
    !screen
      .getByRole("button", { name })
      .closest("[data-slot=composer-foldable]")
      ?.hasAttribute("data-folded");

  it("shows everything with labels when the row has room", () => {
    layout(1000);
    expect(footer().hasAttribute("data-compact")).toBe(false);
    expect(shown("Start voice call")).toBe(true);
    expect(screen.queryByRole("button", { name: "More controls" })).toBeNull();
  });

  it("drops labels first, then folds the lowest priority, then the next", async () => {
    // Full: 28+80 + 200+60+28+70 = 466 (+ gaps of 0). Compact: 28+40 + 120+60+28+70 = 346.
    const { rerender } = layout(400)!;
    expect(footer().hasAttribute("data-compact")).toBe(true);
    expect(shown("Start voice call")).toBe(true);

    // Compact needs 346; folding voice and adding "…" needs 346 - 28 + 28 = 346 too, so 340
    // folds both: 346 - 28 - 60 + 28 = 286.
    layout(340, rerender);
    expect(shown("Start voice call")).toBe(false);
    expect(shown("Context window 40% full")).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More controls" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Context 40% full", "Start voice call"]);
  });

  it("folds only what it must and grows back when room returns", () => {
    // Folding voice alone: 346 - 28 + 28 = 346 > 345, so it folds the context pie too.
    // At 350 the compact row fits without folding.
    const { rerender } = layout(350)!;
    expect(footer().hasAttribute("data-compact")).toBe(true);
    expect(shown("Start voice call")).toBe(true);
    layout(300, rerender);
    expect(shown("Start voice call")).toBe(false);
    layout(1000, rerender);
    expect(footer().hasAttribute("data-compact")).toBe(false);
    expect(shown("Start voice call")).toBe(true);
    expect(shown("Context window 40% full")).toBe(true);
  });
});

describe("ComposerQueueRow", () => {
  it("is one tab stop whose actions are reachable with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <ComposerQueue>
        <ComposerQueueRow aria-label="Queued: Run the typecheck">
          <ComposerQueueRowText>Run the typecheck</ComposerQueueRowText>
          <ComposerQueueRowActions>
            <button type="button">Steer now</button>
            <button type="button">Remove queued message</button>
          </ComposerQueueRowActions>
        </ComposerQueueRow>
      </ComposerQueue>,
    );
    const row = screen.getByRole("group", { name: "Queued: Run the typecheck" });
    expect(screen.getByRole("region", { name: "Queued messages" })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(row);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Steer now" }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove queued message" }),
    );
    await user.keyboard("{ArrowRight}{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(row);
  });
});

describe("ComposerPrimary", () => {
  it("is an icon named by its label for send and stop, and labelled otherwise", () => {
    const { rerender } = render(<ComposerPrimary kind="send" label="Send" />);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button.getAttribute("data-kind")).toBe("send");
    expect(button.textContent).toBe("");
    rerender(<ComposerPrimary kind="steer" label="Steer" shortcut={["Enter"]} busy />);
    const steer = screen.getByRole("button", { name: /Steer/ });
    expect(steer.textContent).toContain("Steer");
    expect(steer.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(steer.getAttribute("aria-busy")).toBe("true");
  });

  it("previews the alternate while Mod is held", () => {
    vi.useFakeTimers();
    try {
      render(
        <ComposerPrimary
          kind="steer"
          label="Steer"
          preview={{ kind: "queue", label: "Queue", shortcut: ["Mod", "Enter"] }}
        />,
      );
      const button = screen.getByRole("button");
      const mod = navigator.platform.startsWith("Mac") ? "Meta" : "Control";
      fireEvent.keyDown(window, { key: mod });
      act(() => vi.advanceTimersByTime(160));
      expect(button.getAttribute("data-kind")).toBe("queue");
      expect(button.textContent).toContain("Queue");
      fireEvent.keyUp(window, { key: mod });
      expect(button.getAttribute("data-kind")).toBe("steer");

      // Mod as part of a shortcut (Mod+K) is not a hold.
      fireEvent.keyDown(window, { key: mod });
      fireEvent.keyDown(window, { key: "k" });
      act(() => vi.advanceTimersByTime(300));
      expect(button.getAttribute("data-kind")).toBe("steer");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ComposerContextPie", () => {
  it("says how full the window is and shows the percentage from 70%", () => {
    const { rerender } = render(<ComposerContextPie value={0.5} />);
    expect(screen.getByRole("button", { name: "Context window 50% full" }).textContent).toBe("");
    rerender(<ComposerContextPie value={0.72} />);
    expect(screen.getByRole("button", { name: "Context window 72% full" }).textContent).toBe("72%");
    rerender(<ComposerContextPie value={0.93} />);
    expect(screen.getByRole("button").getAttribute("data-tone")).toBe("warning");
  });
});

describe("Composer", () => {
  it("exposes its mode and states as data attributes and renders as another element", () => {
    render(
      <Composer mode="shell" disabled dragOver render={<form aria-label="Composer" />}>
        <p>Field</p>
      </Composer>,
    );
    const card = screen.getByRole("form", { name: "Composer" });
    expect(card.getAttribute("data-mode")).toBe("shell");
    expect(card.hasAttribute("data-disabled")).toBe(true);
    expect(card.hasAttribute("data-drag-over")).toBe(true);
    expect(card.getAttribute("data-slot")).toBe("composer");
  });
});
