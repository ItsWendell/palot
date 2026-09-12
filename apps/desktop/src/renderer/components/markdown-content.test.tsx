import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remoteMarkdownFaviconsAtom } from "../atoms/ui";
import { palot } from "../services/palot";
import { MarkdownContent, MarkdownWorkspaceProvider } from "./markdown-content";
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
  it("renders reasoning emphasis as Markdown", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="**Planning the story continuation**" />,
    );

    expect(html).toContain("<strong>Planning the story continuation</strong>");
    expect(html).not.toContain("**Planning");
  });

  it("uses the shared chat typesetting rhythm", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="Readable response" />);

    expect(html).toContain('class="markdown typeset-chat"');
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

  it("removes executable link protocols", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="[Unsafe](javascript:alert(1))" />);

    expect(html).not.toContain("javascript:");
  });

  it("blocks passive images by default", () => {
    const html = renderToStaticMarkup(<MarkdownContent value="![Architecture](diagram.png)" />);

    expect(html).toContain("[Image: Architecture]");
    expect(html).not.toContain("<img");
  });

  it("rejects non-web image protocols when passive media is explicitly enabled", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent value="![Tracker](data:image/png;base64,AAAA)" passiveMedia />,
    );

    expect(html).toContain("[Image: Tracker]");
    expect(html).not.toContain("<img");
  });

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

    expect(openFile).toHaveBeenCalledWith({
      path: "apps/desktop/src/renderer/components/thread.tsx",
      line: 58,
    });
    expect(fileLink.closest("code")).toBeNull();
    expect(view.container.querySelector("code")).toBeNull();
    expect(screen.queryByText("apps/desktop/src/renderer/components/thread.tsx:58")).toBeNull();
  });

  it("opens relative Markdown file links without intercepting web links", () => {
    const openFile = vi.fn();
    render(
      <MarkdownWorkspaceProvider onOpenFile={openFile}>
        <MarkdownContent value="[README.md (line 3)](README.md#L3) and [Docs](https://example.com)" />
      </MarkdownWorkspaceProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open README.md (line 3)" }));

    expect(openFile).toHaveBeenCalledWith({ path: "README.md", line: 3 });
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
    expect(openFile).toHaveBeenCalledWith({ path: "/tmp/build.log", line: 25 });

    const codeLink = screen.getByRole("link", {
      name: "Open /Users/example/project/src/index.ts (line 42)",
    });
    expect(codeLink.getAttribute("href")).toBe("file:///Users/example/project/src/index.ts#L42");
    fireEvent.click(codeLink);
    expect(openFile).toHaveBeenCalledWith({
      path: "/Users/example/project/src/index.ts",
      line: 42,
    });

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
});
