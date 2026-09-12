// @vitest-environment node

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  popup: vi.fn(),
  openExternal: vi.fn(),
  writeText: vi.fn(),
  showItemInFolder: vi.fn(),
  getDisplayNearestPoint: vi.fn(),
  runtimeStatus: vi.fn(),
  getPreferredTargetInfo: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true },
  clipboard: { writeText: electronMocks.writeText },
  Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
  screen: { getDisplayNearestPoint: electronMocks.getDisplayNearestPoint },
  shell: {
    openExternal: electronMocks.openExternal,
    showItemInFolder: electronMocks.showItemInFolder,
  },
}));

vi.mock("./opencode-runtime", () => ({
  openCodeRuntime: { runtimeStatus: electronMocks.runtimeStatus },
}));
vi.mock("./external-open/service", () => ({
  externalOpenService: () => ({
    getPreferredTargetInfo: electronMocks.getPreferredTargetInfo,
    open: electronMocks.openFile,
  }),
}));

import {
  buildNativeContextMenuTemplate,
  installNativeContextMenu,
  type NativeContextMenuParams,
} from "./native-context-menu";

const editFlags: Electron.EditFlags = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: false,
  canPaste: true,
  canDelete: true,
  canSelectAll: false,
  canEditRichly: false,
};

function params(
  overrides: Partial<NativeContextMenuParams> = {},
): NativeContextMenuParams & Pick<Electron.ContextMenuParams, "x" | "y" | "menuSourceType"> {
  return {
    x: 120,
    y: 80,
    menuSourceType: "mouse" as const,
    editFlags,
    formControlType: "none",
    isEditable: false,
    linkURL: "",
    selectionText: "",
    ...overrides,
  };
}

function build(
  overrides: Partial<NativeContextMenuParams> = {},
  options: { preferredEditorLabel?: string } = {},
) {
  const actions = {
    openLink: vi.fn(),
    copyLinkAddress: vi.fn(),
    openFile: vi.fn(),
    revealFile: vi.fn(),
    copyText: vi.fn(),
  };
  const template = buildNativeContextMenuTemplate(params(overrides), {
    actions,
    development: false,
    ...options,
  });
  return { actions, template };
}

describe("buildNativeContextMenuTemplate", () => {
  it("returns no items for blank contexts", () => {
    expect(build().template).toEqual([]);
  });

  it("builds editable roles with Electron edit flag states", () => {
    const { template } = build({ isEditable: true, formControlType: "text-area" });

    expect(template).toEqual([
      { role: "undo", enabled: true },
      { role: "redo", enabled: false },
      { type: "separator" },
      { role: "cut", enabled: true },
      { role: "copy", enabled: false },
      { role: "paste", enabled: true },
      { type: "separator" },
      { role: "selectAll", enabled: false },
    ]);
  });

  it("never offers copy or cut for password controls", () => {
    const { template } = build({ isEditable: true, formControlType: "input-password" });

    expect(template.map((item) => item.role).filter(Boolean)).toEqual([
      "undo",
      "redo",
      "paste",
      "selectAll",
    ]);
  });

  it("offers copy and select all for read-only selections", () => {
    const { template } = build({
      editFlags: { ...editFlags, canCopy: true, canSelectAll: true },
      selectionText: "selected transcript",
    });
    expect(template).toEqual([
      { role: "copy", enabled: true },
      { role: "selectAll", enabled: true },
    ]);
  });

  it("only exposes callbacks for validated external links and captures the normalized URL", () => {
    expect(build({ linkURL: "javascript:alert(1)" }).template).toEqual([]);

    const { actions, template } = build({ linkURL: "https://example.com/docs" });
    expect(template.map((item) => item.label)).toEqual(["Open Link", "Copy Link Address"]);

    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    template[1]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    expect(actions.openLink).toHaveBeenCalledWith("https://example.com/docs");
    expect(actions.copyLinkAddress).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("builds file items with preferred editor label for file URLs and absolute paths", () => {
    const { actions, template } = build(
      { linkURL: "file:///Users/example/project/src/main.ts#L42C10" },
      { preferredEditorLabel: "Cursor" },
    );
    expect(template.map((item) => item.label)).toEqual([
      "Open in Cursor",
      process.platform === "darwin" ? "Reveal in Finder" : "Show in File Manager",
      "Copy File Path",
    ]);

    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    template[1]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    template[2]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);

    expect(actions.openFile).toHaveBeenCalledWith("/Users/example/project/src/main.ts", 42, 10);
    expect(actions.revealFile).toHaveBeenCalledWith("/Users/example/project/src/main.ts");
    expect(actions.copyText).toHaveBeenCalledWith("/Users/example/project/src/main.ts");
  });

  it("builds file items for plain absolute paths with line numbers", () => {
    const { actions, template } = build({ linkURL: "/tmp/report.txt:15" });
    expect(template.map((item) => item.label)).toEqual([
      "Open in Editor",
      process.platform === "darwin" ? "Reveal in Finder" : "Show in File Manager",
      "Copy File Path",
    ]);

    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    expect(actions.openFile).toHaveBeenCalledWith("/tmp/report.txt", 15, undefined);
  });
});

describe("installNativeContextMenu", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    electronMocks.buildFromTemplate.mockReset();
    electronMocks.popup.mockReset();
    electronMocks.openExternal.mockReset();
    electronMocks.writeText.mockReset().mockResolvedValue(undefined);
    electronMocks.showItemInFolder.mockReset();
    electronMocks.openFile.mockReset().mockResolvedValue({});
    electronMocks.getPreferredTargetInfo.mockReset().mockResolvedValue(null);
    electronMocks.runtimeStatus.mockReset().mockReturnValue({
      connectionID: "connection",
      profileID: "local",
      connected: true,
      capabilities: { localPathActions: true },
    });
    electronMocks.buildFromTemplate.mockReturnValue({ popup: electronMocks.popup });
    electronMocks.getDisplayNearestPoint.mockReturnValue({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    });
  });

  function fileWindow(profileID?: string) {
    class FakeWebContents extends EventEmitter {
      url = `https://palot.example/#/sessions/s${profileID ? `?profileID=${profileID}` : ""}`;
      isDestroyed = () => false;
      getURL = () => this.url;
    }
    class FakeWindow extends EventEmitter {
      webContents = new FakeWebContents();
      getContentBounds = () => ({ x: 10, y: 20, width: 900, height: 700 });
      isDestroyed = () => false;
    }
    const window = new FakeWindow();
    installNativeContextMenu(window as unknown as Electron.BrowserWindow);
    window.webContents.emit(
      "context-menu",
      { defaultPrevented: false },
      params({ linkURL: "file:///repo/file.ts#L12" }),
    );
    return window;
  }

  it.each([undefined, "remote"])(
    "does not execute local paths from an unowned window (%s)",
    (profileID) => {
      fileWindow(profileID);
      const template = electronMocks.buildFromTemplate.mock
        .calls[0]![0] as Electron.MenuItemConstructorOptions[];
      expect(template.map((item) => item.label)).toEqual(["Copy File Path"]);
      expect(electronMocks.getPreferredTargetInfo).not.toHaveBeenCalled();
      expect(electronMocks.openFile).not.toHaveBeenCalled();
    },
  );

  it("captures the window's local owner and uses the guarded external-open service", async () => {
    fileWindow("local");
    await vi.waitFor(() => expect(electronMocks.popup).toHaveBeenCalledOnce());
    const template = electronMocks.buildFromTemplate.mock
      .calls[0]![0] as Electron.MenuItemConstructorOptions[];
    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    template[1]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    expect(electronMocks.openFile).toHaveBeenCalledWith({
      resource: { kind: "file", path: "/repo/file.ts", line: 12, column: undefined },
    });
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith("/repo/file.ts");
  });

  it("never treats a matching remote profile's paths as local files", () => {
    electronMocks.runtimeStatus.mockReturnValue({
      connectionID: "remote-connection",
      profileID: "remote",
      connected: true,
      capabilities: { localPathActions: false },
    });
    fileWindow("remote");
    const template = electronMocks.buildFromTemplate.mock
      .calls[0]![0] as Electron.MenuItemConstructorOptions[];
    expect(template.map((item) => item.label)).toEqual(["Copy File Path"]);
  });

  it.each(["focus", "route"])(
    "rejects an already displayed file menu after its %s changes",
    async (change) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const window = fileWindow("local");
      await vi.waitFor(() => expect(electronMocks.popup).toHaveBeenCalledOnce());
      if (change === "focus")
        electronMocks.runtimeStatus.mockReturnValue({ connectionID: "other", connected: true });
      else window.webContents.url = "https://palot.example/#/sessions/other?profileID=local";
      const template = electronMocks.buildFromTemplate.mock
        .calls[0]![0] as Electron.MenuItemConstructorOptions[];
      template[0]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
      template[1]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
      expect(electronMocks.openFile).not.toHaveBeenCalled();
      expect(electronMocks.showItemInFolder).not.toHaveBeenCalled();
    },
  );

  it("skips prevented and empty events, binds popup to the window, and cleans up", () => {
    class FakeWebContents extends EventEmitter {
      destroyed = false;
      isDestroyed = () => this.destroyed;
    }
    class FakeWindow extends EventEmitter {
      destroyed = false;
      webContents = new FakeWebContents();
      getContentBounds = () => ({ x: 10, y: 20, width: 900, height: 700 });
      isDestroyed = () => this.destroyed;
    }
    const window = new FakeWindow();
    const dispose = installNativeContextMenu(window as unknown as Electron.BrowserWindow);

    window.webContents.emit(
      "context-menu",
      { defaultPrevented: true },
      params({ isEditable: true }),
    );
    window.webContents.emit("context-menu", { defaultPrevented: false }, params());
    expect(electronMocks.buildFromTemplate).not.toHaveBeenCalled();

    window.webContents.emit(
      "context-menu",
      { defaultPrevented: false },
      params({ selectionText: "selected" }),
    );
    expect(electronMocks.popup).toHaveBeenCalledWith({
      window,
      x: 120,
      y: 80,
      sourceType: "mouse",
    });

    window.emit("closed");
    dispose();
    expect(window.webContents.listenerCount("context-menu")).toBe(0);
    window.webContents.emit(
      "context-menu",
      { defaultPrevented: false },
      params({ selectionText: "again" }),
    );
    expect(electronMocks.popup).toHaveBeenCalledTimes(1);
  });

  it("uses the captured validated link for open and copy actions", () => {
    class FakeWebContents extends EventEmitter {
      isDestroyed = () => false;
    }
    class FakeWindow extends EventEmitter {
      webContents = new FakeWebContents();
      getContentBounds = () => ({ x: 10, y: 20, width: 900, height: 700 });
      isDestroyed = () => false;
    }
    const window = new FakeWindow();
    installNativeContextMenu(window as unknown as Electron.BrowserWindow);
    window.webContents.emit(
      "context-menu",
      { defaultPrevented: false },
      params({ linkURL: "https://example.com/link" }),
    );

    const template = electronMocks.buildFromTemplate.mock
      .calls[0]?.[0] as Electron.MenuItemConstructorOptions[];
    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    template[1]?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    expect(electronMocks.openExternal).toHaveBeenCalledWith("https://example.com/link");
    expect(electronMocks.writeText).toHaveBeenCalledWith("https://example.com/link");
  });
});
