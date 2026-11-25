/**
 * Palot's own right-click menu for links, so file and web links offer the same actions
 * wherever they appear: transcript Markdown, tool rows, mentions, requests and errors.
 */

import { Code2, Copy, ExternalLink, FileText, FolderOpen, Globe2, Link2 } from "lucide-react";
import {
  cloneElement,
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ExternalOpenTarget } from "../../shared";
import { isHtmlFilePath, workspaceFileTarget } from "../lib/browser-files";
import { cn } from "../lib/cn";
import { writeClipboardText } from "../lib/clipboard";
import {
  fileReferenceAbsolutePath,
  fileReferenceMachine,
  fileReferenceText,
  workspaceRelativePath,
  type FileReference,
} from "../lib/file-reference";
import { linkSegments } from "../lib/linkify";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "./ui/dropdown-menu";
import { formatShortcut } from "../lib/keyboard-shortcuts";

/** What started an open: a click or key on the link, or its menu's Open item. */
export interface FileOpenTrigger {
  currentTarget: EventTarget | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export type FileOpenHandler = (reference: FileReference, event?: FileOpenTrigger) => void;

export type WebLinkDestination = "browser" | "external";

export interface LinkActions {
  /** The OpenCode connection that owns the task, for actions that run on its server. */
  connectionID?: string;
  sessionID?: string;
  /** The task's workspace; Copy relative path is relative to it. */
  taskDirectory?: string;
  /** Where `~` points on the task's server, when known. */
  homeDirectory?: string;
  /** The server shares this machine's filesystem, so editors and the file manager can open paths. */
  localPathActions: boolean;
  /** Opens a workspace HTML file in the task's Palot Browser; absent when it cannot. */
  openFileInBrowser?(absolutePath: string): Promise<void>;
  /**
   * Opens a web link: in the person's preferred place without a destination, or where asked.
   * Absent outside a task, where links open in the default browser.
   */
  openWebLink?(url: string, destination?: WebLinkDestination): void;
  /** The task's Palot Browser can open web links. */
  browserAvailable?: boolean;
}

const NO_LINK_ACTIONS: LinkActions = { localPathActions: false };
const LinkActionsContext = createContext<LinkActions>(NO_LINK_ACTIONS);

/**
 * Provides a task's link actions and the menu host for links inside it. The host sits above
 * the transcript, so a menu stays open when streaming or settling re-renders its link.
 */
export function LinkActionsProvider({
  value,
  children,
}: {
  value: LinkActions;
  children?: ReactNode;
}) {
  return (
    <LinkActionsContext.Provider value={value}>
      <LinkMenuHost>{children}</LinkMenuHost>
    </LinkActionsContext.Provider>
  );
}

export function useLinkActions(): LinkActions {
  return useContext(LinkActionsContext);
}

export function revealFileLabel(platform = globalThis.window?.palot?.platform): string {
  return platform === "darwin" ? "Reveal in Finder" : "Show in File Manager";
}

interface MenuPoint {
  element: HTMLElement;
  x: number;
  y: number;
}

/** Selected text the right-click touched, kept so Copy still works after focus moves to the menu. */
interface MenuSelection {
  text: string;
  ranges: Range[];
}

interface MenuRequest {
  point: MenuPoint;
  label: string;
  selection: MenuSelection | null;
  /** Items render in the host, so they receive the link's actions rather than reading context. */
  items: ReactNode;
}

type ShowLinkMenu = (request: MenuRequest) => void;

const LinkMenuHostContext = createContext<ShowLinkMenu | null>(null);

function useMenuState() {
  const [request, setRequest] = useState<MenuRequest | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((next: MenuRequest) => {
    setRequest(next);
    setOpen(true);
  }, []);
  return { request, open, setOpen, show, clear: () => setRequest(null) };
}

/** Renders one link menu for every link below it; mount once near the app root as well. */
export function LinkMenuHost({ children }: { children?: ReactNode }) {
  const state = useMenuState();
  return (
    <LinkMenuHostContext.Provider value={state.show}>
      {children}
      <LinkMenu state={state} />
    </LinkMenuHostContext.Provider>
  );
}

interface LinkTriggerProps {
  onContextMenu?(event: ReactMouseEvent<HTMLElement>): void;
  onKeyDown?(event: ReactKeyboardEvent<HTMLElement>): void;
}

/**
 * Opens the link's menu at the pointer, or under the link for the context-menu key and
 * Shift+F10. Without a host above it (an isolated component), the link hosts its own menu.
 */
function useLinkMenuTrigger(
  child: ReactElement<LinkTriggerProps>,
  menu: (point: MenuPoint) => Omit<MenuRequest, "point" | "selection">,
): ReactNode {
  const host = useContext(LinkMenuHostContext);
  const local = useMenuState();
  const show = (element: HTMLElement, x?: number, y?: number) => {
    const rect = element.getBoundingClientRect();
    const point = { element, x: x ?? rect.left, y: y ?? rect.bottom };
    (host ?? local.show)({ point, selection: selectionTouching(element), ...menu(point) });
  };
  const trigger = cloneElement(child, {
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      child.props.onContextMenu?.(event);
      // Palot owns link menus; the native menu skips events that were already handled.
      event.preventDefault();
      event.stopPropagation();
      // A keyboard-initiated contextmenu event has no pointer position.
      const keyboard = event.button === 0 && event.clientX === 0 && event.clientY === 0;
      show(
        event.currentTarget,
        keyboard ? undefined : event.clientX,
        keyboard ? undefined : event.clientY,
      );
    },
    onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
      child.props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      event.stopPropagation();
      show(event.currentTarget);
    },
  });
  return (
    <>
      {trigger}
      {host ? null : <LinkMenu state={local} />}
    </>
  );
}

/** The document selection when it is non-empty and covers part of the link, else null. */
function selectionTouching(element: HTMLElement): MenuSelection | null {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) =>
    selection.getRangeAt(index),
  );
  if (!ranges.some((range) => range.intersectsNode(element))) return null;
  return { text, ranges: ranges.map((range) => range.cloneRange()) };
}

/**
 * Copies like the native Copy: the selection is restored and copied by the browser, so rich
 * text keeps its formatting; plain text is the fallback when the command is refused.
 */
function copySelection({ text, ranges }: MenuSelection) {
  const selection = document.getSelection();
  if (selection) {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
  let copied = false;
  try {
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    copied = false;
  }
  if (!copied) copy(text);
}

function LinkMenu({ state }: { state: ReturnType<typeof useMenuState> }) {
  const point = state.request?.point;
  const anchor = useMemo(
    () =>
      point ? { getBoundingClientRect: () => DOMRect.fromRect({ x: point.x, y: point.y }) } : null,
    [point],
  );
  if (!state.request || !point || !anchor) return null;
  return (
    <DropdownMenu
      open={state.open}
      onOpenChange={state.setOpen}
      onOpenChangeComplete={(open) => {
        if (!open) state.clear();
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={0}
        alignOffset={4}
        aria-label={state.request.label}
        // A link that re-rendered meanwhile is gone; focus then follows the default.
        finalFocus={() => (point.element.isConnected ? point.element : true)}
        className="w-auto max-w-80 min-w-44"
      >
        {state.request.selection ? (
          <>
            <SelectionCopyItem selection={state.request.selection} />
            <DropdownMenuSeparator />
          </>
        ) : null}
        {state.request.items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectionCopyItem({ selection }: { selection: MenuSelection }) {
  return (
    <DropdownMenuItem onClick={() => copySelection(selection)}>
      <Copy aria-hidden="true" />
      Copy
      {/* Copy is a locked system key, so its label is not rebindable. */}
      <DropdownMenuShortcut aria-hidden="true">{formatShortcut(["Mod", "c"])}</DropdownMenuShortcut>
    </DropdownMenuItem>
  );
}

function copy(value: string) {
  void writeClipboardText(value).catch((error: unknown) =>
    showErrorToast("Could not copy to clipboard", error),
  );
}

/** Wraps a web link with Open in Palot Browser, Open in default browser and Copy link. */
export function WebLinkMenu({ url, children }: { url: string; children: ReactElement }) {
  const actions = useLinkActions();
  return useLinkMenuTrigger(children as ReactElement<LinkTriggerProps>, () => ({
    label: `Link actions for ${url}`,
    items: <WebLinkMenuItems url={url} actions={actions} />,
  }));
}

function WebLinkMenuItems({ url, actions }: { url: string; actions: LinkActions }) {
  const openWebLink = actions.openWebLink;
  return (
    <>
      {openWebLink && actions.browserAvailable ? (
        <DropdownMenuItem onClick={() => openWebLink(url, "browser")}>
          <Globe2 aria-hidden="true" />
          Open in Palot Browser
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        onClick={() => {
          if (openWebLink) openWebLink(url, "external");
          else void palot.openExternalUrl(url);
        }}
      >
        <ExternalLink aria-hidden="true" />
        Open in default browser
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => copy(url)}>
        <Link2 aria-hidden="true" />
        Copy link
      </DropdownMenuItem>
    </>
  );
}

/** The address (or comma-separated addresses) of a `mailto:` link, without its query. */
export function mailtoAddress(href: string | undefined): string | null {
  if (!href || !/^mailto:/i.test(href)) return null;
  const raw = href.slice("mailto:".length).split("?")[0] ?? "";
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

/** Wraps an email link with Copy email address. */
export function EmailLinkMenu({ address, children }: { address: string; children: ReactElement }) {
  return useLinkMenuTrigger(children as ReactElement<LinkTriggerProps>, () => ({
    label: `Link actions for ${address}`,
    items: (
      <DropdownMenuItem onClick={() => copy(address)}>
        <Copy aria-hidden="true" />
        Copy email address
      </DropdownMenuItem>
    ),
  }));
}

/**
 * Wraps a file link with Open, Palot Browser, editor, file manager and copy actions.
 * `directory` resolves relative paths the way the link's own click does.
 */
export function FileLinkMenu({
  reference,
  directory,
  onOpen,
  children,
}: {
  reference: FileReference;
  directory?: string;
  onOpen?: FileOpenHandler;
  children: ReactElement;
}) {
  const actions = useLinkActions();
  return useLinkMenuTrigger(children as ReactElement<LinkTriggerProps>, (point) => ({
    label: `File actions for ${reference.path}`,
    items: (
      <FileLinkMenuItems
        reference={reference}
        directory={directory}
        onOpen={onOpen}
        element={point.element}
        actions={actions}
      />
    ),
  }));
}

function FileLinkMenuItems({
  reference,
  directory,
  onOpen,
  element,
  actions,
}: {
  reference: FileReference;
  directory?: string;
  onOpen?: FileOpenHandler;
  element: HTMLElement;
  actions: LinkActions;
}) {
  // A file on another OpenCode machine has no local path: no editor, reveal or browser for it.
  const machine = fileReferenceMachine(reference);
  const absolute = machine
    ? null
    : fileReferenceAbsolutePath(reference.path, directory, actions.homeDirectory);
  const local = actions.localPathActions && absolute !== null;
  const editor = usePreferredEditor(local, actions.connectionID, actions.sessionID);
  const relative =
    absolute && actions.taskDirectory
      ? workspaceRelativePath(actions.taskDirectory, absolute)
      : null;
  const openFileInBrowser = actions.openFileInBrowser;
  const browser =
    openFileInBrowser &&
    absolute &&
    actions.taskDirectory &&
    isHtmlFilePath(absolute) &&
    workspaceFileTarget(actions.taskDirectory, absolute).kind === "workspace";
  const hasOpenActions = Boolean(onOpen || browser || local);
  return (
    <>
      {onOpen ? (
        <DropdownMenuItem onClick={() => onOpen(reference, { currentTarget: element })}>
          <FileText aria-hidden="true" />
          Open
        </DropdownMenuItem>
      ) : null}
      {browser && absolute ? (
        <DropdownMenuItem
          onClick={() =>
            void openFileInBrowser(absolute).catch((error: unknown) =>
              showErrorToast("Could not open in Palot Browser", error),
            )
          }
        >
          <Globe2 aria-hidden="true" />
          Open in Palot Browser
        </DropdownMenuItem>
      ) : null}
      {local && absolute && editor !== null ? (
        <DropdownMenuItem
          onClick={() =>
            void palot
              .externalOpen(
                {
                  resource: {
                    kind: "file",
                    path: absolute,
                    ...(reference.line ? { line: reference.line } : {}),
                    ...(reference.column ? { column: reference.column } : {}),
                    ...(actions.sessionID ? { sessionID: actions.sessionID } : {}),
                  },
                  ...(editor ? { targetID: editor.id } : {}),
                },
                actions.connectionID,
              )
              .catch((error: unknown) => showErrorToast("Could not open file", error))
          }
        >
          <Code2 aria-hidden="true" />
          {editor ? `Open in ${editor.label}` : "Open in Editor"}
        </DropdownMenuItem>
      ) : null}
      {local && absolute ? (
        <DropdownMenuItem
          onClick={() =>
            void palot
              .revealFileInFinder(absolute, actions.connectionID)
              .catch((error: unknown) => showErrorToast("Could not show file", error))
          }
        >
          <FolderOpen aria-hidden="true" />
          {revealFileLabel()}
        </DropdownMenuItem>
      ) : null}
      {hasOpenActions ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        onClick={() => copy(machine ? fileReferenceText(reference) : (absolute ?? reference.path))}
      >
        <Copy aria-hidden="true" />
        Copy path
      </DropdownMenuItem>
      {relative ? (
        <DropdownMenuItem onClick={() => copy(relative)}>
          <Copy aria-hidden="true" />
          Copy relative path
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

const EDITOR_TARGETS_TTL_MS = 60_000;
const editorTargets = new Map<string, { at: number; targets: Promise<ExternalOpenTarget[]> }>();

/**
 * The editor Open in uses: the preferred one once known, undefined while loading or without
 * a task to ask about, and null when no editor is installed.
 */
function usePreferredEditor(
  enabled: boolean,
  connectionID: string | undefined,
  sessionID: string | undefined,
): ExternalOpenTarget | null | undefined {
  const [editor, setEditor] = useState<ExternalOpenTarget | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !sessionID) return;
    const key = `${connectionID ?? ""}\0${sessionID}`;
    let entry = editorTargets.get(key);
    if (!entry || Date.now() - entry.at > EDITOR_TARGETS_TTL_MS) {
      entry = { at: Date.now(), targets: palot.externalOpenTargets(sessionID, connectionID) };
      editorTargets.set(key, entry);
    }
    let cancelled = false;
    entry.targets.then(
      (targets) => {
        if (cancelled) return;
        const editors = targets.filter((target) => target.kind === "editor");
        setEditor(editors.find((target) => target.preferred) ?? editors[0] ?? null);
      },
      () => {
        editorTargets.delete(key);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connectionID, enabled, sessionID]);
  return editor;
}

/** A web link in plain text that opens like Markdown links and has the link menu. */
export function WebLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const actions = useLinkActions();
  return (
    <WebLinkMenu url={href}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "text-info underline underline-offset-2 [overflow-wrap:anywhere] outline-none focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (actions.openWebLink) actions.openWebLink(href);
          else void palot.openExternalUrl(href);
        }}
      >
        {children}
      </a>
    </WebLinkMenu>
  );
}

/**
 * Plain text with its http(s) URLs as links. Use where text is not Markdown: questions,
 * form descriptions, permission details and errors. Backtick code stays plain.
 */
export function LinkedText({ text }: { text: string }) {
  const segments = useMemo(() => linkSegments(text), [text]);
  if (!segments.some((segment) => segment.href)) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.href ? (
          <WebLink key={index} href={segment.href}>
            {segment.text}
          </WebLink>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
