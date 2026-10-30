import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fontDisplayName } from "./font-file-preview";
import { RichFilePreview, isRichFilePreview } from "./rich-file-preview";
import { classifyWorkspaceFile } from "./workspace-file-preview";

const mocks = vi.hoisted(() => ({
  mermaid: vi.fn(),
  loadFont: vi.fn(),
  addFont: vi.fn(),
  deleteFont: vi.fn(),
}));

vi.mock("../markdown-rich", async (original) => ({
  ...(await original<typeof import("../markdown-rich")>()),
  MermaidDiagram: mocks.mermaid,
}));
vi.mock("../../atoms/workspace", async () => ({
  runtimeAtom: (await import("jotai")).atom(null),
}));
vi.mock("../../lib/code-highlighter", () => ({
  highlightLanguage: (language: string) => language,
  loadedCodeHighlighter: () => undefined,
  loadedZedTheme: () => undefined,
  loadCodeHighlighter: () => Promise.reject(new Error("Not loaded in DOM tests")),
}));

const text = (source: string) => new TextEncoder().encode(source);
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");

function preview(path: string, data: Uint8Array) {
  const result = classifyWorkspaceFile(path, data);
  if (!isRichFilePreview(result)) throw new Error(`Expected a rich preview for ${path}`);
  return <RichFilePreview preview={result} path={path} />;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  mocks.mermaid.mockImplementation(({ code }: { code: string }) => (
    <div role="img" aria-label="Mermaid diagram">
      {code}
    </div>
  ));
  mocks.loadFont.mockImplementation((font: unknown) => Promise.resolve(font));
  vi.stubGlobal(
    "FontFace",
    class {
      constructor(
        readonly family: string,
        readonly source: unknown,
      ) {}
      load() {
        return mocks.loadFont(this);
      }
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: mocks.addFont, delete: mocks.deleteFont },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
  else Reflect.deleteProperty(document, "fonts");
});

describe("rich file previews", () => {
  it("shows virtualized CSV headers and rows and scrolls", async () => {
    const source = `name,value\n${Array.from({ length: 1000 }, (_, index) => `row ${index},${index}`).join("\n")}`;
    render(preview("data.csv", text(source)));
    const table = screen.getByRole("table", { name: "Table: data.csv" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["name", "value"]);
    expect(within(table).getByRole("cell", { name: "row 0" })).toBeTruthy();
    expect(within(table).getAllByRole("row").length).toBeLessThan(40);
    const scroll = screen.getByRole("region", { name: "Table: data.csv scroll area" });
    fireEvent.scroll(scroll, { target: { scrollTop: 16_000 } });
    await vi.waitFor(() =>
      expect(within(table).getByRole("cell", { name: "row 500" })).toBeTruthy(),
    );
    expect(within(table).queryByRole("cell", { name: "row 0" })).toBeNull();
  });

  it("shows a truncation note for very long tables", () => {
    const source = `header\n${"row\n".repeat(50_001)}`;
    render(preview("large.csv", text(source)));
    expect(screen.getByRole("status").textContent).toContain("Preview limited to 50,000 data rows");
    expect(screen.getAllByRole("row").length).toBeLessThan(40);
  });

  it("renders notebook markdown, highlighted code, execution counts and inert saved outputs", async () => {
    const html = '<script>window.bad = true</script><img src=x onerror="bad()">';
    const source = JSON.stringify({
      nbformat: 4,
      metadata: { language_info: { name: "python" } },
      cells: [
        { cell_type: "markdown", source: ["# Saved notebook\n\n<script>bad()</script>"] },
        {
          cell_type: "code",
          source: ["print(42)"],
          execution_count: 9,
          outputs: [
            { output_type: "stream", text: "hello stream" },
            { output_type: "error", traceback: ["\u001b[31mValueError\u001b[0m"] },
            { output_type: "display_data", data: { "text/html": html } },
            { output_type: "execute_result", data: { "text/plain": "42" } },
            { output_type: "display_data", data: { "image/png": "aGVsbG8=" } },
            { output_type: "display_data", data: { "image/svg+xml": "<svg/>" } },
          ],
        },
      ],
    });
    render(preview("analysis.ipynb", text(source)));
    expect(screen.getByRole("heading", { name: "Saved notebook" })).toBeTruthy();
    const code = screen.getByLabelText("Cell 2 code");
    expect(code.textContent).toBe("print(42)");
    expect(code.getAttribute("data-language")).toBe("python");
    expect(screen.getByText(/In \[9\]:/)).toBeTruthy();
    expect(screen.getByText("hello stream")).toBeTruthy();
    expect(screen.getByText("ValueError")).toBeTruthy();
    expect(screen.getByText(html)).toBeTruthy();
    expect(document.querySelector("script, iframe, object, embed")).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("mounts only the first notebook cells until more are requested", async () => {
    const cells = Array.from({ length: 25 }, (_, i) => ({ cell_type: "raw", source: `cell ${i}` }));
    render(preview("many.ipynb", text(JSON.stringify({ nbformat: 4, cells }))));
    expect(screen.queryByLabelText("Cell 21")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: /Show more cells/ }));
    expect(screen.getByLabelText("Cell 25")).toBeTruthy();
  });

  it("reuses the Mermaid renderer", () => {
    const source = "graph TD\nA-->B";
    const view = render(preview("flow.mmd", text(source)));
    expect(mocks.mermaid.mock.lastCall?.[0]).toMatchObject({ code: source });
    view.rerender(preview("other.mmd", text(source)));
    expect(screen.getByRole("img", { name: "Mermaid diagram" })).toBeTruthy();
  });

  it.each([
    '%%{init: {"securityLevel":"loose"}}%%\ngraph TD\nA-->B',
    'graph TD\nA["<img src=https://example.com>"]',
    'graph TD\nA@{ img: "https://example.com" }',
  ])("refuses Mermaid markup, resource and configuration syntax before rendering", (source) => {
    render(preview("unsafe.mermaid", text(source)));
    expect(screen.getByRole("status").textContent).toContain("Use Source");
    expect(mocks.mermaid).not.toHaveBeenCalled();
    expect(document.querySelector("img, script, iframe")).toBeNull();
  });

  it("renders binary bytes as virtualized offset, hex and printable ASCII columns", () => {
    const data = new Uint8Array(100_000);
    data.set([0, 65, 66, 32, 127, 255]);
    render(preview("binary.bin", data));
    const table = screen.getByRole("table", { name: "Hex: binary.bin" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Offset", "Hex", "ASCII"]);
    expect(within(table).getByRole("cell", { name: "00000000" })).toBeTruthy();
    expect(within(table).getByRole("cell", { name: /^00 41 42 20 7f ff/ })).toBeTruthy();
    expect(within(table).getByRole("cell", { name: /^\.AB / })).toBeTruthy();
    expect(within(table).getAllByRole("row").length).toBeLessThan(40);
  });

  it("loads font bytes with FontFace, shows a specimen and removes the face on unmount", async () => {
    const data = new Uint8Array([0, 1, 0, 0]);
    const view = render(preview("sample.ttf", data));
    expect(await screen.findByRole("heading", { name: "sample.ttf" })).toBeTruthy();
    expect(screen.getAllByText("The quick brown fox jumps over the lazy dog.")).toHaveLength(5);
    expect(within(screen.getByLabelText("Basic Latin glyphs")).getByText("A")).toBeTruthy();
    const font = mocks.addFont.mock.calls[0]?.[0];
    expect(font.source).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(font.source)).toEqual(data);
    view.unmount();
    expect(mocks.deleteFont).toHaveBeenCalledWith(font);
  });

  it("reports rejected fonts without showing a fallback-font specimen", async () => {
    mocks.loadFont.mockRejectedValueOnce(new Error("Bad font"));
    render(preview("broken.woff2", text("not a font")));
    expect(await screen.findByText("Preview unavailable")).toBeTruthy();
    expect(screen.getByText("Could not load broken.woff2 as a font.")).toBeTruthy();
    expect(mocks.addFont).not.toHaveBeenCalled();
    expect(screen.queryByText("The quick brown fox jumps over the lazy dog.")).toBeNull();
  });

  it("reads a bounded sfnt font family name when available", () => {
    const name = "Test Font";
    const data = new Uint8Array(46 + name.length * 2);
    const view = new DataView(data.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    data.set(text("name"), 12);
    view.setUint32(20, 28);
    view.setUint32(24, data.length - 28);
    view.setUint16(30, 1);
    view.setUint16(32, 18);
    view.setUint16(34, 3);
    view.setUint16(40, 1);
    view.setUint16(42, name.length * 2);
    [...name].forEach((char, index) => view.setUint16(46 + index * 2, char.charCodeAt(0)));
    expect(fontDisplayName(data)).toBe(name);
    expect(fontDisplayName(data.subarray(0, 40))).toBeNull();
  });
});
