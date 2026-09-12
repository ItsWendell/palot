import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox, ReadImagePreview } from "./read-image-preview";

afterEach(cleanup);

describe("ImageLightbox", () => {
  it("copies and downloads through guarded desktop APIs", async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    const downloadUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { ...window.palot, downloadUrl, writeClipboardText },
    });
    render(
      <ImageLightbox
        src="https://example.com/preview.png"
        name="preview.png"
        mime="image/png"
        open
        onOpenChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy image address" }));
    fireEvent.click(screen.getByRole("button", { name: "Download image" }));

    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenCalledWith("https://example.com/preview.png"),
    );
    await waitFor(() =>
      expect(downloadUrl).toHaveBeenCalledWith("https://example.com/preview.png"),
    );
  });

  it("resets zoom after an externally controlled close", () => {
    const renderLightbox = (open: boolean) => (
      <ImageLightbox
        src="data:image/png;base64,AA=="
        name="preview.png"
        mime="image/png"
        open={open}
        onOpenChange={() => undefined}
      />
    );
    const view = render(renderLightbox(true));

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();

    view.rerender(renderLightbox(false));
    view.rerender(renderLightbox(true));

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
  });

  it("stays closable while its parent receives streaming updates", async () => {
    const renderPreview = (revision: number) => (
      <div data-revision={revision}>
        <ReadImagePreview src="data:image/png;base64,AA==" name="preview.png" mime="image/png" />
      </div>
    );
    const view = render(renderPreview(0));
    fireEvent.click(screen.getByRole("button", { name: "Open preview of preview.png" }));

    for (let revision = 1; revision <= 10; revision += 1) {
      view.rerender(renderPreview(revision));
    }
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    view.rerender(renderPreview(11));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
