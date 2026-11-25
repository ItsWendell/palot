import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { OpenCodeClient } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { ImageLightbox, ReadImagePreview } from "./read-image-preview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
});

function renderStored(hash: string, get: () => Promise<Uint8Array>) {
  setOpenCodeClientForTest({ experimental: { media: { get } } } as unknown as OpenCodeClient);
  const store = createStore();
  store.set(runtimeAtom, { connectionID: "media-connection" } as OpenCodeRuntimeStatus);
  return render(
    <Provider store={store}>
      <ReadImagePreview src={`media:${hash.repeat(64)}`} name="shot.png" mime="image/png" />
    </Provider>,
  );
}

describe("ReadImagePreview", () => {
  it("loads a stored image reference, showing a placeholder until it arrives", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shot");
    renderStored("1", async () => new Uint8Array([1]));
    expect(screen.getByLabelText("Loading shot.png")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Open preview of shot.png" }));
    expect(screen.getByRole("img", { name: "shot.png" }).getAttribute("src")).toBe("blob:shot");
  });

  it("says a stored image is unavailable when its bytes cannot be read", async () => {
    renderStored("2", async () => {
      throw new Error("FileNotFoundError");
    });
    expect(await screen.findByText("shot.png is unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open preview of shot.png" })).toBeNull();
  });
});

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
