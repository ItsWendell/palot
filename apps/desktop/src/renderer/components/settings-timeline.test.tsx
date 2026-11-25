import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { sessionProjectionPreferenceAtom } from "../atoms/ui";
import type { SessionProjectionPreference } from "../lib/session-projection-policy";
import { TimelineSettings } from "./settings";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderTimeline(preference?: SessionProjectionPreference) {
  const store = createStore();
  if (preference) store.set(sessionProjectionPreferenceAtom, preference);
  render(
    <Provider store={store}>
      <TimelineSettings />
    </Provider>,
  );
  return { store, user: userEvent.setup() };
}

function advancedTrigger() {
  return screen.getByRole("button", { name: /^Advanced/ });
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  control: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: control }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("Timeline settings", () => {
  it("leads with the timeline style, then reasoning summaries and completed turns", () => {
    renderTimeline();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.slice(0, 3)).toEqual([
      "Timeline style",
      "Reasoning summaries",
      "Completed turns",
    ]);
    const style = screen.getByRole("radiogroup", { name: "Timeline style" });
    const presets = within(style).getAllByRole("radio");
    expect(presets.map((radio) => radio.textContent)).toEqual([
      expect.stringContaining("Focused"),
      expect.stringContaining("Balanced"),
      expect.stringContaining("Detailed"),
    ]);
    expect(
      within(style).getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Hides reasoning and folds a turn's work as soon as the answer starts."),
    ).toBeTruthy();
    expect(
      style.compareDocumentPosition(advancedTrigger()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the fine-tuning closed under Advanced until opened", async () => {
    const { user } = renderTimeline();
    const trigger = advancedTrigger();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).not.toContain("customized");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Edits display" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Keep current activity expanded" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Group titles" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Repeated file reads" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset to preset" })).toBeNull();
  });

  it("counts values that differ from the preset and resets only those", async () => {
    const { store, user } = renderTimeline({
      version: 2,
      preset: "compact",
      showReasoningSummaries: false,
      groupTitle: "latest-reasoning",
      categories: {
        edit: { presentation: "individual" },
        // Matches Balanced, so it is not a customization.
        read: { presentation: "grouped" },
      },
    });
    const trigger = advancedTrigger();
    expect(trigger.textContent).toContain("Advanced · 2 customized");
    await user.click(trigger);
    expect(screen.getByText("2 values differ from Balanced.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reset to preset" }));
    expect(store.get(sessionProjectionPreferenceAtom)).toEqual({
      version: 2,
      preset: "compact",
      showReasoningSummaries: false,
    });
    expect(advancedTrigger().textContent).not.toContain("customized");
    expect(screen.queryByRole("button", { name: "Reset to preset" })).toBeNull();
  });

  it("shows stored overrides and stores changes in the same shape", async () => {
    const { store, user } = renderTimeline({
      version: 2,
      preset: "expanded",
      foldCompletedTurns: true,
      categories: { edit: { presentation: "grouped", details: "expanded" } },
    });
    expect(screen.getByRole("radio", { name: "Detailed" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Completed turns" }).textContent).toContain(
      "Folded",
    );
    expect(
      screen
        .getByRole("switch", { name: "Show reasoning summaries in the timeline" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await user.click(advancedTrigger());
    expect(screen.getByRole("combobox", { name: "Edits display" }).textContent).toContain(
      "Grouped",
    );
    expect(screen.getByRole("combobox", { name: "Edits details" }).textContent).toContain(
      "Expanded",
    );
    expect(screen.getByRole("combobox", { name: "Reads display" }).textContent).toContain(
      "Individual",
    );

    await chooseOption(user, "Commands display", "Hidden when completed");
    expect(store.get(sessionProjectionPreferenceAtom)).toEqual({
      version: 2,
      preset: "expanded",
      foldCompletedTurns: true,
      categories: {
        edit: { presentation: "grouped", details: "expanded" },
        command: { presentation: "hidden" },
      },
    });

    await user.click(screen.getByRole("radio", { name: "Focused" }));
    expect(store.get(sessionProjectionPreferenceAtom)).toEqual({
      version: 2,
      preset: "code-focus",
    });
  });
});
