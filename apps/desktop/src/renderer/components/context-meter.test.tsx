import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextUsage } from "../lib/context-usage";
import { ContextMeter, type ContextMeterProps } from "./context-meter";

function usage(percentage: number, overrides: Partial<ContextUsage> = {}): ContextUsage {
  const total = percentage * 10_000;
  return {
    total,
    limit: 1_000_000,
    percentage,
    breakdown: { cached: total - 10_000, uncached: 8_000, output: 2_000 },
    messageID: "step",
    model: { id: "model", providerID: "provider" },
    updatedAt: Date.now(),
    compacted: false,
    ...overrides,
  };
}

function renderMeter(props: Partial<ContextMeterProps> = {}) {
  const onCompact = vi.fn();
  const onOpenDetails = vi.fn();
  render(
    <ContextMeter
      usage={usage(45)}
      sessionTokens={{
        input: 2,
        output: 3_000,
        reasoning: 0,
        cache: { read: 2_400_000, write: 0 },
      }}
      cost={1.2345}
      lastCompactedAt={null}
      compacting={false}
      compactDisabledReason={null}
      onCompact={onCompact}
      onOpenDetails={onOpenDetails}
      {...props}
    />,
  );
  return { onCompact, onOpenDetails };
}

beforeEach(() => {
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(cleanup);

describe("ContextMeter", () => {
  it.each([
    [45, "normal", "Context window: 45% used (55% left)"],
    [70, "warning", "Context window: 70% full"],
    [93, "critical", "Context window: 93% full"],
  ])("names the ring and colors it by threshold at %i%%", (percentage, status, name) => {
    renderMeter({ usage: usage(percentage) });
    expect(screen.getByRole("button", { name }).getAttribute("data-status")).toBe(status);
  });

  it.each([
    ["a paid model before usage", { usage: null, cost: 0 }, "0·$0.00"],
    ["a paid model", { cost: 4.55 }, "450k·$4.55"],
    ["a free model", { cost: 0, freeModel: true }, "450k"],
    ["earlier paid spend on a free model", { cost: 1.25, freeModel: true }, "450k·$1.25"],
    ["unknown cost", { cost: null }, "450k"],
  ] satisfies [string, Partial<ContextMeterProps>, string][])(
    "shows compact tokens and cost beside the ring for %s",
    (_, props, text) => {
      renderMeter(props);
      const trigger = screen.getByRole("button", { name: /^Context window/ });
      expect(trigger.textContent).toBe(text);
    },
  );

  it("opens a summary with the window, cost, and total processed on press", async () => {
    renderMeter({ lastCompactedAt: Date.now() - 2 * 3_600_000 });
    await userEvent.click(screen.getByRole("button", { name: /^Context window/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Context window: 45% used (55% left)")).toBeTruthy();
    expect(within(dialog).getByText("450k / 1M tokens used")).toBeTruthy();
    expect(within(dialog).getByRole("meter", { name: "Context window usage" })).toBeTruthy();
    expect(within(dialog).getByText("$1.23")).toBeTruthy();
    expect(within(dialog).getByText("2.4M tokens")).toBeTruthy();
    expect(within(dialog).getByText("2h ago")).toBeTruthy();
  });

  it("compacts and opens details from the popover", async () => {
    const { onCompact, onOpenDetails } = renderMeter();
    await userEvent.click(screen.getByRole("button", { name: /^Context window/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Compact now" }));
    expect(onCompact).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /^Context window/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Context details" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });

  it("disables Compact now with the reason while work is running", async () => {
    const { onCompact } = renderMeter({
      compactDisabledReason: "Wait for the current turn to finish.",
    });
    await userEvent.click(screen.getByRole("button", { name: /^Context window/ }));
    const compact = await screen.findByRole("button", { name: "Compact now" });
    expect((compact as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Wait for the current turn to finish.")).toBeTruthy();
    expect(compact.getAttribute("aria-describedby")).toBeTruthy();
    expect(onCompact).not.toHaveBeenCalled();
  });

  it("says the window is pending after a compaction", async () => {
    renderMeter({ usage: usage(80, { compacted: true }) });
    const trigger = screen.getByRole("button", { name: "Context window: compacted" });
    expect(trigger.getAttribute("data-status")).toBe("unavailable");
    await userEvent.click(trigger);
    expect(
      await screen.findByText("Context compacted. Usage updates after the next reply."),
    ).toBeTruthy();
  });
});
