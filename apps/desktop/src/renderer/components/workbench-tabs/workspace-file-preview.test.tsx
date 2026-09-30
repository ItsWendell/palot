import type { FileContents } from "@pierre/diffs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { FileTab } from "./file-tab";
import { classifyWorkspaceFile } from "./workspace-file-preview";

const mocks = vi.hoisted(() => ({
  file: vi.fn((_props: { file: FileContents }) => null),
  pdf: vi.fn((_props: { data: Uint8Array; path: string }) => null),
  query: { data: new Uint8Array(), isPending: false },
}));

vi.mock("@pierre/diffs/react", () => ({ File: mocks.file }));
vi.mock("./pdf-preview", () => ({ default: mocks.pdf }));
vi.mock("../../atoms/workspace", async () => ({
  runtimeAtom: (await import("jotai")).atom(null),
}));
vi.mock("../../hooks/use-workspace-file", () => ({ useWorkspaceFile: () => mocks.query }));

const tab: Extract<WorkbenchTab, { kind: "file" }> = {
  id: "file-tab",
  pinned: false,
  kind: "file",
  resource: { profileID: "profile-1", location: { directory: "/repo" }, path: "notes.md" },
};

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const wave = () => {
  const data = new Uint8Array(46);
  data.set(text("RIFF"));
  new DataView(data.buffer).setUint32(4, data.length - 8, true);
  data.set(text("WAVEfmt "), 8);
  new DataView(data.buffer).setUint32(16, 16, true);
  data.set(bytes(1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16, 0), 20);
  data.set(text("data"), 36);
  new DataView(data.buffer).setUint32(40, 2, true);
  return data;
};
const oggOpus = () => {
  const data = new Uint8Array(27 + 1 + 19);
  data.set(text("OggS"));
  data[5] = 2; // beginning of stream
  data[26] = 1;
  data[27] = 19;
  data.set(text("OpusHead"), 28);
  return data;
};
const mp3 = () => {
  const data = new Uint8Array(417 * 2);
  data.set(bytes(0xff, 0xfb, 0x90, 0), 0);
  data.set(bytes(0xff, 0xfb, 0x90, 0), 417);
  return data;
};
const mp4 = () => {
  const data = new Uint8Array(33);
  data.set(bytes(0, 0, 0, 24), 0);
  data.set(text("ftypisom"), 4);
  data.set(text("mp42"), 16);
  data.set(bytes(0, 0, 0, 9), 24);
  data.set(text("mdat"), 28);
  return data;
};
const webm = () =>
  bytes(
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x87,
    0x42,
    0x82,
    0x84,
    ...text("webm"),
    0x18,
    0x53,
    0x80,
    0x67,
    0xff,
    0,
  );

describe("workspace file preview classification", () => {
  it.each([
    ["image/png", bytes(137, 80, 78, 71, 13, 10, 26, 10)],
    ["image/jpeg", bytes(255, 216, 255, 224)],
    ["image/gif", text("GIF89a")],
    ["image/webp", text("RIFF0000WEBP")],
    ["application/pdf", text("%PDF-1.7")],
  ])("recognizes %s from bytes, not a filename", (mime, data) => {
    expect(classifyWorkspaceFile("wrong.svg", data)).toMatchObject({ mime, data });
  });

  it.each([
    ["audio/wav", wave()],
    ["audio/ogg", oggOpus()],
    ["audio/mpeg", mp3()],
    ["video/mp4", mp4()],
    ["video/webm", webm()],
  ])("recognizes %s only from its container or codec bytes", (mime, data) => {
    expect(classifyWorkspaceFile("wrong.html", data)).toMatchObject({
      kind: mime.startsWith("audio/") ? "audio" : "video",
      mime,
      data,
    });
  });

  it("recognizes MP3 with an ID3v2 tag and Ogg Vorbis audio", () => {
    const tagged = new Uint8Array(10 + mp3().length);
    tagged.set(bytes(...text("ID3"), 4, 0, 0, 0, 0, 0, 0));
    tagged.set(mp3(), 10);
    expect(classifyWorkspaceFile("track.bin", tagged)).toMatchObject({ mime: "audio/mpeg" });

    const vorbis = new Uint8Array(27 + 1 + 30);
    vorbis.set(text("OggS"));
    vorbis[5] = 2;
    vorbis[26] = 1;
    vorbis[27] = 30;
    vorbis[28] = 1;
    vorbis.set(text("vorbis"), 29);
    expect(classifyWorkspaceFile("track.bin", vorbis)).toMatchObject({ mime: "audio/ogg" });
  });

  it("keeps HTML, SVG, and spoofed image extensions in the text viewer", () => {
    expect(classifyWorkspaceFile("page.html", text("<script>alert(1)</script>"))).toEqual({
      kind: "text",
      text: "<script>alert(1)</script>",
    });
    expect(classifyWorkspaceFile("icon.svg", text("<svg onload='alert(1)'/>"))).toMatchObject({
      kind: "text",
    });
    expect(classifyWorkspaceFile("fake.png", text("<svg/>"))).toMatchObject({ kind: "text" });
    for (const ext of ["mp3", "wav", "ogg", "mp4", "webm"]) {
      expect(classifyWorkspaceFile(`fake.${ext}`, text("<script>alert(1)</script>"))).toMatchObject(
        {
          kind: "text",
        },
      );
    }
  });

  it("rejects incomplete or misleading media signatures", () => {
    expect(classifyWorkspaceFile("fake.mp3", text("ID3 no frames"))).toMatchObject({
      kind: "text",
    });
    expect(classifyWorkspaceFile("fake.mp4", text("ftypisom"))).toMatchObject({ kind: "text" });
    const riffAvi = wave();
    riffAvi.set(text("AVI "), 8);
    expect(classifyWorkspaceFile("fake.wav", riffAvi)).toMatchObject({ kind: "binary" });
    const matroska = webm();
    matroska.set(text("mkv "), 8);
    expect(classifyWorkspaceFile("fake.webm", matroska)).toMatchObject({ kind: "binary" });
    const silentMp3 = mp3();
    silentMp3.set(bytes(0, 0, 0, 0), 417);
    expect(classifyWorkspaceFile("fake.mp3", silentMp3)).toMatchObject({ kind: "binary" });
  });

  it("rejects invalid UTF-8 and NULs, and bounds decoded text and media", () => {
    expect(classifyWorkspaceFile("sample.md", bytes(0xff))).toEqual({ kind: "binary" });
    expect(classifyWorkspaceFile("sample.md", bytes(65, 0, 66))).toEqual({ kind: "binary" });
    expect(classifyWorkspaceFile("sample.md", new Uint8Array(2 * 1024 * 1024 + 1))).toEqual({
      kind: "too-large",
      limitMiB: 2,
    });
    const oversizedImage = new Uint8Array(16 * 1024 * 1024 + 1);
    oversizedImage.set(bytes(137, 80, 78, 71, 13, 10, 26, 10));
    expect(classifyWorkspaceFile("sample.png", oversizedImage)).toEqual({
      kind: "too-large",
      limitMiB: 16,
    });
    const oversizedVideo = new Uint8Array(32 * 1024 * 1024 + 1);
    oversizedVideo.set(mp4());
    expect(classifyWorkspaceFile("sample.mp4", oversizedVideo)).toEqual({
      kind: "too-large",
      limitMiB: 32,
    });
  });
});

describe("FileTab previews", () => {
  beforeEach(() => {
    mocks.query.data = new Uint8Array();
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.file.mockClear();
    mocks.pdf.mockClear();
  });

  it("renders Markdown as safe content, then returns to the unchanged source viewer", async () => {
    mocks.query.data = text("# Hello preview\n\n<script>alert(1)</script>");
    render(<FileTab tab={tab} />);
    expect(screen.getByRole("heading", { name: "Hello preview" })).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(mocks.file).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Source" }));
    expect(mocks.file.mock.lastCall?.[0].file.contents).toBe(
      "# Hello preview\n\n<script>alert(1)</script>",
    );
    expect(screen.getByRole("button", { name: "Source" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Hello preview" })).toBeTruthy();
  });

  it("creates and revokes image URLs on refresh and unmount without embedding SVG", () => {
    mocks.query.data = bytes(137, 80, 78, 71, 13, 10, 26, 10);
    const view = render(<FileTab tab={tab} />);
    expect(screen.getByRole("img", { name: "notes.md" }).getAttribute("src")).toBe("blob:one");
    mocks.query.data = bytes(255, 216, 255, 224);
    view.rerender(<FileTab tab={tab} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(screen.getByRole("img", { name: "notes.md" }).getAttribute("src")).toBe("blob:two");
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two");
  });

  it("releases a media preview when its workbench tab becomes inactive", () => {
    mocks.query.data = bytes(137, 80, 78, 71, 13, 10, 26, 10);
    const view = render(<FileTab tab={tab} active />);
    expect(screen.getByRole("img", { name: "notes.md" })).toBeTruthy();
    view.rerender(<FileTab tab={tab} active={false} />);
    expect(screen.queryByRole("img", { name: "notes.md" })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    view.rerender(<FileTab tab={tab} active />);
    expect(screen.getByRole("img", { name: "notes.md" }).getAttribute("src")).toBe("blob:two");
  });

  it.each([
    ["audio", wave(), "Audio preview: notes.md"],
    ["video", mp4(), "Video preview: notes.md"],
  ])("renders %s as native controls with revocable URLs", (kind, data, label) => {
    mocks.query.data = data;
    const view = render(<FileTab tab={tab} />);
    const media = screen.getByLabelText(label);
    expect(media.tagName.toLowerCase()).toBe(kind);
    expect(media.getAttribute("src")).toBe("blob:one");
    expect(media.getAttribute("controls")).not.toBeNull();
    expect(media.getAttribute("preload")).toBe("metadata");
    const firstBlob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
    expect(firstBlob).toBeInstanceOf(Blob);
    expect(firstBlob instanceof Blob && firstBlob.type).toBe(
      kind === "audio" ? "audio/wav" : "video/mp4",
    );
    expect(document.querySelector("iframe, object, embed")).toBeNull();

    mocks.query.data = kind === "audio" ? oggOpus() : webm();
    view.rerender(<FileTab tab={tab} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(screen.getByLabelText(label).getAttribute("src")).toBe("blob:two");
    const secondBlob = vi.mocked(URL.createObjectURL).mock.calls[1]?.[0];
    expect(secondBlob).toBeInstanceOf(Blob);
    expect(secondBlob instanceof Blob && secondBlob.type).toBe(
      kind === "audio" ? "audio/ogg" : "video/webm",
    );
    fireEvent.error(screen.getByLabelText(label));
    expect(screen.getByText("Could not display notes.md.")).toBeTruthy();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:two");
  });

  it("renders an SVG file as inert source even when named like an image", () => {
    mocks.query.data = text("<svg onload='alert(1)'/>");
    render(<FileTab tab={{ ...tab, resource: { ...tab.resource, path: "fake.png" } }} />);
    expect(mocks.file.mock.lastCall?.[0].file.contents).toBe("<svg onload='alert(1)'/>");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("routes PDFs to the canvas preview without creating an embedded document", async () => {
    mocks.query.data = text("%PDF-1.7");
    const view = render(<FileTab tab={tab} />);
    await vi.waitFor(() => expect(mocks.pdf).toHaveBeenCalled());
    expect(mocks.pdf.mock.lastCall?.[0]).toMatchObject({
      data: mocks.query.data,
      path: "notes.md",
    });
    expect(document.querySelector("iframe, object, embed")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    mocks.query.data = new Uint8Array(2 * 1024 * 1024 + 1);
    view.rerender(<FileTab tab={tab} />);
    expect(screen.getByText(/exceeds the 2 MiB preview limit/)).toBeTruthy();
  });
});
