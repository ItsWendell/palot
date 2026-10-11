import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import OfficePreview from "./office-preview";
import { loadOfficePreview } from "./office-preview-loader";
import { OfficePreviewError } from "./office-preview-model";

vi.mock("./office-preview-loader", () => ({ loadOfficePreview: vi.fn() }));
const load = vi.mocked(loadOfficePreview);
const data = new Uint8Array([1, 2, 3]);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("renders document text as semantic, inert React content", async () => {
  load.mockResolvedValue({
    format: "docx",
    truncated: false,
    sheets: [],
    sections: [
      {
        name: "Document",
        blocks: [
          { kind: "heading", level: 2, runs: [{ text: "Report" }] },
          {
            kind: "paragraph",
            level: 1,
            runs: [
              {
                text: '<script>alert(1)</script><img src="https://example.invalid" onerror="alert(1)">',
                bold: true,
              },
            ],
          },
          {
            kind: "table",
            rows: [
              [
                { text: "Revenue", rowSpan: 1, colSpan: 1 },
                { text: "42", rowSpan: 1, colSpan: 1 },
              ],
            ],
          },
        ],
      },
    ],
  });
  const view = render(<OfficePreview data={data} format="docx" path="report.docx" />);
  expect(await screen.findByRole("heading", { name: "Report", level: 2 })).toBeTruthy();
  expect(screen.getByRole("table", { name: "Document table" }).textContent).toContain("Revenue42");
  expect(screen.getByText(/<script>alert/).closest("strong")).toBeTruthy();
  expect(document.querySelector("script, img, iframe, object, embed, a")).toBeNull();
  expect(screen.getByText(/page layout and animations are omitted/)).toBeTruthy();
  const signal = load.mock.calls[0]![2];
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it("renders merged table cells with native spans, without continuation placeholders or lost paragraph breaks", async () => {
  load.mockResolvedValue({
    format: "docx",
    truncated: false,
    sheets: [],
    sections: [
      {
        name: "Document",
        blocks: [
          {
            kind: "table",
            rows: [
              [
                { text: "First paragraph\nSecond paragraph", rowSpan: 2, colSpan: 1 },
                { text: "Wide header", rowSpan: 1, colSpan: 2 },
                null,
              ],
              [
                null,
                { text: "Left value", rowSpan: 1, colSpan: 1 },
                { text: "Right value", rowSpan: 1, colSpan: 1 },
              ],
            ],
          },
        ],
      },
    ],
  });
  render(<OfficePreview data={data} format="docx" path="table.docx" />);
  const table = await screen.findByRole("table", { name: "Document table" });
  const rows = table.querySelectorAll("tr");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.querySelectorAll("td")).toHaveLength(2);
  expect(rows[0]?.querySelector("td")?.getAttribute("rowspan")).toBe("2");
  expect(rows[0]?.querySelector("td")?.textContent).toBe("First paragraph\nSecond paragraph");
  expect(screen.getByRole("cell", { name: "Wide header" }).getAttribute("colspan")).toBe("2");
  expect([...rows[1]!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([
    "Left value",
    "Right value",
  ]);
});

it("navigates sheets without rerunning the parser and preserves column and row labels", async () => {
  load.mockResolvedValue({
    format: "xlsx",
    truncated: true,
    sections: [],
    sheets: [
      { name: "Budget", columns: 2, rows: [{ number: 3, cells: ["Revenue", "99"] }] },
      { name: "Notes", columns: 1, rows: [{ number: 1, cells: ["Second sheet"] }] },
    ],
  });
  render(<OfficePreview data={data} format="xlsx" path="book.xlsx" />);
  expect(await screen.findByRole("table", { name: "Sheet: Budget" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "B" })).toBeTruthy();
  expect(screen.getByRole("rowheader", { name: "3" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Preview truncated");
  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Sheet" }), "1");
  expect(screen.getByRole("table", { name: "Sheet: Notes" })).toBeTruthy();
  expect(screen.queryByText("Revenue")).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
});

it("navigates slides with bounded previous/next controls", async () => {
  load.mockResolvedValue({
    format: "pptx",
    truncated: false,
    sheets: [],
    sections: [
      { name: "Slide 1", blocks: [{ kind: "paragraph", level: 1, runs: [{ text: "Overview" }] }] },
      { name: "Slide 2", blocks: [{ kind: "paragraph", level: 1, runs: [{ text: "Results" }] }] },
    ],
  });
  render(<OfficePreview data={data} format="pptx" path="deck.pptx" />);
  expect(await screen.findByText("Overview")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous slide" }).hasAttribute("disabled")).toBe(
    true,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Next slide" }));
  expect(screen.getByText("Results")).toBeTruthy();
  expect(screen.getByText("Slide 2 of 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next slide" }).hasAttribute("disabled")).toBe(true);
});

it("discards a stale document load on refresh and shows a useful encrypted-file error", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof loadOfficePreview>>) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<OfficePreview data={data} format="docx" path="report.docx" />);
  expect(screen.getByText("Loading Office preview")).toBeTruthy();
  const signal = load.mock.calls[0]![2];
  load.mockRejectedValueOnce(new OfficePreviewError("encrypted"));
  view.rerender(<OfficePreview data={new Uint8Array([4])} format="docx" path="report.docx" />);
  expect(signal.aborted).toBe(true);
  expect(await screen.findByText(/Encrypted or password-protected/)).toBeTruthy();
  resolve({
    format: "docx",
    truncated: false,
    sheets: [],
    sections: [
      {
        name: "Document",
        blocks: [{ kind: "paragraph", level: 1, runs: [{ text: "Stale document" }] }],
      },
    ],
  });
  await vi.waitFor(() => expect(screen.queryByText("Stale document")).toBeNull());
});
