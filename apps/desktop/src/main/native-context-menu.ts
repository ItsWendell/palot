import {
  app,
  clipboard,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { allowedExternalUrl } from "./external-url-policy";
import { externalOpenService } from "./external-open/service";
import { popupNativeContextMenu } from "./native-menu-popup";
import { openCodeRuntime } from "./opencode-runtime";
import { guardFocusedOpenCodeConnection } from "./opencode-native-scope";

export type NativeContextMenuParams = Pick<
  Electron.ContextMenuParams,
  "editFlags" | "formControlType" | "isEditable" | "linkURL" | "selectionText"
>;

export interface NativeContextMenuActions {
  copyLinkAddress: (url: string) => void;
  openLink: (url: string) => void;
  openFile?: (filePath: string, line?: number, column?: number) => void;
  revealFile?: (filePath: string) => void;
  copyText?: (text: string) => void;
}

export interface NativeContextMenuOptions {
  actions: NativeContextMenuActions;
  development: boolean;
  preferredEditorLabel?: string;
}

export interface NativeContextMenuFileTarget {
  path: string;
  line?: number;
  column?: number;
}

export function parseNativeContextMenuFileTarget(
  linkURL: string | undefined,
): NativeContextMenuFileTarget | null {
  if (!linkURL) return null;
  const trimmed = linkURL.trim();
  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      let pathname = decodeURIComponent(url.pathname);
      if (process.platform === "win32" && pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }
      let line: number | undefined;
      let column: number | undefined;
      if (url.hash) {
        const match = url.hash.match(/^#L(\d+)(?:[Cc](\d+))?$/i);
        if (match) {
          line = Number(match[1]);
          if (match[2]) column = Number(match[2]);
        }
      }
      return { path: pathname, ...(line ? { line } : {}), ...(column ? { column } : {}) };
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    const colonMatch = trimmed.match(/:(\d+)(?::(\d+))?$/);
    let line: number | undefined;
    let column: number | undefined;
    let cleanPath = trimmed;
    if (colonMatch) {
      line = Number(colonMatch[1]);
      if (colonMatch[2]) column = Number(colonMatch[2]);
      cleanPath = trimmed.slice(0, colonMatch.index);
    }
    return { path: cleanPath, ...(line ? { line } : {}), ...(column ? { column } : {}) };
  }

  return null;
}

function editingItems(params: NativeContextMenuParams): MenuItemConstructorOptions[] {
  if (!params.isEditable) return [];

  const password = params.formControlType === "input-password";
  const items: MenuItemConstructorOptions[] = [
    { role: "undo", enabled: params.editFlags.canUndo },
    { role: "redo", enabled: params.editFlags.canRedo },
    { type: "separator" },
  ];
  if (!password) {
    items.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
    );
  }
  items.push(
    { role: "paste", enabled: params.editFlags.canPaste },
    { type: "separator" },
    { role: "selectAll", enabled: params.editFlags.canSelectAll },
  );
  return items;
}

function selectionItems(params: NativeContextMenuParams): MenuItemConstructorOptions[] {
  if (params.isEditable || params.selectionText.length === 0) return [];
  return [
    { role: "copy", enabled: params.editFlags.canCopy },
    { role: "selectAll", enabled: params.editFlags.canSelectAll },
  ];
}

function fileItems(
  params: NativeContextMenuParams,
  options: NativeContextMenuOptions,
): MenuItemConstructorOptions[] {
  const fileTarget = parseNativeContextMenuFileTarget(params.linkURL);
  if (!fileTarget) return [];

  const editorLabel = options.preferredEditorLabel
    ? `Open in ${options.preferredEditorLabel}`
    : "Open in Editor";
  const revealLabel = process.platform === "darwin" ? "Reveal in Finder" : "Show in File Manager";

  return [
    ...(options.actions.openFile
      ? [
          {
            label: editorLabel,
            click: () =>
              options.actions.openFile?.(fileTarget.path, fileTarget.line, fileTarget.column),
          },
        ]
      : []),
    ...(options.actions.revealFile
      ? [
          {
            label: revealLabel,
            click: () => options.actions.revealFile?.(fileTarget.path),
          },
        ]
      : []),
    {
      label: "Copy File Path",
      click: () => {
        if (options.actions.copyText) {
          options.actions.copyText(fileTarget.path);
        } else {
          options.actions.copyLinkAddress(fileTarget.path);
        }
      },
    },
  ];
}

function linkItems(
  params: NativeContextMenuParams,
  options: NativeContextMenuOptions,
): MenuItemConstructorOptions[] {
  const url = allowedExternalUrl(params.linkURL, options.development);
  if (!url) return [];
  return [
    {
      label: "Open Link",
      click: () => options.actions.openLink(url),
    },
    {
      label: "Copy Link Address",
      click: () => options.actions.copyLinkAddress(url),
    },
  ];
}

export function buildNativeContextMenuTemplate(
  params: NativeContextMenuParams,
  options: NativeContextMenuOptions,
): MenuItemConstructorOptions[] {
  const sections = [
    editingItems(params),
    selectionItems(params),
    fileItems(params, options),
    linkItems(params, options),
  ].filter((section) => section.length > 0);

  return sections.flatMap((section, index) =>
    index === 0 ? section : [{ type: "separator" as const }, ...section],
  );
}

export function installNativeContextMenu(window: BrowserWindow): () => void {
  const webContents = window.webContents;
  const handleContextMenu = (event: Electron.Event, params: Electron.ContextMenuParams): void => {
    // Electron 44 exposes defaultPrevented. Base UI prevents its semantic context-menu events.
    if (event.defaultPrevented || window.isDestroyed() || webContents.isDestroyed()) return;

    // Native file links carry no connection ID. Only enable local actions when the
    // originating window explicitly identifies its profile in the route.
    let validateFileOwner: (() => void) | undefined;
    if (parseNativeContextMenuFileTarget(params.linkURL)) {
      try {
        const windowURL = webContents.getURL();
        const url = new URL(windowURL);
        const profileID = new URLSearchParams(url.hash.split("?")[1] ?? url.search).get(
          "profileID",
        );
        const status = openCodeRuntime.runtimeStatus();
        if (profileID === status.profileID && status.capabilities?.localPathActions === true) {
          const validateConnection = guardFocusedOpenCodeConnection(status.connectionID, () =>
            openCodeRuntime.runtimeStatus(),
          );
          validateFileOwner = () => {
            if (
              window.isDestroyed() ||
              webContents.isDestroyed() ||
              webContents.getURL() !== windowURL
            ) {
              throw new Error("The file's originating window changed");
            }
            validateConnection();
            if (openCodeRuntime.runtimeStatus().capabilities?.localPathActions !== true) {
              throw new Error("Local file actions are unavailable for this connection");
            }
          };
        }
      } catch {
        // Copying the path remains available; never infer its server from focus.
      }
    }

    void (async () => {
      let preferredEditorLabel: string | undefined;
      try {
        if (validateFileOwner) {
          const preferred = await externalOpenService().getPreferredTargetInfo();
          if (preferred) preferredEditorLabel = preferred.label;
        }
      } catch {
        // Fall back to default
      }
      if (window.isDestroyed() || webContents.isDestroyed()) return;

      const template = buildNativeContextMenuTemplate(params, {
        development: !app.isPackaged,
        preferredEditorLabel,
        actions: {
          openLink: (url) => {
            if (!window.isDestroyed() && !webContents.isDestroyed()) void shell.openExternal(url);
          },
          copyLinkAddress: (url) => {
            if (!window.isDestroyed() && !webContents.isDestroyed())
              void clipboard
                .writeText(url)
                .catch((error) => console.warn("[clipboard] Copy link failed", error));
          },
          ...(validateFileOwner
            ? {
                openFile: (filePath: string, line?: number, column?: number) => {
                  try {
                    validateFileOwner();
                    void externalOpenService()
                      .open({ resource: { kind: "file", path: filePath, line, column } })
                      .catch((error) => console.warn("[context-menu] Open file failed", error));
                  } catch (error) {
                    console.warn("[context-menu] File owner changed", error);
                  }
                },
                revealFile: (filePath: string) => {
                  try {
                    validateFileOwner();
                    shell.showItemInFolder(filePath);
                  } catch (error) {
                    console.warn("[context-menu] File owner changed", error);
                  }
                },
              }
            : {}),
          copyText: (text) => {
            if (!window.isDestroyed() && !webContents.isDestroyed())
              void clipboard
                .writeText(text)
                .catch((error) => console.warn("[clipboard] Copy text failed", error));
          },
        },
      });
      if (template.length === 0) return;

      popupNativeContextMenu(Menu.buildFromTemplate(template), window, params);
    })();
  };

  let installed = true;
  const dispose = (): void => {
    if (!installed) return;
    installed = false;
    webContents.off("context-menu", handleContextMenu);
    window.off("closed", dispose);
  };

  webContents.on("context-menu", handleContextMenu);
  window.once("closed", dispose);
  return dispose;
}
