import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadHeaderInsets } from "./use-thread-header-insets";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Header() {
  const ref = useThreadHeaderInsets();
  return <header ref={ref}>Task title</header>;
}

function fixture() {
  const workspace = document.createElement("div");
  workspace.dataset.palotWorkspace = "";
  workspace.innerHTML = `
    <div class="window-chrome-cluster"></div>
    <div class="window-trailing-controls"></div>
    <div data-shell-panel="navigation"></div>
    <div data-shell-panel="center"></div>`;
  document.body.append(workspace);
  const center = workspace.querySelector<HTMLElement>('[data-shell-panel="center"]')!;
  const geometry = { left: 300, right: 1440, chromeRight: 92, trailingLeft: 1350 };
  vi.spyOn(center, "getBoundingClientRect").mockImplementation(
    () => ({ left: geometry.left, right: geometry.right }) as DOMRect,
  );
  vi.spyOn(
    workspace.querySelector(".window-chrome-cluster")!,
    "getBoundingClientRect",
  ).mockImplementation(() => ({ right: geometry.chromeRight }) as DOMRect);
  vi.spyOn(
    workspace.querySelector(".window-trailing-controls")!,
    "getBoundingClientRect",
  ).mockImplementation(() => ({ left: geometry.trailingLeft }) as DOMRect);
  let notify: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  return { workspace, center, geometry, disconnect, resize: () => act(() => notify()) };
}

it("tracks physical control overlap and skips unchanged writes", () => {
  const { workspace, center, geometry, resize } = fixture();
  render(<Header />, { container: center });
  const header = screen.getByRole("banner");
  const leading = () => header.style.getPropertyValue("--thread-header-leading-inset");
  const trailing = () => header.style.getPropertyValue("--thread-header-trailing-inset");
  expect([leading(), trailing()]).toEqual(["18px", "102px"]);
  expect(workspace.style.length).toBe(0);
  const writes = vi.spyOn(header.style, "setProperty");
  resize();
  expect(writes).not.toHaveBeenCalled();
  geometry.left = 44;
  geometry.right = 1000;
  resize();
  expect([leading(), trailing()]).toEqual(["60px", "12px"]);
  expect(writes).toHaveBeenCalledTimes(2);
  // macOS's traffic lights move the chrome cluster right; use its actual rect.
  geometry.chromeRight = 170;
  resize();
  expect(leading()).toBe("138px");
  expect(writes).toHaveBeenCalledTimes(3);
});

it("initializes a conditionally mounted header and releases its observer on replacement", () => {
  const { center, geometry, disconnect } = fixture();
  const view = render(<div />, { container: center });
  view.rerender(<Header />);
  expect(screen.getByRole("banner").style.getPropertyValue("--thread-header-leading-inset")).toBe(
    "18px",
  );
  view.rerender(<div />);
  expect(disconnect).toHaveBeenCalledOnce();
  geometry.left = 44;
  view.rerender(<Header />);
  expect(screen.getByRole("banner").style.getPropertyValue("--thread-header-leading-inset")).toBe(
    "60px",
  );
});

it("leaves standalone headers on their CSS fallbacks", () => {
  render(<Header />);
  expect(screen.getByRole("banner").style.length).toBe(0);
});
