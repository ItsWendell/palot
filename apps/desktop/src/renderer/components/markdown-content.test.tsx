import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../shared";
import { remoteMarkdownFaviconsAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import {
  isLocalMarkdownWebLink,
  MarkdownContent,
  MarkdownWorkspaceProvider,
} from "./markdown-content";
import { MermaidLightbox } from "./markdown-rich";

afterEach(cleanup);

function pinchWheelEvent(bubbles = true) {
  const event = new WheelEvent("wheel", { bubbles, cancelable: true, deltaY: -10 });
  // Happy DOM's WheelEvent omits MouseEvent modifiers and coordinates.
  Object.defineProperties(event, {
    ctrlKey: { value: true },
    clientX: { value: 100 },
    clientY: { value: 100 },
  });
  return event;
}

describe("MarkdownContent", () => {
  it("offers shell paste and HTML preview through the task's action handlers", () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const preview = vi.fn();
    render(
      <MarkdownWorkspaceProvider onOpenFile={vi.fn()} runCode={run} previewHTML={preview}>
        <MarkdownContent value={"```bash\necho safe\n```\n\n```html\n<h1>Isolated</h1>\n```"} />
      </MarkdownWorkspaceProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run in terminal" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("echo safe");
    fireEvent.click(screen.getByRole("button", { name: "Preview HTML" }));
    expect(preview).toHaveBeenCalledExactlyOnceWith("<h1>Isolated</h1>");
    expect(screen.queryByRole("heading", { name: "Isolated" })).toBeNull();
  });
  it("retains code wrapping through streaming settlement without changing text and toggles back", () => {
    const text = "echo original command";
    const store = createStore();
    const contents = (streaming: boolean) => (
      <Provider store={store}>
        <MarkdownContent value={`\`\`\`bash\n${text}\n\`\`\``} streaming={streaming} />
      </Provider>
    );
    const view = render(contents(true));
    fireEvent.click(screen.getByRole("button", { name: "Wrap code" }));
    expect(view.container.querySelector("pre")?.style.whiteSpace).toBe("pre-wrap");
    view.rerender(contents(false));
    expect(view.container.querySelector("pre")?.style.whiteSpace).toBe("pre-wrap");
    expect(view.container.querySelector("pre")?.textContent).toBe(text);
    fireEvent.click(screen.getByRole("button", { name: "Unwrap code" }));
    expect(view.container.querySelector("pre")?.style.whiteSpace).toBe("");
  });
  it("renders disabled task checkboxes and enables only document draft edits", () => {
    const value = "- [ ] first\n- [x] done";
    const edit = vi.fn();
    const view = render(<MarkdownContent value={value} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
    view.rerender(<MarkdownContent value={value} onTaskEdit={edit} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(edit).toHaveBeenCalledExactlyOnceWith("- [ ] first\n- [ ] done");
  });
  it("links complete session tokens in prose and standalone inline code without changing copy text", () => {
    const id = "ses_0123456789abcdefghijklmnop";
    const openSession = vi.fn();
    const value = `Open ${id}, then \`${id}\`. **${id}**`;
    const view = render(
      <MarkdownWorkspaceProvider onOpenFile={vi.fn()} onOpenSession={openSession}>
        <MarkdownContent value={value} />
      </MarkdownWorkspaceProvider>,
    );
    const buttons = screen.getAllByRole("button", { name: id });
    expect(buttons).toHaveLength(3);
    expect(buttons[1]!.querySelector("code")?.textContent).toBe(id);
    fireEvent.click(buttons[1]!);
    expect(openSession).toHaveBeenCalledWith(id);
    expect(view.container.textContent).toBe(`Open ${id}, then ${id}. ${id}`);
  });

  it("never links partial IDs, paths, snippets, fences, or existing links", () => {
    const id = "ses_0123456789abcdefghijklmnop";
    render(
      <MarkdownWorkspaceProvider onOpenFile={vi.fn()} onOpenSession={vi.fn()}>
        <MarkdownContent
          value={`ses_123 x${id} ${id}extra dir/${id} ${id}.ts\n\n\`const id = '${id}'\`\n\n[${id}](https://example.com/${id})\n\n\`\`\`text\n${id}\n\`\`\``}
        />
      </MarkdownWorkspaceProvider>,
    );
    expect(screen.queryByRole("button", { name: id })).toBeNull();
  });

  it("waits for a token boundary during streaming and leaves unclosed inline code alone", () => {
    const id = "ses_0123456789abcdefghijklmnop";
    const content = (value: string) => (
      <MarkdownWorkspaceProvider onOpenFile={vi.fn()} onOpenSession={vi.fn()}>
        <MarkdownContent value={value} streaming />
      </MarkdownWorkspaceProvider>
    );
    const view = render(content(`See ${id.slice(0, -1)}`));
    expect(screen.queryByRole("button", { name: id })).toBeNull();
    view.rerender(content(`See ${id}`));
    expect(screen.queryByRole("button", { name: id })).toBeNull();
    view.rerender(content(`See ${id}. Next`));
    expect(screen.getByRole("button", { name: id })).toBeTruthy();
    view.rerender(content(`See \`${id}`));
    expect(screen.queryByRole("button", { name: id })).toBeNull();
    view.rerender(content(`See \`${id} is still unclosed`));
    expect(screen.queryByRole("button", { name: id })).toBeNull();
    view.rerender(content(`See \`${id}\``));
    expect(screen.getByRole("button", { name: id })).toBeTruthy();
  });

  it("does not invent a session destination outside a task's scoped provider", () => {
    const id = "ses_0123456789abcdefghijklmnop";
    render(<MarkdownContent value={`Open ${id}`} />);
    expect(screen.queryByRole("button", { name: id })).toBeNull();
  });
  it("renders reasoning emphasis as Markdown", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="**Planning the story continuation**" />,
    );

    expect(html).toContain("<strong>Planning the story continuation</strong>");
    expect(html).not.toContain("**Planning");
  });

  it("uses the shared chat typesetting rhythm", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="Readable response" />);

    expect(html).toContain('class="markdown typeset-chat select-text"');
  });

  it("sanitizes unsafe reasoning markup", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value={'Safe <script>alert("unsafe")</script>'} />,
    );

    expect(html).toContain("Safe");
    expect(html).not.toContain("<script>");
  });

  it("renders streaming text synchronously without Markdown repair", () => {
    const view = render(<MarkdownContent value="Planning **the next step" streaming />);

    expect(view.container.textContent).toContain("Planning **the next step");
    expect(view.container.querySelector("strong")).toBeNull();
  });

  it("animates and highlights streamed fenced code", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(<MarkdownContent value={"```ts\nconst value"} streaming />);
    await waitFor(() =>
      expect(view.container.querySelector(".markdown-highlight pre.th-code")).toBeTruthy(),
    );
    const liveCode = view.container.querySelector(".markdown-highlight pre.th-code code");

    expect(liveCode?.textContent).toBe("const value");
    expect(liveCode?.querySelector("[data-markdown-stream-code]")).toBeTruthy();

    now.mockReturnValue(200);
    view.rerender(<MarkdownContent value={"```ts\nconst value = 1;"} streaming />);
    await waitFor(() =>
      expect(
        view.container.querySelector(".markdown-highlight pre.th-code code")?.textContent,
      ).toBe("const value = 1;"),
    );
    expect(
      [...view.container.querySelectorAll("[data-markdown-stream-code]")].some((element) =>
        element.textContent?.includes("="),
      ),
    ).toBe(true);

    now.mockReturnValue(600);
    view.rerender(
      <MarkdownContent value={"```ts\nconst value = 1;\n```\n\nStill streaming"} streaming />,
    );

    await waitFor(() => expect(view.container.querySelector(".markdown-highlight")).toBeTruthy());
    expect(view.container.querySelector(".markdown-highlight pre.th-code")?.textContent).toContain(
      "const value",
    );
    now.mockRestore();
  });

  it("highlights a settled code block while a later block keeps streaming", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const view = render(
      <MarkdownContent value={"```ts\nconst value = 1\n```\n\nStill"} streaming />,
    );
    await waitFor(() => expect(view.container.querySelector(".markdown-highlight")).toBeTruthy());

    now.mockReturnValue(400);
    view.rerender(
      <MarkdownContent value={"```ts\nconst value = 1\n```\n\nStill streaming"} streaming />,
    );

    await waitFor(() => expect(view.container.querySelector(".markdown-highlight")).toBeTruthy());
    expect(view.container.querySelector(".markdown-highlight pre.th-code")?.textContent).toContain(
      "const value = 1",
    );
    now.mockRestore();
  });

  it("formats completed Markdown constructs while streaming", () => {
    const view = render(<MarkdownContent value="Planning **the next step**" streaming />);

    expect(view.container.querySelector("strong")?.textContent).toBe("the next step");
  });

  it("keeps incomplete streaming links non-clickable", () => {
    const view = render(
      <MarkdownContent value="See [the docs](https://example.com/gu" streaming />,
    );

    expect(view.container.textContent).toContain("See [the docs](https://example.com/gu");
    expect(view.container.querySelector("a")).toBeNull();
  });

  it("removes temporary streaming word elements when the message completes", () => {
    const view = render(<MarkdownContent value="Current response" streaming />);
    expect(view.container.querySelector("[data-markdown-stream-word]")).not.toBeNull();

    view.rerender(<MarkdownContent value="Current response" />);

    expect(view.container.querySelector("[data-markdown-stream-word]")).toBeNull();
    expect(view.container.textContent).toBe("Current response");
  });

  it("resolves reference links across the completed document", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value={"See [the docs][docs].\n\n[docs]: https://example.com"} />,
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("the docs");
  });

  it("renders the supported table, task-list, and strikethrough profile", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        value={"| State | Value |\n| --- | --- |\n| Done | ~~old~~ new |\n\n- [x] Shipped"}
      />,
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("copies fenced code from a code block", async () => {
    const browserWriteText = vi.fn().mockRejectedValue(new Error("Write permission denied."));
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: browserWriteText },
    });
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { writeClipboardText },
    });
    const view = render(<MarkdownContent value={"```ts\nconst value = 1\n```"} />);

    fireEvent.click(view.container.querySelector('button[aria-label="Copy code"]')!);

    expect(writeClipboardText).toHaveBeenCalledWith("const value = 1");
    expect(browserWriteText).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.container.querySelector('button[aria-label="Copied"]')).toBeTruthy(),
    );
  });

  it("renders safe collapsible details sections", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        value={"<details open>\n<summary>More context</summary>\n\nExtra **context**.\n</details>"}
      />,
    );

    expect(html).toContain("<details open");
    expect(html).toContain("More context");
    expect(html).toContain("<strong>context</strong>");
    expect(html).not.toContain("<summary>More context</summary>");
  });

  it("renders GitHub alerts and footnotes", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        value={
          "> [!WARNING] Take care\n> This is important.\n\nSee the note[^1].\n\n[^1]: Supporting detail."
        }
      />,
    );

    expect(html).toContain("markdown-alert-warning");
    expect(html).toContain("Take care");
    expect(html).toContain('data-footnotes=""');
    expect(html).toContain("Supporting detail.");
  });

  it("keeps fragment navigation inside its Markdown instance", () => {
    const view = render(<MarkdownContent value={"[Jump](#target)\n\n## Target"} />);
    const target = view.getByRole("heading", { name: "Target" });
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const previousHash = window.location.hash;

    fireEvent.click(view.getByRole("link", { name: "Jump" }));

    expect(window.location.hash).toBe(previousHash);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(view.getByRole("link", { name: "Jump" }).getAttribute("href")).toBe(`#${target.id}`);
  });

  it("scopes footnote ids per Markdown instance", () => {
    const view = render(
      <>
        <MarkdownContent value={"First[^1].\n\n[^1]: One."} />
        <MarkdownContent value={"Second[^1].\n\n[^1]: Two."} />
      </>,
    );
    const footnotes = [
      ...view.container.querySelectorAll<HTMLElement>('li[id*="user-content-fn-1"]'),
    ];

    expect(footnotes).toHaveLength(2);
    expect(footnotes[0]?.id).not.toBe(footnotes[1]?.id);
  });

  it("supports code metadata for filenames, line numbers, and highlights", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value={"```ts {1} lineNumbers file=example.ts\nconst value = 1\n```"} />,
    );

    expect(html).toContain("example.ts");
    expect(html).toContain('data-line-numbers="true"');
    expect(html).toContain('class="th-line th-line--highlighted" data-line="1"');
  });

  it("offers spreadsheet-friendly table copy formats", async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { writeClipboardText },
    });
    const view = render(<MarkdownContent value={"| Name | Value |\n| --- | --- |\n| One | 1 |"} />);

    fireEvent.click(view.container.querySelector('button[aria-label="Copy table"]')!);
    await waitFor(() => expect(document.body.textContent).toContain("Copy as TSV"));
    fireEvent.click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === "Copy as TSV",
      )!,
    );

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("Name\tValue\nOne\t1"));
  });

  it("renders block and inline math without blocking Markdown output", async () => {
    const view = render(<MarkdownContent value={"Inline $x^2$\n\n$$\ny = mx + b\n$$"} />);

    await waitFor(() => expect(view.container.querySelectorAll(".katex")).toHaveLength(2));
  });

  it("does not interpret currency or escaped dollars as inline math", async () => {
    const view = render(<MarkdownContent value={"Costs $5 and $10. Math $x^2$. Escaped \\$20."} />);

    await waitFor(() => expect(view.container.querySelectorAll(".katex")).toHaveLength(1));
    expect(view.container.textContent).toContain("Costs $5 and $10.");
    expect(view.container.textContent).toContain("Escaped $20.");
  });

  it("renders math beside punctuation without turning price ranges into formulas", async () => {
    const view = render(<MarkdownContent value={"Price $5-$10. Formula ($x^2$), then $y$!"} />);
    await waitFor(() => expect(view.container.querySelectorAll(".katex")).toHaveLength(2));
    expect(view.container.textContent).toContain("Price $5-$10.");
  });

  it("starts rendering Mermaid diagrams without a manual activation step", () => {
    const view = render(<MarkdownContent value={"```mermaid\ngraph TD\nA --> B\n```"} />);

    expect(view.queryByRole("button", { name: "Render diagram" })).toBeNull();
    expect(view.container.querySelector(".markdown-mermaid")).toBeNull();
    expect(view.container.textContent).toContain("Rendering diagram…");
  });

  it("zooms Mermaid previews with controls and trackpad pinch events", () => {
    render(
      <MermaidLightbox
        svg={'<svg viewBox="0 0 100 50"><rect width="100" height="50" /></svg>'}
        open
        onOpenChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Fit diagram to window" }).textContent).toBe("125%");
    const stage = document.querySelector<HTMLElement>(".markdown-mermaid-lightbox")!;
    expect(stage.style.width).toBe("125%");
    expect(stage.style.height).toBe("125%");

    // Direct target dispatch requires the native listener, not React's delegated handler.
    const pinch = pinchWheelEvent(false);
    fireEvent(stage.parentElement!, pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Fit diagram to window" }).textContent).toBe("138%");

    const secondPinch = pinchWheelEvent();
    fireEvent(stage.parentElement!, secondPinch);
    expect(secondPinch.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Fit diagram to window" }).textContent).toBe("153%");

    const pan = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 20 });
    fireEvent(stage.parentElement!, pan);
    expect(pan.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "Fit diagram to window" }).textContent).toBe("153%");
  });

  it("removes the Mermaid pinch listener on close and reattaches it on reopen", () => {
    const props = { svg: '<svg viewBox="0 0 100 50" />', onOpenChange: () => undefined };
    const view = render(<MermaidLightbox {...props} open={false} />);
    view.rerender(<MermaidLightbox {...props} open />);
    const frame = document.querySelector(".markdown-mermaid-lightbox")!.parentElement!;
    const first = pinchWheelEvent();
    fireEvent(frame, first);
    expect(first.defaultPrevented).toBe(true);

    view.rerender(<MermaidLightbox {...props} open={false} />);
    const closed = pinchWheelEvent();
    fireEvent(frame, closed);
    expect(closed.defaultPrevented).toBe(false);

    view.rerender(<MermaidLightbox {...props} open />);
    const reopenedFrame = document.querySelector(".markdown-mermaid-lightbox")!.parentElement!;
    const reopened = pinchWheelEvent();
    fireEvent(reopenedFrame, reopened);
    expect(reopened.defaultPrevented).toBe(true);
    view.unmount();
    const unmounted = pinchWheelEvent();
    fireEvent(reopenedFrame, unmounted);
    expect(unmounted.defaultPrevented).toBe(false);
  });

  it("supports safe image sizing hints", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        value={'![Diagram](https://example.com/diagram.png "width=320 height=180")'}
        passiveMedia
      />,
    );

    expect(html).toContain('width="320"');
    expect(html).toContain('height="180"');
  });

  it("renders ordinary ordered and unordered lists", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value={"- First\n- Second\n\n3. Third\n4. Fourth"} />,
    );

    expect(html).toContain("<ul>");
    expect(html).toContain('<ol start="3">');
  });

  it("stops repairing incomplete Markdown after streaming completes", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="Planning **the next step" />);

    expect(html).toContain("Planning **the next step");
    expect(html).not.toContain("<strong>");
  });

  it("keeps the streaming profile stable after completion", () => {
    const html = renderToStaticMarkup(<MarkdownContent value={"Complete response\n\n#"} />);

    expect(html).toContain("Complete response");
    expect(html).not.toContain("<h1");
  });

  it("preserves indented code blocks in completed Markdown", () => {
    const html = renderToStaticMarkup(<MarkdownContent value={"Before\n\n    const value = 1"} />);

    expect(html).toContain('data-language="plaintext"');
    expect(html).toContain("const value = 1");
  });

  it("preserves setext headings", () => {
    const html = renderToStaticMarkup(<MarkdownContent value={"Release notes\n============="} />);

    expect(html).toContain("<h1>Release notes</h1>");
  });

  it("resolves relative links against a supplied base URL", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="[Docs](/docs)" baseUrl="https://example.com/guide/" />,
    );

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("Docs");
  });

  it("uses a local globe without requesting a remote favicon by default", () => {
    const view = render(<MarkdownContent value="[Docs](https://docs.example.org/guide)" />);

    expect(view.container.querySelector(".markdown-link-icon svg")).toBeTruthy();
    expect(view.container.querySelector(".markdown-link-favicon")).toBeNull();
  });

  it("loads a DuckDuckGo favicon only after the preference is enabled", () => {
    const store = createStore();
    store.set(remoteMarkdownFaviconsAtom, true);
    const view = render(
      <Provider store={store}>
        <MarkdownContent value="[Docs](https://docs.github.com/en/rest?token=secret)" />
      </Provider>,
    );

    expect(view.container.querySelector<HTMLImageElement>(".markdown-link-favicon")?.src).toBe(
      "https://icons.duckduckgo.com/ip9/docs.github.com.ico",
    );
  });

  it("loads favicons for links nested in Markdown structures", () => {
    const store = createStore();
    store.set(remoteMarkdownFaviconsAtom, true);
    const view = render(
      <Provider store={store}>
        <MarkdownContent
          value={
            "> [Quoted](https://quoted.example.org/docs)\n\n| Link |\n| --- |\n| [Cell](https://table.example.org/docs) |"
          }
        />
      </Provider>,
    );

    expect(
      Array.from(view.container.querySelectorAll<HTMLImageElement>(".markdown-link-favicon")).map(
        (image) => image.src,
      ),
    ).toEqual([
      "https://icons.duckduckgo.com/ip9/quoted.example.org.ico",
      "https://icons.duckduckgo.com/ip9/table.example.org.ico",
    ]);
  });

  it("links plain HTTP URLs without requiring explicit Markdown syntax", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="Read https://example.com/docs for details." />,
    );

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("https://example.com/docs");
    expect(html).toContain("</a> for details.");
  });

  it("preserves balanced URL punctuation and GFM-style email links", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="See https://example.com/docs(v2) or https://user@example.com/docs. Email team@example.com." />,
    );

    expect(html).toContain('href="https://example.com/docs(v2)"');
    expect(html).toContain("https://example.com/docs(v2)");
    expect(html).toContain('href="https://user@example.com/docs"');
    expect(html).toContain("https://user@example.com/docs");
    expect(html).toContain('href="mailto:team@example.com"');
    expect(html).toContain("team@example.com");
  });

  it("trims GFM trailing punctuation and quotes from bare URLs", () => {
    const view = render(
      <MarkdownContent
        value={`Use "https://example.com/a", 'https://example.com/b'; or https:// alone.`}
      />,
    );

    expect(
      Array.from(view.container.querySelectorAll("a")).map((link) => link.getAttribute("href")),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(view.container.textContent).toContain("or https:// alone.");
  });

  it("links inline code that is exactly a web URL and routes it like other web links", () => {
    const openWebLink = vi.fn();
    const view = render(
      <MarkdownWorkspaceProvider onOpenFile={vi.fn()} onOpenWebLink={openWebLink}>
        <MarkdownContent
          value={
            "Open `https://example.com/docs?q=1).` now, not `open https://example.com now`, `https://example.com/a(b)`, `ftp://example.com`, or [`https://example.com/x`](https://example.org/y).\n\n```\nhttps://example.com/fenced\n```"
          }
        />
      </MarkdownWorkspaceProvider>,
    );

    const links = Array.from(view.container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/docs?q=1",
      "https://example.org/y",
    ]);
    expect(links[0]!.querySelector("code")?.textContent).toBe("https://example.com/docs?q=1).");
    expect(links[0]!.querySelector(".markdown-link-icon")).toBeTruthy();
    fireEvent.click(links[0]!);
    expect(openWebLink).toHaveBeenCalledWith("https://example.com/docs?q=1");
  });

  it("shows a site icon only on labelled web links", () => {
    const view = render(
      <MarkdownContent
        value={
          "Mail team@example.com or [![Logo](https://example.com/logo.png)](https://example.com)"
        }
        passiveMedia
      />,
    );

    expect(view.container.querySelectorAll("a")).toHaveLength(2);
    expect(view.container.querySelector(".markdown-link-icon")).toBeNull();
  });

  it("removes executable link protocols", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="[Unsafe](javascript:alert(1))" />);

    expect(html).not.toContain("javascript:");
  });

  it("blocks passive images by default", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="![Architecture](diagram.png)" />);

    expect(html).toContain("[Image: Architecture]");
    expect(html).not.toContain("<img");
  });

  it.each(["javascript:alert(1)", "file:///outside/image.png"])(
    "rejects unsafe image destination %s even with passive media enabled",
    (destination) => {
      const html = renderToStaticMarkup(
        <MarkdownContent value={`![Tracker](${destination})`} passiveMedia />,
      );

      expect(html).toContain("[Image: Tracker]");
      expect(html).not.toContain("<img");
    },
  );

  it("opens standalone Markdown images in the shared lightbox", () => {
    render(
      <MarkdownContent value="![Architecture](https://example.com/diagram.png)" passiveMedia />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open image preview: Architecture" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Architecture")).toBeTruthy();
    expect(screen.getByText("image/png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
  });

  describe("local workspace images", () => {
    afterEach(() => vi.restoreAllMocks());

    const runtime: OpenCodeRuntimeStatus = {
      profileID: "local",
      connectionID: "local-connection",
      connected: true,
      phase: "connected",
      contractVersion: "test",
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    };

    function renderInTask(value: string, openFile = vi.fn()) {
      const store = createStore();
      store.set(runtimeAtom, runtime);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <MarkdownWorkspaceProvider
              onOpenFile={openFile}
              workspaceDirectory="/repo"
              workspaceLocation={{ directory: "/repo" }}
            >
              <MarkdownContent value={value} />
            </MarkdownWorkspaceProvider>
          </Provider>
        </QueryClientProvider>,
      );
      return { view, openFile };
    }

    it("renders workspace and embedded media players but leaves web media as an ordinary link", async () => {
      const read = vi.spyOn(palot, "readWorkspaceFile").mockResolvedValue(new Uint8Array([0, 1]));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:workspace-video");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const { view } = renderInTask(
        "[Video](clips/demo.mp4)\n\n[Audio](data:audio/wav;base64,AAAA)\n\n[Remote](https://example.com/track.mp3)",
      );
      await waitFor(() =>
        expect(view.container.querySelector("video")?.getAttribute("src")).toBe(
          "blob:workspace-video",
        ),
      );
      expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(
        "data:audio/wav;base64,AAAA",
      );
      expect(screen.getByRole("link", { name: "Remote" }).getAttribute("href")).toBe(
        "https://example.com/track.mp3",
      );
      expect(read).toHaveBeenCalledExactlyOnceWith(
        { directory: "/repo", path: "clips/demo.mp4" },
        expect.anything(),
        "local-connection",
      );
    });

    it("offers save and copy in an image context menu", async () => {
      renderInTask("![Fixture](data:image/png;base64,AAAA)");
      fireEvent.contextMenu(screen.getByRole("img", { name: "Fixture" }));
      expect(await screen.findByRole("menuitem", { name: "Save image as…" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Copy image" })).toBeTruthy();
    });

    it("reads workspace images through the task's server and shows them inline", async () => {
      const read = vi
        .spyOn(palot, "readWorkspaceFile")
        .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:workspace-image");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

      renderInTask("![After: palette](/repo/.local/qa/palette.png)");

      // The read and blob URL settle asynchronously; allow for a loaded full-suite run.
      const image = await screen.findByRole("img", { name: "After: palette" }, { timeout: 5000 });
      expect(image.getAttribute("src")).toBe("blob:workspace-image");
      expect(read).toHaveBeenCalledWith(
        { directory: "/repo", path: ".local/qa/palette.png" },
        expect.anything(),
        "local-connection",
      );
      expect(
        screen.getByRole("button", { name: "Open image preview: After: palette" }),
      ).toBeTruthy();
    });

    it("keeps images outside the workspace actionable without reading them", () => {
      const read = vi.spyOn(palot, "readWorkspaceFile");
      const { openFile } = renderInTask("![Log](/tmp/elsewhere/shot.png)");

      fireEvent.click(screen.getByRole("button", { name: "Open image /tmp/elsewhere/shot.png" }));

      expect(openFile).toHaveBeenCalledWith({ path: "/tmp/elsewhere/shot.png" }, expect.anything());
      expect(read).not.toHaveBeenCalled();
    });

    it("still gates remote images inside a task", () => {
      const read = vi.spyOn(palot, "readWorkspaceFile");
      const { view } = renderInTask("![Tracker](https://example.com/pixel.png)");

      expect(view.container.textContent).toContain("[Image: Tracker]");
      expect(view.container.querySelector("img")).toBeNull();
      expect(read).not.toHaveBeenCalled();
    });
  });

  it("preserves linked Markdown images as links", () => {
    const view = render(
      <MarkdownContent
        value="[![Architecture](https://example.com/diagram.png)](https://example.com/docs)"
        passiveMedia
      />,
    );

    expect(screen.getByRole("link", { name: "Architecture" })).toBeTruthy();
    expect(view.container.querySelector("button")).toBeNull();
  });

  it("renders inline workspace paths as file links", () => {
    const openFile = vi.fn();
    const view = render(
      <MarkdownWorkspaceProvider onOpenFile={openFile}>
        <MarkdownContent value="Open `apps/desktop/src/renderer/components/thread.tsx:58`." />
      </MarkdownWorkspaceProvider>,
    );

    const fileLink = screen.getByRole("link", {
      name: "Open apps/desktop/src/renderer/components/thread.tsx (line 58)",
    });
    fireEvent.click(fileLink);

    expect(openFile).toHaveBeenCalledWith(
      {
        path: "apps/desktop/src/renderer/components/thread.tsx",
        line: 58,
      },
      expect.anything(),
    );
    expect(fileLink.closest("code")).toBeNull();
    expect(view.container.querySelector("code")).toBeNull();
    expect(screen.queryByText("apps/desktop/src/renderer/components/thread.tsx:58")).toBeNull();
  });

  it("opens agent-referenced workspace media in the same file tabs", () => {
    const openFile = vi.fn();
    render(
      <MarkdownWorkspaceProvider onOpenFile={openFile} workspaceDirectory="/repo">
        <MarkdownContent value="Preview `diagram.png`, `guide.pdf`, and `tone.wav`." />
      </MarkdownWorkspaceProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open diagram.png" }));
    fireEvent.click(screen.getByRole("link", { name: "Open guide.pdf" }));
    fireEvent.click(screen.getByRole("link", { name: "Open tone.wav" }));

    expect(openFile).toHaveBeenNthCalledWith(1, { path: "diagram.png" }, expect.anything());
    expect(openFile).toHaveBeenNthCalledWith(2, { path: "guide.pdf" }, expect.anything());
    expect(openFile).toHaveBeenNthCalledWith(3, { path: "tone.wav" }, expect.anything());
  });

  it("opens relative Markdown file links without intercepting web links", () => {
    const openFile = vi.fn();
    render(
      <MarkdownWorkspaceProvider onOpenFile={openFile}>
        <MarkdownContent value="[README.md (line 3)](README.md#L3) and [Docs](https://example.com)" />
      </MarkdownWorkspaceProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open README.md (line 3)" }));

    expect(openFile).toHaveBeenCalledWith({ path: "README.md", line: 3 }, expect.anything());
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
      "https://example.com",
    );
  });

  it("keeps ordinary dotted inline code as code", () => {
    const openFile = vi.fn();
    const view = render(
      <MarkdownWorkspaceProvider onOpenFile={openFile}>
        <MarkdownContent value="Use `react.version` with `1.2.3`." />
      </MarkdownWorkspaceProvider>,
    );

    expect(view.container.querySelectorAll("code")).toHaveLength(2);
    expect(view.container.querySelector("button")).toBeNull();
  });

  it("keeps commands and identifiers as code and links home paths only locally", () => {
    const openFile = vi.fn();
    const view = render(
      <MarkdownWorkspaceProvider onOpenFile={openFile} workspaceDirectory="/repo">
        <MarkdownContent value="Run `npm test src/x.ts`, read `this.state`, open `~/notes/a.md`." />
      </MarkdownWorkspaceProvider>,
    );
    expect(view.container.querySelectorAll("code")).toHaveLength(3);
    expect(screen.queryByRole("link")).toBeNull();

    view.rerender(
      <MarkdownWorkspaceProvider onOpenFile={openFile} workspaceDirectory="/repo" allowHomePaths>
        <MarkdownContent value="Open `~/notes/a.md`." />
      </MarkdownWorkspaceProvider>,
    );
    const home = screen.getByRole("link", { name: "Open ~/notes/a.md" });
    expect(home.getAttribute("href")).toBeNull();
    fireEvent.keyDown(home, { key: "Enter" });
    expect(openFile).toHaveBeenCalledWith({ path: "~/notes/a.md" }, expect.anything());
  });

  it("handles absolute file paths and file:// URLs with native file hrefs", () => {
    const openFile = vi.fn();
    render(
      <MarkdownWorkspaceProvider onOpenFile={openFile} workspaceDirectory="/Users/example/project">
        <MarkdownContent value="Check `/tmp/build.log:25` and `<file:///Users/example/project/src/index.ts#L42>`." />
      </MarkdownWorkspaceProvider>,
    );

    const logLink = screen.getByRole("link", { name: "Open /tmp/build.log (line 25)" });
    expect(logLink.getAttribute("href")).toBe("file:///tmp/build.log#L25");
    fireEvent.click(logLink);
    expect(openFile).toHaveBeenCalledWith({ path: "/tmp/build.log", line: 25 }, expect.anything());

    const codeLink = screen.getByRole("link", {
      name: "Open /Users/example/project/src/index.ts (line 42)",
    });
    expect(codeLink.getAttribute("href")).toBe("file:///Users/example/project/src/index.ts#L42");
    fireEvent.click(codeLink);
    expect(openFile).toHaveBeenCalledWith(
      {
        path: "/Users/example/project/src/index.ts",
        line: 42,
      },
      expect.anything(),
    );

    // Cmd+click passes the modifier event
    fireEvent.click(codeLink, { metaKey: true });
    expect(openFile).toHaveBeenLastCalledWith(
      { path: "/Users/example/project/src/index.ts", line: 42 },
      expect.objectContaining({ metaKey: true }),
    );
  });

  it("resolves relative file links into file:// URLs using workspaceDirectory", () => {
    const openFile = vi.fn();
    render(
      <MarkdownWorkspaceProvider onOpenFile={openFile} workspaceDirectory="/Users/example/project">
        <MarkdownContent value="Open `src/main.ts:10`." />
      </MarkdownWorkspaceProvider>,
    );

    const link = screen.getByRole("link", { name: "Open src/main.ts (line 10)" });
    expect(link.getAttribute("href")).toBe("file:///Users/example/project/src/main.ts#L10");
  });

  it("opens external web URLs via palot.openExternalUrl on click", () => {
    const openExternalSpy = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    render(<MarkdownContent value="Visit [Website](http://example.com) for details." />);

    const link = screen.getByRole("link", { name: "Website" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.click(link);
    expect(openExternalSpy).toHaveBeenCalledWith("http://example.com");
  });

  it("routes web links through a thread provider only on deliberate click", () => {
    const openExternal = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    const openWebLink = vi.fn();
    const openFile = vi.fn();
    render(
      <>
        <MarkdownWorkspaceProvider onOpenFile={openFile} onOpenWebLink={openWebLink}>
          <MarkdownContent value="[Task link](https://example.com/docs) and [File](README.md)" />
        </MarkdownWorkspaceProvider>
        <MarkdownContent value="[Outside](https://outside.example.com)" />
      </>,
    );

    expect(openWebLink).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Task link" }));
    expect(openWebLink).toHaveBeenCalledExactlyOnceWith("https://example.com/docs");
    expect(openExternal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Outside" }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://outside.example.com");
    fireEvent.click(screen.getByRole("link", { name: "Open README.md" }));
    expect(openFile).toHaveBeenCalledExactlyOnceWith({ path: "README.md" }, expect.anything());
    expect(openWebLink).toHaveBeenCalledTimes(1);
  });

  it("recognizes localhost and IPv4/IPv6 loopback links as local", () => {
    for (const href of [
      "http://localhost:3000",
      "http://localhost.:3000",
      "http://0.0.0.0:3000",
      "http://[::]:3000",
      "https://app.localhost/docs",
      "http://127.42.0.1:8000",
      "http://[::1]:8080",
      "http://[::ffff:127.0.0.1]:9000",
    ]) {
      expect(isLocalMarkdownWebLink(new URL(href)), href).toBe(true);
    }
    for (const href of ["https://example.com", "https://notlocalhost.com", "http://192.168.1.1"]) {
      expect(isLocalMarkdownWebLink(new URL(href)), href).toBe(false);
    }
  });
});
