import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TranscriptPromptAnchor } from "../lib/transcript-outline";
import { TranscriptRail, type TranscriptRailProps } from "./transcript-rail";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function prompts(count: number, offset = 0): TranscriptPromptAnchor[] {
  return Array.from({ length: count }, (_, index) => ({
    messageID: `message-${offset + index}`,
    turnID: `turn-${offset + index}`,
    rowIndex: offset + index,
    label: `Prompt ${offset + index}`,
  }));
}

function setup(overrides: Partial<TranscriptRailProps> = {}) {
  const props: TranscriptRailProps = {
    prompts: prompts(20),
    activeMessageID: "message-0",
    height: 100,
    onSelect: vi.fn(),
    earlier: { available: false, loading: false, load: vi.fn(async () => true) },
    ...overrides,
  };
  return { ...render(<TranscriptRail {...props} />), props };
}

it.each([false, true])(
  "selects pointer targets and browses with one stable keyboard tab stop (compact=%s)",
  (compact) => {
    const { props } = setup({ compact });
    fireEvent.click(screen.getByRole("option", { name: "Prompt 2" }));
    expect(props.onSelect).toHaveBeenLastCalledWith("message-2");
    const list = screen.getByRole("listbox");
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(props.onSelect).toHaveBeenLastCalledWith("message-3");
    fireEvent.keyDown(list, { key: "End" });
    const descendant = document.getElementById(list.getAttribute("aria-activedescendant")!);
    expect(descendant?.getAttribute("aria-label")).toBe("Prompt 19");
    fireEvent.keyDown(list, { key: " " });
    expect(props.onSelect).toHaveBeenLastCalledWith("message-19");
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(props.onSelect).toHaveBeenLastCalledWith("message-0");
    expect(screen.getAllByRole("option").every((option) => option.tabIndex === -1)).toBe(true);
  },
);

it.each([false, true])(
  "keeps two thousand markers bounded and mounts the keyboard descendant (compact=%s)",
  (compact) => {
    setup({ prompts: prompts(2000), compact });
    const list = screen.getByRole("listbox");
    expect(screen.getAllByRole("option").length).toBeLessThan(25);
    fireEvent.focus(list);
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getAllByRole("option").length).toBeLessThan(25);
    expect(
      document
        .getElementById(list.getAttribute("aria-activedescendant")!)
        ?.getAttribute("aria-posinset"),
    ).toBe("2000");
    fireEvent.scroll(list, { target: { scrollTop: 0 } });
    expect(document.getElementById(list.getAttribute("aria-activedescendant")!)).not.toBeNull();
    expect(screen.getAllByRole("option").length).toBeLessThan(25);
  },
);

it("fades only edges with more prompts and clears the fades when everything fits", () => {
  const { props, rerender } = setup();
  const list = screen.getByRole("listbox");
  // At the beginning only the bottom edge hides more prompts.
  expect(list.style.maskImage).toContain("#000 0px");
  expect(list.style.maskImage).not.toContain("100% - 0px");
  fireEvent.scroll(list, { target: { scrollTop: 50 } });
  expect(list.style.maskImage).not.toContain("#000 0px");
  expect(list.style.maskImage).not.toContain("100% - 0px");
  fireEvent.focus(list);
  fireEvent.keyDown(list, { key: "End" });
  expect(list.style.maskImage).not.toContain("#000 0px");
  expect(list.style.maskImage).toContain("100% - 0px");
  fireEvent.keyDown(list, { key: "Home" });
  rerender(<TranscriptRail {...props} height={300} />);
  expect(list.style.maskImage).toBe("");
});

it("keeps the active marker in a comfort band without continuously centering", () => {
  const { props, rerender } = setup({ prompts: prompts(200), activeMessageID: "message-50" });
  const list = screen.getByRole("listbox");
  expect(list.scrollTop).toBe(455);
  // Centers at 20% and 80% stay put; crossing either boundary recenters.
  rerender(<TranscriptRail {...props} activeMessageID="message-53" />);
  expect(list.scrollTop).toBe(455);
  rerender(<TranscriptRail {...props} activeMessageID="message-47" />);
  expect(list.scrollTop).toBe(455);
  rerender(<TranscriptRail {...props} activeMessageID="message-54" />);
  expect(list.scrollTop).toBe(495);
  rerender(<TranscriptRail {...props} activeMessageID="message-50" />);
  expect(list.scrollTop).toBe(455);
});

it("clamps near endpoints and reveals the entire end when the active tail is appended", () => {
  const { props, rerender } = setup({ activeMessageID: "message-1" });
  const list = screen.getByRole("listbox");
  expect(list.scrollTop).toBe(0);
  rerender(<TranscriptRail {...props} activeMessageID="message-18" />);
  expect(list.scrollTop).toBe(100);
  rerender(<TranscriptRail {...props} activeMessageID="message-19" />);
  expect(list.scrollTop).toBe(100);
  rerender(<TranscriptRail {...props} prompts={prompts(21)} activeMessageID="message-20" />);
  // Appending the active tail exposes the new end rather than leaving it faded.
  expect(list.scrollTop).toBe(110);
  expect(list.style.maskImage).toContain("100% - 0px");
  rerender(<TranscriptRail {...props} prompts={prompts(21)} activeMessageID="message-0" />);
  expect(list.scrollTop).toBe(0);
});

it("rechecks endpoint status and viewport geometry even when the active index stays unchanged", () => {
  const { props, rerender } = setup({ prompts: prompts(30), activeMessageID: "message-19" });
  const list = screen.getByRole("listbox");
  expect(list.scrollTop).toBe(145);
  rerender(<TranscriptRail {...props} prompts={prompts(20)} />);
  expect(list.scrollTop).toBe(100);
  rerender(<TranscriptRail {...props} prompts={prompts(20)} height={80} />);
  expect(list.scrollTop).toBe(120);
  rerender(
    <TranscriptRail
      {...props}
      prompts={prompts(20)}
      height={80}
      earlier={{ ...props.earlier, available: true }}
    />,
  );
  expect(list.scrollTop).toBe(148);
});

it("does not follow or write scroll position on ordinary parent updates", () => {
  const { props, rerender } = setup({ prompts: prompts(200), activeMessageID: "message-50" });
  const list = screen.getByRole("listbox");
  // Independent rail scrolling isn't immediately undone by streaming renders.
  fireEvent.scroll(list, { target: { scrollTop: 100 } });
  const write = vi.spyOn(list, "scrollTop", "set");
  rerender(<TranscriptRail {...props} onSelect={vi.fn()} />);
  rerender(<TranscriptRail {...props} prompts={[...props.prompts]} />);
  expect(list.scrollTop).toBe(100);
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

it("follows the current prompt only outside pointer and keyboard browsing", () => {
  const { props, rerender } = setup({ prompts: prompts(200) });
  const list = screen.getByRole("listbox");
  const rail = list.parentElement!.parentElement!;
  fireEvent.pointerEnter(rail);
  rerender(<TranscriptRail {...props} activeMessageID="message-100" />);
  expect(list.scrollTop).toBe(0);
  fireEvent.pointerLeave(rail);
  expect(list.scrollTop).toBe(955);
  fireEvent.focus(list);
  rerender(<TranscriptRail {...props} activeMessageID="message-150" />);
  expect(list.scrollTop).toBe(955);
  fireEvent.blur(list);
  expect(list.scrollTop).toBe(1455);
});

it("pauses for earlier-button focus and resumes only after both hover and rail focus end", () => {
  const { props, rerender } = setup({
    prompts: prompts(200),
    earlier: { available: true, loading: false, load: vi.fn(async () => true) },
  });
  const list = screen.getByRole("listbox");
  const rail = list.parentElement!.parentElement!;
  const earlier = screen.getByRole("button", { name: "Load earlier prompts" });
  act(() => earlier.focus());
  rerender(<TranscriptRail {...props} activeMessageID="message-100" />);
  expect(list.scrollTop).toBe(0);
  act(() => list.focus());
  expect(list.scrollTop).toBe(0);
  expect(list.getAttribute("aria-activedescendant")).not.toBeNull();
  fireEvent.keyDown(list, { key: "End" });
  expect(list.scrollTop).toBe(1928);
  act(() => earlier.focus());
  expect(list.scrollTop).toBe(1928);
  expect(list.getAttribute("aria-activedescendant")).toBeNull();
  fireEvent.pointerEnter(rail);
  act(() => earlier.blur());
  expect(list.scrollTop).toBe(1928);
  fireEvent.pointerLeave(rail);
  expect(list.scrollTop).toBe(969);
});

it("preserves keyboard identity and the rail viewport anchor on prepend", () => {
  const original = prompts(100, 100);
  const { props, rerender } = setup({ prompts: original, activeMessageID: "message-100" });
  const list = screen.getByRole("listbox");
  fireEvent.focus(list);
  fireEvent.keyDown(list, { key: "ArrowDown" });
  const descendant = list.getAttribute("aria-activedescendant");
  fireEvent.scroll(list, { target: { scrollTop: 103 } });
  rerender(<TranscriptRail {...props} prompts={[...prompts(100), ...original]} />);
  expect(list.scrollTop).toBe(1103);
  expect(list.getAttribute("aria-activedescendant")).toBe(descendant);
  fireEvent.keyDown(list, { key: "Enter" });
  expect(props.onSelect).toHaveBeenLastCalledWith("message-101");
  fireEvent.blur(list);
  expect(list.scrollTop).toBe(955);
});

it("preserves an idle prepend anchor when the active marker remains in the comfort band", () => {
  const original = prompts(100, 100);
  const { props, rerender } = setup({ prompts: original, activeMessageID: "message-150" });
  const list = screen.getByRole("listbox");
  fireEvent.scroll(list, { target: { scrollTop: 463 } });
  rerender(<TranscriptRail {...props} prompts={[...prompts(100), ...original]} />);
  expect(list.scrollTop).toBe(1463);
});

it("reevaluates a shifted active index after prepend rather than caching only its identity", () => {
  const original = prompts(100, 100);
  const { props, rerender } = setup({ prompts: original, activeMessageID: "message-100" });
  const list = screen.getByRole("listbox");
  // Initially the earliest prompt is at the start. It becomes an interior prompt
  // after prepend, so the anchored position now needs the comfort-band correction.
  rerender(<TranscriptRail {...props} prompts={[...prompts(100), ...original]} />);
  expect(list.scrollTop).toBe(955);
});

it.each([false, true])(
  "uses one delayed plain text preview, keeps hover identity on prepend, and dismisses it (compact=%s)",
  (compact) => {
    vi.useFakeTimers();
    const original = prompts(20, 100);
    original[1]!.label = "<b>not markup</b>" + "x".repeat(400);
    const { props, rerender } = setup({
      prompts: original,
      activeMessageID: "message-100",
      compact,
    });
    const option = screen.getAllByRole("option")[1]!;
    fireEvent.pointerEnter(option);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole("tooltip").textContent).toBe(original[1]!.label.slice(0, 240));
    expect(screen.getByRole("tooltip").querySelector("b")).toBeNull();
    rerender(<TranscriptRail {...props} prompts={[...prompts(100), ...original]} />);
    expect(screen.getByRole("tooltip").textContent).toBe(original[1]!.label.slice(0, 240));
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "Escape" });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerLeave(list.parentElement!.parentElement!);
    fireEvent.focus(list);
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole("tooltip").textContent).toBe("Prompt 100");
  },
);

it("loads earlier only on the explicit action and disables it while loading", () => {
  const earlier = { available: true, loading: false, load: vi.fn(async () => true) };
  const { props, rerender } = setup({ earlier });
  expect(earlier.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load earlier prompts" }));
  expect(earlier.load).toHaveBeenCalledTimes(1);
  rerender(<TranscriptRail {...props} earlier={{ ...earlier, loading: true }} />);
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});

it("retains keyboard focus, selection, and accessible previews when the pane becomes compact", () => {
  vi.useFakeTimers();
  const { props, rerender } = setup({
    earlier: { available: true, loading: false, load: vi.fn(async () => true) },
  });
  const list = screen.getByRole("listbox", { name: "Prompt navigation" });
  act(() => list.focus());
  fireEvent.keyDown(list, { key: "End" });
  const descendant = list.getAttribute("aria-activedescendant");
  rerender(<TranscriptRail {...props} compact />);
  expect(document.activeElement).toBe(list);
  expect(list.tabIndex).toBe(0);
  expect(list.getAttribute("aria-activedescendant")).toBe(descendant);
  act(() => vi.advanceTimersByTime(180));
  expect(document.getElementById(list.getAttribute("aria-describedby")!)?.textContent).toBe(
    "Prompt 19",
  );
  fireEvent.keyDown(list, { key: "Enter" });
  expect(props.onSelect).toHaveBeenLastCalledWith("message-19");
  const earlier = screen.getByRole("button", { name: "Load earlier prompts" });
  act(() => earlier.focus());
  expect(document.activeElement).toBe(earlier);
  expect(earlier.tabIndex).toBe(0);
  fireEvent.click(earlier);
  expect(props.earlier.load).toHaveBeenCalledOnce();
  rerender(<TranscriptRail {...props} compact={false} />);
  expect(document.activeElement).toBe(earlier);
});

it("hides fewer than four prompts", () => {
  setup({ prompts: prompts(3) });
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("uses the latest selection and history callbacks after callback-only parent updates", () => {
  const earlier = { available: true, loading: false, load: vi.fn(async () => true) };
  const { props, rerender } = setup({ earlier });
  const onSelect = vi.fn();
  const load = vi.fn(async () => false);
  rerender(<TranscriptRail {...props} onSelect={onSelect} earlier={{ ...earlier, load }} />);
  fireEvent.click(screen.getByRole("option", { name: "Prompt 2" }));
  expect(onSelect).toHaveBeenCalledWith("message-2");
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load earlier prompts" }));
  expect(load).toHaveBeenCalledOnce();
  expect(earlier.load).not.toHaveBeenCalled();
});
