import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type {
  OpenCodeRuntimeCapabilities,
  PalotApi,
  PalotFileAttachment,
  PalotSession,
} from "../../../shared";
import { saveScopedPersistedValue } from "../../atoms/persisted";
import { runtimeAtom } from "../../atoms/workspace";
import type { ComposerDraft } from "../../lib/composer-draft";
import { composerScope } from "../../lib/composer-scope";
import { createRendererQueryClient } from "../../lib/query-client";
import { WORKSPACE_FILE_DRAG_TYPE } from "../../lib/workspace-file-drag";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { palot } from "../../services/palot";
import { terminalQuote } from "../workbench-tabs/terminal-quote";
import type { ComposerController } from "./use-composer";

const controller = vi.hoisted(() => ({ current: null as ComposerController | null }));
vi.mock("./use-composer", async (original) => {
  const actual = await original<typeof import("./use-composer")>();
  return {
    ...actual,
    useComposer: (props: ComponentProps<typeof import("./composer-view").Composer>) => {
      const value = actual.useComposer(props);
      controller.current = value;
      return value;
    },
  };
});

import { Composer } from "./composer-view";
import type { ComposerEditorElement } from "../../lib/composer-editor-element";

const session: PalotSession = {
  id: "session-editor",
  parentID: null,
  projectID: "project-1",
  title: "Editor",
  agent: null,
  model: null,
  location: { directory: "/workspace" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};
const scope = composerScope("test-profile", `session:${session.id}`);
const TASK_ID = "ses_0123456789abcdefghijklmnop";

function client(): OpenCodeClient {
  return {
    project: { list: vi.fn().mockResolvedValue([]) },
    model: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      default: vi.fn().mockResolvedValue({ data: null }),
    },
    provider: { list: vi.fn().mockResolvedValue({ data: [] }) },
    agent: { list: vi.fn().mockResolvedValue({ data: [] }) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    skill: { list: vi.fn().mockResolvedValue({ data: [] }) },
    file: { find: vi.fn().mockResolvedValue({ data: [] }) },
    session: {},
  } as unknown as OpenCodeClient;
}

beforeEach(() => {
  window.localStorage.clear();
  setOpenCodeClientForTest(client());
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      runtimeStatus: vi.fn(),
      onOpenCodeEvents: vi.fn(() => () => undefined),
      onAttachmentProgress: vi.fn(() => () => undefined),
      cancelAttachmentUpload: vi.fn().mockResolvedValue(undefined),
      // Files built in a test have no path, like pasted bitmaps.
      pathForFile: vi.fn(() => ""),
    } as unknown as PalotApi,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
  controller.current = null;
});

function renderComposer(capabilities?: Partial<OpenCodeRuntimeCapabilities>) {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "test",
    profileID: "test-profile",
    contractVersion: "test",
    phase: "connected",
    connected: true,
    binaryPath: "/usr/local/bin/opencode2",
    version: "test",
    pid: 1,
    managed: true,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
    ...(capabilities ? { capabilities: capabilities as OpenCodeRuntimeCapabilities } : {}),
  });
  const view = render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <main aria-label="Current task">
          <div data-testid="transcript">Transcript</div>
          <Composer session={session} messages={[]} isWorking={false} />
        </main>
      </Provider>
    </QueryClientProvider>,
  );
  const input = screen.getByRole<ComposerEditorElement>("textbox", { name: "Message Palot" });
  return { store, view, input };
}

/** A draft as the current build saves it: one mention of each kind, a terminal quote and a PR. */
function savedDraft(): ComposerDraft {
  const parts: string[] = [];
  const mentions: ComposerDraft["mentions"] = [];
  const add = (
    value: string,
    mention?: Omit<ComposerDraft["mentions"][number], "start" | "end">,
  ) => {
    const start = parts.join("").length;
    parts.push(value);
    if (mention) mentions.push({ ...mention, start, end: start + value.length });
  };
  add("Compare ");
  add("@src/a.ts", { localID: "f", kind: "file", value: "src/a.ts", text: "@src/a.ts" });
  add(" with ");
  add("@docs/", { localID: "d", kind: "file", value: "docs/", text: "@docs/" });
  add(", ask ");
  add("@helper", { localID: "a", kind: "agent", value: "helper", text: "@helper" });
  add(", use ");
  add("$review", {
    localID: "s",
    kind: "skill",
    value: "review",
    text: "$review",
    attachmentText: "Review carefully.",
  });
  add(" and ");
  add("@source", {
    localID: "r",
    kind: "reference",
    value: "source",
    path: "/reference",
    text: "@source",
  });
  add(" like ");
  add(`@session:${TASK_ID}`, {
    localID: "t",
    kind: "task",
    value: TASK_ID,
    title: "Earlier task",
    text: `@session:${TASK_ID}`,
  });
  add(`.\n\n${terminalQuote("exit 1")!}See https://github.com/acme/repo/pull/42 too.`);
  return { text: parts.join(""), mentions, command: null };
}

const receipt = {
  id: "msg-1",
  sessionID: session.id,
  type: "user" as const,
  delivery: "steer" as const,
  createdAt: 3,
};

async function sendAndCapture(touch: boolean) {
  const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue(receipt);
  const user = userEvent.setup();
  const { input, view } = renderComposer();
  if (touch) {
    // An edit makes the editor report the draft it holds, in place of the saved one.
    await user.type(input, "x{Backspace}");
  } else {
    act(() => input.focus());
  }
  await user.keyboard("{Enter}");
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  const { id: _id, ...payload } = send.mock.calls[0]![0];
  view.unmount();
  send.mockRestore();
  return payload;
}

describe("Composer editor", () => {
  it("restores a draft saved by the current build, with each mention as an inline chip", () => {
    const draft = savedDraft();
    saveScopedPersistedValue("composer.draft", scope, draft, 100);
    const { input } = renderComposer();

    expect(input.value).toBe(draft.text);
    for (const name of [
      "File: @src/a.ts",
      "Folder: @docs/",
      "Agent: @helper",
      "Skill: $review",
      "Reference: @source",
      "Task: Earlier task",
      "Terminal output: Terminal output",
      "Pull request: PR #42",
    ])
      expect(within(input).getByRole("img", { name })).toBeTruthy();
    // Mentions are in the text; the attachment row does not repeat them.
    expect(screen.queryByRole("group", { name: /Mentions/ })).toBeNull();
    expect(controller.current!.contents.read().draft).toEqual(draft);
  });

  it("sends exactly what the saved draft sends, after the editor has rewritten it", async () => {
    saveScopedPersistedValue("composer.draft", scope, savedDraft(), 100);
    const untouched = await sendAndCapture(false);
    saveScopedPersistedValue("composer.draft", scope, savedDraft(), 100);
    const edited = await sendAndCapture(true);

    expect(JSON.stringify(edited)).toBe(JSON.stringify(untouched));
    expect(untouched).toMatchObject({
      text: savedDraft().text,
      fileReferences: [
        { path: "src/a.ts", name: "a.ts" },
        { path: "docs/", name: "docs" },
      ],
      skillReferences: [{ id: "review", text: "Review carefully." }],
    });
  });

  it("acts on a selection a script just made, before the selection change is reported", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.type(input, "Throw this away");
    // Selection changes reach the editor as a later event; a key can arrive first.
    const changes: Event[] = [];
    const hold = (event: Event) => {
      changes.push(event);
      event.stopImmediatePropagation();
    };
    document.addEventListener("selectionchange", hold, true);
    try {
      document.getSelection()!.selectAllChildren(input);
      fireEvent.keyDown(input, { key: "Delete" });
    } finally {
      document.removeEventListener("selectionchange", hold, true);
    }
    expect(input.value).toBe("");
  });

  it("never opens the suggestion list for pasted text, and does once typing continues", async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    await user.click(input);
    fireEvent.paste(input, {
      clipboardData: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? "@src" : ""),
      },
    });
    expect(input.value).toBe("@src");
    expect(screen.queryByRole("region", { name: "Add to message" })).toBeNull();
    await user.type(input, "/", { skipClick: true });
    expect(await screen.findByRole("region", { name: "Add to message" })).toBeTruthy();
  });

  it("attaches long pasted text and shows it in the text field again on request", async () => {
    const user = userEvent.setup();
    const pasted = Array.from({ length: 401 }, (_, index) => `line ${index}`).join("\n");
    const file: PalotFileAttachment = {
      uri: "file:///tmp/pasted-text-1.txt",
      name: "pasted-text-1.txt",
      mime: "text/plain",
      size: pasted.length,
    };
    const attach = vi
      .spyOn(palot, "attachClipboardText")
      .mockResolvedValue({ files: [file], errors: [] });
    const { input } = renderComposer();
    await user.type(input, "Before ");
    fireEvent.paste(input, {
      clipboardData: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? pasted : ""),
      },
    });

    await waitFor(() => expect(attach).toHaveBeenCalledWith(pasted, "test", expect.any(String)));
    const chip = await screen.findByText("Pasted text · 401 lines");
    expect(input.value).toBe("Before ");
    await user.click(
      within(chip.closest("[data-palot-pasted-text]")!).getByText("Show in text field"),
    );
    expect(input.value).toBe(`Before ${pasted}`);
    expect(screen.queryByText("Pasted text · 401 lines")).toBeNull();
  });

  it("types long pasted text where a remote server cannot take attachments", async () => {
    const attach = vi.spyOn(palot, "attachClipboardText");
    const pasted = "x".repeat(40_000);
    const { input } = renderComposer({ localFileAttachments: false });
    fireEvent.paste(input, {
      clipboardData: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? pasted : ""),
      },
    });
    expect(input.value).toBe(pasted);
    expect(attach).not.toHaveBeenCalled();
  });

  it("names pasted files without a path it cannot attach instead of ignoring them", async () => {
    const attach = vi.spyOn(palot, "attachClipboardImages");
    const attachByPath = vi.spyOn(palot, "attachDroppedFiles");
    const { input } = renderComposer();
    const archive = new File([new Uint8Array([1])], "notes.zip", { type: "application/zip" });
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: "file", type: archive.type, getAsFile: () => archive }],
        getData: () => "",
      },
    });
    expect(
      await screen.findByText(/notes\.zip: only images can be pasted or dropped/),
    ).toBeTruthy();
    expect(attach).not.toHaveBeenCalled();
    expect(attachByPath).not.toHaveBeenCalled();
  });

  it("attaches pasted files from a file manager by path, as if picked", async () => {
    const archive = new File([new Uint8Array([1])], "notes.zip", { type: "application/zip" });
    const photo = new File([new Uint8Array([1])], "holiday.png", { type: "image/png" });
    vi.spyOn(palot, "pathForFile").mockImplementation(
      (file) =>
        ({ "notes.zip": "/home/me/notes.zip", "holiday.png": "/home/me/holiday.png" })[file.name] ??
        "",
    );
    const bytes = vi.spyOn(palot, "attachClipboardImages");
    const attach = vi.spyOn(palot, "attachDroppedFiles").mockResolvedValue({
      files: [
        { uri: "file:///home/me/notes.zip", name: "notes.zip", mime: "application/zip", size: 1 },
        { uri: "file:///home/me/holiday.png", name: "holiday.png", mime: "image/png", size: 1 },
      ],
      errors: [],
    });
    const { input } = renderComposer();
    fireEvent.paste(input, {
      clipboardData: {
        items: [archive, photo].map((file) => ({
          kind: "file",
          type: file.type,
          getAsFile: () => file,
        })),
        getData: (type: string) => (type === "text/plain" ? "notes.zip" : ""),
      },
    });
    expect(await screen.findByText("notes.zip")).toBeTruthy();
    // Images on disk attach by path too, so they keep their real name.
    expect(screen.getByText("holiday.png")).toBeTruthy();
    expect(attach).toHaveBeenCalledExactlyOnceWith([archive, photo], "test", expect.any(String));
    expect(bytes).not.toHaveBeenCalled();
    expect(screen.queryByText(/only images can be pasted/)).toBeNull();
  });

  describe("sending while a pasted image uploads", () => {
    const shot = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
    const staged: PalotFileAttachment = {
      uri: "file:///tmp/screenshot-1.png",
      name: "screenshot-1.png",
      mime: "image/png",
      size: 1,
    };
    function pasteShot(input: HTMLElement) {
      fireEvent.paste(input, {
        clipboardData: {
          items: [{ kind: "file", type: shot.type, getAsFile: () => shot }],
          getData: () => "",
        },
      });
    }

    it("holds the send until the upload finishes, then sends the image", async () => {
      let finish!: (value: { files: PalotFileAttachment[]; errors: string[] }) => void;
      vi.spyOn(palot, "attachClipboardImages").mockReturnValue(
        new Promise((resolve) => (finish = resolve)),
      );
      const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue(receipt);
      const user = userEvent.setup();
      const { input } = renderComposer();
      await user.type(input, "Look at this");
      pasteShot(input);
      await waitFor(() => expect(controller.current!.attachments.upload).not.toBeNull());

      await user.keyboard("{Enter}");
      const waiting = await screen.findByRole("button", { name: "Sends when the upload finishes" });
      expect(waiting.getAttribute("aria-busy")).toBe("true");
      expect(send).not.toHaveBeenCalled();

      await act(async () => finish({ files: [staged], errors: [] }));
      await waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(send.mock.calls[0]![0]).toMatchObject({ text: "Look at this", files: [staged] });
    });

    it("drops the held send when the upload fails, and shows why", async () => {
      let fail!: (error: Error) => void;
      vi.spyOn(palot, "attachClipboardImages").mockReturnValue(
        new Promise((_, reject) => (fail = reject)),
      );
      const send = vi.spyOn(palot, "sendComposerPrompt").mockResolvedValue(receipt);
      const user = userEvent.setup();
      const { input } = renderComposer();
      await user.type(input, "Look at this");
      pasteShot(input);
      await waitFor(() => expect(controller.current!.attachments.upload).not.toBeNull());
      await user.keyboard("{Enter}");
      await screen.findByRole("button", { name: "Sends when the upload finishes" });

      await act(async () => fail(new Error("The disk is full.")));
      expect(await screen.findByText(/The disk is full\./)).toBeTruthy();
      await screen.findByRole("button", { name: "Send message" });
      expect(send).not.toHaveBeenCalled();
      expect(input.value).toBe("Look at this");
    });
  });

  describe("dropping files from the operating system", () => {
    const image = () => new File([new Uint8Array([1, 2])], "shot.png", { type: "image/png" });
    const transfer = (files: File[], types = ["Files"]) => ({
      types,
      files,
      dropEffect: "none",
      getData: () => "",
    });

    it("attaches files dropped anywhere on the task's pane and reports the drag over it", async () => {
      const attach = vi
        .spyOn(palot, "attachClipboardImages")
        .mockResolvedValue({ files: [], errors: [] });
      const { store } = renderComposer();
      const transcript = screen.getByTestId("transcript");
      const dragOver = controller.current!.attachments.dragOverAtom;

      fireEvent.dragOver(transcript, { dataTransfer: transfer([image()]) });
      expect(store.get(dragOver)).toBe(true);
      fireEvent.dragLeave(transcript, { dataTransfer: transfer([]), relatedTarget: document.body });
      expect(store.get(dragOver)).toBe(false);

      fireEvent.dragOver(transcript, { dataTransfer: transfer([image()]) });
      fireEvent.drop(transcript, { dataTransfer: transfer([image()]) });
      expect(store.get(dragOver)).toBe(false);
      await waitFor(() =>
        expect(attach).toHaveBeenCalledWith(
          [{ mime: "image/png", data: expect.any(ArrayBuffer) }],
          "test",
          expect.any(String),
        ),
      );
    });

    it("attaches every file of a mixed drop, by path where it has one and by bytes otherwise", async () => {
      const archive = new File([new Uint8Array([1])], "notes.zip", { type: "application/zip" });
      const loose = new File([new Uint8Array([1])], "page.bin", { type: "" });
      vi.spyOn(palot, "pathForFile").mockImplementation((file) =>
        file === archive ? "/home/me/notes.zip" : "",
      );
      const byPath = vi.spyOn(palot, "attachDroppedFiles").mockResolvedValue({
        files: [
          { uri: "file:///home/me/notes.zip", name: "notes.zip", mime: "application/zip", size: 1 },
        ],
        errors: [],
      });
      const bytes = vi.spyOn(palot, "attachClipboardImages").mockResolvedValue({
        files: [
          {
            uri: "file:///tmp/screenshot-1.png",
            name: "screenshot-1.png",
            mime: "image/png",
            size: 2,
          },
        ],
        errors: [],
      });
      renderComposer();
      const shot = image();
      fireEvent.drop(screen.getByTestId("transcript"), {
        dataTransfer: transfer([archive, shot, loose]),
      });

      expect(await screen.findByText("notes.zip")).toBeTruthy();
      expect(screen.getByText("screenshot-1.png")).toBeTruthy();
      expect(screen.getByText(/page\.bin: only images can be pasted or dropped/)).toBeTruthy();
      expect(byPath).toHaveBeenCalledExactlyOnceWith([archive], "test", expect.any(String));
      const requestID = byPath.mock.calls[0]![2];
      expect(bytes).toHaveBeenCalledExactlyOnceWith(
        [{ mime: "image/png", data: expect.any(ArrayBuffer) }],
        "test",
        requestID,
      );
    });

    it("shows the existing reason on a remote server instead of attaching", async () => {
      const attach = vi.spyOn(palot, "attachClipboardImages");
      const attachByPath = vi.spyOn(palot, "attachDroppedFiles");
      vi.spyOn(palot, "pathForFile").mockReturnValue("/home/me/shot.png");
      renderComposer({ localFileAttachments: false });
      fireEvent.drop(screen.getByTestId("transcript"), { dataTransfer: transfer([image()]) });
      expect(
        await screen.findByText(
          "Local file attachments are unavailable for remote OpenCode servers.",
        ),
      ).toBeTruthy();
      expect(attach).not.toHaveBeenCalled();
      expect(attachByPath).not.toHaveBeenCalled();
    });

    it("refuses files in shell mode and leaves the app's own drags to their handlers", async () => {
      const user = userEvent.setup();
      const attach = vi.spyOn(palot, "attachClipboardImages");
      const { input, store } = renderComposer();
      const dragOver = controller.current!.attachments.dragOverAtom;
      fireEvent.dragOver(screen.getByTestId("transcript"), {
        dataTransfer: transfer([], [WORKSPACE_FILE_DRAG_TYPE, "Files"]),
      });
      expect(store.get(dragOver)).toBe(false);

      await user.type(input, "!");
      expect(screen.getByRole("textbox", { name: "Shell command" })).toBe(input);
      fireEvent.drop(screen.getByTestId("transcript"), { dataTransfer: transfer([image()]) });
      expect(attach).not.toHaveBeenCalled();
    });
  });
});
