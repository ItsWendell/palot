import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotFileAttachment } from "../../shared";
import { mapMessage } from "../services/opencode-mappers";
import { FileAttachment } from "./file-attachment";

const { attachmentPreview } = vi.hoisted(() => ({ attachmentPreview: vi.fn() }));
vi.mock("../services/palot", () => ({ palot: { attachmentPreview } }));

const file: PalotFileAttachment = {
  uri: "file:///deleted/screenshot.png",
  name: "screenshot.png",
  mime: "image/png",
  size: null,
};
beforeEach(() => {
  attachmentPreview.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FileAttachment", () => {
  it("falls back when a composer preview grant has expired", async () => {
    attachmentPreview.mockResolvedValue(null);
    const view = render(<FileAttachment file={{ ...file, previewGrant: "expired" }} />);
    await waitFor(() => expect(view.container.querySelector("svg")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open preview of screenshot.png" })).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows a reloaded sent screenshot and opens and closes its lightbox without local reads", async () => {
    const message = mapMessage({
      id: "sent",
      type: "user",
      time: { created: 1 },
      text: "",
      files: [
        { name: file.name, mime: file.mime, data: "AAAA", source: { type: "uri", uri: file.uri } },
      ],
    });
    const sentFile = JSON.parse(JSON.stringify(message.files![0]));
    const view = render(<FileAttachment file={sentFile} />);
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open preview of screenshot.png" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("img", { name: "screenshot.png" }).getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(attachmentPreview).not.toHaveBeenCalled();
  });

  it("retains grant previews and revokes their object URLs when replaced or unmounted", async () => {
    attachmentPreview.mockResolvedValue({ mime: "image/png", data: new ArrayBuffer(3) });
    const view = render(<FileAttachment file={{ ...file, previewGrant: "grant" }} />);
    await screen.findByRole("button", { name: "Open preview of screenshot.png" });
    expect(attachmentPreview).toHaveBeenCalledWith("grant", undefined);
    view.rerender(
      <FileAttachment file={{ ...file, previewDataUrl: "data:image/png;base64,AAAA" }} />,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    view.rerender(<FileAttachment file={{ ...file, previewGrant: "new-grant" }} />);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("does not create object URLs for late grant responses after unmount", async () => {
    let resolve!: (value: { mime: string; data: ArrayBuffer }) => void;
    attachmentPreview.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<FileAttachment file={{ ...file, previewGrant: "grant" }} />);
    view.unmount();
    resolve({ mime: "image/png", data: new ArrayBuffer(3) });
    await Promise.resolve();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("keeps non-previewable files removable without reading their paths", () => {
    const onRemove = vi.fn();
    render(<FileAttachment file={file} onRemove={onRemove} />);
    expect(screen.queryByRole("button", { name: "Open preview of screenshot.png" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove screenshot.png" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(attachmentPreview).not.toHaveBeenCalled();
  });

  it("falls back to a file card when image decoding fails", () => {
    const view = render(
      <FileAttachment file={{ ...file, previewDataUrl: "data:image/png;base64,AAAA" }} />,
    );
    fireEvent.error(view.container.querySelector("img")!);
    expect(screen.queryByRole("button", { name: "Open preview of screenshot.png" })).toBeNull();
    expect(screen.getByText("screenshot.png")).toBeTruthy();
  });
});
