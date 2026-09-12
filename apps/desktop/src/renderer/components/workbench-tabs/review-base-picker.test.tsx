import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewBasePicker } from "./review-base-picker";

const state = vi.hoisted(() => ({
  setManual: vi.fn(),
  retry: vi.fn(),
  manual: null as string | null,
  error: null as Error | null,
  pending: false,
}));
vi.mock("../../hooks/use-vcs-info", () => ({
  useReviewBase: () => ({
    manual: state.manual,
    setManual: state.setManual,
    inferred: {
      data: null,
      isPending: state.pending,
      isError: Boolean(state.error),
      error: state.error,
      refetch: state.retry,
    },
  }),
  useVcsBranches: () => ({ data: ["main", "release"], isSuccess: true }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.manual = null;
  state.error = null;
  state.pending = false;
});
async function open() {
  render(<ReviewBasePicker location={{ directory: "/repo" }} />);
  fireEvent.click(screen.getByRole("button", { name: /Review base:/ }));
  await screen.findByRole("textbox", { name: "Search branches or enter a ref" });
}
it("explains null inference and accepts an explicit ref by keyboard", async () => {
  await open();
  expect(screen.getByRole("status").textContent).toContain("No unambiguous base");
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: " refs/tags/v1 " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(state.setManual).toHaveBeenCalledWith("refs/tags/v1");
});
it("selects branches and resets to inference", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "release" }));
  expect(state.setManual).toHaveBeenCalledWith("release");
  fireEvent.click(screen.getByRole("button", { name: /Review base:/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Use inferred base" }));
  expect(state.setManual).toHaveBeenLastCalledWith(null);
});
it("offers retry on inference failure without blocking manual choice", async () => {
  state.error = new Error("offline");
  await open();
  expect(screen.getByRole("alert").textContent).toContain("offline");
  fireEvent.click(screen.getByRole("button", { name: "Retry base" }));
  expect(state.retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "main" }));
  expect(state.setManual).toHaveBeenCalledWith("main");
});
