import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "../lib/clipboard";
import { createStreamingPatchDocument as document } from "../lib/streaming-patch-input";
import { StreamingPatchView } from "./streaming-patch-view";

vi.mock("../lib/clipboard", () => ({ writeClipboardText: vi.fn(async () => {}) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("StreamingPatchView", () => {
  it("samples rendering but copies every received line, including text not yet displayed", async () => {
    vi.useFakeTimers();
    const first = "*** Begin Patch\n*** Add File: example.ts\n+first\n";
    const full = `${first}${Array.from({ length: 500 }, (_, index) => `+line ${index}\n`).join("")}+${"x".repeat(4000)}\n+last received`;
    const result = render(<StreamingPatchView document={document(first)} streaming />);
    result.rerender(<StreamingPatchView document={document(full)} streaming />);

    expect(screen.getByText("+1")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy full patch" })));
    expect(writeClipboardText).toHaveBeenCalledWith(full);
    expect(screen.getByRole("button", { name: "Copied full patch" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByText("+503")).toBeTruthy();
    result.unmount();
  });

  it("flushes the last chunk immediately when argument streaming ends", () => {
    vi.useFakeTimers();
    const first = document("*** Begin Patch\n");
    const final = document("*** Begin Patch\n*** Add File: example.ts\n+last\n*** End Patch");
    const result = render(<StreamingPatchView document={first} streaming />);
    result.rerender(<StreamingPatchView document={final} streaming />);
    expect(screen.getByText("Preparing changes…")).toBeTruthy();

    result.rerender(<StreamingPatchView document={final} streaming={false} />);
    expect(screen.getByText("example.ts")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("keeps a live reader in the patch when completed review arrives", () => {
    const patch = document("*** Begin Patch\n*** Add File: example.ts\n+new\n*** End Patch");
    const result = render(<StreamingPatchView document={patch} streaming />);
    fireEvent.wheel(screen.getByRole("region", { name: "Proposed changes for example.ts" }), {
      deltaY: -100,
    });
    expect(screen.getByRole("button", { name: "Follow changes" })).toBeTruthy();

    result.rerender(
      <StreamingPatchView document={patch} streaming={false} review={<div>Completed diff</div>} />,
    );
    expect(screen.getByRole("region", { name: "Proposed changes for example.ts" })).toBeTruthy();
    expect(screen.queryByText("Completed diff")).toBeNull();
    expect(screen.getByRole("button", { name: "Follow changes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show applied diff" }));
    expect(screen.getByText("Completed diff")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show proposed changes" }));
    expect(screen.getByRole("region", { name: "Proposed changes for example.ts" })).toBeTruthy();
  });

  it("opens historical patches on the completed diff with a structured deletion proposal available", () => {
    render(
      <StreamingPatchView
        document={document("*** Begin Patch\n*** Delete File: example.ts\n*** End Patch")}
        streaming={false}
        review={<div>Completed diff</div>}
      />,
    );
    expect(screen.getByText("Completed diff")).toBeTruthy();
    expect(screen.queryByText("File deleted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show proposed changes" }));
    expect(screen.getByText("example.ts")).toBeTruthy();
    expect(screen.getByText("File deleted")).toBeTruthy();
  });

  it("gives each file its own section and independent follow state", () => {
    render(
      <StreamingPatchView
        document={document(
          [
            "*** Begin Patch",
            "*** Add File: alpha.ts",
            "+const value = 1;",
            "*** Add File: beta.py",
            "+value = 2",
            "*** End Patch",
          ].join("\n"),
        )}
        streaming
      />,
    );
    expect(screen.getByText("2 files")).toBeTruthy();
    expect(screen.getByText("alpha.ts")).toBeTruthy();
    expect(screen.getByText("beta.py")).toBeTruthy();
    const alpha = screen.getByRole("region", { name: "Proposed changes for alpha.ts" });
    const beta = screen.getByRole("region", { name: "Proposed changes for beta.py" });
    fireEvent.wheel(alpha, { deltaY: -100 });
    expect(
      within(alpha.parentElement!).getByRole("button", { name: "Follow changes" }),
    ).toBeTruthy();
    expect(
      within(beta.parentElement!).queryByRole("button", { name: "Follow changes" }),
    ).toBeNull();
  });
});
