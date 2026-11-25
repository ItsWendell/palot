import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFocusRegions } from "./use-focus-regions";

const layout = `
  <nav data-focus-region="sidebar" aria-label="Inbox navigation">
    <div data-sidebar-fluid-row><button>First task</button></div>
    <div data-sidebar-fluid-row><button aria-current="page">Open task</button></div>
  </nav>
  <main aria-label="Current task">
    <div data-focus-region="transcript" role="region" aria-label="Task transcript" tabindex="0">
      <button>Copy</button>
    </div>
    <div data-focus-region="composer">
      <button>Attach files</button>
      <textarea aria-label="Message Palot"></textarea>
    </div>
  </main>
  <section data-focus-region="workbench" aria-label="Right workbench">
    <div role="tablist"><button role="tab" aria-selected="true">Terminal</button></div>
    <div role="tabpanel" tabindex="0"><textarea aria-label="Terminal input"></textarea></div>
  </section>
`;

function press(shift = false) {
  const event = new KeyboardEvent("keydown", {
    key: "F6",
    code: "F6",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

function focused() {
  const active = document.activeElement as HTMLElement | null;
  return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? active?.tagName;
}

const get = (selector: string) => document.querySelector<HTMLElement>(selector)!;

beforeEach(() => {
  document.body.innerHTML = layout;
  renderHook(() => useFocusRegions());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useFocusRegions", () => {
  it("moves through the regions in order, wrapping both ways", () => {
    expect(press().defaultPrevented).toBe(true);
    expect(focused()).toBe("Open task");
    press();
    expect(focused()).toBe("Task transcript");
    press();
    expect(focused()).toBe("Message Palot");
    press();
    expect(document.activeElement?.getAttribute("role")).toBe("tabpanel");
    press();
    expect(focused()).toBe("Open task");
    press(true);
    expect(document.activeElement?.getAttribute("role")).toBe("tabpanel");
  });

  it("returns to the element last focused in a region", () => {
    get("[data-sidebar-fluid-row] button").focus();
    press();
    expect(focused()).toBe("Task transcript");
    press(true);
    expect(focused()).toBe("First task");
  });

  it("leaves a terminal that keeps the key for itself", () => {
    const terminal = get('[aria-label="Terminal input"]');
    let terminalSaw = false;
    terminal.addEventListener("keydown", (event) => {
      terminalSaw = true;
      event.stopPropagation();
    });
    terminal.focus();
    press();
    expect(focused()).toBe("Open task");
    expect(terminalSaw).toBe(false);
  });

  it("skips regions that are inert or hidden", () => {
    get('[data-focus-region="workbench"]').setAttribute("inert", "");
    get('[data-focus-region="transcript"]').setAttribute("aria-hidden", "true");
    get('[aria-label="Message Palot"]').focus();
    press();
    expect(focused()).toBe("Open task");
    press();
    expect(focused()).toBe("Message Palot");
  });

  it("does nothing while a modal dialog is open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.dataset.slot = "dialog-content";
    document.body.append(dialog);
    get('[aria-label="Message Palot"]').focus();
    expect(press().defaultPrevented).toBe(false);
    expect(focused()).toBe("Message Palot");
  });
});
