import { Provider, createStore } from "jotai";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotApi, PalotMessage } from "../../shared";
import { palot } from "../services/palot";
import { LinkActionsProvider, LinkedText, type LinkActions } from "./link-actions";
import { MarkdownContent, MarkdownWorkspaceProvider } from "./markdown-content";
import { TimelineBoundary } from "./transcript/timeline-parts";
import { SubagentRequests } from "./composer/composer-requests";

const writeClipboardText = vi.fn<(value: string) => Promise<void>>();

function installBridge(overrides: Partial<Record<keyof PalotApi, unknown>> = {}) {
  writeClipboardText.mockReset().mockResolvedValue(undefined);
  (window as unknown as { palot?: PalotApi }).palot = {
    platform: "linux",
    homeDirectory: "/home/me",
    runtimeStatus: vi.fn(),
    writeClipboardText,
    ...overrides,
  } as unknown as PalotApi;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { palot?: PalotApi }).palot;
});

const LOCAL: LinkActions = {
  connectionID: "conn_1",
  sessionID: "ses_1",
  taskDirectory: "/home/me/Projects/demo",
  homeDirectory: "/home/me",
  localPathActions: true,
};

function renderReply(value: string, actions: LinkActions, onOpenFile = vi.fn()) {
  render(
    <Provider store={createStore()}>
      <LinkActionsProvider value={actions}>
        <MarkdownWorkspaceProvider
          onOpenFile={onOpenFile}
          workspaceDirectory={actions.taskDirectory}
          homeDirectory={actions.homeDirectory}
          allowHomePaths={actions.localPathActions}
        >
          <MarkdownContent value={value} />
        </MarkdownWorkspaceProvider>
      </LinkActionsProvider>
    </Provider>,
  );
  return onOpenFile;
}

function openMenu(link: HTMLElement) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 20,
    button: 2,
  });
  link.dispatchEvent(event);
  return event;
}

async function menuItems() {
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

describe("file link menu", () => {
  it("resolves ~ against the server home for the href, click, and Copy path", async () => {
    installBridge();
    vi.spyOn(palot, "externalOpenTargets").mockResolvedValue([
      { id: "zed", label: "Zed", kind: "editor", iconDataUrl: null, preferred: true },
      { id: "finder", label: "Files", kind: "file-manager", iconDataUrl: null, preferred: false },
    ]);
    const openFileInBrowser = vi.fn().mockResolvedValue(undefined);
    const onOpenFile = renderReply("Open `~/Projects/demo/.private/report/index.html`.", {
      ...LOCAL,
      openFileInBrowser,
    });
    const link = screen.getByRole("link", {
      name: "Open ~/Projects/demo/.private/report/index.html",
    });
    expect(link.getAttribute("href")).toBe(
      "file:///home/me/Projects/demo/.private/report/index.html",
    );

    const event = openMenu(link);
    // The native menu skips events a renderer menu already handled.
    expect(event.defaultPrevented).toBe(true);
    await waitFor(async () =>
      expect(await menuItems()).toEqual([
        "Open",
        "Open in Palot Browser",
        "Open in Zed",
        "Show in File Manager",
        "Copy path",
        "Copy relative path",
      ]),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenCalledWith(
        "/home/me/Projects/demo/.private/report/index.html",
      ),
    );

    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy relative path" }));
    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenLastCalledWith(".private/report/index.html"),
    );

    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in Palot Browser" }));
    expect(openFileInBrowser).toHaveBeenCalledWith(
      "/home/me/Projects/demo/.private/report/index.html",
    );

    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open" }));
    expect(onOpenFile).toHaveBeenCalledWith(
      { path: "~/Projects/demo/.private/report/index.html" },
      expect.objectContaining({ currentTarget: link }),
    );
  });

  it("opens the preferred editor and the file manager with the expanded path", async () => {
    installBridge();
    vi.spyOn(palot, "externalOpenTargets").mockResolvedValue([
      { id: "vscode", label: "VS Code", kind: "editor", iconDataUrl: null, preferred: true },
    ]);
    const externalOpen = vi
      .spyOn(palot, "externalOpen")
      .mockResolvedValue({ openedTargetID: "vscode" });
    const reveal = vi.spyOn(palot, "revealFileInFinder").mockResolvedValue(true);
    // Editor targets are cached per task, so this task has not asked before.
    renderReply("See `~/notes/todo.md:12`.", { ...LOCAL, sessionID: "ses_2" });
    const link = screen.getByRole("link", { name: "Open ~/notes/todo.md (line 12)" });

    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in VS Code" }));
    expect(externalOpen).toHaveBeenCalledWith(
      {
        resource: { kind: "file", path: "/home/me/notes/todo.md", line: 12, sessionID: "ses_2" },
        targetID: "vscode",
      },
      "conn_1",
    );
    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show in File Manager" }));
    expect(reveal).toHaveBeenCalledWith("/home/me/notes/todo.md", "conn_1");
    // Outside the task folder there is no relative path to copy.
    openMenu(link);
    expect(await menuItems()).not.toContain("Copy relative path");
  });

  it("keeps only server-side actions for a remote connection", async () => {
    installBridge();
    const targets = vi.spyOn(palot, "externalOpenTargets");
    renderReply("Edit `src/app.ts`.", {
      connectionID: "remote",
      sessionID: "ses_1",
      taskDirectory: "/srv/app",
      homeDirectory: undefined,
      localPathActions: false,
    });
    openMenu(screen.getByRole("link", { name: "Open src/app.ts" }));
    expect(await menuItems()).toEqual(["Open", "Copy path", "Copy relative path"]);
    expect(targets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("/srv/app/src/app.ts"));
  });

  it("keeps a ~ link openable and copyable when the home is unknown", async () => {
    installBridge();
    renderReply("Read `~/notes/a.md`.", { ...LOCAL, homeDirectory: undefined });
    const link = screen.getByRole("link", { name: "Open ~/notes/a.md" });
    expect(link.getAttribute("href")).toBeNull();
    openMenu(link);
    expect(await menuItems()).toEqual(["Open", "Copy path"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("~/notes/a.md"));
  });

  it("opens from the keyboard with Shift+F10 and the context-menu key", async () => {
    installBridge();
    const user = userEvent.setup();
    renderReply("Edit `src/app.ts` and [docs](https://example.com/docs).", {
      ...LOCAL,
      localPathActions: false,
    });
    const file = screen.getByRole("link", { name: "Open src/app.ts" });
    file.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu", { name: "File actions for src/app.ts" });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Open"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu.isConnected).toBe(false));
    expect(document.activeElement).toBe(file);

    const web = screen.getByRole("link", { name: "docs" });
    web.focus();
    fireEvent.keyDown(web, { key: "ContextMenu" });
    expect(
      await screen.findByRole("menu", { name: "Link actions for https://example.com/docs" }),
    ).toBeTruthy();
  });
});

describe("web link menu", () => {
  it("offers Palot Browser, the default browser and Copy link, keeping left click", async () => {
    installBridge();
    const openWebLink = vi.fn();
    renderReply("Read [the docs](https://example.com/docs).", {
      ...LOCAL,
      openWebLink,
      browserAvailable: true,
    });
    const external = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    const link = screen.getByRole("link", { name: "the docs" });
    fireEvent.click(link);
    expect(external).toHaveBeenCalledWith("https://example.com/docs");
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu(link);
    expect(await menuItems()).toEqual([
      "Open in Palot Browser",
      "Open in default browser",
      "Copy link",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Palot Browser" }));
    expect(openWebLink).toHaveBeenCalledWith("https://example.com/docs", "browser");
    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open in default browser" }));
    expect(openWebLink).toHaveBeenLastCalledWith("https://example.com/docs", "external");
    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenCalledWith("https://example.com/docs"),
    );
  });

  it("offers Copy for a selection that touches the link, and not for one elsewhere", async () => {
    installBridge();
    render(
      <LinkActionsProvider value={LOCAL}>
        <p data-testid="linked">
          <LinkedText text="Read https://example.com/a for details" />
        </p>
        <p data-testid="other">Unrelated text</p>
      </LinkActionsProvider>,
    );
    const link = screen.getByRole("link", { name: "https://example.com/a" });
    const select = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };

    select(screen.getByTestId("other"));
    openMenu(link);
    expect(await menuItems()).toEqual(["Open in default browser", "Copy link"]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    select(screen.getByTestId("linked"));
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    openMenu(link);
    const copy = await screen.findByRole("menuitem", { name: "Copy" });
    expect(copy.textContent).toBe("CopyCtrl+C");
    expect(await menuItems()).toEqual(["CopyCtrl+C", "Open in default browser", "Copy link"]);
    // Focus moving into the menu must not lose what was selected.
    document.getSelection()!.removeAllRanges();
    fireEvent.click(copy);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.getSelection()!.toString()).toBe("Read https://example.com/a for details");
    // When the browser refuses the copy command, the selected text is copied as plain text.
    await waitFor(() =>
      expect(writeClipboardText).toHaveBeenCalledWith("Read https://example.com/a for details"),
    );

    execCommand.mockReturnValue(true);
    writeClipboardText.mockClear();
    openMenu(link);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy" }));
    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(writeClipboardText).not.toHaveBeenCalled();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it("stays open when the reply re-renders its link", async () => {
    installBridge();
    const view = render(
      <LinkActionsProvider value={LOCAL}>
        <p key="streaming">
          <LinkedText text="See https://example.com/a" />
        </p>
      </LinkActionsProvider>,
    );
    openMenu(screen.getByRole("link", { name: "https://example.com/a" }));
    await screen.findByRole("menu");
    view.rerender(
      <LinkActionsProvider value={LOCAL}>
        <p key="settled">
          <LinkedText text="See https://example.com/a" />
        </p>
      </LinkActionsProvider>,
    );
    expect(await menuItems()).toEqual(["Open in default browser", "Copy link"]);
  });

  it("opens externally outside a task, where Palot Browser is not offered", async () => {
    installBridge();
    const external = vi.spyOn(palot, "openExternalUrl").mockResolvedValue(true);
    render(<LinkedText text="Check https://status.example.com/incidents." />);
    const link = screen.getByRole("link", { name: "https://status.example.com/incidents" });
    openMenu(link);
    expect(await menuItems()).toEqual(["Open in default browser", "Copy link"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in default browser" }));
    expect(external).toHaveBeenCalledWith("https://status.example.com/incidents");
  });
});

describe("email link menu", () => {
  it("offers Copy email address for written and bare addresses", async () => {
    installBridge();
    renderReply(
      "Mail [support](mailto:help%2Bpalot@example.com?subject=Hi) or ada@example.com.",
      LOCAL,
    );
    openMenu(screen.getByRole("link", { name: "support" }));
    expect(await menuItems()).toEqual(["Copy email address"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy email address" }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("help+palot@example.com"));

    openMenu(screen.getByRole("link", { name: "ada@example.com" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy email address" }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenLastCalledWith("ada@example.com"));
  });
});

describe("linkified plain text", () => {
  function wrap(children: ReactNode) {
    return (
      <Provider store={createStore()}>
        <LinkActionsProvider value={{ ...LOCAL, openWebLink: vi.fn() }}>
          {children}
        </LinkActionsProvider>
      </Provider>
    );
  }
  const request = {
    title: "Request",
    detail: undefined,
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
    delivery: undefined,
  };

  it("links URLs in a question and a form field description", async () => {
    installBridge();
    render(
      wrap(
        <>
          <SubagentRequests
            sessionID="ses_1"
            requests={[
              {
                ...request,
                id: "que_1",
                type: "question",
                questions: [
                  {
                    header: "Docs",
                    question: "Did you read https://example.com/guide before continuing?",
                    multiple: false,
                    custom: false,
                    options: [{ label: "Yes" }],
                  },
                ],
              },
            ]}
          />
          <SubagentRequests
            sessionID="ses_1"
            requests={[
              {
                ...request,
                id: "form_1",
                type: "form",
                title: "Connect",
                detail: "Create a key at https://keys.example.com (needs admin).",
                fields: [
                  {
                    key: "token",
                    type: "string",
                    title: "Token",
                    description:
                      "Paste the token from https://keys.example.com/new, not `https://code.example`.",
                    required: true,
                    options: [],
                    custom: false,
                    when: [],
                  },
                ],
              },
            ]}
          />
        </>,
      ),
    );
    const guide = screen.getByRole("link", { name: "https://example.com/guide" });
    expect(guide.closest('[data-slot="questionnaire-title"]')).toBeTruthy();
    const form = within(screen.getByRole("region", { name: "Connect" }));
    expect(form.getByText(/Create a key at/)).toBeTruthy();
    expect(form.getByRole("link", { name: "https://keys.example.com" })).toBeTruthy();
    expect(form.getByRole("link", { name: "https://keys.example.com/new" })).toBeTruthy();
    expect(form.queryByRole("link", { name: "https://code.example" })).toBeNull();
    expect(form.getByText(/not `https:\/\/code\.example`/)).toBeTruthy();
    openMenu(guide);
    expect(await menuItems()).toContain("Copy link");
  });

  it("links URLs in a failed turn's error", () => {
    installBridge();
    const source = {
      id: "assistant-1",
      type: "assistant",
      createdAt: 1,
      completedAt: 2,
      text: null,
      agent: null,
      model: null,
      tokens: null,
      finish: "error",
      content: [],
      data: {},
    } satisfies PalotMessage;
    render(
      wrap(
        <TimelineBoundary
          group={{
            id: "error",
            kind: "boundary",
            title: "Response failed",
            status: "failed",
            entries: [
              {
                message: source,
                index: 0,
                part: {
                  type: "timeline-boundary",
                  name: "Response failed",
                  text: "Could not connect to http://localhost:11434/api. Check that Ollama is running.",
                  status: "failed",
                  data: { kind: "error", tone: "error" },
                },
              },
            ],
          }}
        />,
      ),
    );
    const alert = within(screen.getByRole("alert", { name: "Response failed" }));
    expect(alert.getByRole("link", { name: "http://localhost:11434/api" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Check that Ollama is running.");
  });
});
