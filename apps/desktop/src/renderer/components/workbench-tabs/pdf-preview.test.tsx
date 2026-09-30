import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfPreview from "./pdf-preview";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  workerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: mocks.workerOptions,
}));

const bytes = (value: string) => new TextEncoder().encode(value);

function documentFixture(numPages = 2, width = 600, height = 800) {
  const cancel = vi.fn();
  const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel }));
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render: renderPage,
    cleanup: vi.fn(),
  }));
  const document = { numPages, getPage };
  const destroy = vi.fn(async () => undefined);
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy });
  return { document, destroy, renderPage, cancel, getPage };
}

describe("PDF canvas preview", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.getDocument.mockReset();
  });

  it("renders only the selected page as pixels with bounded navigation and zoom", async () => {
    const fixture = documentFixture(300);
    const data = bytes("%PDF-1.7");
    const view = render(<PdfPreview data={data} path="report.pdf" />);
    expect(await screen.findByRole("img", { name: "PDF page 1 of report.pdf" })).toBeTruthy();
    expect(screen.getByText(/Page 1 of 200 \(first 200 of 300\)/)).toBeTruthy();
    expect(fixture.getPage).toHaveBeenCalledWith(1);
    expect(fixture.getPage).toHaveBeenCalledTimes(1);
    expect(mocks.getDocument.mock.lastCall?.[0]).toMatchObject({
      isEvalSupported: false,
      enableXfa: false,
    });
    expect(mocks.getDocument.mock.lastCall?.[0].data).not.toBe(data);
    expect(data).toEqual(bytes("%PDF-1.7"));
    expect(mocks.workerOptions.workerSrc).toContain("pdf.worker.min.mjs");
    expect(document.querySelector("iframe, object, embed, script")).toBeNull();

    await userEvent.setup().click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("img", { name: "PDF page 2 of report.pdf" });
    expect(fixture.getPage).toHaveBeenCalledWith(2);
    await userEvent.setup().click(screen.getByRole("button", { name: "Zoom in" }));
    await screen.findByText("125%");
    await waitFor(() => expect(fixture.renderPage).toHaveBeenCalledTimes(3));

    view.unmount();
    expect(fixture.destroy).toHaveBeenCalledOnce();
  });

  it("cancels work on file change and unmount, ignoring stale document loads", async () => {
    let resolveFirst: ((value: ReturnType<typeof documentFixture>["document"]) => void) | undefined;
    const firstPromise = new Promise<ReturnType<typeof documentFixture>["document"]>((resolve) => {
      resolveFirst = resolve;
    });
    const oldDestroy = vi.fn(async () => undefined);
    mocks.getDocument.mockReturnValueOnce({ promise: firstPromise, destroy: oldDestroy });
    const firstData = bytes("%PDF-old");
    const nextData = bytes("%PDF-new");
    const view = render(<PdfPreview data={firstData} path="report.pdf" />);
    const next = documentFixture();
    view.rerender(<PdfPreview data={nextData} path="report.pdf" />);
    expect(oldDestroy).toHaveBeenCalledOnce();
    resolveFirst?.({ numPages: 99, getPage: vi.fn() });
    expect(await screen.findByRole("img", { name: "PDF page 1 of report.pdf" })).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    view.unmount();
    expect(next.destroy).toHaveBeenCalledOnce();
    expect(next.cancel).toHaveBeenCalledOnce();
  });

  it("cancels a pending render when the page changes", async () => {
    const fixture = documentFixture();
    const pendingRender = { promise: new Promise<void>(() => {}), cancel: vi.fn() };
    fixture.renderPage.mockReturnValueOnce(pendingRender);
    render(<PdfPreview data={bytes("%PDF-pages")} path="report.pdf" />);
    await waitFor(() => expect(fixture.renderPage).toHaveBeenCalledOnce());
    await userEvent.setup().click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("img", { name: "PDF page 2 of report.pdf" });
    expect(pendingRender.cancel).toHaveBeenCalledOnce();
  });

  it("shows explicit parse and oversized-page errors instead of embedding PDF content", async () => {
    mocks.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("malformed")),
      destroy: vi.fn(async () => undefined),
    });
    const view = render(<PdfPreview data={bytes("%PDF-bad")} path="broken.pdf" />);
    expect(await screen.findByText("Could not open broken.pdf as a PDF.")).toBeTruthy();
    const huge = documentFixture(1, 90_000, 90_000);
    view.rerender(<PdfPreview data={bytes("%PDF-huge")} path="huge.pdf" />);
    expect(await screen.findByText("This PDF page is too large to preview.")).toBeTruthy();
    expect(huge.renderPage).not.toHaveBeenCalled();
  });
});
